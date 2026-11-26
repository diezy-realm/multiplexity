use super::{
    process, provider,
    settings::{self, Connection, Model},
};
use crate::AppError;
use serde::Serialize;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

#[derive(Serialize)]
pub(super) struct ProbeResult {
    pub models: Vec<Model>,
    pub version: String,
    pub executable: String,
}

pub(super) async fn probe_connection(connection: &Connection) -> Result<ProbeResult, AppError> {
    let cancel = CancellationToken::new();
    let provider = connection.provider.as_str();
    let mut version = String::new();
    let mut executable = String::new();
    let models = if settings::is_cli(provider) {
        let path = settings::find_cli(provider, &connection.cli_path)
            .await
            .ok_or_else(|| {
                AppError::bad_request("CLI tidak ditemukan. Isi Binary path atau pasang CLI resmi.")
            })?;
        executable = path.to_string_lossy().into_owned();
        version = cli_command(&path, &["--version"], &cancel)
            .await?
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .chars()
            .filter(|character| !character.is_control())
            .take(100)
            .collect();
        match provider {
            "codex" => {
                cli_command(&path, &["login", "status"], &cancel)
                    .await
                    .map_err(|_| {
                        AppError::bad_request(
                            "Login Codex belum tersedia. Buka login CLI lalu uji lagi.",
                        )
                    })?;
            }
            "kiro" if connection.key.is_empty() => {
                let status = cli_command(&path, &["whoami"], &cancel).await?;
                if !status
                    .lines()
                    .any(|line| line.trim_start().starts_with("Logged in"))
                {
                    return Err(AppError::bad_request(
                        "Login Kiro belum tersedia. Buka login CLI lalu uji lagi.",
                    ));
                }
            }
            _ => {}
        }
        let result = cli_models(connection, &path, &cancel).await?;
        if result.is_empty() {
            return Err(AppError::bad_request(
                "CLI tidak mengembalikan daftar model. Periksa login dan versi CLI.",
            ));
        }
        result
    } else {
        // OpenRouter serves its model catalog without authentication.
        if provider == "openrouter" {
            let result = api_get(connection, "key", &cancel).await?;
            if !result["data"].is_object() {
                return Err(AppError::bad_request(
                    "Status API key OpenRouter tidak dapat diverifikasi.",
                ));
            }
        }
        api_models(connection, &cancel).await?
    };
    Ok(ProbeResult {
        models,
        version,
        executable,
    })
}

async fn cli_command(
    path: &Path,
    args: &[&str],
    cancel: &CancellationToken,
) -> Result<String, AppError> {
    process::run(
        path,
        &args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>(),
        &std::env::temp_dir(),
        "",
        None,
        cancel,
        None,
        "",
        Duration::from_secs(8),
        false,
    )
    .await
}

async fn cli_models(
    connection: &Connection,
    executable: &Path,
    cancel: &CancellationToken,
) -> Result<Vec<Model>, AppError> {
    let provider = connection.provider.as_str();
    let values = {
        if provider == "codex" {
            process::codex_models(executable, cancel).await?
        } else {
            let args = if provider == "kiro" {
                vec!["chat", "--list-models", "--format", "json"]
            } else {
                vec!["models"]
            };
            let credential = if connection.key.is_empty() {
                None
            } else {
                Some((
                    if provider == "kiro" {
                        "KIRO_API_KEY"
                    } else {
                        "GEMINI_API_KEY"
                    },
                    connection.key.as_str(),
                ))
            };
            let output = process::run(
                executable,
                &args.into_iter().map(str::to_owned).collect::<Vec<_>>(),
                &std::env::temp_dir(),
                "",
                credential,
                cancel,
                None,
                "",
                Duration::from_secs(20),
                false,
            )
            .await?;
            if provider == "kiro" {
                let parsed: Value = serde_json::from_str(&output)
                    .map_err(|_| AppError::bad_request("Format daftar model tidak valid."))?;
                let list = parsed
                    .as_array()
                    .or_else(|| parsed["models"].as_array())
                    .or_else(|| parsed["data"].as_array())
                    .cloned()
                    .unwrap_or_default();
                list.iter().filter_map(|v| {let id=v.as_str().or_else(||["id","modelId","model_id","name"].into_iter().find_map(|key|v[key].as_str()))?;Some(json!({"id":id,"name":v["model_name"].as_str().or_else(||v["name"].as_str()).unwrap_or(id)}))}).collect()
            } else {
                let expression = regex::Regex::new(r"^(gemini|claude|gpt)-[a-zA-Z0-9.-]+$")
                    .map_err(|_| AppError::internal("Model parser unavailable"))?;
                output
                    .lines()
                    .filter_map(|line| line.split_whitespace().next())
                    .filter(|id| expression.is_match(id))
                    .map(|id| json!({"id":id,"name":id}))
                    .collect()
            }
        }
    };
    Ok(parse_models(values))
}

async fn api_get(
    connection: &Connection,
    path: &str,
    cancel: &CancellationToken,
) -> Result<Value, AppError> {
    if settings::needs_key(&connection.provider) && connection.key.is_empty() {
        return Err(AppError::bad_request("Isi API key terlebih dahulu."));
    }
    if connection.endpoint.is_empty() {
        return Err(AppError::bad_request("Isi endpoint API terlebih dahulu."));
    }
    let url = format!("{}/{}", connection.endpoint.trim_end_matches('/'), path);
    tokio::time::timeout(
        Duration::from_secs(12),
        provider::request(&url, connection, None, "chat", cancel, None),
    )
    .await
    .map_err(|_| AppError::bad_request("Provider tidak merespons uji koneksi."))?
}

async fn api_models(
    connection: &Connection,
    cancel: &CancellationToken,
) -> Result<Vec<Model>, AppError> {
    let result = api_get(connection, "models", cancel).await?;
    let data = result["data"].as_array().ok_or_else(|| {
        AppError::bad_request("Endpoint tidak mengembalikan katalog model yang valid.")
    })?;
    Ok(parse_models(data.iter().cloned()))
}

fn parse_models(raw: impl IntoIterator<Item = Value>) -> Vec<Model> {
    let mut seen = std::collections::HashSet::new();
    raw.into_iter()
        .filter_map(|item| {
            let id = item["id"].as_str()?;
            if id.is_empty() || !settings::valid_model(id) || !seen.insert(id.to_owned()) {
                return None;
            }
            let name = ["display_name", "name"]
                .iter()
                .find_map(|field| item.get(field).and_then(Value::as_str))
                .unwrap_or(id);
            Some(Model {
                id: id.to_owned(),
                name: name.chars().take(160).collect(),
            })
        })
        .take(250)
        .collect()
}

pub(super) async fn models(connection: &Connection) -> Result<Vec<Model>, AppError> {
    let cancel = CancellationToken::new();
    if settings::is_cli(&connection.provider) {
        let path = settings::find_cli(&connection.provider, &connection.cli_path)
            .await
            .ok_or_else(|| AppError::bad_request("CLI tidak ditemukan."))?;
        cli_models(connection, &path, &cancel).await
    } else {
        api_models(connection, &cancel).await
    }
}
