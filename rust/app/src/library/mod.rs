use crate::{ApiResult, AppError, AppState, User};
use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    routing::{get, patch},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/library/apps", get(apps))
        .route("/api/library/apps/{id}", patch(toggle))
        .merge(skills::router())
}

pub(crate) mod skills;

const NATIVE: [(&str, &str); 4] = [
    (
        "vm-machines",
        "SELECT id,label,host AS endpoint,port,username AS account,'SSH' AS auth FROM vms WHERE user_id=? ORDER BY label",
    ),
    (
        "databases",
        "SELECT id,label,host AS endpoint,port,db_username AS account,db_type AS auth FROM database_connections WHERE user_id=? ORDER BY label",
    ),
    (
        "konga",
        "SELECT 'kong' AS id,'Kong Admin API' AS label,admin_url AS endpoint,CASE WHEN token_encrypted='' THEN 'URL' ELSE 'Token' END AS auth FROM kong_connections WHERE user_id=? AND admin_url<>''",
    ),
    (
        "openshift",
        "SELECT id,label,api_url AS endpoint,username AS account,auth_type AS auth FROM openshift_clusters WHERE user_id=? ORDER BY label",
    ),
];
const CONNECTOR_APPS: [(&str, &str); 7] = [
    ("bamboo", "bamboo"),
    ("sonarqube", "sonarqube"),
    ("jira", "jira"),
    ("bitbucket", "code-review"),
    ("ghes", "code-review"),
    ("checkmarx", "checkmarx"),
    ("confluent", "confluent"),
];

fn clean_endpoint(value: &str) -> String {
    if let Ok(mut url) = url::Url::parse(value)
        && matches!(url.scheme(), "http" | "https")
    {
        let _ = url.set_username("");
        let _ = url.set_password(None);
        url.set_query(None);
        url.set_fragment(None);
        return url.into();
    }
    value.chars().take(512).collect()
}

fn connections(
    state: &AppState,
    user: &str,
) -> Result<BTreeMap<&'static str, Vec<Value>>, AppError> {
    let mut entries = BTreeMap::<&'static str, Vec<Value>>::new();
    for (id, sql) in NATIVE {
        entries.insert(id, state.db.query(sql, &[json!(user)])?);
    }
    let connectors = state.db.query(
        "SELECT id,kind,label,base_url AS endpoint,auth_type AS auth,enabled,last_status AS status,last_version AS version,last_checked_at AS checked_at
         FROM pilot_connectors WHERE user_id=? AND token_encrypted<>'' ORDER BY label", &[json!(user)],
    )?;
    for (kind, id) in CONNECTOR_APPS {
        entries
            .entry(id)
            .or_default()
            .extend(connectors.iter().filter(|row| row["kind"] == kind).cloned());
    }
    entries.insert("mcp", state.db.query(
        "SELECT id,label,CASE WHEN transport='http' THEN target ELSE '' END AS endpoint,transport AS auth,enabled,last_status AS status
         FROM mcp_servers WHERE user_id=? ORDER BY label", &[json!(user)],
    )?);
    for connection in entries.values_mut().flatten() {
        if let Some(endpoint) = connection["endpoint"].as_str() {
            connection["endpoint"] = json!(clean_endpoint(endpoint));
        }
    }
    Ok(entries)
}

fn snapshot(state: &AppState, user: &str) -> Result<Value, AppError> {
    let prefs = state.db.query(
        "SELECT scope,value FROM ui_preferences WHERE user_id=? AND scope LIKE 'library-app-%'",
        &[json!(user)],
    )?;
    let values = connections(state, user)?
        .into_iter()
        .map(|(id, connections)| {
            let ready = connections
                .iter()
                .any(|connection| connection["enabled"].as_i64() != Some(0));
            let scope = format!("library-app-{id}");
            let preference = prefs.iter().find(|pref| pref["scope"] == scope);
            let enabled = ready && preference.is_some_and(|pref| pref["value"] == "true");
            (
                id,
                json!({"connections":connections,"ready":ready,"enabled":enabled}),
            )
        })
        .collect::<BTreeMap<_, _>>();
    Ok(json!({"apps":values}))
}

async fn apps(State(state): State<AppState>, Extension(user): Extension<User>) -> ApiResult {
    Ok(Json(snapshot(&state, &user.id)?))
}

#[derive(Deserialize)]
struct Toggle {
    enabled: bool,
}

async fn toggle(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(input): Json<Toggle>,
) -> ApiResult {
    let before = snapshot(&state, &user.id)?;
    let item = &before["apps"][&id];
    if item.is_null() {
        return Err(AppError::not_found("Aplikasi Library tidak ditemukan."));
    }
    if input.enabled && item["ready"] != true {
        return Err(AppError::bad_request(
            "Tambahkan atau aktifkan koneksi terlebih dahulu.",
        ));
    }
    state.db.execute(
        "INSERT INTO ui_preferences(user_id,scope,value) VALUES(?,?,?) ON CONFLICT(user_id,scope) DO UPDATE SET value=excluded.value",
        &[json!(user.id),json!(format!("library-app-{id}")),json!(input.enabled.to_string())],
    )?;
    Ok(Json(snapshot(&state, &user.id)?))
}
