use crate::{ApiResult, AppError, AppState, User, ai::context::redact};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use uuid::Uuid;

fn validate_restart_target(
    state: &AppState,
    user_id: &str,
    body: &Value,
) -> Result<(String, String, String, String, String), AppError> {
    let cluster_label = body.get("clusterLabel").and_then(Value::as_str).unwrap_or("").trim().to_owned();
    let namespace = body.get("namespace").and_then(Value::as_str).unwrap_or("").trim().to_owned();
    let workload = body.get("workload").and_then(Value::as_str).unwrap_or("").trim().to_owned();
    let kind = body.get("kind").and_then(Value::as_str).unwrap_or("Deployment").trim().to_owned();
    let env = body.get("environment").and_then(Value::as_str).unwrap_or("").trim().to_owned();
    if namespace.is_empty() || workload.is_empty() {
        return Err(AppError::bad_request("Namespace dan workload wajib diisi."));
    }
    if !matches!(kind.as_str(), "Deployment" | "DeploymentConfig") {
        return Err(AppError::bad_request("Kind harus Deployment atau DeploymentConfig."));
    }
    if !super::policies::is_env_allowed(state, user_id, &env) {
        return Err(AppError::forbidden(
            "Target produksi atau environment di luar kebijakan Settings → Policies ditolak.",
        ));
    }
    Ok((cluster_label, namespace, workload, kind, env))
}

pub async fn restart_preview(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(case_id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let _ = state
        .db
        .one(
            "SELECT id FROM evidence_cases WHERE id=? AND user_id=?",
            &[json!(case_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Evidence Case tidak ditemukan."))?;
    let (cluster_label, namespace, workload, kind, env) =
        validate_restart_target(&state, &user.id, &body)?;
    Ok(Json(json!({
        "preview": {
            "caseId": case_id,
            "cluster": if cluster_label.is_empty() { "default" } else { &cluster_label },
            "namespace": namespace,
            "workload": workload,
            "kind": kind,
            "environment": env,
            "impact": format!("Akan memicu rollout-restart pada {kind} {workload} di namespace {namespace} ({env}). Pod akan dibuat ulang secara bertahap."),
        }
    })))
}

pub async fn restart_execute(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(case_id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let _ = state
        .db
        .one(
            "SELECT id FROM evidence_cases WHERE id=? AND user_id=?",
            &[json!(case_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Evidence Case tidak ditemukan."))?;
    let cluster_id = body.get("clusterId").and_then(Value::as_str).unwrap_or("").trim().to_owned();
    let (cluster_label, namespace, workload, kind, env) =
        match validate_restart_target(&state, &user.id, &body) {
            Ok(target) => target,
            Err(err) => {
                let receipt_id = record_receipt(
                    &state,
                    &user,
                    Some(&case_id),
                    "rollout-restart",
                    &cluster_id,
                    body.get("clusterLabel").and_then(Value::as_str).unwrap_or(""),
                    body.get("namespace").and_then(Value::as_str).unwrap_or(""),
                    body.get("workload").and_then(Value::as_str).unwrap_or(""),
                    body.get("kind").and_then(Value::as_str).unwrap_or(""),
                    body.get("environment").and_then(Value::as_str).unwrap_or(""),
                    "denied",
                    &err.message,
                    "Ditolak sebelum eksekusi remote.",
                )?;
                return Ok(Json(json!({ "receiptId": receipt_id, "status": "denied", "error": err.message })));
            }
        };

    let simulated = body.get("simulatedOutcome").and_then(Value::as_str).unwrap_or("");
    let (status, summary, post_check) = if !simulated.is_empty() {
        match simulated {
            "success" => (
                "success",
                format!("Rollout restart {kind}/{workload} diterima cluster."),
                "Replicas siap dan rollout terpantau aktif.".to_owned(),
            ),
            "denied" => (
                "denied",
                "Izin cluster menolak aksi rollout-restart (HTTP 403).".to_owned(),
                "Tidak ada perubahan workload.".to_owned(),
            ),
            "timeout" => (
                "timeout",
                "Permintaan ke API cluster melebihi batas waktu.".to_owned(),
                "Periksa status pod secara manual di OpenShift.".to_owned(),
            ),
            _ => (
                "unknown",
                "Rollout dipicu namun status kesiapan pod belum selesai.".to_owned(),
                "Rollout masih berlangsung; verifikasi ulang kesiapan pod.".to_owned(),
            ),
        }
    } else if !cluster_id.is_empty() {
        match crate::integrations::ocp_rollout_restart(
            &state,
            &user,
            &cluster_id,
            &namespace,
            &workload,
            &kind,
        )
        .await
        {
            Ok(_) => (
                "success",
                format!("Rollout restart nyata dikirim ke {kind}/{workload} ({namespace})."),
                "Permintaan restart diterima API cluster OpenShift.".to_owned(),
            ),
            Err(err) if err.status == StatusCode::FORBIDDEN || err.status == StatusCode::UNAUTHORIZED => (
                "denied",
                err.message,
                "Tidak ada perubahan pada workload OpenShift.".to_owned(),
            ),
            Err(err) if err.message.to_ascii_lowercase().contains("timeout") => (
                "timeout",
                err.message,
                "Periksa kondisi rollout langsung pada OpenShift console.".to_owned(),
            ),
            Err(err) => (
                "unknown",
                err.message,
                "Status rollout tidak dapat dikonfirmasi.".to_owned(),
            ),
        }
    } else {
        (
            "unknown",
            "Cluster OpenShift aktif tidak dipilih; status tidak dapat dipastikan.".to_owned(),
            "Pilih cluster OpenShift pada Integrations/Openshift untuk eksekusi nyata.".to_owned(),
        )
    };

    let receipt_id = record_receipt(
        &state,
        &user,
        Some(&case_id),
        "rollout-restart",
        &cluster_id,
        &cluster_label,
        &namespace,
        &workload,
        &kind,
        &env,
        status,
        &summary,
        &post_check,
    )?;
    let receipt = state
        .db
        .one(
            "SELECT * FROM operation_receipts WHERE id=? AND user_id=?",
            &[json!(receipt_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::internal("Receipt tidak tersimpan."))?;
    Ok(Json(json!({ "receipt": receipt })))
}

pub async fn ops_preview(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let op_type = body.get("opType").and_then(Value::as_str).unwrap_or("");
    let env = body.get("environment").and_then(Value::as_str).unwrap_or("");
    if !super::policies::is_env_allowed(&state, &user.id, env) {
        return Err(AppError::forbidden(
            "Environment produksi atau belum diizinkan pada Settings → Policies.",
        ));
    }
    let target = body.get("target").and_then(Value::as_str).unwrap_or("").trim();
    if target.is_empty() || !matches!(op_type, "vm_service" | "vm_config" | "kong_mutate") {
        return Err(AppError::bad_request("Tipe operasi atau target tidak valid."));
    }
    Ok(Json(json!({
        "preview": {
            "opType": op_type,
            "target": target,
            "environment": env,
            "action": body.get("action").and_then(Value::as_str).unwrap_or("update"),
            "impact": format!("Operasi terkontrol {op_type} pada {target} ({env}) akan dicatat ke Activity."),
        }
    })))
}

pub async fn ops_execute(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let op_type = body.get("opType").and_then(Value::as_str).unwrap_or("");
    let env = body.get("environment").and_then(Value::as_str).unwrap_or("");
    let target = body.get("target").and_then(Value::as_str).unwrap_or("").trim();
    let case_id = body.get("caseId").and_then(Value::as_str);
    if !super::policies::is_env_allowed(&state, &user.id, env) {
        let rid = record_receipt(
            &state,
            &user,
            case_id,
            op_type,
            "",
            op_type,
            env,
            target,
            op_type,
            env,
            "denied",
            "Target ditolak oleh kebijakan non-produksi.",
            "Tidak ada perubahan.",
        )?;
        return Ok(Json(json!({ "receiptId": rid, "status": "denied" })));
    }
    let (status, summary, post_check) = match op_type {
        "vm_service" => {
            let vm_id = body.get("vmId").and_then(Value::as_str).unwrap_or("").to_owned();
            let res = crate::machines::service_action(
                State(state.clone()),
                Extension(user.clone()),
                Path(vm_id),
                Json(body.get("payload").cloned().unwrap_or_else(|| json!({}))),
            )
            .await;
            match res {
                Ok(_) => (
                    "success",
                    format!("Aksi systemd pada {target} berhasil dijalankan."),
                    "Periksa status service pada VM.",
                ),
                Err(err) => ("denied", err.message, "Aksi service VM gagal."),
            }
        }
        "vm_config" => {
            let vm_id = body.get("vmId").and_then(Value::as_str).unwrap_or("").to_owned();
            let res = crate::machines::save_file(
                State(state.clone()),
                Extension(user.clone()),
                Path(vm_id),
                Json(body.get("payload").cloned().unwrap_or_else(|| json!({}))),
            )
            .await;
            match res {
                Ok(_) => (
                    "success",
                    format!("Perubahan config {target} disimpan (backup dibuat)."),
                    "Validasi konfigurasi sebelum reload layanan.",
                ),
                Err(err) => ("denied", err.message, "Penyimpanan file config VM gagal."),
            }
        }
        "kong_mutate" => {
            let method_str = body.get("method").and_then(Value::as_str).unwrap_or("PATCH");
            let method = match method_str {
                "POST" => axum::http::Method::POST,
                "DELETE" => axum::http::Method::DELETE,
                _ => axum::http::Method::PATCH,
            };
            let res = crate::integrations::kong_mutate(
                state.clone(),
                user.clone(),
                body.get("payload").cloned().unwrap_or_else(|| json!({})),
                method,
            )
            .await;
            match res {
                Ok(_) => (
                    "success",
                    format!("Mutasi Kong {method_str} pada {target} berhasil."),
                    "Periksa daftar service/route Kong.",
                ),
                Err(err) => ("denied", err.message, "Mutasi Kong Admin API ditolak."),
            }
        }
        _ => return Err(AppError::bad_request("opType tidak didukung.")),
    };
    let receipt_id = record_receipt(
        &state,
        &user,
        case_id,
        op_type,
        "",
        op_type,
        env,
        target,
        op_type,
        env,
        status,
        &summary,
        post_check,
    )?;
    let receipt = state
        .db
        .one(
            "SELECT * FROM operation_receipts WHERE id=? AND user_id=?",
            &[json!(receipt_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::internal("Receipt tidak tersimpan."))?;
    Ok(Json(json!({ "receipt": receipt })))
}

#[allow(clippy::too_many_arguments)]
fn record_receipt(
    state: &AppState,
    user: &User,
    case_id: Option<&str>,
    action_type: &str,
    cluster_id: &str,
    cluster_label: &str,
    namespace: &str,
    workload: &str,
    kind: &str,
    env: &str,
    status: &str,
    summary: &str,
    post_check: &str,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    state.db.execute(
        "INSERT INTO operation_receipts(id,case_id,user_id,actor,action_type,cluster_id,cluster_label,namespace_name,workload_name,workload_kind,environment,status,summary,post_check) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        &[
            json!(id),
            case_id.map(|s| json!(s)).unwrap_or(Value::Null),
            json!(user.id),
            json!(user.username),
            json!(action_type),
            json!(cluster_id),
            json!(cluster_label),
            json!(namespace),
            json!(workload),
            json!(kind),
            json!(env),
            json!(status),
            json!(redact(summary)),
            json!(redact(post_check)),
        ],
    )?;
    Ok(id)
}

pub async fn list_activity(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let env = query.get("environment").map(|s| s.trim()).unwrap_or("");
    let target = query.get("target").map(|s| s.trim()).unwrap_or("");
    let status = query.get("status").map(|s| s.trim()).unwrap_or("");

    let mut sql = String::from("SELECT * FROM operation_receipts WHERE user_id=?");
    let mut params = vec![json!(user.id)];
    if !env.is_empty() {
        sql.push_str(" AND environment=?");
        params.push(json!(env));
    }
    if !status.is_empty() {
        sql.push_str(" AND status=?");
        params.push(json!(status));
    }
    if !target.is_empty() {
        sql.push_str(" AND (workload_name LIKE ? OR namespace_name LIKE ? OR action_type LIKE ?)");
        let pat = format!("%{target}%");
        params.push(json!(pat.clone()));
        params.push(json!(pat.clone()));
        params.push(json!(pat));
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT 200");
    let receipts = state.db.query(&sql, &params)?;
    Ok(Json(json!({ "receipts": receipts })))
}
