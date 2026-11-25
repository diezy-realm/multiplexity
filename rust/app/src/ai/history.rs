use super::settings::text;
use crate::{AppError, AppState};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub fn conversation(
    state: &AppState,
    user: &str,
    id: Option<&str>,
) -> Result<Option<Value>, AppError> {
    if let Some(id) = id {
        state.db.one(
            "SELECT id,title,archived,updated_at FROM ai_conversations WHERE user_id=? AND id=?",
            &[json!(user), json!(id)],
        )
    } else {
        state.db.one("SELECT id,title,archived,updated_at FROM ai_conversations WHERE user_id=? AND archived=0 ORDER BY updated_at DESC,rowid DESC LIMIT 1",&[json!(user)])
    }
}
pub fn create(state: &AppState, user: &str, title: &str) -> Result<Value, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    state.db.execute(
        "INSERT INTO ai_conversations(id,user_id,title,updated_at) VALUES(?,?,?,?)",
        &[
            json!(id),
            json!(user),
            json!(title),
            json!(chrono::Utc::now().to_rfc3339()),
        ],
    )?;
    conversation(state, user, Some(&id))?
        .ok_or_else(|| AppError::internal("Percakapan gagal dibuat."))
}
pub fn messages(state: &AppState, user: &str, id: &str) -> Result<Vec<Value>, AppError> {
    let rows=state.db.query("SELECT id,role,content,created_at,metadata FROM (SELECT * FROM ai_chat_messages WHERE user_id=? AND conversation_id=? ORDER BY id DESC LIMIT 100) ORDER BY id",&[json!(user),json!(id)])?;
    rows.into_iter()
        .map(|mut row| {
            let metadata: Value =
                serde_json::from_str(text(&row, "metadata")).unwrap_or_else(|_| json!({}));
            row.as_object_mut().map(|map| map.remove("metadata"));
            if let Some(metadata) = metadata.as_object() {
                for (key, value) in metadata {
                    if !matches!(key.as_str(), "id" | "role" | "content" | "created_at") {
                        row[key] = value.clone();
                    }
                }
            }
            if !text(&row, "created_at").contains('T') {
                row["created_at"] =
                    json!(format!("{}Z", text(&row, "created_at").replace(' ', "T")));
            }
            Ok(row)
        })
        .collect()
}
pub fn model_history(
    state: &AppState,
    user: &str,
    id: &str,
    selected: &[Value],
    before: i64,
) -> Result<Vec<Value>, AppError> {
    let rows=state.db.query("SELECT id,role,content,metadata FROM (SELECT * FROM ai_chat_messages WHERE user_id=? AND conversation_id=? AND id<? ORDER BY id DESC LIMIT 100) ORDER BY id",&[json!(user),json!(id),json!(before)])?;
    let root = |row: &Value| -> i64 {
        serde_json::from_str::<Value>(text(row, "metadata"))
            .ok()
            .and_then(|v| v["variantOf"].as_i64())
            .unwrap_or_else(|| row["id"].as_i64().unwrap_or(0))
    };
    let mut answers = HashMap::new();
    for row in &rows {
        if text(row, "role") == "assistant" {
            answers.insert(root(row), row);
        }
    }
    for selected in selected {
        let row = rows
            .iter()
            .find(|row| row["id"] == *selected && text(row, "role") == "assistant")
            .ok_or_else(|| {
                AppError::bad_request("Versi konteks tidak tersedia. Muat ulang percakapan.")
            })?;
        answers.insert(root(row), row);
    }
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    for row in &rows {
        if text(row, "role") == "user" {
            output.push(json!({"role":"user","content":row["content"]}));
        } else {
            let key = root(row);
            if seen.insert(key)
                && let Some(answer) = answers.get(&key)
            {
                output.push(json!({"role":"assistant","content":answer["content"]}));
            }
        }
    }
    Ok(output
        .into_iter()
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect())
}
pub fn regeneration(
    state: &AppState,
    user: &str,
    id: &str,
    message_id: i64,
) -> Result<(Value, Vec<Value>), AppError> {
    let selected=state.db.one("SELECT id,metadata FROM ai_chat_messages WHERE user_id=? AND conversation_id=? AND id=? AND role='assistant'",&[json!(user),json!(id),json!(message_id)])?.ok_or_else(||AppError::not_found("Jawaban tidak ditemukan."))?;
    let selected_meta: Value =
        serde_json::from_str(text(&selected, "metadata")).unwrap_or_else(|_| json!({}));
    let root = if let Some(root) = selected_meta["variantOf"].as_i64() {
        state.db.one("SELECT id,metadata FROM ai_chat_messages WHERE user_id=? AND conversation_id=? AND id=? AND role='assistant'",&[json!(user),json!(id),json!(root)])?.ok_or_else(||AppError::not_found("Jawaban asal tidak ditemukan."))?
    } else {
        selected
    };
    let metadata: Value =
        serde_json::from_str(text(&root, "metadata")).unwrap_or_else(|_| json!({}));
    if metadata["attachments"]
        .as_array()
        .is_some_and(|items| !items.is_empty())
    {
        return Err(AppError::bad_request(
            "Lampirkan ulang file sebagai pesan baru untuk mengulang analisis.",
        ));
    }
    let prompt=state.db.one("SELECT id,content FROM ai_chat_messages WHERE user_id=? AND conversation_id=? AND id<? AND role='user' ORDER BY id DESC LIMIT 1",&[json!(user),json!(id),root["id"].clone()])?.ok_or_else(||AppError::not_found("Pesan asal tidak ditemukan."))?;
    let history = model_history(state, user, id, &[], prompt["id"].as_i64().unwrap_or(0))?;
    Ok((
        json!({"message":prompt["content"],"variantOf":root["id"],"sources":metadata.get("contextSources").cloned().unwrap_or_else(||json!([])),"skill":metadata.get("skill").cloned().unwrap_or_else(||json!("")),"diagnostic":metadata.get("diagnostic").cloned().unwrap_or_else(||json!("logs")),"includeResources":metadata["includeResources"]==true}),
        history,
    ))
}
