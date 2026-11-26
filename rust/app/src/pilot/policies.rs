use crate::{ApiResult, AppError, AppState, User, ai::context::redact};
use axum::{Extension, Json, extract::State};
use regex::Regex;
use serde_json::{Value, json};

const DEFAULT_ENVS: &[&str] = &[
    "dev",
    "development",
    "sit",
    "uat",
    "staging",
    "qa",
    "nonprod",
    "sandbox",
];

pub fn load_policy(state: &AppState, user_id: &str) -> Result<Value, AppError> {
    let row = state.db.one(
        "SELECT * FROM user_policies WHERE user_id=?",
        &[json!(user_id)],
    )?;
    if let Some(row) = row {
        let envs: Value = serde_json::from_str(
            row["allowed_nonprod_envs"].as_str().unwrap_or("[]"),
        )
        .unwrap_or_else(|_| json!(DEFAULT_ENVS));
        let patterns: Value = serde_json::from_str(
            row["custom_redaction_patterns"].as_str().unwrap_or("[]"),
        )
        .unwrap_or_else(|_| json!([]));
        let commands: Value = serde_json::from_str(
            row["allowed_test_commands"].as_str().unwrap_or("[]"),
        )
        .unwrap_or_else(|_| json!([]));
        return Ok(json!({
            "allowedNonprodEnvs": envs,
            "customRedactionPatterns": patterns,
            "maxAiPayloadChars": row["max_ai_payload_chars"].as_i64().unwrap_or(32_000),
            "allowedTestCommands": commands,
        }));
    }
    Ok(json!({
        "allowedNonprodEnvs": DEFAULT_ENVS,
        "customRedactionPatterns": [],
        "maxAiPayloadChars": 32_000,
        "allowedTestCommands": [],
    }))
}

pub fn redact_for_user(state: &AppState, user_id: &str, input: &str) -> String {
    let mut output = redact(input);
    if let Ok(policy) = load_policy(state, user_id)
        && let Some(patterns) = policy["customRedactionPatterns"].as_array()
    {
        for pat in patterns.iter().filter_map(Value::as_str).take(20) {
            if let Ok(re) = Regex::new(pat) {
                output = re.replace_all(&output, "[REDACTED]").into_owned();
            }
        }
    }
    output
}

pub fn is_env_allowed(state: &AppState, user_id: &str, env: &str) -> bool {
    let lower = env.trim().to_ascii_lowercase();
    if lower.is_empty()
        || matches!(lower.as_str(), "prod" | "production" | "prd" | "live")
        || lower.contains("prod") && !lower.contains("nonprod")
    {
        return false;
    }
    if let Ok(policy) = load_policy(state, user_id)
        && let Some(list) = policy["allowedNonprodEnvs"].as_array()
    {
        return list
            .iter()
            .filter_map(Value::as_str)
            .any(|item| item.trim().eq_ignore_ascii_case(&lower));
    }
    DEFAULT_ENVS.iter().any(|item| item.eq_ignore_ascii_case(&lower))
}

pub async fn get_policies(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
) -> ApiResult {
    let policy = load_policy(&state, &user.id)?;
    Ok(Json(json!({ "policy": policy })))
}

pub async fn save_policies(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let envs: Vec<String> = body
        .get("allowedNonprodEnvs")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty() && !s.contains("prod") || s == "nonprod")
                .take(30)
                .collect()
        })
        .unwrap_or_else(|| DEFAULT_ENVS.iter().map(|s| (*s).to_owned()).collect());
    if envs.is_empty() {
        return Err(AppError::bad_request(
            "Minimal satu environment non-produksi harus diizinkan.",
        ));
    }

    let patterns: Vec<String> = body
        .get("customRedactionPatterns")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
                .take(20)
                .collect()
        })
        .unwrap_or_default();
    for pat in &patterns {
        if pat.len() > 200 || pat.contains("(.*)+") || pat.contains("(.+)+") {
            return Err(AppError::bad_request(format!(
                "Pola regex redaksi berisiko atau terlalu panjang: {pat}"
            )));
        }
        Regex::new(pat).map_err(|_| {
            AppError::bad_request(format!("Regex redaksi tidak valid: {pat}"))
        })?;
    }

    let max_chars = body
        .get("maxAiPayloadChars")
        .and_then(Value::as_i64)
        .unwrap_or(32_000)
        .clamp(2_000, 100_000);

    let commands: Vec<String> = body
        .get("allowedTestCommands")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(|s| s.trim().to_owned())
                .filter(|s| {
                    !s.is_empty()
                        && s.len() <= 160
                        && !s.contains("&&")
                        && !s.contains(';')
                        && !s.contains('|')
                        && !s.contains('`')
                        && !s.contains("$(")
                })
                .take(20)
                .collect()
        })
        .unwrap_or_default();

    state.db.execute(
        "INSERT INTO user_policies(user_id,allowed_nonprod_envs,custom_redaction_patterns,max_ai_payload_chars,allowed_test_commands,updated_at)
         VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           allowed_nonprod_envs=excluded.allowed_nonprod_envs,
           custom_redaction_patterns=excluded.custom_redaction_patterns,
           max_ai_payload_chars=excluded.max_ai_payload_chars,
           allowed_test_commands=excluded.allowed_test_commands,
           updated_at=CURRENT_TIMESTAMP",
        &[
            json!(user.id),
            json!(json!(envs).to_string()),
            json!(json!(patterns).to_string()),
            json!(max_chars),
            json!(json!(commands).to_string()),
        ],
    )?;
    let saved = load_policy(&state, &user.id)?;
    Ok(Json(json!({ "policy": saved })))
}
