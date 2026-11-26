use crate::{ApiResult, AppError, AppState, User};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

mod parsers;
mod sockets;
pub use sockets::{shutdown, socket_layer};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/vms", get(list).post(create))
        .route("/api/vms/{id}", get(detail).put(update).delete(remove))
        .route("/api/vms/{id}/status", get(status))
        .route("/api/vms/{id}/resources", get(resources))
        .route("/api/vms/{id}/services", get(services))
        .route("/api/vms/{id}/services/logs", get(service_logs))
        .route("/api/vms/{id}/services/action", post(service_action))
        .route("/api/vms/{id}/services/test-port", post(test_port))
        .route("/api/vms/{id}/services/git", get(git_info))
        .route("/api/vms/{id}/services/git-pull", post(git_pull))
        .route("/api/vms/{id}/files/list", get(files))
        .route("/api/vms/{id}/files/read", get(read_file))
        .route("/api/vms/{id}/files/save", post(save_file))
        .route("/api/vms/{id}/projects", get(projects))
        .route("/api/vms/{id}/logs/{project}", get(log_files))
        .route("/api/vms/{id}/logs/{project}/search", get(search_logs))
        .route("/api/vms/{id}/logs/{project}/{file}", get(log_content))
}

pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
fn required(value: &Value, key: &str) -> Result<String, AppError> {
    let value = text(value, key).trim();
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
        return Err(AppError::bad_request(format!("{key} is required")));
    }
    Ok(value.to_owned())
}
pub(crate) fn port(value: Option<&Value>, default: u16) -> Result<u16, AppError> {
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(value) => value
            .as_u64()
            .and_then(|x| u16::try_from(x).ok())
            .filter(|x| *x > 0)
            .ok_or_else(|| AppError::bad_request("Invalid port")),
    }
}
pub fn vm(state: &AppState, user: &str, id: &str) -> Result<Value, AppError> {
    state
        .db
        .one(
            "SELECT * FROM vms WHERE id=? AND user_id=?",
            &[json!(id), json!(user)],
        )?
        .ok_or_else(|| AppError::not_found("VM not found"))
}
fn public_vm(row: Value) -> Value {
    json!({"id":row["id"],"label":row["label"],"host":row["host"],"port":row["port"],"username":row["username"],"createdAt":row["created_at"],"updatedAt":row["updated_at"],"created_at":row["created_at"],"updated_at":row["updated_at"]})
}
async fn list(State(state): State<AppState>, Extension(user): Extension<User>) -> ApiResult {
    Ok(Json(json!(
        state
            .db
            .query(
                "SELECT * FROM vms WHERE user_id=? ORDER BY created_at DESC",
                &[json!(user.id)]
            )?
            .into_iter()
            .map(public_vm)
            .collect::<Vec<_>>()
    )))
}
async fn detail(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    Ok(Json(public_vm(vm(&state, &user.id, &id)?)))
}
async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let label = required(&body, "label")?;
    let host = required(&body, "host")?;
    let username = required(&body, "username")?;
    let password = required(&body, "password")?;
    let port = port(body.get("port"), 22)?;
    let encrypted = state.db.encrypt(&password)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    state.db.execute("INSERT INTO vms(id,user_id,label,host,port,username,encrypted_password,encryption_iv,encryption_auth_tag) VALUES(?,?,?,?,?,?,?,?,?)", &[json!(id),json!(user.id),json!(label),json!(host),json!(port),json!(username),json!(encrypted.ciphertext),json!(encrypted.iv),json!(encrypted.auth_tag)])?;
    Ok((
        StatusCode::CREATED,
        Json(public_vm(vm(&state, &user.id, &id)?)),
    ))
}
async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let old = vm(&state, &user.id, &id)?;
    let mut values = Vec::new();
    let mut columns = Vec::new();
    for key in ["label", "host", "username"] {
        if body.get(key).is_some() {
            columns.push(format!("{key}=?"));
            values.push(json!(required(&body, key)?));
        }
    }
    if body.get("port").is_some() {
        columns.push("port=?".into());
        values.push(json!(port(body.get("port"), 22)?));
    }
    if !text(&body, "password").is_empty() {
        let encrypted = state.db.encrypt(text(&body, "password"))?;
        columns.extend([
            "encrypted_password=?".into(),
            "encryption_iv=?".into(),
            "encryption_auth_tag=?".into(),
        ]);
        values.extend([
            json!(encrypted.ciphertext),
            json!(encrypted.iv),
            json!(encrypted.auth_tag),
        ]);
    }
    if columns.is_empty() {
        return Err(AppError::bad_request("No fields to update"));
    }
    values.extend([old["id"].clone(), json!(user.id)]);
    state.db.execute(
        &format!(
            "UPDATE vms SET {},updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
            columns.join(",")
        ),
        &values,
    )?;
    Ok(Json(public_vm(vm(&state, &user.id, &id)?)))
}
async fn remove(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let row = vm(&state, &user.id, &id)?;
    state.db.execute(
        "DELETE FROM vms WHERE id=? AND user_id=?",
        &[json!(id), json!(user.id)],
    )?;
    Ok(Json(json!({"success":true,"deleted":row["label"]})))
}
async fn status(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let row = vm(&state, &user.id, &id)?;
    let online = matches!(
        tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::TcpStream::connect((
                text(&row, "host"),
                row["port"].as_u64().unwrap_or(22) as u16
            ))
        )
        .await,
        Ok(Ok(_))
    );
    let old = state
        .db
        .one(
            "SELECT fail_count FROM vm_status WHERE vm_id=?",
            &[json!(id)],
        )?
        .unwrap_or(Value::Null);
    let count = if online {
        0
    } else {
        old["fail_count"].as_i64().unwrap_or(0) + 1
    };
    let status = if online {
        "online"
    } else if count >= 3 {
        "unreachable"
    } else {
        "offline"
    };
    let checked = now();
    state.db.execute("INSERT INTO vm_status(vm_id,status,last_checked,fail_count) VALUES(?,?,?,?) ON CONFLICT(vm_id) DO UPDATE SET status=excluded.status,last_checked=excluded.last_checked,fail_count=excluded.fail_count",&[json!(id),json!(status),json!(checked),json!(count)])?;
    Ok(Json(
        json!({"vmId":id,"status":status,"lastChecked":checked,"failCount":count}),
    ))
}

pub fn connect(state: &AppState, user: &str, id: &str) -> Result<ssh2::Session, AppError> {
    let row = vm(state, user, id)?;
    let host = text(&row, "host");
    let port = row["port"].as_u64().unwrap_or(22) as u16;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| AppError::internal("SSH hostname could not be resolved"))?;
    let mut tcp = None;
    for address in addresses {
        if let Ok(stream) = TcpStream::connect_timeout(&address, Duration::from_secs(10)) {
            tcp = Some(stream);
            break;
        }
    }
    let tcp = tcp.ok_or_else(|| AppError::internal("SSH connection failed"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(20))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(20))).ok();
    let mut session = ssh2::Session::new().map_err(|_| AppError::internal("SSH session failed"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(20_000);
    session
        .handshake()
        .map_err(|_| AppError::internal("SSH handshake failed"))?;
    let fingerprint = session
        .host_key_hash(ssh2::HashType::Sha256)
        .ok_or_else(|| AppError::internal("SSH server did not supply a host key"))?;
    use base64::Engine;
    let fingerprint = base64::engine::general_purpose::STANDARD.encode(fingerprint);
    state.db.execute("CREATE TABLE IF NOT EXISTS ssh_host_keys(vm_id TEXT PRIMARY KEY REFERENCES vms(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL)",&[])?;
    state.db.execute(
        "INSERT OR IGNORE INTO ssh_host_keys(vm_id,fingerprint) VALUES(?,?)",
        &[json!(id), json!(fingerprint)],
    )?;
    let saved = state
        .db
        .one(
            "SELECT fingerprint FROM ssh_host_keys WHERE vm_id=?",
            &[json!(id)],
        )?
        .ok_or_else(|| AppError::internal("SSH host key could not be stored"))?;
    if saved["fingerprint"] != fingerprint {
        return Err(AppError::forbidden(
            "SSH host key changed. Verify the server identity before recreating this VM connection.",
        ));
    }
    let password = state.db.decrypt(
        text(&row, "encrypted_password"),
        text(&row, "encryption_iv"),
        text(&row, "encryption_auth_tag"),
    )?;
    session
        .userauth_password(text(&row, "username"), &password)
        .map_err(|_| AppError::forbidden("SSH authentication failed"))?;
    Ok(session)
}

pub async fn execute(
    state: &AppState,
    user_id: &str,
    vm_id: &str,
    command: &str,
) -> Result<String, AppError> {
    execute_input(state, user_id, vm_id, command, None).await
}
async fn execute_privileged(
    state: &AppState,
    user_id: &str,
    vm_id: &str,
    command: &str,
) -> Result<String, AppError> {
    let row = vm(state, user_id, vm_id)?;
    let password = state.db.decrypt(
        text(&row, "encrypted_password"),
        text(&row, "encryption_iv"),
        text(&row, "encryption_auth_tag"),
    )?;
    let command = format!(
        "sudo -S -p '' -- sh -c {} 2>/dev/null || sh -c {}",
        quote(command),
        quote(command)
    );
    execute_input(
        state,
        user_id,
        vm_id,
        &command,
        Some(format!("{password}\n").into_bytes()),
    )
    .await
}
async fn execute_input(
    state: &AppState,
    user: &str,
    id: &str,
    command: &str,
    input: Option<Vec<u8>>,
) -> Result<String, AppError> {
    let state = state.clone();
    let user = user.to_owned();
    let id = id.to_owned();
    let command = command.to_owned();
    tokio::task::spawn_blocking(move || {
        let session = connect(&state, &user, &id)?;
        let mut channel = session
            .channel_session()
            .map_err(|_| AppError::internal("SSH channel failed"))?;
        channel
            .exec(&command)
            .map_err(|_| AppError::internal("SSH command failed"))?;
        if let Some(input) = input {
            channel
                .write_all(&input)
                .map_err(|_| AppError::internal("SSH input failed"))?;
        }
        channel.send_eof().ok();
        let mut data = Vec::new();
        Read::by_ref(&mut channel)
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut data)
            .map_err(|_| AppError::internal("SSH output failed or timed out"))?;
        if data.len() > 4 * 1024 * 1024 {
            return Err(AppError::bad_request("SSH output exceeds 4 MB"));
        }
        let mut error = String::new();
        channel.stderr().take(65536).read_to_string(&mut error).ok();
        channel.wait_close().ok();
        if channel.exit_status().unwrap_or(1) != 0 {
            return Err(AppError::internal(
                "Remote command failed; check permissions and service status",
            ));
        }
        Ok(String::from_utf8_lossy(&data).into_owned())
    })
    .await
    .map_err(|_| AppError::internal("SSH worker failed"))?
}

async fn resources(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let raw = execute_privileged(&state, &user.id, &id, parsers::RESOURCE_SCRIPT).await?;
    Ok(Json(parsers::resources(&raw)))
}
async fn services(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let raw = execute_privileged(&state, &user.id, &id, parsers::SERVICE_SCRIPT).await?;
    Ok(Json(
        json!({"vmId":id,"scannedAt":now(),"services":parsers::services(&raw)}),
    ))
}
fn safe_unit(unit: &str) -> Result<(), AppError> {
    if unit.is_empty()
        || !unit
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.@-".contains(c))
    {
        Err(AppError::bad_request("Invalid service name"))
    } else {
        Ok(())
    }
}
async fn service_logs(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let unit = query
        .get("unit")
        .ok_or_else(|| AppError::bad_request("unit parameter is required"))?;
    safe_unit(unit)?;
    let lines = query
        .get("lines")
        .and_then(|x| x.parse::<u32>().ok())
        .unwrap_or(100)
        .clamp(10, 500);
    let logs = execute_privileged(
        &state,
        &user.id,
        &id,
        &format!("journalctl -u {} -n {lines} --no-pager", quote(unit)),
    )
    .await?;
    Ok(Json(
        json!({"unit":unit,"lines":lines,"logs":logs,"timestamp":now()}),
    ))
}
pub(crate) async fn service_action(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let unit = required(&body, "serviceName")?;
    safe_unit(&unit)?;
    let action = text(&body, "action");
    if !["start", "stop", "restart", "status"].contains(&action) {
        return Err(AppError::bad_request("Invalid service action"));
    }
    let command = format!("systemctl {action} {} --no-pager", quote(&unit));
    let output = execute_privileged(&state, &user.id, &id, &command).await?;
    Ok(Json(
        json!({"success":true,"serviceName":unit,"action":action,"output":output.trim()}),
    ))
}
async fn test_port(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let port = body["port"]
        .as_u64()
        .or_else(|| body["port"].as_str().and_then(|x| x.parse().ok()))
        .filter(|x| *x > 0 && *x <= 65535)
        .ok_or_else(|| AppError::bad_request("Invalid port"))?;
    let path = text(&body, "path");
    let path = if path.starts_with('/') { path } else { "/" };
    let output=execute(&state,&user.id,&id,&format!("curl -s -o /dev/null -w '%{{http_code}}|%{{time_total}}' --connect-timeout 3 --max-time 10 {} || true",quote(&format!("http://127.0.0.1:{port}{path}")))).await?;
    let parts: Vec<_> = output.trim().split('|').collect();
    let code = parts
        .first()
        .and_then(|x| x.parse::<u16>().ok())
        .unwrap_or(0);
    let ms = parts
        .get(1)
        .and_then(|x| x.parse::<f64>().ok())
        .unwrap_or(0.)
        * 1000.;
    Ok(Json(
        json!({"port":port,"reachable":code>0,"httpCode":code,"responseTimeMs":ms.round(),"status":if code==0{"Connection Refused / Non-HTTP".into()}else{format!("{code} Response")}}),
    ))
}
async fn git_info(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let path = query
        .get("path")
        .ok_or_else(|| AppError::bad_request("path parameter is required"))?;
    let command = format!(
        "cd {} && git rev-parse --is-inside-work-tree && git branch --show-current && git rev-parse --short HEAD && git log -1 --format=%s && git log -1 --format=%cr && git log -1 --format=%an && git status --porcelain",
        quote(path)
    );
    let output = execute(&state, &user.id, &id, &command).await;
    match output {
        Ok(raw) => {
            let lines: Vec<_> = raw.lines().collect();
            Ok(Json(
                json!({"isRepo":true,"branch":lines.get(1),"commitHash":lines.get(2),"commitMessage":lines.get(3),"date":lines.get(4),"author":lines.get(5),"modifiedFilesCount":lines.len().saturating_sub(6)}),
            ))
        }
        Err(_) => Ok(Json(json!({"isRepo":false}))),
    }
}
async fn git_pull(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let path = required(&body, "path")?;
    let output = execute(
        &state,
        &user.id,
        &id,
        &format!("cd {} && git pull --ff-only", quote(&path)),
    )
    .await?;
    Ok(Json(json!({"success":true,"output":output,"path":path})))
}
fn query_path(query: &HashMap<String, String>, key: &str) -> Result<String, AppError> {
    let value = query
        .get(key)
        .filter(|x| !x.is_empty() && !x.contains('\0'))
        .ok_or_else(|| AppError::bad_request(format!("{key} parameter is required")))?;
    Ok(value.clone())
}
async fn files(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let dir = query_path(&query, "dir")?;
    let search = query.get("search").cloned().unwrap_or_default();
    let recursive = query.get("recursive").is_some_and(|x| x == "true") || !search.is_empty();
    let command = if recursive {
        format!(
            "find {} -maxdepth 4 -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/vendor/*' -name {} 2>/dev/null | head -250",
            quote(&dir),
            quote(&format!("*{search}*"))
        )
    } else {
        format!("ls -1Ap -- {} | head -250", quote(&dir))
    };
    let output = execute(&state, &user.id, &id, &command).await?;
    let mut files:Vec<_>=output.lines().filter(|x|!x.is_empty()&&!matches!(*x,".git/"|"node_modules/"|"vendor/")).map(|line|{let is_dir=line.ends_with('/');let path=if recursive{line.into()}else{format!("{}/{}",dir.trim_end_matches('/'),line.trim_end_matches('/'))};let name=if recursive{line.strip_prefix(&(dir.trim_end_matches('/').to_owned()+"/")).unwrap_or(line)}else{line.trim_end_matches('/')};let filename=line.trim_end_matches('/').rsplit('/').next().unwrap_or(line);json!({"name":name,"filename":filename,"path":path,"isDir":is_dir,"isConfig":parsers::is_config(filename),"isCode":parsers::is_code(filename)})}).collect();
    files.sort_by_key(|x| {
        (
            !x["isConfig"].as_bool().unwrap_or(false),
            !x["isDir"].as_bool().unwrap_or(false),
            x["name"].as_str().unwrap_or("").to_owned(),
        )
    });
    Ok(Json(
        json!({"dir":dir,"files":files,"isRecursive":recursive,"timestamp":now()}),
    ))
}
async fn read_file(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let path = query_path(&query, "path")?;
    let content = execute_privileged(
        &state,
        &user.id,
        &id,
        &format!("head -c 2097153 -- {}", quote(&path)),
    )
    .await?;
    if content.len() > 2097152 {
        return Err(AppError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File exceeds 2 MB",
        ));
    }
    Ok(Json(
        json!({"path":path,"filename":path.rsplit('/').next(),"size":content.len(),"content":content}),
    ))
}
pub(crate) async fn save_file(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let path = required(&body, "path")?;
    let content = body["content"]
        .as_str()
        .ok_or_else(|| AppError::bad_request("content is required"))?;
    if content.len() > 2097152 {
        return Err(AppError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File exceeds 2 MB",
        ));
    }
    let temporary = execute(
        &state,
        &user.id,
        &id,
        "mktemp /tmp/.multiplexity-save-XXXXXX",
    )
    .await?
    .trim()
    .to_owned();
    if !temporary.starts_with("/tmp/.multiplexity-save-") || temporary.contains('\n') {
        return Err(AppError::internal("Invalid temporary file response"));
    }
    let backup = body["createBackup"]
        .as_bool()
        .unwrap_or(true)
        .then(|| format!("{path}.bak-{}", chrono::Utc::now().format("%Y%m%d%H%M%S")));
    let result = async {
        execute_input(
            &state,
            &user.id,
            &id,
            &format!("cat > {}", quote(&temporary)),
            Some(content.as_bytes().to_vec()),
        )
        .await?;
        let backup_command = backup
            .as_ref()
            .map(|backup| {
                format!(
                    "if [ -f {} ]; then cp -p -- {} {}; fi; ",
                    quote(&path),
                    quote(&path),
                    quote(backup)
                )
            })
            .unwrap_or_default();
        let reload = if path.ends_with(".service") {
            " && systemctl daemon-reload"
        } else {
            ""
        };
        execute_privileged(
            &state,
            &user.id,
            &id,
            &format!(
                "{backup_command}cat {} > {}{reload}",
                quote(&temporary),
                quote(&path)
            ),
        )
        .await
    }
    .await;
    let _ = execute(
        &state,
        &user.id,
        &id,
        &format!("rm -f -- {}", quote(&temporary)),
    )
    .await;
    result?;
    Ok(Json(
        json!({"success":true,"path":path,"backupPath":backup,"isSystemdUnit":path.ends_with(".service"),"size":content.len()}),
    ))
}
fn safe_segment(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.contains("..")
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
    {
        return Err(AppError::bad_request("Invalid log path"));
    }
    Ok(())
}
async fn projects(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let raw=execute(&state,&user.id,&id,"for p in /var/www/html/*/; do [ -d \"$p/application/logs\" ] && printf '%s|%s|%s\\n' \"$(basename \"$p\")\" \"$p\" \"$(find \"$p/application/logs\" -maxdepth 1 -name 'log-*.php' | wc -l)\"; done; true").await?;
    Ok(Json(json!(
        raw.lines()
            .filter_map(|x| {
                let p: Vec<_> = x.split('|').collect();
                (p.len() == 3).then(
                    || json!({"name":p[0],"path":p[1],"logCount":p[2].parse::<u32>().unwrap_or(0)}),
                )
            })
            .collect::<Vec<_>>()
    )))
}
async fn log_files(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((id, project)): Path<(String, String)>,
) -> ApiResult {
    safe_segment(&project)?;
    let path = format!("/var/www/html/{project}/application/logs");
    let output = execute(
        &state,
        &user.id,
        &id,
        &format!(
            "find {} -maxdepth 1 -type f -name 'log-*.php' -printf '%f|%s\\n' | sort -r",
            quote(&path)
        ),
    )
    .await?;
    Ok(Json(json!(output.lines().filter_map(|x|{let(name,size)=x.split_once('|')?;Some(json!({"filename":name,"date":name.trim_start_matches("log-").trim_end_matches(".php"),"size":size.parse::<u64>().unwrap_or(0)}))}).collect::<Vec<_>>())))
}
async fn log_content(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((id, project, file)): Path<(String, String, String)>,
) -> ApiResult {
    safe_segment(&project)?;
    safe_segment(&file)?;
    let raw = execute(
        &state,
        &user.id,
        &id,
        &format!(
            "cat -- {}",
            quote(&format!("/var/www/html/{project}/application/logs/{file}"))
        ),
    )
    .await?;
    Ok(Json(json!(parsers::logs(&raw))))
}
async fn search_logs(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((id, project)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    safe_segment(&project)?;
    let search = query
        .get("q")
        .or_else(|| query.get("query"))
        .ok_or_else(|| AppError::bad_request("query required"))?;
    let path = format!("/var/www/html/{project}/application/logs");
    let target = if let Some(file) = query.get("file") {
        safe_segment(file)?;
        quote(&format!("{path}/{file}"))
    } else {
        format!("{}/*.php", quote(&path))
    };
    let raw = execute(
        &state,
        &user.id,
        &id,
        &format!(
            "grep -h -F -- {} {target} | head -1000; true",
            quote(search)
        ),
    )
    .await?;
    Ok(Json(json!(parsers::logs(&raw))))
}
