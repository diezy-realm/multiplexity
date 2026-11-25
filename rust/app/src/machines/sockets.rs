use super::{connect, execute, parsers, quote};
use crate::{AppState, User};
use serde_json::{Value, json};
use socketioxide::handler::ConnectHandler;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
    layer::SocketIoLayer,
};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        mpsc::{SyncSender, TryRecvError, sync_channel},
    },
    time::Duration,
};

enum Input {
    Write(String),
    Resize(u32, u32),
    Close,
}
type Shell = Arc<Mutex<Option<SyncSender<Input>>>>;
fn servers() -> &'static Mutex<HashMap<PathBuf, SocketIo>> {
    static SERVERS: OnceLock<Mutex<HashMap<PathBuf, SocketIo>>> = OnceLock::new();
    SERVERS.get_or_init(|| Mutex::new(HashMap::new()))
}
pub async fn shutdown(state: &AppState) {
    let io = servers()
        .lock()
        .ok()
        .and_then(|mut servers| servers.remove(&state.data_dir));
    if let Some(io) = io {
        io.close().await;
    }
}
fn send(shell: &Shell, input: Input) {
    if let Ok(lock) = shell.lock()
        && let Some(sender) = lock.as_ref()
    {
        let _ = sender.try_send(input);
    }
}
fn close(shell: &Shell) {
    send(shell, Input::Close);
    if let Ok(mut lock) = shell.lock() {
        *lock = None;
    }
}

pub fn socket_layer(state: &AppState) -> SocketIoLayer {
    let state = state.clone();
    let (layer, io) = SocketIo::builder()
        .req_path("/api/socketio")
        .max_payload(1024 * 1024)
        .build_layer();
    if let Ok(mut servers) = servers().lock() {
        servers.insert(state.data_dir.clone(), io.clone());
    }
    let auth_state = state.clone();
    let handler = move |socket: SocketRef| {
        let state = state.clone();
        async move {
            let user = match state.authenticate(&socket.req_parts().headers) {
                Ok(user) => user,
                Err(_) => {
                    let _ = socket.emit("terminal:error", &"Unauthorized");
                    let _ = socket.disconnect();
                    return;
                }
            };
            register(socket.clone(), state.clone(), user.clone());
            crate::integrations::register_ocp(socket, state, user);
        }
    };
    io.ns(
        "/",
        handler.with(move |socket: SocketRef| {
            let state = auth_state.clone();
            async move {
                state
                    .authenticate(&socket.req_parts().headers)
                    .map(|_| ())
                    .map_err(|_| "Unauthorized")
            }
        }),
    );
    layer
}
fn register(socket: SocketRef, state: AppState, user: User) {
    let shell: Shell = Arc::new(Mutex::new(None));
    let logs: Shell = Arc::new(Mutex::new(None));
    let current = shell.clone();
    let open_state = state.clone();
    let open_user = user.clone();
    socket.on(
        "terminal:open",
        move |socket: SocketRef, Data((id, size)): Data<(String, Option<Value>)>| {
            let current = current.clone();
            let state = open_state.clone();
            let user = open_user.clone();
            async move {
                close(&current);
                let cols = size
                    .as_ref()
                    .and_then(|x| x["cols"].as_u64())
                    .unwrap_or(80)
                    .clamp(1, 1000) as u32;
                let rows = size
                    .as_ref()
                    .and_then(|x| x["rows"].as_u64())
                    .unwrap_or(24)
                    .clamp(1, 1000) as u32;
                launch(socket, state, user, id, current, None, cols, rows);
            }
        },
    );
    let input = shell.clone();
    socket.on("terminal:input", move |Data(data): Data<String>| {
        let input = input.clone();
        async move {
            if data.len() <= 64 * 1024 {
                send(&input, Input::Write(data));
            }
        }
    });
    let resize = shell.clone();
    socket.on(
        "terminal:resize",
        move |Data((cols, rows)): Data<(u32, u32)>| {
            let resize = resize.clone();
            async move {
                send(
                    &resize,
                    Input::Resize(cols.clamp(1, 1000), rows.clamp(1, 1000)),
                );
            }
        },
    );
    let exit = shell.clone();
    socket.on("terminal:close", move |socket: SocketRef| {
        let exit = exit.clone();
        async move {
            close(&exit);
            let _ = socket.emit("terminal:close", &());
        }
    });
    let list_state = state.clone();
    let list_user = user.clone();
    socket.on("terminal:list-logs",move|socket:SocketRef,Data((id,directory)):Data<(String,Option<String>)>|{let state=list_state.clone();let user=list_user.clone();async move{
        let path=directory.unwrap_or_else(||".".into());let command=format!("find {} -maxdepth 1 -printf '%f|%y|%s\\n' | head -250",quote(&path));
        match execute(&state,&user.id,&id,&command).await{Ok(raw)=>{let entries:Vec<_>=raw.lines().filter_map(|line|{let p:Vec<_>=line.split('|').collect();if p.len()!=3||p[0]=="."||p[0]==".."{return None;}Some(json!({"name":p[0],"isDir":p[1]=="d","isDirectory":p[1]=="d","size":p[2].parse::<u64>().unwrap_or(0),"path":format!("{}/{}",path.trim_end_matches('/'),p[0])}))}).collect();let _=socket.emit("terminal:log-files",&json!({"directory":path,"entries":entries}));},Err(_)=>{let _=socket.emit("terminal:error",&"Could not list remote files");}}
    }});
    let git_state = state.clone();
    let git_user = user.clone();
    socket.on(
        "terminal:check-git",
        move |socket: SocketRef, Data((id, directory)): Data<(String, Option<String>)>| {
            let state = git_state.clone();
            let user = git_user.clone();
            async move {
                let path = directory.unwrap_or_else(|| ".".into());
                let command = format!(
                    "cd {} && git rev-parse --show-toplevel && git branch --show-current",
                    quote(&path)
                );
                let result = execute(&state, &user.id, &id, &command).await;
                let data = match result {
                    Ok(raw) => {
                        let p: Vec<_> = raw.lines().collect();
                        json!({"isGit":true,"directory":p.first(),"branch":p.get(1)})
                    }
                    Err(_) => json!({"isGit":false,"branch":null,"directory":""}),
                };
                let _ = socket.emit("terminal:git-info", &data);
            }
        },
    );
    let log_state = state.clone();
    let log_user = user;
    let subscribe = logs.clone();
    socket.on(
        "log:subscribe",
        move |socket: SocketRef, Data((id, project, file)): Data<(String, String, String)>| {
            let state = log_state.clone();
            let user = log_user.clone();
            let logs = subscribe.clone();
            async move {
                close(&logs);
                if super::safe_segment(&project).is_err() || super::safe_segment(&file).is_err() {
                    let _ = socket.emit("terminal:error", &"Invalid log path");
                    return;
                }
                let command = format!(
                    "tail -n 0 -F -- {}",
                    quote(&format!("/var/www/html/{project}/application/logs/{file}"))
                );
                launch(socket, state, user, id, logs, Some(command), 80, 24);
            }
        },
    );
    let unsubscribe = logs.clone();
    socket.on("log:unsubscribe", move || {
        let unsubscribe = unsubscribe.clone();
        async move {
            close(&unsubscribe);
        }
    });
    socket.on_disconnect(move || {
        let shell = shell.clone();
        let logs = logs.clone();
        async move {
            close(&shell);
            close(&logs);
        }
    });
}

#[expect(
    clippy::too_many_arguments,
    reason = "Preserve terminal identity, channel and PTY parameters"
)]
fn launch(
    socket: SocketRef,
    state: AppState,
    user: User,
    id: String,
    shell: Shell,
    command: Option<String>,
    cols: u32,
    rows: u32,
) {
    let (tx, rx) = sync_channel::<Input>(64);
    if let Ok(mut lock) = shell.lock() {
        *lock = Some(tx);
    }
    tokio::task::spawn_blocking(move || {
        let result = (|| -> Result<(), crate::AppError> {
            let session = connect(&state, &user.id, &id)?;
            let mut channel = session
                .channel_session()
                .map_err(|_| crate::AppError::internal("SSH channel failed"))?;
            if let Some(command) = &command {
                channel
                    .exec(command)
                    .map_err(|_| crate::AppError::internal("Log subscription failed"))?;
            } else {
                channel
                    .request_pty("xterm-256color", None, Some((cols, rows, 0, 0)))
                    .map_err(|_| crate::AppError::internal("SSH PTY failed"))?;
                channel
                    .shell()
                    .map_err(|_| crate::AppError::internal("SSH shell failed"))?;
            }
            session.set_blocking(false);
            let mut buffer = [0u8; 16384];
            let mut pending = Vec::<u8>::new();
            let mut write_buffer = Vec::<u8>::new();
            let mut log_buffer = String::new();
            loop {
                loop {
                    match rx.try_recv() {
                        Ok(Input::Close) | Err(TryRecvError::Disconnected) => {
                            channel.close().ok();
                            return Ok(());
                        }
                        Ok(Input::Resize(cols, rows)) => {
                            channel.request_pty_size(cols, rows, None, None).ok();
                        }
                        Ok(Input::Write(data)) => {
                            if write_buffer.len() + data.len() <= 256 * 1024 {
                                write_buffer.extend_from_slice(data.as_bytes());
                            }
                        }
                        Err(TryRecvError::Empty) => break,
                    }
                }
                if !write_buffer.is_empty() {
                    match channel.write(&write_buffer) {
                        Ok(n) => {
                            write_buffer.drain(..n);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                        Err(_) => break,
                    }
                }
                match channel.read(&mut buffer) {
                    Ok(0) => {
                        if channel.eof() {
                            break;
                        }
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&buffer[..n]);
                        let valid = match std::str::from_utf8(&pending) {
                            Ok(_) => pending.len(),
                            Err(error) => {
                                if error.error_len().is_some() {
                                    pending.len()
                                } else {
                                    error.valid_up_to()
                                }
                            }
                        };
                        let chunk = String::from_utf8_lossy(&pending[..valid]).into_owned();
                        pending.drain(..valid);
                        if command.is_some() {
                            log_buffer.push_str(&chunk);
                            while let Some(end) = log_buffer.find('\n') {
                                let line = log_buffer.drain(..=end).collect::<String>();
                                for entry in parsers::logs(&line) {
                                    let _ = socket.emit("log:newEntry", &entry);
                                }
                            }
                            if log_buffer.len() > 65536 {
                                log_buffer.clear();
                            }
                        } else {
                            let _ = socket.emit("terminal:output", &chunk);
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => break,
                }
                std::thread::sleep(Duration::from_millis(8));
            }
            channel.close().ok();
            Ok(())
        })();
        if result.is_err() {
            let _ = socket.emit("terminal:error", &"SSH connection or session failed");
        }
        if command.is_none() {
            let _ = socket.emit("terminal:close", &());
        }
    });
}
