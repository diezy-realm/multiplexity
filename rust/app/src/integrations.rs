use crate::{ApiResult, AppError, AppState, User};
use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    http::{HeaderMap, Method, StatusCode},
    routing::get,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use socketioxide::extract::{Data, SocketRef};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::mpsc;

const DEFAULT_ADMIN: &str = "http://172.18.139.190:4567";
const DEFAULT_CONSOLE: &str = "https://console-openshift-console.apps.ocp-new-dev.bri.co.id";
const DEFAULT_API: &str = "https://api.ocp-new-dev.bri.co.id:6443";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/konga",
            get(kong_get)
                .put(kong_save)
                .post(kong_create)
                .patch(kong_patch)
                .delete(kong_delete),
        )
        .route(
            "/api/openshift",
            get(ocp_get)
                .put(ocp_save)
                .post(ocp_action)
                .delete(ocp_delete),
        )
}

pub(crate) fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn param<'a>(q: &'a HashMap<String, String>, key: &str) -> &'a str {
    q.get(key).map(String::as_str).unwrap_or("")
}
fn bad(message: &str) -> AppError {
    AppError::bad_request(message)
}
pub fn valid_url(raw: &str) -> Result<String, AppError> {
    if raw.len() > 500 {
        return Err(bad("URL tidak valid."));
    }
    let parsed = url::Url::parse(raw.trim()).map_err(|_| bad("URL tidak valid."))?;
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    if !matches!(parsed.scheme(), "http" | "https")
        || host.is_empty()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || host.starts_with("169.254.")
        || host.starts_with("0.")
        || host.starts_with("[fe80:")
        || host.starts_with("[fd00:ec2:")
    {
        return Err(bad("URL tidak valid."));
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}
fn safe_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._~-".contains(&c))
}
fn k8s_name(value: &str) -> Result<&str, AppError> {
    if value.is_empty()
        || value.len() > 253
        || !value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        || !value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-".contains(&c))
    {
        return Err(bad("Nama resource tidak valid."));
    }
    Ok(value)
}
fn encoded(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn client(insecure: bool) -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(insecure)
        .build()
        .map_err(|_| AppError::internal("HTTP client tidak tersedia."))
}
async fn body_limited(response: reqwest::Response, limit: usize) -> Result<String, AppError> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(bad("Respons API terlalu besar."));
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| bad("Respons API terputus."))?;
        if body.len() + chunk.len() > limit {
            return Err(bad("Respons API terlalu besar."));
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| bad("Respons API bukan UTF-8."))
}
#[expect(
    clippy::too_many_arguments,
    reason = "Preserve explicit remote authentication and TLS policy"
)]
async fn remote_json(
    base: &str,
    token: &str,
    endpoint: &str,
    method: Method,
    data: Option<&Value>,
    kong: bool,
    insecure: bool,
    content_type: &str,
) -> Result<Value, AppError> {
    let client = client(insecure)?;
    let mut request = client
        .request(method, format!("{}{}", valid_url(base)?, endpoint))
        .header("Accept", "application/json");
    if !token.is_empty() {
        request = request.header(
            if kong {
                "Kong-Admin-Token"
            } else {
                "Authorization"
            },
            if kong {
                token.to_string()
            } else {
                format!("Bearer {token}")
            },
        );
    }
    if let Some(data) = data {
        request = request
            .header("Content-Type", content_type)
            .body(data.to_string());
    }
    let response = request
        .send()
        .await
        .map_err(|_| bad("API tidak dapat dihubungi. Periksa URL, jaringan, token, dan TLS."))?;
    if !response.status().is_success() {
        return Err(bad(match response.status().as_u16() {
            401 | 403 => "Akses API ditolak. Periksa token atau izin.",
            404 => "Resource API tidak ditemukan.",
            400 | 409 => "API menolak data. Periksa nama unik dan konfigurasi.",
            _ => "Permintaan API gagal.",
        }));
    }
    if response.status() == StatusCode::NO_CONTENT {
        return Ok(json!({"success":true}));
    }
    let body = body_limited(response, 4_000_000).await?;
    serde_json::from_str(&body)
        .map_err(|_| bad("Endpoint bukan JSON API. Gunakan URL Admin/API, bukan halaman console."))
}
fn connection(
    state: &AppState,
    user: &User,
    table: &str,
    id: Option<&str>,
) -> Result<Option<Value>, AppError> {
    if table == "kong_connections" {
        state.db.one(
            "SELECT * FROM kong_connections WHERE user_id=?",
            &[json!(user.id)],
        )
    } else if let Some(id) = id.filter(|s| !s.is_empty()) {
        state.db.one(
            "SELECT * FROM openshift_clusters WHERE user_id=? AND id=?",
            &[json!(user.id), json!(id)],
        )
    } else {
        state.db.one(
            "SELECT * FROM openshift_clusters WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
            &[json!(user.id)],
        )
    }
}
fn token(state: &AppState, row: &Value) -> Result<String, AppError> {
    state.db.decrypt(
        string(row, "token_encrypted"),
        string(row, "token_iv"),
        string(row, "token_auth_tag"),
    )
}
fn entity_data(entity: &str, data: &Value) -> Result<Value, AppError> {
    let name = string(data, "name");
    if !safe_name(name) {
        return Err(bad("Nama tidak valid."));
    }
    if entity == "services" {
        let value = valid_url(string(data, "url"))?;
        let url = url::Url::parse(&value).map_err(|_| bad("Upstream URL tidak valid."))?;
        return Ok(
            json!({"name":name,"protocol":url.scheme(),"host":url.host_str().unwrap_or("").trim_matches(['[',']']),"port":url.port_or_known_default(),"path":if url.path()=="/" {Value::Null} else {json!(url.path())}}),
        );
    }
    let paths = data["paths"]
        .as_array()
        .ok_or_else(|| bad("paths tidak valid."))?;
    let hosts = data["hosts"]
        .as_array()
        .ok_or_else(|| bad("hosts tidak valid."))?;
    if paths.len() > 32
        || hosts.len() > 32
        || paths.iter().any(|v| {
            !v.as_str()
                .is_some_and(|s| s.starts_with('/') && s.len() <= 256 && !s.contains(['\r', '\n']))
        })
        || hosts.iter().any(|v| {
            !v.as_str().is_some_and(|s| {
                !s.is_empty()
                    && s.len() <= 256
                    && s.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"*.-".contains(&c))
            })
        })
        || (paths.is_empty() && hosts.is_empty())
        || !safe_name(string(data, "serviceId"))
        || !data["strip_path"].is_boolean()
        || !data["preserve_host"].is_boolean()
    {
        return Err(bad("Opsi route tidak valid."));
    }
    Ok(
        json!({"name":name,"service":{"id":data["serviceId"]},"paths":if paths.is_empty(){Value::Null}else{json!(paths)},"hosts":if hosts.is_empty(){Value::Null}else{json!(hosts)},"strip_path":data["strip_path"],"preserve_host":data["preserve_host"]}),
    )
}
async fn kong_get(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult {
    let row = connection(&state, &user, "kong_connections", None)?;
    if param(&q, "entity") == "connection" {
        return Ok(Json(
            json!({"adminUrl":row.as_ref().map(|r|string(r,"admin_url")).unwrap_or(DEFAULT_ADMIN),"connected":row.is_some(),"hasToken":row.as_ref().is_some_and(|r|!string(r,"token_encrypted").is_empty())}),
        ));
    }
    let row = row.ok_or_else(|| {
        AppError::new(
            StatusCode::CONFLICT,
            "Hubungkan Kong Admin API terlebih dahulu.",
        )
    })?;
    let entity = param(&q, "entity");
    if !matches!(entity, "services" | "routes") {
        return Err(bad("Entity tidak valid."));
    }
    let offset = param(&q, "offset");
    if offset.len() > 512 || offset.contains(['\r', '\n']) {
        return Err(bad("Offset tidak valid."));
    }
    let endpoint = format!(
        "/{entity}?size=100{}",
        if offset.is_empty() {
            String::new()
        } else {
            format!("&offset={}", encoded(offset))
        }
    );
    let result = remote_json(
        string(&row, "admin_url"),
        &token(&state, &row)?,
        &endpoint,
        Method::GET,
        None,
        true,
        false,
        "application/json",
    )
    .await?;
    Ok(Json(
        json!({"data":result["data"],"offset":result.get("offset").unwrap_or(&Value::Null)}),
    ))
}
async fn kong_save(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let url = valid_url(string(&body, "adminUrl"))?;
    let previous = connection(&state, &user, "kong_connections", None)?;
    let entered = string(&body, "token");
    if entered.len() > 4000 || entered.contains(['\r', '\n']) {
        return Err(bad("Token tidak valid."));
    }
    let secret = if body["clearToken"] == true {
        String::new()
    } else if !entered.is_empty() {
        entered.to_string()
    } else if let Some(row) = previous.filter(|r| string(r, "admin_url") == url) {
        token(&state, &row)?
    } else {
        String::new()
    };
    let result = remote_json(
        &url,
        &secret,
        "/",
        Method::GET,
        None,
        true,
        false,
        "application/json",
    )
    .await?;
    if !result["version"].is_string() {
        return Err(bad("Endpoint bukan Kong Admin API."));
    }
    let encrypted = state.db.encrypt(&secret)?;
    state.db.execute("INSERT INTO kong_connections(user_id,admin_url,token_encrypted,token_iv,token_auth_tag) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET admin_url=excluded.admin_url,token_encrypted=excluded.token_encrypted,token_iv=excluded.token_iv,token_auth_tag=excluded.token_auth_tag", &[json!(user.id),json!(url),json!(encrypted.ciphertext),json!(encrypted.iv),json!(encrypted.auth_tag)])?;
    Ok(Json(json!({"success":true,"version":result["version"]})))
}
async fn kong_create(
    State(s): State<AppState>,
    Extension(u): Extension<User>,
    Json(b): Json<Value>,
) -> ApiResult {
    kong_mutate(s, u, b, Method::POST).await
}
async fn kong_patch(
    State(s): State<AppState>,
    Extension(u): Extension<User>,
    Json(b): Json<Value>,
) -> ApiResult {
    kong_mutate(s, u, b, Method::PATCH).await
}
async fn kong_delete(
    State(s): State<AppState>,
    Extension(u): Extension<User>,
    Json(b): Json<Value>,
) -> ApiResult {
    kong_mutate(s, u, b, Method::DELETE).await
}
pub(crate) async fn kong_mutate(state: AppState, user: User, body: Value, method: Method) -> ApiResult {
    if body.to_string().len() > 16000 {
        return Err(bad("Data terlalu besar."));
    }
    let entity = string(&body, "entity");
    if !matches!(entity, "services" | "routes") {
        return Err(bad("Entity tidak valid."));
    }
    let id = string(&body, "id");
    if method != Method::POST && !safe_name(id) {
        return Err(bad("ID tidak valid."));
    }
    let row = connection(&state, &user, "kong_connections", None)?
        .ok_or_else(|| bad("Hubungkan Kong Admin API terlebih dahulu."))?;
    let data = if method == Method::DELETE {
        None
    } else {
        Some(entity_data(entity, &body["data"])?)
    };
    let endpoint = format!(
        "/{entity}{}",
        if method == Method::POST {
            String::new()
        } else {
            format!("/{id}")
        }
    );
    Ok(Json(
        remote_json(
            string(&row, "admin_url"),
            &token(&state, &row)?,
            &endpoint,
            method,
            data.as_ref(),
            true,
            false,
            "application/json",
        )
        .await?,
    ))
}
fn public_cluster(row: &Value) -> Value {
    json!({"id":row["id"],"label":row["label"],"apiUrl":row["api_url"],"consoleUrl":row["console_url"],"authType":row["auth_type"],"idp":row["idp"],"username":row["username"],"insecureTls":row["insecure_tls"]==1,"hasToken":!string(row,"token_encrypted").is_empty()})
}
async fn ocp_get(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult {
    let entity = param(&q, "entity");
    if matches!(entity, "clusters" | "connection") {
        let rows=state.db.query("SELECT * FROM openshift_clusters WHERE user_id=? ORDER BY updated_at DESC,created_at DESC",&[json!(user.id)])?;
        let clusters: Vec<Value> = rows.iter().map(public_cluster).collect();
        let active = clusters
            .iter()
            .find(|r| string(r, "id") == param(&q, "clusterId"))
            .or(clusters.first());
        return Ok(Json(
            json!({"clusters":clusters,"connected":!rows.is_empty(),"apiUrl":active.map(|r|string(r,"apiUrl")).unwrap_or(DEFAULT_API),"consoleUrl":active.map(|r|string(r,"consoleUrl")).unwrap_or(DEFAULT_CONSOLE),"hasToken":active.map(|r|r["hasToken"].clone()).unwrap_or(json!(false)),"insecureTls":active.map(|r|r["insecureTls"].clone()).unwrap_or(json!(true))}),
        ));
    }
    let row = connection(
        &state,
        &user,
        "openshift_clusters",
        q.get("clusterId").map(String::as_str),
    )?
    .ok_or_else(|| {
        AppError::new(
            StatusCode::CONFLICT,
            "Hubungkan OpenShift API terlebih dahulu.",
        )
    })?;
    let secret = token(&state, &row)?;
    let base = string(&row, "api_url");
    let insecure = row["insecure_tls"] == 1;
    if entity == "projects" {
        let result = match remote_json(
            base,
            &secret,
            "/apis/project.openshift.io/v1/projects",
            Method::GET,
            None,
            false,
            insecure,
            "",
        )
        .await
        {
            Ok(r) => r,
            Err(_) => {
                remote_json(
                    base,
                    &secret,
                    "/api/v1/namespaces",
                    Method::GET,
                    None,
                    false,
                    insecure,
                    "",
                )
                .await?
            }
        };
        return Ok(Json(
            json!({"items":result.get("items").unwrap_or(&json!([]))}),
        ));
    }
    let project = k8s_name(param(&q, "project"))?;
    let endpoint = match entity {
        "pods" | "services" | "configmaps" => format!("/api/v1/namespaces/{project}/{entity}"),
        "routes" => format!("/apis/route.openshift.io/v1/namespaces/{project}/routes"),
        "deployments" => {
            let deployments_path = format!("/apis/apps/v1/namespaces/{project}/deployments");
            let configs_path =
                format!("/apis/apps.openshift.io/v1/namespaces/{project}/deploymentconfigs");
            let (deps, dcs) = tokio::join!(
                remote_json(
                    base,
                    &secret,
                    &deployments_path,
                    Method::GET,
                    None,
                    false,
                    insecure,
                    ""
                ),
                remote_json(
                    base,
                    &secret,
                    &configs_path,
                    Method::GET,
                    None,
                    false,
                    insecure,
                    ""
                )
            );
            let mut items = Vec::new();
            for result in [deps, dcs].into_iter().flatten() {
                if let Some(list) = result["items"].as_array() {
                    items.extend(list.iter().cloned());
                }
            }
            return Ok(Json(json!({"items":items})));
        }
        "configmap" => format!(
            "/api/v1/namespaces/{project}/configmaps/{}",
            k8s_name(param(&q, "name"))?
        ),
        "logs" => {
            let pod = k8s_name(param(&q, "pod"))?;
            let tail = param(&q, "tail")
                .parse::<u32>()
                .unwrap_or(300)
                .clamp(10, 2000);
            let container = param(&q, "container");
            let suffix = if container.is_empty() {
                String::new()
            } else {
                format!("&container={}", k8s_name(container)?)
            };
            let response = client(insecure)?
                .get(format!(
                    "{base}/api/v1/namespaces/{project}/pods/{pod}/log?tailLines={tail}{suffix}"
                ))
                .bearer_auth(secret)
                .send()
                .await
                .map_err(|_| bad("Log OpenShift tidak dapat dibaca."))?;
            if !response.status().is_success() {
                return Err(bad("Log OpenShift ditolak cluster."));
            }
            return Ok(Json(
                json!({"logs":body_limited(response,4_000_000).await?}),
            ));
        }
        _ => return Err(bad("Entity tidak valid.")),
    };
    let result = remote_json(
        base,
        &secret,
        &endpoint,
        Method::GET,
        None,
        false,
        insecure,
        "",
    )
    .await?;
    Ok(Json(if entity == "configmap" {
        json!({"item":result})
    } else {
        json!({"items":result.get("items").unwrap_or(&json!([]))})
    }))
}
fn derived_url(console: &str, oauth: bool) -> Result<String, AppError> {
    let url = url::Url::parse(console).map_err(|_| bad("URL tidak valid."))?;
    let host = url.host_str().unwrap_or("");
    if let Some(suffix) = host.strip_prefix("console-openshift-console.apps.") {
        Ok(if oauth {
            format!("https://oauth-openshift.apps.{suffix}")
        } else {
            format!("https://api.{suffix}:6443")
        })
    } else if oauth {
        if let Some(suffix) = host.strip_prefix("api.") {
            Ok(format!("https://oauth-openshift.apps.{suffix}"))
        } else {
            Ok(console.to_string())
        }
    } else {
        Ok(console.to_string())
    }
}
fn access_token(location: &str) -> Option<String> {
    let fragment = location.split_once('#')?.1;
    url::form_urlencoded::parse(fragment.as_bytes())
        .find(|(k, _)| k == "access_token")
        .map(|(_, v)| v.into_owned())
}
fn merge_cookies(jar: &mut HashMap<String, String>, headers: &HeaderMap) {
    for value in headers.get_all("set-cookie") {
        if let Ok(value) = value.to_str()
            && let Some((name, value)) = value.split(';').next().and_then(|v| v.split_once('='))
        {
            jar.insert(name.trim().into(), value.trim().into());
        }
    }
}
fn cookie_header(jar: &HashMap<String, String>) -> String {
    jar.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}
async fn oauth_login(
    api: &str,
    console: &str,
    username: &str,
    password: &str,
    idp: &str,
    insecure: bool,
) -> Result<String, AppError> {
    let client = client(insecure)?;
    let mut auth = derived_url(console, true)?;
    if let Ok(response) = client
        .get(format!("{api}/.well-known/oauth-authorization-server"))
        .send()
        .await
        && response.status().is_success()
        && let Ok(text) = body_limited(response, 100_000).await
        && let Ok(meta) = serde_json::from_str::<Value>(&text)
        && let Ok(url) = url::Url::parse(string(&meta, "authorization_endpoint"))
    {
        auth = url.origin().ascii_serialization();
    }
    auth = valid_url(&auth)?;
    let authorize = "/oauth/authorize?client_id=openshift-challenging-client&response_type=token";
    let direct = client
        .get(format!("{auth}{authorize}"))
        .header(
            "Authorization",
            format!(
                "Basic {}",
                STANDARD.encode(format!("{username}:{password}"))
            ),
        )
        .header("X-CSRF-Token", "1")
        .send()
        .await
        .map_err(|_| bad("OAuth OpenShift tidak dapat dihubungi."))?;
    if let Some(secret) = direct
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .and_then(access_token)
    {
        return Ok(secret);
    }
    let mut jar = HashMap::new();
    merge_cookies(&mut jar, direct.headers());
    let login = format!("{auth}/login/{}", encoded(idp));
    let page = client
        .get(format!("{login}?then={}", encoded(authorize)))
        .header("Cookie", cookie_header(&jar))
        .send()
        .await
        .map_err(|_| bad("Login OpenShift gagal."))?;
    merge_cookies(&mut jar, page.headers());
    let page = body_limited(page, 1_000_000).await?;
    let csrf = regex::Regex::new(r#"name=["']csrf["'][^>]*value=["']([^"']+)["']"#)
        .ok()
        .and_then(|r| {
            r.captures(&page)
                .and_then(|c| c.get(1).map(|v| v.as_str().to_string()))
        })
        .or_else(|| {
            regex::Regex::new(r#"value=["']([^"']+)["'][^>]*name=["']csrf["']"#)
                .ok()
                .and_then(|r| {
                    r.captures(&page)
                        .and_then(|c| c.get(1).map(|v| v.as_str().to_string()))
                })
        })
        .or_else(|| jar.get("csrf").cloned())
        .unwrap_or_default();
    let form = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("then", authorize)
        .append_pair("csrf", &csrf)
        .append_pair("username", username)
        .append_pair("password", password)
        .finish();
    let mut current = login.clone();
    let mut post = true;
    for _ in 0..6 {
        let mut req = client
            .request(if post { Method::POST } else { Method::GET }, &current)
            .header("Cookie", cookie_header(&jar));
        if post {
            req = req
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Origin", &auth)
                .header("Referer", &login)
                .body(form.clone());
        }
        let response = req
            .send()
            .await
            .map_err(|_| bad("Login OpenShift gagal."))?;
        merge_cookies(&mut jar, response.headers());
        if let Some(location) = response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
        {
            if let Some(secret) = access_token(location) {
                return Ok(secret);
            }
            if response.status().is_redirection() {
                let next = url::Url::parse(&current)
                    .and_then(|u| u.join(location))
                    .map_err(|_| bad("Redirect OAuth tidak valid."))?;
                if next.origin().ascii_serialization() != auth {
                    return Err(bad("Redirect OAuth lintas origin ditolak."));
                }
                current = next.to_string();
                post = false;
                continue;
            }
        }
        break;
    }
    Err(bad(
        "Login OpenShift gagal. Periksa username/password atau gunakan Bearer Token.",
    ))
}
async fn ocp_save(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let console = valid_url(if string(&body, "consoleUrl").is_empty() {
        DEFAULT_CONSOLE
    } else {
        string(&body, "consoleUrl")
    })?;
    let api = if string(&body, "apiUrl").trim().is_empty() {
        derived_url(&console, false)?
    } else {
        valid_url(string(&body, "apiUrl"))?
    };
    let previous = if string(&body, "clusterId").is_empty() {
        None
    } else {
        connection(
            &state,
            &user,
            "openshift_clusters",
            Some(string(&body, "clusterId")),
        )?
    };
    if !string(&body, "clusterId").is_empty() && previous.is_none() {
        return Err(AppError::not_found("Cluster tidak ditemukan."));
    }
    let insecure = body["insecureTls"] != false;
    let username = string(&body, "username").trim();
    let idp = if string(&body, "idp").trim().is_empty() {
        "Local Login"
    } else {
        string(&body, "idp").trim()
    };
    let (secret, auth_type) = if !username.is_empty() && !string(&body, "password").is_empty() {
        (
            oauth_login(
                &api,
                &console,
                username,
                string(&body, "password"),
                idp,
                insecure,
            )
            .await?,
            "oauth_password".to_string(),
        )
    } else {
        let secret = if body["clearToken"] == true {
            String::new()
        } else if !string(&body, "token").trim().is_empty() {
            string(&body, "token").trim().to_string()
        } else if let Some(ref row) = previous {
            if string(row, "api_url") == api {
                token(&state, row)?
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        (
            secret,
            previous
                .as_ref()
                .map(|r| string(r, "auth_type"))
                .unwrap_or("token")
                .to_string(),
        )
    };
    if secret.is_empty() || secret.len() > 16000 || secret.contains(['\r', '\n']) {
        return Err(bad(
            "Masukkan Bearer Token atau Username & Password OpenShift.",
        ));
    }
    let projects = match remote_json(
        &api,
        &secret,
        "/apis/project.openshift.io/v1/projects?limit=1",
        Method::GET,
        None,
        false,
        insecure,
        "",
    )
    .await
    {
        Ok(v) => v,
        Err(_) => {
            remote_json(
                &api,
                &secret,
                "/api/v1/namespaces?limit=1",
                Method::GET,
                None,
                false,
                insecure,
                "",
            )
            .await?
        }
    };
    let id = previous
        .as_ref()
        .map(|r| string(r, "id").to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
    let label = if string(&body, "label").trim().is_empty() {
        url::Url::parse(&console)
            .map(|u| u.host_str().unwrap_or("OpenShift").to_string())
            .unwrap_or_else(|_| "OpenShift".into())
    } else {
        string(&body, "label").trim().to_string()
    };
    if label.len() > 200 || idp.len() > 200 || username.len() > 300 {
        return Err(bad("Data cluster terlalu panjang."));
    }
    let encrypted = state.db.encrypt(&secret)?;
    state.db.execute("INSERT INTO openshift_clusters(id,user_id,label,api_url,console_url,auth_type,idp,username,token_encrypted,token_iv,token_auth_tag,insecure_tls) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,api_url=excluded.api_url,console_url=excluded.console_url,auth_type=excluded.auth_type,idp=excluded.idp,username=excluded.username,token_encrypted=excluded.token_encrypted,token_iv=excluded.token_iv,token_auth_tag=excluded.token_auth_tag,insecure_tls=excluded.insecure_tls,updated_at=CURRENT_TIMESTAMP",&[json!(id),json!(user.id),json!(label),json!(api),json!(console),json!(auth_type),json!(idp),json!(username),json!(encrypted.ciphertext),json!(encrypted.iv),json!(encrypted.auth_tag),json!(if insecure{1}else{0})])?;
    let row = connection(&state, &user, "openshift_clusters", Some(&id))?
        .ok_or_else(|| AppError::internal("Cluster tidak tersimpan."))?;
    Ok(Json(
        json!({"success":true,"cluster":public_cluster(&row),"apiUrl":api,"consoleUrl":console,"projectCount":projects["items"].as_array().map(Vec::len).unwrap_or(0)}),
    ))
}
async fn ocp_delete(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult {
    let id = param(&q, "clusterId");
    if id.is_empty() {
        return Err(bad("clusterId diperlukan."));
    }
    let removed = state.db.execute(
        "DELETE FROM openshift_clusters WHERE id=? AND user_id=?",
        &[json!(id), json!(user.id)],
    )?;
    Ok(Json(json!({"success":removed>0})))
}
pub(crate) async fn ocp_rollout_restart(
    state: &AppState,
    user: &User,
    cluster_id: &str,
    project: &str,
    name: &str,
    kind: &str,
) -> Result<Value, AppError> {
    let row = connection(
        state,
        user,
        "openshift_clusters",
        (!cluster_id.is_empty()).then_some(cluster_id),
    )?
    .ok_or_else(|| {
        AppError::new(
            StatusCode::CONFLICT,
            "Hubungkan OpenShift API terlebih dahulu.",
        )
    })?;
    let project = k8s_name(project)?;
    let name = k8s_name(name)?;
    let (endpoint, method, data, content_type) = if kind == "DeploymentConfig" {
        (
            format!(
                "/apis/apps.openshift.io/v1/namespaces/{project}/deploymentconfigs/{name}/instantiate"
            ),
            Method::POST,
            json!({"kind":"DeploymentRequest","apiVersion":"apps.openshift.io/v1","name":name,"latest":true,"force":true}),
            "application/json",
        )
    } else {
        (
            format!("/apis/apps/v1/namespaces/{project}/deployments/{name}"),
            Method::PATCH,
            json!({"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":chrono::Utc::now().to_rfc3339()}}}}}),
            "application/strategic-merge-patch+json",
        )
    };
    remote_json(
        string(&row, "api_url"),
        &token(state, &row)?,
        &endpoint,
        method,
        Some(&data),
        false,
        row["insecure_tls"] == 1,
        content_type,
    )
    .await
}

async fn ocp_action(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let row = connection(
        &state,
        &user,
        "openshift_clusters",
        body.get("clusterId").and_then(Value::as_str),
    )?
    .ok_or_else(|| {
        AppError::new(
            StatusCode::CONFLICT,
            "Hubungkan OpenShift API terlebih dahulu.",
        )
    })?;
    let project = k8s_name(string(&body, "project"))?;
    let name = k8s_name(string(&body, "name"))?;
    let (endpoint, method, data, content_type) = match string(&body, "action") {
        "rollout-restart" if string(&body, "kind") == "DeploymentConfig" => (
            format!(
                "/apis/apps.openshift.io/v1/namespaces/{project}/deploymentconfigs/{name}/instantiate"
            ),
            Method::POST,
            json!({"kind":"DeploymentRequest","apiVersion":"apps.openshift.io/v1","name":name,"latest":true,"force":true}),
            "application/json",
        ),
        "rollout-restart" => (
            format!("/apis/apps/v1/namespaces/{project}/deployments/{name}"),
            Method::PATCH,
            json!({"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":chrono::Utc::now().to_rfc3339()}}}}}),
            "application/strategic-merge-patch+json",
        ),
        "save-configmap" => {
            let data = body["data"]
                .as_object()
                .ok_or_else(|| bad("Data ConfigMap tidak valid."))?;
            if data.iter().any(|(k, v)| {
                k.is_empty()
                    || k.len() > 253
                    || !k
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"-._".contains(&c))
                    || !(v.is_string() || v.is_null())
            }) {
                return Err(bad("Data ConfigMap tidak valid."));
            }
            (
                format!("/api/v1/namespaces/{project}/configmaps/{name}"),
                Method::PATCH,
                json!({"data":data}),
                "application/merge-patch+json",
            )
        }
        _ => return Err(bad("Aksi tidak dikenal.")),
    };
    let result = remote_json(
        string(&row, "api_url"),
        &token(&state, &row)?,
        &endpoint,
        method,
        Some(&data),
        false,
        row["insecure_tls"] == 1,
        content_type,
    )
    .await?;
    Ok(Json(if string(&body, "action") == "save-configmap" {
        json!({"success":true,"item":result})
    } else {
        json!({"success":true,"result":result})
    }))
}

#[derive(Default)]
struct ExecSlot {
    generation: u64,
    sender: Option<mpsc::Sender<Vec<u8>>>,
}

pub fn register_ocp(socket: SocketRef, state: AppState, user: User) {
    let channel = Arc::new(Mutex::new(ExecSlot::default()));
    let current = channel.clone();
    let open_socket = socket.clone();
    socket.on("ocp:exec:open", move |Data(body): Data<Value>| {
        let state = state.clone();
        let user = user.clone();
        let socket = open_socket.clone();
        let current = current.clone();
        async move {
            let generation = if let Ok(mut active) = current.lock() {
                active.generation += 1;
                active.sender = None;
                active.generation
            } else {
                return;
            };
            let result = open_exec(&state, &user, &socket, &body, current, generation).await;
            if let Err(_error) = result {
                let _ = socket.emit(
                    "ocp:exec:error",
                    "Pod exec gagal. Periksa cluster, pod, token, dan TLS.",
                );
            }
        }
    });
    let input = channel.clone();
    socket.on(
        "ocp:exec:input",
        move |Data(value): Data<String>| async move {
            if value.len() <= 64000
                && let Ok(active) = input.lock()
                && let Some(sender) = active.sender.as_ref()
            {
                let mut data = vec![0];
                data.extend_from_slice(value.as_bytes());
                let _ = sender.try_send(data);
            }
        },
    );
    let resize = channel.clone();
    socket.on(
        "ocp:exec:resize",
        move |Data((cols, rows)): Data<(u16, u16)>| async move {
            if let Ok(active) = resize.lock()
                && let Some(sender) = active.sender.as_ref()
            {
                let mut data = vec![4];
                data.extend_from_slice(
                    json!({"Width":cols.clamp(10,500),"Height":rows.clamp(4,300)})
                        .to_string()
                        .as_bytes(),
                );
                let _ = sender.try_send(data);
            }
        },
    );
    let close = channel.clone();
    socket.on("ocp:exec:close", move |socket: SocketRef| async move {
        if let Ok(mut active) = close.lock() {
            active.generation += 1;
            active.sender = None;
        }
        let _ = socket.emit("ocp:exec:close", &());
    });
    socket.on_disconnect(move || async move {
        if let Ok(mut active) = channel.lock() {
            active.generation += 1;
            active.sender = None;
        }
    });
}
async fn open_exec(
    state: &AppState,
    user: &User,
    socket: &SocketRef,
    body: &Value,
    current: Arc<Mutex<ExecSlot>>,
    generation: u64,
) -> Result<(), AppError> {
    use tokio_tungstenite::{
        Connector,
        tungstenite::{Message, client::IntoClientRequest},
    };
    let namespace = k8s_name(string(body, "namespace"))?;
    let pod = k8s_name(string(body, "podName"))?;
    let row = connection(
        state,
        user,
        "openshift_clusters",
        body.get("clusterId").and_then(Value::as_str),
    )?
    .ok_or_else(|| bad("Cluster tidak ditemukan."))?;
    let secret = token(state, &row)?;
    let mut url =
        url::Url::parse(string(&row, "api_url")).map_err(|_| bad("URL cluster tidak valid."))?;
    let scheme = if url.scheme() == "http" { "ws" } else { "wss" };
    url.set_scheme(scheme)
        .map_err(|_| bad("URL cluster tidak valid."))?;
    url.set_path(&format!("/api/v1/namespaces/{namespace}/pods/{pod}/exec"));
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("stdin", "true")
            .append_pair("stdout", "true")
            .append_pair("stderr", "true")
            .append_pair("tty", "true")
            .append_pair(
                "command",
                if string(body, "shell") == "/bin/bash" {
                    "/bin/bash"
                } else {
                    "/bin/sh"
                },
            );
        if !string(body, "container").is_empty() {
            query.append_pair("container", k8s_name(string(body, "container"))?);
        }
    }
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| bad("URL exec tidak valid."))?;
    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {secret}")
            .parse()
            .map_err(|_| bad("Token tidak valid."))?,
    );
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        "v4.channel.k8s.io"
            .parse()
            .map_err(|_| AppError::internal("WebSocket protocol tidak valid."))?,
    );
    let mut tls = native_tls::TlsConnector::builder();
    if row["insecure_tls"] == 1 {
        tls.danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true);
    }
    let connector = tls
        .build()
        .map_err(|_| AppError::internal("TLS tidak tersedia."))?;
    let (mut ws, _) = tokio::time::timeout(
        Duration::from_secs(15),
        tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(Connector::NativeTls(connector)),
        ),
    )
    .await
    .map_err(|_| bad("Pod exec timeout."))?
    .map_err(|_| bad("Pod exec ditolak cluster."))?;
    let cols = body["cols"].as_u64().unwrap_or(80).clamp(10, 500);
    let rows = body["rows"].as_u64().unwrap_or(24).clamp(4, 300);
    let mut resize = vec![4];
    resize.extend_from_slice(json!({"Width":cols,"Height":rows}).to_string().as_bytes());
    ws.send(Message::Binary(resize.into()))
        .await
        .map_err(|_| bad("Resize exec gagal."))?;
    let (sender, mut receiver) = mpsc::channel::<Vec<u8>>(64);
    if let Ok(mut active) = current.lock() {
        if active.generation != generation {
            return Ok(());
        }
        active.sender = Some(sender);
    }
    let _ = socket.emit("ocp:exec:ready", &());
    loop {
        tokio::select! {
            value=receiver.recv()=>{match value{Some(data)=>if ws.send(Message::Binary(data.into())).await.is_err(){break;},None=>break}},
            value=ws.next()=>{match value{Some(Ok(Message::Binary(bytes)))=>{if bytes.len()>1{let text=String::from_utf8_lossy(&bytes[1..]);match bytes[0]{1|2=>{let _=socket.emit("ocp:exec:output",&text.as_ref());},3=>{if let Ok(status)=serde_json::from_str::<Value>(&text)&& string(&status,"status")!="Success"{let _=socket.emit("ocp:exec:error",&string(&status,"message"));}},_=>{}}}},Some(Ok(Message::Ping(bytes)))=>{let _=ws.send(Message::Pong(bytes)).await;},Some(Ok(Message::Close(_)))|Some(Err(_))|None=>break,_=>{}}}
        }
    }
    let _ = ws.close(None).await;
    if let Ok(mut active) = current.lock() {
        if active.generation != generation {
            return Ok(());
        }
        active.sender = None;
    }
    let _ = socket.emit("ocp:exec:close", &());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_urls_reject_credentials_and_metadata() {
        for url in [
            "file:///etc/passwd",
            "http://169.254.169.254",
            "http://user:password@localhost",
            "https://localhost?token=x",
        ] {
            assert!(valid_url(url).is_err());
        }
        assert_eq!(
            valid_url("http://localhost:8001/").unwrap(),
            "http://localhost:8001"
        );
    }
    #[test]
    fn routes_validate_exclusive_fields() {
        assert!(entity_data("routes",&json!({"name":"r","paths":[],"hosts":[],"serviceId":"s","strip_path":true,"preserve_host":false})).is_err());
        let service = entity_data(
            "services",
            &json!({"name":"api","url":"https://example.com/upstream"}),
        )
        .unwrap();
        assert_eq!(service["port"], 443);
        assert_eq!(service["path"], "/upstream");
    }
    #[test]
    fn oauth_fragment_and_console_derivation() {
        assert_eq!(
            access_token("https://host/#access_token=redacted&token_type=Bearer").as_deref(),
            Some("redacted")
        );
        assert_eq!(
            derived_url("https://console-openshift-console.apps.example.test", false).unwrap(),
            "https://api.example.test:6443"
        );
        assert!(k8s_name("pod/name").is_err());
    }

    #[tokio::test]
    async fn kong_remote_contract_preserves_header_and_rejects_redirects() {
        use axum::{http::HeaderMap, response::IntoResponse};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let remote = Router::new()
            .route(
                "/services",
                get(|headers: HeaderMap| async move {
                    assert_eq!(headers.get("kong-admin-token").unwrap(), "fixture-token");
                    Json(json!({"data":[{"name":"fixture-service"}]}))
                }),
            )
            .route(
                "/redirect",
                get(|| async {
                    (
                        StatusCode::FOUND,
                        [("location", "http://127.0.0.1:1/private")],
                    )
                        .into_response()
                }),
            );
        let task = tokio::spawn(async move {
            axum::serve(listener, remote).await.unwrap();
        });
        let base = format!("http://{address}");
        let result = remote_json(
            &base,
            "fixture-token",
            "/services",
            Method::GET,
            None,
            true,
            false,
            "",
        )
        .await
        .unwrap();
        assert_eq!(result["data"][0]["name"], "fixture-service");
        assert!(
            remote_json(
                &base,
                "fixture-token",
                "/redirect",
                Method::GET,
                None,
                true,
                false,
                ""
            )
            .await
            .is_err()
        );
        task.abort();
    }
}
