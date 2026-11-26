use crate::{ApiResult, AppError, AppState, User, ai::context::redact};
use axum::{
    Extension, Json,
    extract::{Path, State},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MAX_EXCERPT_CHARS: usize = 32_000;
const MAX_SARIF_BYTES: usize = 2 * 1024 * 1024;

fn opt_str(body: &Value, key: &str, max_len: usize) -> Result<String, AppError> {
    let raw = body.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if raw.chars().count() > max_len {
        return Err(AppError::bad_request(format!("{key} terlalu panjang.")));
    }
    Ok(raw.to_owned())
}

fn require_case(
    state: &AppState,
    user_id: &str,
    case_id: &str,
) -> Result<Value, AppError> {
    state
        .db
        .one(
            "SELECT * FROM evidence_cases WHERE id=? AND user_id=?",
            &[json!(case_id), json!(user_id)],
        )?
        .ok_or_else(|| AppError::not_found("Evidence Case tidak ditemukan."))
}

pub async fn list_cases(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
) -> ApiResult {
    let cases = state.db.query(
        "SELECT c.*, (SELECT COUNT(*) FROM evidence_items e WHERE e.case_id=c.id AND e.user_id=c.user_id) AS evidence_count
         FROM evidence_cases c WHERE c.user_id=? ORDER BY c.updated_at DESC, c.created_at DESC",
        &[json!(user.id)],
    )?;
    Ok(Json(json!({ "cases": cases })))
}

pub async fn save_case(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let title = opt_str(&body, "title", 180)?;
    if title.is_empty() {
        return Err(AppError::bad_request("Judul kasus wajib diisi."));
    }
    let service_name = opt_str(&body, "serviceName", 120)?;
    let environment = opt_str(&body, "environment", 60)?;
    let namespace_name = opt_str(&body, "namespace", 120)?;
    let workload_name = opt_str(&body, "workload", 120)?;
    let repo_path = opt_str(&body, "repoPath", 400)?;
    let revision = opt_str(&body, "revision", 80)?;
    let id = opt_str(&body, "id", 80)?;

    let case_id = if id.is_empty() {
        let new_id = Uuid::new_v4().to_string();
        state.db.execute(
            "INSERT INTO evidence_cases(id,user_id,title,service_name,environment,namespace_name,workload_name,repo_path,revision) VALUES(?,?,?,?,?,?,?,?,?)",
            &[
                json!(new_id),
                json!(user.id),
                json!(title),
                json!(service_name),
                json!(environment),
                json!(namespace_name),
                json!(workload_name),
                json!(repo_path),
                json!(revision),
            ],
        )?;
        new_id
    } else {
        require_case(&state, &user.id, &id)?;
        state.db.execute(
            "UPDATE evidence_cases SET title=?,service_name=?,environment=?,namespace_name=?,workload_name=?,repo_path=?,revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
            &[
                json!(title),
                json!(service_name),
                json!(environment),
                json!(namespace_name),
                json!(workload_name),
                json!(repo_path),
                json!(revision),
                json!(id),
                json!(user.id),
            ],
        )?;
        id
    };
    let case = require_case(&state, &user.id, &case_id)?;
    Ok(Json(json!({ "case": case })))
}

pub async fn get_case(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let case = require_case(&state, &user.id, &id)?;
    let items = state.db.query(
        "SELECT * FROM evidence_items WHERE case_id=? AND user_id=? ORDER BY created_at DESC",
        &[json!(id), json!(user.id)],
    )?;
    Ok(Json(json!({ "case": case, "items": items })))
}

pub async fn delete_case(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let deleted = state.db.execute(
        "DELETE FROM evidence_cases WHERE id=? AND user_id=?",
        &[json!(id), json!(user.id)],
    )?;
    if deleted == 0 {
        return Err(AppError::not_found("Evidence Case tidak ditemukan."));
    }
    Ok(Json(json!({ "deleted": true })))
}

pub async fn add_evidence(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(case_id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    require_case(&state, &user.id, &case_id)?;
    let raw_content = body
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if raw_content.is_empty() {
        return Err(AppError::bad_request(
            "Cuplikan log atau bukti tidak boleh kosong.",
        ));
    }
    let source_type = match body.get("sourceType").and_then(Value::as_str).unwrap_or("openshift_log") {
        "openshift_log" | "sarif" | "ci_run" | "note" => {
            body.get("sourceType").and_then(Value::as_str).unwrap_or("openshift_log")
        }
        _ => return Err(AppError::bad_request("Tipe evidence tidak didukung.")),
    };
    let cluster_label = opt_str(&body, "clusterLabel", 120)?;
    let namespace_name = opt_str(&body, "namespace", 120)?;
    let pod_name = opt_str(&body, "pod", 160)?;
    let source_url = opt_str(&body, "source", 300)?;
    let raw_time = opt_str(&body, "sourceTime", 80)?;
    let source_time = if raw_time.is_empty() {
        "tidak tersedia".to_owned()
    } else {
        raw_time
    };
    let bounded: String = raw_content.chars().take(MAX_EXCERPT_CHARS).collect();
    let redacted = redact(&bounded);
    let redaction_status = if redacted != bounded {
        "redacted"
    } else {
        "clean"
    };
    let item_id = Uuid::new_v4().to_string();
    let metadata = body
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    state.db.execute(
        "INSERT INTO evidence_items(id,case_id,user_id,source_type,cluster_label,namespace_name,pod_name,source_url,source_time,redaction_status,content,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        &[
            json!(item_id),
            json!(case_id),
            json!(user.id),
            json!(source_type),
            json!(cluster_label),
            json!(namespace_name),
            json!(pod_name),
            json!(source_url),
            json!(source_time),
            json!(redaction_status),
            json!(redacted),
            json!(metadata.to_string()),
        ],
    )?;
    state.db.execute(
        "UPDATE evidence_cases SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
        &[json!(case_id), json!(user.id)],
    )?;
    let item = state
        .db
        .one(
            "SELECT * FROM evidence_items WHERE id=? AND user_id=?",
            &[json!(item_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::internal("Evidence tidak tersimpan."))?;
    Ok(Json(json!({ "item": item })))
}

pub async fn delete_evidence(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((case_id, item_id)): Path<(String, String)>,
) -> ApiResult {
    let deleted = state.db.execute(
        "DELETE FROM evidence_items WHERE id=? AND case_id=? AND user_id=?",
        &[json!(item_id), json!(case_id), json!(user.id)],
    )?;
    if deleted == 0 {
        return Err(AppError::not_found("Evidence Item tidak ditemukan."));
    }
    Ok(Json(json!({ "deleted": true })))
}

pub async fn import_sarif(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(case_id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    require_case(&state, &user.id, &case_id)?;
    let raw = body
        .get("sarif")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::bad_request("Konten SARIF wajib berupa teks JSON."))?;
    if raw.len() > MAX_SARIF_BYTES {
        return Err(AppError::bad_request(
            "Ukuran file SARIF melebihi batas 2 MB.",
        ));
    }
    let parsed: Value = serde_json::from_str(raw)
        .map_err(|_| AppError::bad_request("Format JSON SARIF tidak valid atau rusak."))?;
    let runs = parsed
        .get("runs")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::bad_request("Dokumen bukan SARIF 2.1.0 (field runs tidak ditemukan)."))?;
    let source_name = opt_str(&body, "sourceName", 160)?;
    let revision = opt_str(&body, "revision", 80)?;

    let existing_keys: Vec<String> = state
        .db
        .query(
            "SELECT dedup_key FROM evidence_items WHERE case_id=? AND user_id=? AND source_type='sarif' AND dedup_key!=''",
            &[json!(case_id), json!(user.id)],
        )?
        .into_iter()
        .filter_map(|row| row["dedup_key"].as_str().map(String::from))
        .collect();

    let mut imported = 0usize;
    let mut duplicates = 0usize;
    for run in runs {
        let tool = run["tool"]["driver"]["name"]
            .as_str()
            .unwrap_or("sarif-scanner");
        let results = match run.get("results").and_then(Value::as_array) {
            Some(list) => list,
            None => continue,
        };
        for result in results {
            let rule = result["ruleId"].as_str().unwrap_or("unknown-rule");
            let severity = result["level"].as_str().unwrap_or("warning");
            let message = result["message"]["text"].as_str().unwrap_or("");
            let loc = &result["locations"][0]["physicalLocation"];
            let file = loc["artifactLocation"]["uri"].as_str().unwrap_or("");
            let line = loc["region"]["startLine"].as_u64().unwrap_or(0);
            let fp = result["partialFingerprints"]["primaryLocationLineHash"]
                .as_str()
                .unwrap_or("");
            let dedup_input = if !fp.is_empty() {
                format!("{tool}:{rule}:{fp}")
            } else {
                format!("{tool}:{rule}:{file}:{line}:{message}")
            };
            let dedup_key = hex::encode(Sha256::digest(dedup_input.as_bytes()));
            if existing_keys.contains(&dedup_key) {
                duplicates += 1;
                continue;
            }
            let content = redact(&format!(
                "[{severity}] {rule} ({tool})\nFile: {file}:{line}\nRevision: {}\nMessage: {message}",
                if revision.is_empty() { "tidak diketahui" } else { &revision }
            ));
            let meta = json!({
                "tool": tool,
                "ruleId": rule,
                "severity": severity,
                "file": file,
                "line": line,
                "revision": revision,
            });
            state.db.execute(
                "INSERT INTO evidence_items(id,case_id,user_id,source_type,source_url,source_time,redaction_status,dedup_key,content,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?)",
                &[
                    json!(Uuid::new_v4().to_string()),
                    json!(case_id),
                    json!(user.id),
                    json!("sarif"),
                    json!(if source_name.is_empty() { tool } else { &source_name }),
                    json!("sarif-import"),
                    json!("clean"),
                    json!(dedup_key),
                    json!(content),
                    json!(meta.to_string()),
                ],
            )?;
            imported += 1;
        }
    }
    Ok(Json(json!({ "imported": imported, "duplicates": duplicates })))
}

pub async fn preview_ai_send(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let provider = body
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("openai")
        .trim()
        .to_owned();
    let case_id = body
        .get("caseId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let message = body
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let log_text = body
        .get("logText")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let evidence_ids: Vec<String> = body
        .get("evidenceIds")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let mut evidence_refs = Vec::new();
    let mut payload_parts = Vec::new();
    if !message.is_empty() {
        payload_parts.push(format!(
            "[Pertanyaan/Instruksi Pengguna]\n{}",
            super::policies::redact_for_user(&state, &user.id, &message)
        ));
    }
    if !log_text.is_empty() {
        let bounded: String = log_text.chars().take(24_000).collect();
        payload_parts.push(format!(
            "[Log Teredaksi]\n{}",
            super::policies::redact_for_user(&state, &user.id, &bounded)
        ));
    }
    if !case_id.is_empty() {
        let case_row = require_case(&state, &user.id, &case_id)?;
        payload_parts.push(format!(
            "[Evidence Case: {} | service={} | env={}]",
            case_row["title"].as_str().unwrap_or(""),
            case_row["service_name"].as_str().unwrap_or(""),
            case_row["environment"].as_str().unwrap_or("")
        ));
        for eid in &evidence_ids {
            if let Some(item) = state.db.one(
                "SELECT id,source_type,cluster_label,namespace_name,pod_name,source_time,redaction_status,content FROM evidence_items WHERE id=? AND case_id=? AND user_id=?",
                &[json!(eid), json!(case_id), json!(user.id)],
            )? {
                let text = super::policies::redact_for_user(
                    &state,
                    &user.id,
                    item["content"].as_str().unwrap_or(""),
                );
                evidence_refs.push(json!({
                    "id": item["id"],
                    "sourceType": item["source_type"],
                    "pod": item["pod_name"],
                    "namespace": item["namespace_name"],
                    "sourceTime": item["source_time"],
                    "redactionStatus": item["redaction_status"],
                }));
                payload_parts.push(format!(
                    "<evidence_item id=\"{}\" type=\"{}\" time=\"{}\">\n{}\n</evidence_item>",
                    item["id"].as_str().unwrap_or(""),
                    item["source_type"].as_str().unwrap_or(""),
                    item["source_time"].as_str().unwrap_or(""),
                    text
                ));
            }
        }
    }
    let policy = super::policies::load_policy(&state, &user.id)?;
    let max_chars = policy["maxAiPayloadChars"].as_u64().unwrap_or(32_000) as usize;
    let full_payload = payload_parts.join("\n\n");
    let total_chars = full_payload.chars().count();
    let redacted_payload: String = full_payload.chars().take(max_chars).collect();
    let conn_model = crate::ai::settings::connection(&state, &provider)
        .map(|c| c.model)
        .unwrap_or_default();
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&conn_model)
        .to_owned();
    Ok(Json(json!({
        "destination": {
            "provider": provider,
            "model": model,
        },
        "evidenceRefs": evidence_refs,
        "redactedPayload": redacted_payload,
        "totalChars": total_chars,
        "truncated": total_chars > max_chars,
        "promptInjectionGuard": "Semua isi log/evidence diperlakukan sebagai data kutipan, bukan instruksi.",
    })))
}
