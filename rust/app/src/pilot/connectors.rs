use crate::{ApiResult, AppError, AppState, User, ai::context::redact};
use axum::{
    Extension, Json,
    extract::{Path, State},
};
use serde_json::{Value, json};
use std::time::Duration;
use uuid::Uuid;

fn sanitize_connector(row: &Value) -> Value {
    json!({
        "id": row["id"],
        "kind": row["kind"],
        "label": row["label"],
        "baseUrl": row["base_url"],
        "authType": row["auth_type"],
        "insecureTls": row["insecure_tls"].as_i64().unwrap_or(0) != 0,
        "enabled": row["enabled"].as_i64().unwrap_or(1) != 0,
        "hasToken": !row["token_encrypted"].as_str().unwrap_or("").is_empty(),
        "hasCa": !row["ghes_ca_pem"].as_str().unwrap_or("").is_empty(),
        "lastStatus": row["last_status"],
        "lastVersion": row["last_version"],
        "lastCheckedAt": row["last_checked_at"],
    })
}

fn http_client(insecure: bool) -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(8))
        .danger_accept_invalid_certs(insecure)
        .build()
        .map_err(|_| AppError::internal("HTTP client tidak tersedia."))
}

pub async fn list_connectors(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
) -> ApiResult {
    let rows = state.db.query(
        "SELECT * FROM pilot_connectors WHERE user_id=? ORDER BY updated_at DESC",
        &[json!(user.id)],
    )?;
    let connectors: Vec<Value> = rows.iter().map(sanitize_connector).collect();
    Ok(Json(json!({ "connectors": connectors })))
}

pub async fn save_connector(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let kind = body.get("kind").and_then(Value::as_str).unwrap_or("");
    if !matches!(
        kind,
        "bamboo" | "sonarqube" | "jira" | "bitbucket" | "ghes" | "checkmarx" | "confluent"
    ) {
        return Err(AppError::bad_request("Jenis konektor tidak didukung."));
    }
    let label = body
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let base_url = body
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .trim_end_matches('/');
    if label.is_empty() || base_url.is_empty() {
        return Err(AppError::bad_request("Label dan Base URL wajib diisi."));
    }
    let parsed =
        url::Url::parse(base_url).map_err(|_| AppError::bad_request("Base URL tidak valid."))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::bad_request("Base URL harus http atau https."));
    }
    let auth_type = body
        .get("authType")
        .and_then(Value::as_str)
        .unwrap_or("bearer");
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let insecure = i64::from(
        body.get("insecureTls")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    );
    let id = body.get("id").and_then(Value::as_str).unwrap_or("").trim();
    let ghes = kind == "ghes";
    let bitbucket = kind == "bitbucket";
    let scm = ghes || bitbucket;
    let ca = body.get("caPem").and_then(Value::as_str).map(str::trim);
    if scm {
        if ghes {
            crate::scm::base_url(base_url)?;
        } else {
            crate::scm::bitbucket_base_url(base_url)?;
        }
        if auth_type != "bearer" || insecure != 0 {
            return Err(AppError::bad_request(
                "Koneksi SCM memerlukan token Bearer dan TLS terverifikasi.",
            ));
        }
        if let Some(pem) = ca {
            crate::scm::tls_client(pem)?;
        }
    }

    let connector_id = if id.is_empty() {
        if token.is_empty() {
            return Err(AppError::bad_request("Token autentikasi wajib diisi."));
        }
        let enc = state.db.encrypt(token)?;
        let new_id = Uuid::new_v4().to_string();
        let inserted = state.db.execute(
            "INSERT INTO pilot_connectors(id,user_id,kind,label,base_url,auth_type,token_encrypted,token_iv,token_auth_tag,insecure_tls,ghes_ca_pem)
             SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ? != 'ghes' OR NOT EXISTS
             (SELECT 1 FROM pilot_connectors WHERE user_id=? AND kind='ghes' AND enabled=1)",
            &[
                json!(new_id),
                json!(user.id),
                json!(kind),
                json!(label),
                json!(base_url),
                json!(auth_type),
                json!(enc.ciphertext),
                json!(enc.iv),
                json!(enc.auth_tag),
                json!(insecure),
                json!(ca.filter(|_| scm).unwrap_or("")),
                json!(kind),
                json!(user.id),
            ],
        )?;
        if inserted == 0 {
            return Err(AppError::bad_request(
                "Profil GitHub Enterprise aktif sudah tersedia. Edit atau nonaktifkan profil tersebut.",
            ));
        }
        new_id
    } else {
        let existing = state
            .db
            .one(
                "SELECT * FROM pilot_connectors WHERE id=? AND user_id=?",
                &[json!(id), json!(user.id)],
            )?
            .ok_or_else(|| AppError::not_found("Konektor tidak ditemukan."))?;
        if (scm || existing["kind"] == "ghes" || existing["kind"] == "bitbucket")
            && existing["kind"] != kind
        {
            return Err(AppError::bad_request(
                "Jenis profil SCM tidak dapat diubah.",
            ));
        }
        if scm && existing["base_url"] != base_url && token.is_empty() {
            return Err(AppError::bad_request(
                "Masukkan token baru saat base URL SCM berubah.",
            ));
        }
        let ca = if scm {
            ca.unwrap_or_else(|| existing["ghes_ca_pem"].as_str().unwrap_or(""))
        } else {
            ""
        };
        let (ct, iv, tag) = if token.is_empty() {
            (
                existing["token_encrypted"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned(),
                existing["token_iv"].as_str().unwrap_or("").to_owned(),
                existing["token_auth_tag"].as_str().unwrap_or("").to_owned(),
            )
        } else {
            let enc = state.db.encrypt(token)?;
            (enc.ciphertext, enc.iv, enc.auth_tag)
        };
        state.db.execute(
            "UPDATE pilot_connectors SET kind=?,label=?,base_url=?,auth_type=?,token_encrypted=?,token_iv=?,token_auth_tag=?,insecure_tls=?,ghes_ca_pem=?,
             last_status=CASE WHEN kind IN ('ghes','bitbucket') THEN 'untested' ELSE last_status END,
             last_version=CASE WHEN kind IN ('ghes','bitbucket') THEN '' ELSE last_version END,
             last_checked_at=CASE WHEN kind IN ('ghes','bitbucket') THEN NULL ELSE last_checked_at END,
             updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
            &[
                json!(kind),
                json!(label),
                json!(base_url),
                json!(auth_type),
                json!(ct),
                json!(iv),
                json!(tag),
                json!(insecure),
                json!(ca),
                json!(id),
                json!(user.id),
            ],
        )?;
        id.to_owned()
    };
    let saved = state
        .db
        .one(
            "SELECT * FROM pilot_connectors WHERE id=? AND user_id=?",
            &[json!(connector_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::internal("Konektor gagal disimpan."))?;
    Ok(Json(json!({ "connector": sanitize_connector(&saved) })))
}

pub async fn toggle_connector(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let enabled = body
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| AppError::bad_request("Status enabled wajib diisi."))?;
    let updated = state.db.execute(
        "UPDATE pilot_connectors SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND
         (?=0 OR kind!='ghes' OR NOT EXISTS
          (SELECT 1 FROM pilot_connectors other WHERE other.user_id=? AND other.id!=? AND other.kind='ghes' AND other.enabled=1))",
        &[json!(i64::from(enabled)), json!(id), json!(user.id), json!(i64::from(enabled)), json!(user.id), json!(id)],
    )?;
    if updated == 0 {
        if state
            .db
            .one(
                "SELECT id FROM pilot_connectors WHERE id=? AND user_id=?",
                &[json!(id), json!(user.id)],
            )?
            .is_some()
        {
            return Err(AppError::bad_request(
                "Nonaktifkan profil GitHub Enterprise yang lain terlebih dahulu.",
            ));
        }
        return Err(AppError::not_found("Konektor tidak ditemukan."));
    }
    let row = state
        .db
        .one(
            "SELECT * FROM pilot_connectors WHERE id=? AND user_id=?",
            &[json!(id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Konektor tidak ditemukan."))?;
    Ok(Json(json!({ "connector": sanitize_connector(&row) })))
}

pub async fn delete_connector(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let deleted = state.db.execute(
        "DELETE FROM pilot_connectors WHERE id=? AND user_id=?",
        &[json!(id), json!(user.id)],
    )?;
    if deleted == 0 {
        return Err(AppError::not_found("Konektor tidak ditemukan."));
    }
    Ok(Json(json!({ "deleted": true })))
}

pub async fn test_connector(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let row = state
        .db
        .one(
            "SELECT * FROM pilot_connectors WHERE id=? AND user_id=?",
            &[json!(id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Konektor tidak ditemukan."))?;
    if row["enabled"].as_i64().unwrap_or(1) == 0 {
        return Err(AppError::bad_request("Konektor sedang dinonaktifkan."));
    }
    if row["kind"] == "ghes" || row["kind"] == "bitbucket" {
        let result = if row["kind"] == "ghes" {
            crate::scm::probe(&state, &row).await
        } else {
            crate::scm::probe_bitbucket(&state, &row).await
        };
        let (status, version, message) = match result {
            Ok(version) => ("ok", version, "Versi API dan identitas token terverifikasi. Izin repository diperiksa saat PR dibuka.".to_owned()),
            Err(error) => (if error.status == axum::http::StatusCode::FORBIDDEN { "denied" } else { "error" }, String::new(), error.message),
        };
        state.db.execute(
            "UPDATE pilot_connectors SET last_status=?,last_version=?,last_checked_at=CURRENT_TIMESTAMP
             WHERE id=? AND user_id=? AND base_url=? AND token_encrypted=? AND ghes_ca_pem=?",
            &[json!(status), json!(version), json!(id), json!(user.id), row["base_url"].clone(),
              row["token_encrypted"].clone(), row["ghes_ca_pem"].clone()],
        )?;
        return Ok(Json(
            json!({"status":status,"version":version,"message":message}),
        ));
    }
    let token = state.db.decrypt(
        row["token_encrypted"].as_str().unwrap_or(""),
        row["token_iv"].as_str().unwrap_or(""),
        row["token_auth_tag"].as_str().unwrap_or(""),
    )?;
    let kind = row["kind"].as_str().unwrap_or("");
    let base = row["base_url"].as_str().unwrap_or("");
    let client = http_client(row["insecure_tls"].as_i64().unwrap_or(0) != 0)?;
    let probe_path = match kind {
        "bamboo" => "/rest/api/latest/server",
        "sonarqube" => "/api/system/status",
        "jira" => "/rest/api/2/serverInfo",
        "checkmarx" => "/api/scans?limit=1",
        "confluent" => "/topics",
        _ => return Err(AppError::bad_request("Konektor tidak dikenal.")),
    };
    let url = format!("{base}{probe_path}");
    let resp = client.get(&url).bearer_auth(&token).send().await;
    let (status_label, version, detail) = match resp {
        Ok(r) if r.status().is_success() => {
            let ghes_ver = r
                .headers()
                .get("x-github-enterprise-version")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_owned();
            let text = r.text().await.unwrap_or_default();
            let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
            let ver = if !ghes_ver.is_empty() {
                ghes_ver
            } else {
                parsed["version"]
                    .as_str()
                    .or_else(|| parsed["versionNumber"].as_str())
                    .unwrap_or("")
                    .to_owned()
            };
            (
                "ok".to_owned(),
                ver,
                "Koneksi read-only berhasil.".to_owned(),
            )
        }
        Ok(r) if r.status().as_u16() == 401 || r.status().as_u16() == 403 => (
            "denied".to_owned(),
            String::new(),
            format!("Izin ditolak ({}). Periksa token atau scope.", r.status()),
        ),
        Ok(r) => (
            "error".to_owned(),
            String::new(),
            format!("Instance merespons HTTP {}.", r.status()),
        ),
        Err(err) => {
            let msg = if err.to_string().to_ascii_lowercase().contains("tls")
                || err.to_string().to_ascii_lowercase().contains("cert")
            {
                "Verifikasi TLS gagal. Periksa CA perusahaan atau profil TLS."
            } else {
                "Gagal menghubungi instance target."
            };
            ("error".to_owned(), String::new(), msg.to_owned())
        }
    };
    state.db.execute(
        "UPDATE pilot_connectors SET last_status=?,last_version=?,last_checked_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
        &[json!(status_label), json!(version), json!(id), json!(user.id)],
    )?;
    Ok(Json(json!({
        "status": status_label,
        "version": version,
        "message": detail,
    })))
}

pub fn format_bamboo_summary(parsed: &Value, run_key: &str) -> (String, Value) {
    let state = parsed["buildState"]
        .as_str()
        .or_else(|| parsed["state"].as_str())
        .unwrap_or("Unknown");
    let branch = parsed["plan"]["shortName"].as_str().unwrap_or("");
    let commit = parsed["vcsRevisionKey"].as_str().unwrap_or("");
    let reason = parsed["buildReason"].as_str().unwrap_or("");
    let mut failed_jobs = Vec::new();
    if let Some(stages) = parsed["stages"]["stage"].as_array() {
        for stage in stages {
            if let Some(results) = stage["results"]["result"].as_array() {
                for job in results {
                    if job["buildState"].as_str() == Some("Failed") {
                        let name = job["planName"].as_str().unwrap_or("job");
                        let key = job["buildResultKey"].as_str().unwrap_or("");
                        failed_jobs.push(format!("{name} ({key})"));
                    }
                }
            }
        }
    }
    let summary = format!(
        "Bamboo Run: {run_key}\nStatus: {state}\nBranch: {branch}\nCommit: {commit}\nReason: {reason}\nFailed Jobs: {}",
        if failed_jobs.is_empty() {
            "tidak ada".to_owned()
        } else {
            failed_jobs.join(", ")
        }
    );
    let meta = json!({
        "kind": "bamboo",
        "runKey": run_key,
        "status": state,
        "branch": branch,
        "commit": commit,
        "failedJobs": failed_jobs,
    });
    (summary, meta)
}

pub fn format_sonarqube_summary(parsed: &Value, project_key: &str) -> (String, Value) {
    let status = parsed["projectStatus"]["status"].as_str().unwrap_or("NONE");
    let mut failed_conditions = Vec::new();
    if let Some(conds) = parsed["projectStatus"]["conditions"].as_array() {
        for cond in conds {
            if cond["status"].as_str() != Some("OK") {
                let metric = cond["metricKey"].as_str().unwrap_or("metric");
                let actual = cond["actualValue"].as_str().unwrap_or("");
                let threshold = cond["errorThreshold"].as_str().unwrap_or("");
                failed_conditions.push(format!("{metric}: {actual} (batas {threshold})"));
            }
        }
    }
    let summary = format!(
        "SonarQube Project: {project_key}\nQuality Gate: {status}\nKondisi Gagal: {}",
        if failed_conditions.is_empty() {
            "tidak ada".to_owned()
        } else {
            failed_conditions.join("; ")
        }
    );
    let meta = json!({
        "kind": "sonarqube",
        "projectKey": project_key,
        "qualityGate": status,
        "failedConditions": failed_conditions,
    });
    (summary, meta)
}

pub async fn fetch_ci_run(
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
    let connector_id = body
        .get("connectorId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::bad_request("connectorId wajib dipilih."))?;
    let key = body
        .get("runKey")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if key.is_empty()
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_./:".contains(&b))
    {
        return Err(AppError::bad_request("Target key tidak valid."));
    }
    let row = state
        .db
        .one(
            "SELECT * FROM pilot_connectors WHERE id=? AND user_id=?",
            &[json!(connector_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Konektor tidak ditemukan."))?;
    if row["enabled"].as_i64().unwrap_or(1) == 0 {
        return Err(AppError::bad_request(
            "Konektor dinonaktifkan. Pengambilan baru dihentikan.",
        ));
    }
    let token = state.db.decrypt(
        row["token_encrypted"].as_str().unwrap_or(""),
        row["token_iv"].as_str().unwrap_or(""),
        row["token_auth_tag"].as_str().unwrap_or(""),
    )?;
    let base = row["base_url"].as_str().unwrap_or("");
    let kind = row["kind"].as_str().unwrap_or("");
    let client = http_client(row["insecure_tls"].as_i64().unwrap_or(0) != 0)?;

    let url = match kind {
        "bamboo" => format!("{base}/rest/api/latest/result/{key}?expand=stages.stage.results"),
        "sonarqube" => format!("{base}/api/qualitygates/project_status?projectKey={key}"),
        "bitbucket" => {
            let mut parts = key.split('/');
            let proj = parts.next().unwrap_or("");
            let slug = parts.next().unwrap_or("");
            if proj.is_empty() || slug.is_empty() {
                return Err(AppError::bad_request(
                    "Format target Bitbucket harus PROJECT/repo.",
                ));
            }
            format!(
                "{base}/rest/api/latest/projects/{proj}/repos/{slug}/pull-requests?state=OPEN&limit=10"
            )
        }
        "ghes" => {
            let mut parts = key.split('/');
            let owner = parts.next().unwrap_or("");
            let repo = parts.next().unwrap_or("");
            if owner.is_empty() || repo.is_empty() {
                return Err(AppError::bad_request(
                    "Format target GHES harus owner/repo.",
                ));
            }
            format!("{base}/api/v3/repos/{owner}/{repo}/pulls?state=open&per_page=10")
        }
        "checkmarx" => format!("{base}/api/results?scan-id={key}&limit=25"),
        "confluent" => format!("{base}/topics/{key}"),
        _ => {
            return Err(AppError::bad_request(
                "Konektor tidak mendukung pengambilan evidence.",
            ));
        }
    };
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| AppError::bad_request("Gagal menghubungi instance enterprise."))?;
    if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
        return Err(AppError::forbidden(
            "Izin baca ditolak oleh instance enterprise.",
        ));
    }
    if !resp.status().is_success() {
        return Err(AppError::bad_request(format!(
            "Instance mengembalikan HTTP {}.",
            resp.status()
        )));
    }
    let text = resp.text().await.unwrap_or_default();
    let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
    let (formatted, mut meta) = match kind {
        "bamboo" => format_bamboo_summary(&parsed, key),
        "sonarqube" => format_sonarqube_summary(&parsed, key),
        _ => (
            text.chars().take(16_000).collect::<String>(),
            json!({ "kind": kind, "runKey": key }),
        ),
    };
    meta["connectorId"] = json!(connector_id);
    let content = redact(&formatted);
    let item_id = Uuid::new_v4().to_string();
    state.db.execute(
        "INSERT INTO evidence_items(id,case_id,user_id,source_type,source_url,source_time,redaction_status,content,metadata_json) VALUES(?,?,?,?,?,?,?,?,?)",
        &[
            json!(item_id),
            json!(case_id),
            json!(user.id),
            json!("ci_run"),
            json!(url),
            json!(chrono::Utc::now().to_rfc3339()),
            json!("redacted"),
            json!(content),
            json!(meta.to_string()),
        ],
    )?;
    Ok(Json(
        json!({ "itemId": item_id, "sourceUrl": url, "metadata": meta }),
    ))
}

pub async fn confluent_metadata(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(connector_id): Path<String>,
) -> ApiResult {
    let row = state
        .db
        .one(
            "SELECT * FROM pilot_connectors WHERE id=? AND user_id=? AND kind='confluent'",
            &[json!(connector_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Konektor Confluent tidak ditemukan."))?;
    if row["enabled"].as_i64().unwrap_or(1) == 0 {
        return Err(AppError::bad_request("Konektor Confluent dinonaktifkan."));
    }
    let token = state.db.decrypt(
        row["token_encrypted"].as_str().unwrap_or(""),
        row["token_iv"].as_str().unwrap_or(""),
        row["token_auth_tag"].as_str().unwrap_or(""),
    )?;
    let base = row["base_url"].as_str().unwrap_or("");
    let client = http_client(row["insecure_tls"].as_i64().unwrap_or(0) != 0)?;
    let resp = client
        .get(format!("{base}/topics"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| AppError::bad_request("Gagal mengambil metadata topic Confluent."))?;
    if !resp.status().is_success() {
        return Err(AppError::bad_request(format!(
            "Confluent merespons HTTP {}.",
            resp.status()
        )));
    }
    let topics: Value = resp.json().await.unwrap_or_else(|_| json!([]));
    Ok(Json(json!({ "topics": topics })))
}

pub async fn list_jira_drafts(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(case_id): Path<String>,
) -> ApiResult {
    let drafts = state.db.query(
        "SELECT * FROM jira_drafts WHERE case_id=? AND user_id=? ORDER BY updated_at DESC",
        &[json!(case_id), json!(user.id)],
    )?;
    Ok(Json(json!({ "drafts": drafts })))
}

pub async fn save_jira_draft(
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
    let summary = body
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if summary.is_empty() {
        return Err(AppError::bad_request("Ringkasan draft Jira wajib diisi."));
    }
    let project_key = body
        .get("projectKey")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    let draft_body = body.get("body").and_then(Value::as_str).unwrap_or("");
    let ac = body
        .get("acceptanceCriteria")
        .and_then(Value::as_str)
        .unwrap_or("");
    let links = body
        .get("evidenceLinks")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let id = body.get("id").and_then(Value::as_str).unwrap_or("").trim();
    let draft_id = if id.is_empty() {
        let new_id = Uuid::new_v4().to_string();
        state.db.execute(
            "INSERT INTO jira_drafts(id,case_id,user_id,project_key,summary,body,acceptance_criteria,evidence_links_json,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?)",
            &[
                json!(new_id),
                json!(case_id),
                json!(user.id),
                json!(project_key),
                json!(summary),
                json!(redact(draft_body)),
                json!(redact(ac)),
                json!(links.to_string()),
                json!(Uuid::new_v4().to_string()),
            ],
        )?;
        new_id
    } else {
        state.db.execute(
            "UPDATE jira_drafts SET project_key=?,summary=?,body=?,acceptance_criteria=?,evidence_links_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND case_id=? AND user_id=?",
            &[
                json!(project_key),
                json!(summary),
                json!(redact(draft_body)),
                json!(redact(ac)),
                json!(links.to_string()),
                json!(id),
                json!(case_id),
                json!(user.id),
            ],
        )?;
        id.to_owned()
    };
    let draft = state
        .db
        .one(
            "SELECT * FROM jira_drafts WHERE id=? AND user_id=?",
            &[json!(draft_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::internal("Draft Jira tidak tersimpan."))?;
    Ok(Json(json!({ "draft": draft })))
}

pub async fn submit_jira_draft(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((case_id, draft_id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult {
    let draft = state
        .db
        .one(
            "SELECT * FROM jira_drafts WHERE id=? AND case_id=? AND user_id=?",
            &[json!(draft_id), json!(case_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Draft Jira tidak ditemukan."))?;
    if let Some(existing_key) = draft["issue_key"].as_str().filter(|s| !s.is_empty()) {
        return Ok(Json(json!({
            "issueKey": existing_key,
            "deduplicated": true,
        })));
    }
    let connector_id = body
        .get("connectorId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::bad_request("Konektor Jira wajib dipilih."))?;
    let conn = state
        .db
        .one(
            "SELECT * FROM pilot_connectors WHERE id=? AND user_id=? AND kind='jira'",
            &[json!(connector_id), json!(user.id)],
        )?
        .ok_or_else(|| AppError::not_found("Konektor Jira tidak ditemukan."))?;
    if conn["enabled"].as_i64().unwrap_or(1) == 0 {
        return Err(AppError::bad_request("Konektor Jira dinonaktifkan."));
    }
    let token = state.db.decrypt(
        conn["token_encrypted"].as_str().unwrap_or(""),
        conn["token_iv"].as_str().unwrap_or(""),
        conn["token_auth_tag"].as_str().unwrap_or(""),
    )?;
    let project_key = draft["project_key"].as_str().unwrap_or("").trim();
    if project_key.is_empty() {
        return Err(AppError::bad_request(
            "Project key Jira wajib diisi sebelum submit.",
        ));
    }
    let payload = json!({
        "fields": {
            "project": { "key": project_key },
            "summary": draft["summary"],
            "description": format!(
                "{}\n\nAcceptance Criteria:\n{}",
                draft["body"].as_str().unwrap_or(""),
                draft["acceptance_criteria"].as_str().unwrap_or("")
            ),
            "issuetype": { "name": "Task" }
        }
    });
    let url = format!(
        "{}/rest/api/2/issue",
        conn["base_url"].as_str().unwrap_or("")
    );
    let client = http_client(conn["insecure_tls"].as_i64().unwrap_or(0) != 0)?;
    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .json(&payload)
        .send()
        .await
        .map_err(|_| AppError::bad_request("Gagal mengirim draft ke Jira."))?;
    if !resp.status().is_success() {
        let status = resp.status();
        state.db.execute(
            "UPDATE jira_drafts SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
            &[json!(draft_id), json!(user.id)],
        )?;
        return Err(AppError::bad_request(format!(
            "Submit Jira gagal (HTTP {status})."
        )));
    }
    let resp_json: Value = resp.json().await.unwrap_or_else(|_| json!({}));
    let issue_key = resp_json["key"].as_str().unwrap_or("").to_owned();
    state.db.execute(
        "UPDATE jira_drafts SET issue_key=?,status='submitted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
        &[json!(issue_key), json!(draft_id), json!(user.id)],
    )?;
    Ok(Json(
        json!({ "issueKey": issue_key, "deduplicated": false }),
    ))
}
