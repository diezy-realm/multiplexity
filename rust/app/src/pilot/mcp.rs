use crate::{ApiResult, AppError, AppState, User};
use axum::{
    Extension, Json,
    extract::{Path, State},
};
use serde_json::{Value, json};
use std::time::Duration;
use uuid::Uuid;

fn sanitize_mcp(row: &Value) -> Value {
    let tools: Value = serde_json::from_str(row["tools_json"].as_str().unwrap_or("[]"))
        .unwrap_or_else(|_| json!([]));
    let args: Value = serde_json::from_str(row["args_json"].as_str().unwrap_or("[]"))
        .unwrap_or_else(|_| json!([]));
    json!({
        "id": row["id"],
        "label": row["label"],
        "transport": row["transport"],
        "target": row["target"],
        "args": args,
        "enabled": row["enabled"].as_i64().unwrap_or(1) != 0,
        "lastStatus": row["last_status"],
        "tools": tools,
        "readOnly": true,
    })
}

pub async fn list_mcp(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
) -> ApiResult {
    let rows = state.db.query(
        "SELECT * FROM mcp_servers WHERE user_id=? ORDER BY updated_at DESC",
        &[json!(user.id)],
    )?;
    let servers: Vec<Value> = rows.iter().map(sanitize_mcp).collect();
    Ok(Json(json!({ "servers": servers })))
}

pub async fn save_mcp(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let label = body.get("label").and_then(Value::as_str).unwrap_or("").trim();
    let transport = body.get("transport").and_then(Value::as_str).unwrap_or("http");
    let target = body.get("target").and_then(Value::as_str).unwrap_or("").trim();
    if label.is_empty() || target.is_empty() || !matches!(transport, "stdio" | "http") {
        return Err(AppError::bad_request(
            "Label, transport (stdio/http), dan target wajib diisi.",
        ));
    }
    if transport == "http" {
        let parsed =
            url::Url::parse(target).map_err(|_| AppError::bad_request("URL MCP tidak valid."))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(AppError::bad_request("URL MCP harus http atau https."));
        }
    }
    let args = body.get("args").cloned().unwrap_or_else(|| json!([]));
    let token = body.get("token").and_then(Value::as_str).unwrap_or("").trim();
    let enc = if token.is_empty() {
        None
    } else {
        Some(state.db.encrypt(token)?)
    };
    let id = Uuid::new_v4().to_string();
    state.db.execute(
        "INSERT INTO mcp_servers(id,user_id,label,transport,target,args_json,token_encrypted,token_iv,token_auth_tag,insecure_tls) VALUES(?,?,?,?,?,?,?,?,?,?)",
        &[
            json!(id),
            json!(user.id),
            json!(label),
            json!(transport),
            json!(target),
            json!(args.to_string()),
            json!(enc.as_ref().map(|e| e.ciphertext.as_str()).unwrap_or("")),
            json!(enc.as_ref().map(|e| e.iv.as_str()).unwrap_or("")),
            json!(enc.as_ref().map(|e| e.auth_tag.as_str()).unwrap_or("")),
            json!(i64::from(body.get("insecureTls").and_then(Value::as_bool).unwrap_or(false))),
        ],
    )?;
    let row = state
        .db
        .one(
            "SELECT * FROM mcp_servers WHERE id=? AND user_id=?",
            &[json!(id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::internal("Server MCP gagal disimpan."))?;
    Ok(Json(json!({ "server": sanitize_mcp(&row) })))
}

pub async fn delete_mcp(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let deleted = state.db.execute(
        "DELETE FROM mcp_servers WHERE id=? AND user_id=?",
        &[json!(id), json!(user.id)],
    )?;
    if deleted == 0 {
        return Err(AppError::not_found("Server MCP tidak ditemukan."));
    }
    Ok(Json(json!({ "deleted": true })))
}

pub async fn probe_mcp(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let row = state
        .db
        .one(
            "SELECT * FROM mcp_servers WHERE id=? AND user_id=?",
            &[json!(id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Server MCP tidak ditemukan."))?;
    if row["transport"].as_str() != Some("http") {
        state.db.execute(
            "UPDATE mcp_servers SET last_status='configured',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
            &[json!(id), json!(user.id)],
        )?;
        return Ok(Json(json!({ "status": "configured", "tools": [] })));
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(row["insecure_tls"].as_i64().unwrap_or(0) != 0)
        .build()
        .map_err(|_| AppError::internal("HTTP client tidak tersedia."))?;
    let mut req = client.post(row["target"].as_str().unwrap_or("")).json(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    }));
    let ct = row["token_encrypted"].as_str().unwrap_or("");
    if !ct.is_empty() {
        let token = state.db.decrypt(
            ct,
            row["token_iv"].as_str().unwrap_or(""),
            row["token_auth_tag"].as_str().unwrap_or(""),
        )?;
        req = req.bearer_auth(token);
    }
    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            let body: Value = resp.json().await.unwrap_or_else(|_| json!({}));
            let tools = body["result"]["tools"].clone();
            let list = if tools.is_array() { tools } else { json!([]) };
            state.db.execute(
                "UPDATE mcp_servers SET last_status='ok',tools_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
                &[json!(list.to_string()), json!(id), json!(user.id)],
            )?;
            Ok(Json(json!({ "status": "ok", "tools": list })))
        }
        Ok(resp) => {
            state.db.execute(
                "UPDATE mcp_servers SET last_status='error',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
                &[json!(id), json!(user.id)],
            )?;
            Err(AppError::bad_request(format!("MCP tools/list HTTP {}", resp.status())))
        }
        Err(_) => Err(AppError::bad_request("Gagal menghubungi server MCP.")),
    }
}

pub async fn call_mcp_tool(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    if body.get("confirmed").and_then(Value::as_bool) != Some(true) {
        return Err(AppError::new(
            axum::http::StatusCode::PRECONDITION_REQUIRED,
            "Pemanggilan tool MCP memerlukan konfirmasi eksplisit pengguna.",
        ));
    }
    let tool_name = body
        .get("tool")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if tool_name.is_empty() {
        return Err(AppError::bad_request("Nama tool MCP wajib diisi."));
    }
    let row = state
        .db
        .one(
            "SELECT * FROM mcp_servers WHERE id=? AND user_id=?",
            &[json!(id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Server MCP tidak ditemukan."))?;
    if row["enabled"].as_i64().unwrap_or(1) == 0 {
        return Err(AppError::bad_request("Server MCP dinonaktifkan."));
    }
    if row["transport"].as_str() != Some("http") {
        return Err(AppError::bad_request(
            "Eksekusi langsung hanya mendukung transport Streamable HTTP pada fase ini.",
        ));
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .danger_accept_invalid_certs(row["insecure_tls"].as_i64().unwrap_or(0) != 0)
        .build()
        .map_err(|_| AppError::internal("HTTP client tidak tersedia."))?;
    let mut req = client.post(row["target"].as_str().unwrap_or("")).json(&json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": body.get("arguments").cloned().unwrap_or_else(|| json!({})),
        }
    }));
    let ct = row["token_encrypted"].as_str().unwrap_or("");
    if !ct.is_empty() {
        let token = state.db.decrypt(
            ct,
            row["token_iv"].as_str().unwrap_or(""),
            row["token_auth_tag"].as_str().unwrap_or(""),
        )?;
        req = req.bearer_auth(token);
    }
    let resp = req
        .send()
        .await
        .map_err(|_| AppError::bad_request("Gagal memanggil tool MCP."))?;
    let text = resp.text().await.unwrap_or_default();
    let bounded: String = text.chars().take(24_000).collect();
    let redacted = super::policies::redact_for_user(&state, &user.id, &bounded);
    Ok(Json(json!({ "tool": tool_name, "output": redacted, "readOnly": true })))
}
