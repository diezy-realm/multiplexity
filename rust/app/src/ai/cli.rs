use super::{
    process::{self, Observer, emit},
    settings::{Connection, text},
};
use crate::{AppError, AppState};
use base64::Engine;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

struct TemporaryFiles(Vec<PathBuf>);
impl Drop for TemporaryFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "Keep provider execution parameters explicit during contract migration"
)]
pub async fn complete(
    state: &AppState,
    user: &str,
    connection: &Connection,
    executable: &Path,
    model: &str,
    effort: &str,
    permission: &str,
    prompt: &str,
    images: &[&Value],
    cancel: &CancellationToken,
    observer: Option<Observer>,
) -> Result<String, AppError> {
    let cwd = crate::core::workspace_root(state, user)?;
    let provider = connection.provider.as_str();
    let allow = permission == "allow-all";
    let mut temporary = TemporaryFiles(Vec::new());
    let mut args: Vec<String>;
    match provider {
        "codex" => {
            args = [
                "exec",
                "--skip-git-repo-check",
                "--ephemeral",
                "--ignore-user-config",
                "--ignore-rules",
                "--json",
            ]
            .map(str::to_owned)
            .to_vec();
            if allow {
                args.push("--dangerously-bypass-approvals-and-sandbox".into());
            } else {
                args.extend(
                    [
                        "-s",
                        "read-only",
                        "-c",
                        "approval_policy=\"never\"",
                        "-c",
                        "features.shell_tool=false",
                        "-c",
                        "features.apply_patch_tool=false",
                        "-c",
                        "web_search=\"disabled\"",
                    ]
                    .map(str::to_owned),
                );
            }
            for image in images {
                let extension = match text(image, "mediaType") {
                    "image/png" => "png",
                    "image/jpeg" => "jpg",
                    _ => "webp",
                };
                let file = std::env::temp_dir().join(format!(
                    "multiplexity-image-{}.{extension}",
                    uuid::Uuid::new_v4()
                ));
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(text(image, "content"))
                    .map_err(|_| AppError::bad_request("Gambar tidak valid."))?;
                tokio::fs::write(&file, bytes)
                    .await
                    .map_err(|_| AppError::internal("Gagal menulis lampiran gambar."))?;
                temporary.0.push(file.clone());
                args.extend(["--image".to_owned(), file.to_string_lossy().into_owned()]);
            }
            if effort != "default" {
                args.extend([
                    "-c".to_owned(),
                    format!("model_reasoning_effort=\"{effort}\""),
                ]);
            }
        }
        "kiro" => {
            let directory = cwd.join(".kiro/agents");
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(|_| AppError::internal("Workspace CLI tidak tersedia."))?;
            let name = format!("multiplexity-{}", uuid::Uuid::new_v4());
            let file = directory.join(format!("{name}.json"));
            let policy = json!({"name":name,"description":"Multiplexity shared workspace","tools":if allow {vec!["@builtin"]} else {vec![]},"resources":[],"mcpServers":{},"includeMcpJson":false,"includePowers":false,"hooks":{},"permissions":{"rules":[]},"prompt":"Read AGENTS.md, rules.md, steering.md and applicable skills. Save deliverables under artifacts/. Never claim an action without execution evidence."});
            tokio::fs::write(&file, policy.to_string())
                .await
                .map_err(|_| AppError::internal("Kebijakan CLI tidak dapat ditulis."))?;
            temporary.0.push(file);
            args = [
                "chat",
                "--v3",
                "--no-interactive",
                "--agent",
                &name,
                if allow {
                    "--trust-all-tools"
                } else {
                    "--trust-tools="
                },
                "--output-format",
                "text",
            ]
            .map(str::to_owned)
            .to_vec();
            if effort != "default" {
                args.extend(["--effort".to_owned(), effort.to_owned()]);
            }
        }
        "antigravity" => {
            let help = process::run(
                executable,
                &["--help".into()],
                &cwd,
                "",
                None,
                cancel,
                None,
                "",
                Duration::from_secs(15),
                true,
            )
            .await?;
            if !help.contains("--settings") {
                return Err(AppError::bad_request(
                    "Versi Antigravity belum mendukung --settings. Perbarui CLI.",
                ));
            }
            let directory = cwd.join(".runtime");
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(|_| AppError::internal("Workspace CLI tidak tersedia."))?;
            let file = directory.join(format!("agy-policy-{}.json", uuid::Uuid::new_v4()));
            let mut policy = json!({"toolPermission":if allow {"always-proceed"} else {"strict"}});
            if !connection.key.is_empty() {
                policy["modelProvider"] = json!("gemini");
            }
            tokio::fs::write(&file, policy.to_string())
                .await
                .map_err(|_| AppError::internal("Kebijakan CLI tidak dapat ditulis."))?;
            temporary.0.push(file.clone());
            args = [
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--disable-slash-commands",
            ]
            .map(str::to_owned)
            .to_vec();
            if allow {
                args.push("--dangerously-skip-permissions".into());
            } else {
                args.extend(["--mode", "plan", "--sandbox"].map(str::to_owned));
            }
            args.extend(["--settings".to_owned(), file.to_string_lossy().into_owned()]);
            if effort != "default" {
                args.extend(["--effort".to_owned(), effort.to_owned()]);
            }
        }
        _ => return Err(AppError::bad_request("Provider CLI tidak valid.")),
    }
    if !model.is_empty() {
        args.extend(["--model".to_owned(), model.to_owned()]);
    }
    let input = if provider == "antigravity" {
        format!("{}\n", json!({"event":"user","message":{"content":prompt}}))
    } else {
        prompt.to_owned()
    };
    let credential = if connection.key.is_empty() || provider == "codex" {
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
    emit(
        &observer,
        json!({"type":"status","stage":if provider=="kiro" {"buffered"} else {"thinking"}}),
    )
    .await;
    let output = process::run(
        executable,
        &args,
        &cwd,
        &input,
        credential,
        cancel,
        observer,
        provider,
        Duration::from_secs(120),
        false,
    )
    .await?;
    match provider {
        "codex" => {
            let messages: Vec<String> = output
                .lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .filter(|v| {
                    text(v, "type") == "item.completed"
                        && text(&v["item"], "type") == "agent_message"
                })
                .map(|v| text(&v["item"], "text").to_owned())
                .collect();
            if messages.is_empty() {
                return Err(AppError::bad_request(
                    "Codex tidak memberikan respons teks. Periksa login dan versi CLI.",
                ));
            }
            Ok(messages.join("\n\n"))
        }
        "antigravity" => {
            let answer = output
                .lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .filter(|v| {
                    text(v, "event") == "result" && text(&v["result"], "status") == "SUCCESS"
                })
                .map(|v| text(&v["result"], "response").to_owned())
                .next_back()
                .unwrap_or_default();
            if answer.is_empty() {
                return Err(AppError::bad_request(
                    "Antigravity tidak memberikan hasil. Periksa login dan kebijakan CLI.",
                ));
            }
            Ok(answer)
        }
        _ => {
            let expression = regex::Regex::new("\u{1b}\\[[0-9;]*m")
                .map_err(|_| AppError::internal("Pembersih output gagal."))?;
            let answer = expression.replace_all(&output, "").trim().to_owned();
            if answer.is_empty() {
                return Err(AppError::bad_request("CLI tidak memberikan respons teks."));
            }
            Ok(answer)
        }
    }
}
