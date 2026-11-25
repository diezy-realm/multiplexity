use super::settings::text;
use crate::AppError;
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::mpsc,
};
use tokio_util::sync::CancellationToken;

pub type Observer = mpsc::Sender<Value>;
struct ProcessTree {
    pid: Option<u32>,
    armed: bool,
}
impl Drop for ProcessTree {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if let Some(pid) = self.pid {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill.exe")
                    .args(["/pid", &pid.to_string(), "/t", "/f"])
                    .creation_flags(0x08000000)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
            }
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", "--", &format!("-{pid}")])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
            }
        }
    }
}
pub async fn emit(observer: &Option<Observer>, value: Value) {
    if let Some(sender) = observer {
        let _ = sender.send(value).await;
    }
}

fn environment(command: &mut tokio::process::Command) {
    let variables = [
        "PATH",
        "Path",
        "PATHEXT",
        "SystemRoot",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "USERPROFILE",
        "HOME",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ];
    command.env_clear().env("NODE_ENV", "production");
    for name in variables {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
}

pub async fn stop_process(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let mut killer = tokio::process::Command::new("taskkill.exe");
        killer
            .args(["/pid", &pid.to_string(), "/t", "/f"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let _ = tokio::time::timeout(Duration::from_secs(5), killer.status()).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[expect(
    clippy::too_many_arguments,
    reason = "Keep process policy, cancellation and observer explicit at the adapter boundary"
)]
pub async fn run(
    executable: &Path,
    args: &[String],
    cwd: &Path,
    input: &str,
    credential: Option<(&str, &str)>,
    cancel: &CancellationToken,
    observer: Option<Observer>,
    provider: &str,
    timeout: Duration,
    capture_help: bool,
) -> Result<String, AppError> {
    let mut command = tokio::process::Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    environment(&mut command);
    if let Some((name, value)) = credential {
        command.env(name, value);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| AppError::bad_request("CLI tidak dapat dijalankan. Periksa executable."))?;
    let mut tree = ProcessTree {
        pid: child.id(),
        armed: true,
    };
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::internal("CLI stdin tidak tersedia."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::internal("CLI stdout tidak tersedia."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::internal("CLI stderr tidak tersedia."))?;
    let read = async {
        let mut reader = BufReader::new(stdout.take(2 * 1024 * 1024 + 1));
        let mut output = Vec::new();
        let mut texts = HashMap::<String, String>::new();
        loop {
            let mut line = Vec::new();
            let read = reader
                .read_until(b'\n', &mut line)
                .await
                .map_err(|_| AppError::internal("Stream CLI terputus."))?;
            if read == 0 {
                break;
            }
            if output.len() + line.len() > 2 * 1024 * 1024 {
                return Err(AppError::bad_request("Output CLI terlalu besar."));
            }
            if let Ok(event) = serde_json::from_slice::<Value>(&line) {
                decode_cli(provider, &event, &mut texts, &observer).await;
            }
            output.extend(line);
        }
        String::from_utf8(output)
            .map_err(|_| AppError::bad_request("Encoding output CLI tidak valid."))
    };
    let errors = async {
        let mut bytes = Vec::new();
        stderr
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| AppError::internal("Stream CLI terputus."))?;
        Ok::<_, AppError>(bytes)
    };
    let write = async move {
        let _ = stdin.write_all(input.as_bytes()).await;
        let _ = stdin.shutdown().await;
        drop(stdin);
    };
    let result = tokio::select! {
        _=cancel.cancelled()=>Err(AppError::bad_request("Permintaan dibatalkan.")),
        _=tokio::time::sleep(timeout)=>Err(AppError::bad_request("CLI timeout.")),
        result=async { let (output,errors,_,status)=tokio::join!(read,errors,write,child.wait()); let output=output?;let errors=errors?;let status=status.map_err(|_|AppError::internal("CLI berhenti tanpa status."))?;
            if !status.success() && !capture_help {return Err(AppError::bad_request(format!("CLI gagal (exit {}). Periksa login, versi, model dan izin CLI.",status.code().unwrap_or(-1))));}
            Ok(if capture_help {output+&String::from_utf8_lossy(&errors)} else {output})
        }=>result
    };
    if result.is_err() {
        stop_process(&mut child).await;
    }
    tree.armed = false;
    result
}

pub async fn decode_cli(
    provider: &str,
    event: &Value,
    texts: &mut HashMap<String, String>,
    observer: &Option<Observer>,
) {
    if provider == "codex" {
        if text(event, "type") == "turn.started" {
            emit(observer, json!({"type":"status","stage":"thinking"})).await;
        }
        if text(&event["item"], "type") == "agent_message" {
            let id = event["item"]["id"].as_str().unwrap_or("answer").to_owned();
            let next = text(&event["item"], "text");
            let previous = texts.get(&id).map(String::as_str).unwrap_or("");
            let mut delta = next.strip_prefix(previous).unwrap_or(next).to_owned();
            if previous.is_empty() && !texts.is_empty() {
                delta = format!("\n\n{delta}");
            }
            texts.insert(id, next.to_owned());
            if !delta.is_empty() {
                emit(observer, json!({"type":"delta","text":delta})).await;
            }
        } else if text(event, "type") == "item.started" {
            emit(observer,json!({"type":"status","stage":if matches!(text(&event["item"],"type"),"command_execution"|"mcp_tool_call"|"file_change"|"web_search") {"tool"} else {"thinking"}})).await;
        }
    } else if provider == "antigravity" && text(event, "event") == "step_update" {
        let step = &event["step_update"];
        if text(step, "step_type") == "tool" {
            emit(observer, json!({"type":"status","stage":"tool"})).await;
        }
        if text(step, "step_type") == "agent_response" {
            let id = step["step_index"].to_string();
            let previous = texts.get(&id).map(String::as_str).unwrap_or("");
            let next = text(step, "text_delta");
            let delta = if text(step, "state") == "DONE" {
                next.strip_prefix(previous).unwrap_or(next)
            } else {
                next
            };
            let combined = format!("{previous}{delta}");
            let delta = delta.to_owned();
            texts.insert(id, combined);
            if !delta.is_empty() {
                emit(observer, json!({"type":"delta","text":delta})).await;
            }
        }
    }
}

pub async fn codex_models(
    executable: &Path,
    cancel: &CancellationToken,
) -> Result<Vec<Value>, AppError> {
    let mut command = tokio::process::Command::new(executable);
    environment(&mut command);
    command
        .arg("app-server")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| AppError::bad_request("Codex app-server tidak dapat dijalankan."))?;
    let mut tree = ProcessTree {
        pid: child.id(),
        armed: true,
    };
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::internal("CLI stdin tidak tersedia."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::internal("CLI stdout tidak tersedia."))?;
    let work = async {
        stdin.write_all(format!("{}\n",json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"multiplexity","version":"0.3.0"},"capabilities":{"experimentalApi":false}}})).as_bytes()).await.map_err(|_|AppError::bad_request("Inisialisasi Codex gagal."))?;
        let mut reader = BufReader::new(stdout);
        let mut total = 0;
        loop {
            let mut line = String::new();
            let n = reader
                .read_line(&mut line)
                .await
                .map_err(|_| AppError::bad_request("Stream model Codex terputus."))?;
            total += n;
            if n == 0 || total > 1024 * 1024 {
                return Err(AppError::bad_request("Daftar model Codex tidak tersedia."));
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if message["id"] == 1 {
                if message.get("error").is_some() {
                    return Err(AppError::bad_request("Inisialisasi Codex gagal."));
                }
                stdin
                    .write_all(
                        format!(
                            "{}\n{}\n",
                            json!({"method":"initialized"}),
                            json!({"id":2,"method":"model/list","params":{"includeHidden":false}})
                        )
                        .as_bytes(),
                    )
                    .await
                    .map_err(|_| AppError::bad_request("Permintaan model Codex gagal."))?;
            }
            if message["id"] == 2 {
                let list = message["result"]["data"].as_array().ok_or_else(|| {
                    AppError::bad_request("Daftar model Codex tidak tersedia. Periksa login CLI.")
                })?;
                return Ok(list
                    .iter()
                    .take(250)
                    .map(|v| {
                        let id = v["model"]
                            .as_str()
                            .or_else(|| v["id"].as_str())
                            .unwrap_or("");
                        json!({"id":id,"name":v["displayName"].as_str().unwrap_or(id)})
                    })
                    .collect());
            }
        }
    };
    let result = tokio::select! {_=cancel.cancelled()=>Err(AppError::bad_request("Permintaan dibatalkan.")),_=tokio::time::sleep(Duration::from_secs(20))=>Err(AppError::bad_request("Daftar model Codex timeout.")),value=work=>value};
    stop_process(&mut child).await;
    tree.armed = false;
    result
}
