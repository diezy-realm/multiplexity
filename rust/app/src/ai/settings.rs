use crate::{AppError, AppState};
use axum::Json;
use serde_json::{Value, json};
use std::path::PathBuf;

pub const PROVIDERS: [&str; 8] = [
    "openai",
    "claude",
    "gemini",
    "ollama",
    "custom",
    "codex",
    "kiro",
    "antigravity",
];

pub fn text<'a>(value: &'a Value, field: &str) -> &'a str {
    value.get(field).and_then(Value::as_str).unwrap_or("")
}

pub fn is_cli(provider: &str) -> bool {
    matches!(provider, "codex" | "kiro" | "antigravity")
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
    let endpoint = match (text(value, "endpoint"), provider) {
        ("", "gemini") => "https://generativelanguage.googleapis.com/v1beta/openai",
        ("", "ollama") => "http://127.0.0.1:11434/v1",
        (other, _) => other,
    }
    .to_owned();
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
        endpoint,
        saved: row.is_some(),
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
    Ok(if PROVIDERS.contains(&provider) {
        provider
    } else {
        "openai"
    }
    .to_owned())
}

pub async fn public(state: &AppState) -> Result<Value, AppError> {
    let mut items = Vec::new();
    for provider in PROVIDERS {
        let item = connection(state, provider)?;
        let executable = if is_cli(provider) {
            find_cli(provider, &item.cli_path).await
        } else {
            None
        };
        let configured = !item.key.is_empty()
            || executable.is_some()
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
        items.push(json!({"provider":provider,"model":item.model,"configured":configured,"apiKeyHint":hint,"cliPath":item.cli_path,"endpoint":item.endpoint,"available":!is_cli(provider)||executable.is_some(),"executable":executable.map(|p|p.to_string_lossy().into_owned()).unwrap_or_default()}));
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

pub async fn save(state: &AppState, body: Value) -> Result<Json<Value>, AppError> {
    let provider = text(&body, "provider");
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::bad_request("Model tidak valid."))?;
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
    let previous = connection(state, provider)?;
    let key = text(&body, "apiKey").trim();
    if provider == "codex" && !key.is_empty() {
        return Err(AppError::bad_request("Gunakan login resmi Codex CLI."));
    }
    if (!key.is_empty() && key.len() < 10)
        || (!is_cli(provider)
            && !matches!(provider, "ollama" | "custom")
            && body["clearKey"] != true
            && key.is_empty()
            && previous.key.is_empty())
    {
        return Err(AppError::bad_request("API key wajib diisi."));
    }
    let endpoint = text(&body, "endpoint").trim();
    if !endpoint.is_empty() {
        validate_endpoint(endpoint)?;
    }
    if provider == "custom" && endpoint.is_empty() {
        return Err(AppError::bad_request("Endpoint API wajib diisi."));
    }
    let mut cli_path = text(&body, "cliPath").trim().to_owned();
    if is_cli(provider) && !cli_path.is_empty() {
        cli_path = find_cli(provider, &cli_path)
            .await
            .ok_or_else(|| AppError::bad_request("Executable CLI tidak ditemukan."))?
            .to_string_lossy()
            .into_owned();
    }
    let secret = state.db.encrypt(if !key.is_empty() {
        key
    } else if body["clearKey"] == true {
        ""
    } else {
        &previous.key
    })?;
    state.db.execute("INSERT INTO ai_connections(provider,model,api_key_encrypted,api_key_iv,api_key_auth_tag,cli_path,endpoint) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET model=excluded.model,api_key_encrypted=excluded.api_key_encrypted,api_key_iv=excluded.api_key_iv,api_key_auth_tag=excluded.api_key_auth_tag,cli_path=excluded.cli_path,endpoint=excluded.endpoint,updated_at=CURRENT_TIMESTAMP",&[json!(provider),json!(model),json!(secret.ciphertext),json!(secret.iv),json!(secret.auth_tag),json!(cli_path),json!(endpoint)])?;
    state.db.execute("INSERT INTO ai_settings(id,provider,model) VALUES('default',?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model",&[json!(provider),json!(model)])?;
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
            && candidate
                .file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&expected))
            && candidate.is_file()
    };
    if !configured.is_empty() {
        let mut candidate = PathBuf::from(configured.trim_matches('"'));
        if !candidate.is_absolute() || configured.contains(['\0', '\r', '\n']) {
            return None;
        }
        if candidate.is_dir() {
            candidate.push(&expected);
        }
        if native(&candidate) {
            return Some(candidate);
        }
        if candidate.extension().is_some_and(|e| e == "exe")
            && !candidate
                .file_name()
                .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&expected))
        {
            return None;
        }
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
