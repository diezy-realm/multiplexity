use crate::{AppError, AppState};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;

pub const PROVIDERS: [&str; 11] = [
    "openai",
    "claude",
    "gemini",
    "ollama",
    "custom",
    "codex",
    "kiro",
    "antigravity",
    "openrouter",
    "groq",
    "grok",
];

pub fn text<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or("")
}

pub fn is_cli(provider: &str) -> bool {
    matches!(provider, "codex" | "kiro" | "antigravity")
}

pub fn needs_key(provider: &str) -> bool {
    !is_cli(provider) && !matches!(provider, "ollama" | "custom")
}

fn default_endpoint(provider: &str) -> &'static str {
    match provider {
        "openai" => "https://api.openai.com/v1",
        "claude" => "https://api.anthropic.com/v1",
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai",
        "ollama" => "http://127.0.0.1:11434/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "groq" => "https://api.groq.com/openai/v1",
        "grok" => "https://api.x.ai/v1",
        _ => "",
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Model {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Profile {
    pub label: String,
    pub description: String,
    pub color: String,
    pub enabled: bool,
    pub verified: bool,
    pub version: String,
    pub models: Vec<Model>,
    pub disabled_models: Vec<String>,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            label: String::new(),
            description: String::new(),
            color: String::new(),
            enabled: true,
            verified: false,
            version: String::new(),
            models: Vec::new(),
            disabled_models: Vec::new(),
        }
    }
}

pub fn valid_model(value: &str) -> bool {
    value.len() <= 120
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._:/-".contains(&c))
}

pub struct Connection {
    pub provider: String,
    pub model: String,
    pub key: String,
    pub cli_path: String,
    pub endpoint: String,
    pub saved: bool,
    pub profile: Profile,
}

impl Connection {
    pub fn check_enabled(&self, model: &str) -> Result<(), AppError> {
        if !self.profile.enabled {
            return Err(AppError::bad_request(
                "Provider dinonaktifkan di AI Provider.",
            ));
        }
        if model.is_empty() && !self.profile.disabled_models.is_empty() {
            return Err(AppError::bad_request("Pilih model aktif di AI Provider."));
        }
        if self.profile.disabled_models.iter().any(|id| id == model) {
            return Err(AppError::bad_request("Model dinonaktifkan di AI Provider."));
        }
        Ok(())
    }
}

pub fn connection(state: &AppState, provider: &str) -> Result<Connection, AppError> {
    if !PROVIDERS.contains(&provider) {
        return Err(AppError::bad_request("Provider tidak valid."));
    }
    let row = state.db.one(
        "SELECT * FROM ai_connections WHERE provider=?",
        &[json!(provider)],
    )?;
    let value = row.as_ref().unwrap_or(&Value::Null);
    let key = if text(value, "api_key_encrypted").is_empty() {
        String::new()
    } else {
        state.db.decrypt(
            text(value, "api_key_encrypted"),
            text(value, "api_key_iv"),
            text(value, "api_key_auth_tag"),
        )?
    };
    let endpoint = text(value, "endpoint");
    let endpoint = if !matches!(provider, "gemini" | "ollama" | "custom") || endpoint.is_empty() {
        default_endpoint(provider)
    } else {
        endpoint
    };
    Ok(Connection {
        provider: provider.to_owned(),
        model: row
            .as_ref()
            .map(|r| text(r, "model"))
            .unwrap_or(if provider == "openai" {
                "gpt-4o-mini"
            } else {
                ""
            })
            .to_owned(),
        key,
        cli_path: text(value, "cli_path").to_owned(),
        endpoint: endpoint.to_owned(),
        saved: row.is_some(),
        profile: serde_json::from_str(text(value, "profile_json")).unwrap_or_default(),
    })
}

pub fn active(state: &AppState) -> Result<String, AppError> {
    let row = state
        .db
        .one("SELECT provider FROM ai_settings WHERE id='default'", &[])?;
    let provider = row
        .as_ref()
        .map(|v| text(v, "provider"))
        .unwrap_or("openai");
    if PROVIDERS.contains(&provider) && connection(state, provider)?.profile.enabled {
        return Ok(provider.to_owned());
    }
    let rows = state.db.query(
        "SELECT provider FROM ai_connections WHERE COALESCE(json_extract(profile_json,'$.enabled'),1)=1 ORDER BY updated_at DESC,provider",
        &[],
    )?;
    Ok(rows
        .iter()
        .map(|row| text(row, "provider"))
        .find(|id| PROVIDERS.contains(id))
        .unwrap_or("openai")
        .to_owned())
}

pub async fn public(state: &AppState) -> Result<Value, AppError> {
    let records = PROVIDERS
        .into_iter()
        .map(|provider| connection(state, provider))
        .collect::<Result<Vec<_>, _>>()?;
    let executables = futures_util::future::join_all(records.iter().map(|item| async {
        if is_cli(&item.provider) {
            find_cli(&item.provider, &item.cli_path).await
        } else {
            None
        }
    }))
    .await;
    let mut items = Vec::new();
    for (item, executable) in records.into_iter().zip(executables) {
        let provider = item.provider.as_str();
        let configured = !item.key.is_empty()
            || (is_cli(provider) && item.saved && executable.is_some())
            || (provider == "ollama" && item.saved)
            || (provider == "custom" && !item.endpoint.is_empty());
        let hint = if item.key.is_empty() {
            String::new()
        } else {
            format!(
                "••••{}",
                item.key
                    .chars()
                    .rev()
                    .take(4)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<String>()
            )
        };
        items.push(json!({"provider":provider,"model":item.model,"saved":item.saved,"configured":configured,"profile":item.profile,"apiKeyHint":hint,"cliPath":item.cli_path,"endpoint":item.endpoint,"available":!is_cli(provider)||executable.is_some(),"executable":executable.map(|p|p.to_string_lossy().into_owned()).unwrap_or_default()}));
    }
    let selected = active(state)?;
    let mut result = items
        .iter()
        .find(|v| text(v, "provider") == selected)
        .cloned()
        .unwrap_or_else(|| json!({}));
    result["connections"] = json!(items);
    result["desktop"] = json!(std::env::var("MULTIPLEXITY_DESKTOP").as_deref() == Ok("1"));
    result["localCli"] = json!(true);
    result["runtime"] = json!(if result["desktop"] == true {
        "desktop"
    } else {
        "local-development"
    });
    Ok(result)
}

pub fn validate_endpoint(endpoint: &str) -> Result<(), AppError> {
    let url = reqwest::Url::parse(endpoint)
        .map_err(|_| AppError::bad_request("Endpoint tidak valid."))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https"
            || (url.scheme() == "http"
                && matches!(
                    url.host_str(),
                    Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
                )))
    {
        return Err(AppError::bad_request(
            "Gunakan HTTPS atau HTTP localhost tanpa kredensial/query.",
        ));
    }
    Ok(())
}

pub async fn draft(state: &AppState, body: &Value) -> Result<Connection, AppError> {
    let provider = text(body, "provider");
    let mut previous = connection(state, provider)?;
    if body.get("model").is_some_and(|model| !model.is_string()) {
        return Err(AppError::bad_request("Model tidak valid."));
    }
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(&previous.model);
    if !PROVIDERS.contains(&provider) || !valid_model(model) {
        return Err(AppError::bad_request("Konfigurasi tidak valid."));
    }
    for (name, limit) in [("apiKey", 4096), ("cliPath", 1024), ("endpoint", 2048)] {
        if let Some(v) = body.get(name)
            && v.as_str()
                .is_none_or(|v| v.len() > limit || v.contains(['\0', '\r', '\n']))
        {
            return Err(AppError::bad_request("Konfigurasi tidak valid."));
        }
    }
    if body.get("clearKey").is_some_and(|v| !v.is_boolean()) {
        return Err(AppError::bad_request("Konfigurasi tidak valid."));
    }
    let key = text(body, "apiKey").trim();
    if provider == "codex" && !key.is_empty() {
        return Err(AppError::bad_request("Gunakan login resmi Codex CLI."));
    }
    if (!key.is_empty() && key.len() < 10)
        || (needs_key(provider)
            && body["clearKey"] != true
            && key.is_empty()
            && previous.key.is_empty())
    {
        return Err(AppError::bad_request("API key wajib diisi."));
    }
    let endpoint = body
        .get("endpoint")
        .and_then(Value::as_str)
        .unwrap_or(&previous.endpoint)
        .trim();
    if !endpoint.is_empty() {
        validate_endpoint(endpoint)?;
    }
    if provider == "custom" && endpoint.is_empty() {
        return Err(AppError::bad_request("Endpoint API wajib diisi."));
    }
    let mut cli_path = body
        .get("cliPath")
        .and_then(Value::as_str)
        .unwrap_or(&previous.cli_path)
        .trim()
        .to_owned();
    if is_cli(provider) && !cli_path.is_empty() {
        cli_path = find_cli(provider, &cli_path)
            .await
            .ok_or_else(|| AppError::bad_request("Executable CLI tidak ditemukan."))?
            .to_string_lossy()
            .into_owned();
    }
    let key = if !key.is_empty() {
        key.to_owned()
    } else if body["clearKey"] == true {
        String::new()
    } else {
        previous.key.clone()
    };
    let endpoint = if !matches!(provider, "gemini" | "ollama" | "custom") || endpoint.is_empty() {
        default_endpoint(provider).to_owned()
    } else {
        endpoint.trim_end_matches('/').to_owned()
    };
    let origin = |value: &str| reqwest::Url::parse(value).ok().map(|url| url.origin());
    if body["clearKey"] != true
        && text(body, "apiKey").trim().is_empty()
        && !previous.key.is_empty()
        && origin(&endpoint) != origin(&previous.endpoint)
    {
        return Err(AppError::bad_request(
            "Isi API key untuk endpoint baru atau hapus key tersimpan.",
        ));
    }
    if key != previous.key || endpoint != previous.endpoint || cli_path != previous.cli_path {
        previous.profile.verified = false;
        previous.profile.version.clear();
    }
    previous.model = model.to_owned();
    previous.key = key;
    previous.endpoint = endpoint;
    previous.cli_path = cli_path;
    Ok(previous)
}

pub async fn save(state: &AppState, body: Value) -> Result<Json<Value>, AppError> {
    let mut connection = draft(state, &body).await?;
    let profile = &mut connection.profile;
    if let Some(identity) = body.get("profile") {
        let invalid = || AppError::bad_request("Identitas atau daftar model tidak valid.");
        let label = text(identity, "label").trim();
        let description = text(identity, "description").trim();
        let color = text(identity, "color");
        if label.is_empty()
            || label.chars().count() > 64
            || description.chars().count() > 280
            || label.chars().any(char::is_control)
            || description.contains('\0')
            || (!color.is_empty()
                && !(color.len() == 7
                    && color.starts_with('#')
                    && color.bytes().skip(1).all(|byte| byte.is_ascii_hexdigit())))
        {
            return Err(invalid());
        }
        let models: Vec<Model> =
            serde_json::from_value(identity["models"].clone()).map_err(|_| invalid())?;
        let disabled: Vec<String> =
            serde_json::from_value(identity["disabledModels"].clone()).map_err(|_| invalid())?;
        if models.len() > 300
            || disabled.len() > 300
            || models.iter().any(|model| {
                model.id.is_empty() || !valid_model(&model.id) || model.name.chars().count() > 160
            })
            || disabled
                .iter()
                .any(|id| id.is_empty() || !valid_model(id) || id == &connection.model)
        {
            return Err(invalid());
        }
        profile.label = label.to_owned();
        profile.description = description.to_owned();
        profile.color = color.to_owned();
        profile.models = models;
        profile.disabled_models = disabled;
    }
    if body["verify"] == true {
        let result = super::probe_connection(&connection).await?;
        connection.profile.verified = true;
        connection.profile.version = result.version;
    }
    let secret = state.db.encrypt(&connection.key)?;
    let make_default = body["makeDefault"].as_bool().unwrap_or(true);
    if make_default {
        connection.check_enabled(&connection.model)?;
    }
    let serialized = serde_json::to_string(&connection.profile)
        .map_err(|_| AppError::internal("Profil provider tidak dapat disimpan."))?;
    state.db.with_connection(|db| {
        let failed = |_| AppError::internal("Profil provider tidak dapat disimpan.");
        let transaction = db.transaction().map_err(failed)?;
        transaction.execute(
            "INSERT INTO ai_connections(provider,model,api_key_encrypted,api_key_iv,api_key_auth_tag,cli_path,endpoint,profile_json)
             VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET
             model=excluded.model,api_key_encrypted=excluded.api_key_encrypted,api_key_iv=excluded.api_key_iv,
             api_key_auth_tag=excluded.api_key_auth_tag,cli_path=excluded.cli_path,endpoint=excluded.endpoint,
             profile_json=json_set(excluded.profile_json,'$.enabled',json(CASE WHEN json_extract(ai_connections.profile_json,'$.enabled')=0 THEN 'false' ELSE 'true' END)),updated_at=CURRENT_TIMESTAMP",
            rusqlite::params![connection.provider,connection.model,secret.ciphertext,secret.iv,secret.auth_tag,connection.cli_path,connection.endpoint,serialized],
        ).map_err(failed)?;
        if make_default {
            let enabled: bool = transaction.query_row(
                "SELECT COALESCE(json_extract(profile_json,'$.enabled'),1) FROM ai_connections WHERE provider=?",
                [&connection.provider], |row| row.get(0),
            ).map_err(failed)?;
            if !enabled {
                return Err(AppError::bad_request("Aktifkan provider sebelum menjadikannya default."));
            }
            transaction.execute(
                "INSERT INTO ai_settings(id,provider,model) VALUES('default',?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model",
                rusqlite::params![connection.provider,connection.model],
            ).map_err(failed)?;
        }
        transaction.commit().map_err(failed)
    })?;
    Ok(Json(json!({"success":true})))
}

pub async fn find_cli(provider: &str, configured: &str) -> Option<PathBuf> {
    let command = match provider {
        "codex" => "codex",
        "kiro" => "kiro-cli",
        "antigravity" => "agy",
        _ => return None,
    };
    let expected = if cfg!(windows) {
        format!("{command}.exe")
    } else {
        command.to_owned()
    };
    let native = |candidate: &PathBuf| {
        candidate.is_absolute()
            && !candidate.to_string_lossy().starts_with(r"\\")
            && candidate
                .file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&expected))
            && candidate.is_file()
    };
    if !configured.is_empty() {
        let mut candidate = PathBuf::from(configured.trim_matches('"'));
        if !candidate.is_absolute()
            || candidate.to_string_lossy().starts_with(r"\\")
            || configured.contains(['\0', '\r', '\n'])
        {
            return None;
        }
        if candidate.is_dir() {
            candidate.push(&expected);
        }
        if native(&candidate) {
            return Some(candidate);
        }
        return None;
    }
    let mut folders = Vec::new();
    if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            let known = match provider {
                "codex" => vec!["Programs/OpenAI/Codex/bin"],
                "kiro" => vec!["Kiro-Cli", "Programs/Kiro CLI/bin"],
                _ => vec![
                    "agy/bin",
                    "Programs/Antigravity/bin",
                    "Programs/Google/Antigravity/bin",
                    "Programs/agy/bin",
                ],
            };
            folders.extend(known.into_iter().map(|p| local.join(p)));
        }
        let mut command = tokio::process::Command::new("powershell.exe");
        command.args(["-NoProfile","-NonInteractive","-Command","[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::GetEnvironmentVariable('Path','Machine')"]);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command.kill_on_drop(true);
        if let Ok(Ok(output)) =
            tokio::time::timeout(std::time::Duration::from_secs(5), command.output()).await
        {
            folders.extend(
                String::from_utf8_lossy(&output.stdout)
                    .split([';', '\r', '\n'])
                    .filter(|p| !p.is_empty())
                    .map(PathBuf::from),
            );
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        folders.push(PathBuf::from(&home).join(".local/bin"));
        folders.push(PathBuf::from(home).join(".cargo/bin"));
    }
    if let Some(paths) = std::env::var_os("PATH") {
        folders.extend(std::env::split_paths(&paths));
    }
    if provider == "codex"
        && cfg!(windows)
        && let Some(appdata) = std::env::var_os("APPDATA")
    {
        let base = PathBuf::from(appdata).join("npm/node_modules/@openai");
        let arch = if cfg!(target_arch = "aarch64") {
            "aarch64"
        } else {
            "x86_64"
        };
        for package in [
            "codex",
            "codex-win32-x64",
            "codex/node_modules/@openai/codex-win32-x64",
        ] {
            folders.push(
                base.join(package)
                    .join(format!("vendor/{arch}-pc-windows-msvc/codex")),
            );
        }
    }
    folders.into_iter().map(|p| p.join(&expected)).find(native)
}
