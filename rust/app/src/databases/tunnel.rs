use crate::{AppError, AppState};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

pub struct Tunnel {
    pub port: u16,
    alive: Arc<AtomicBool>,
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Release);
    }
}
pub async fn start(
    state: &AppState,
    user: &str,
    vm: &str,
    host: &str,
    port: u16,
) -> Result<Tunnel, AppError> {
    crate::machines::vm(state, user, vm)?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| AppError::internal("Could not bind SSH tunnel"))?;
    let local_port = listener
        .local_addr()
        .map_err(|_| AppError::internal("Tunnel address failed"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|_| AppError::internal("Tunnel configuration failed"))?;
    let alive = Arc::new(AtomicBool::new(true));
    let worker_alive = alive.clone();
    let state = state.clone();
    let user = user.to_owned();
    let vm = vm.to_owned();
    let host = host.to_owned();
    std::thread::spawn(move || {
        while worker_alive.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let state = state.clone();
                    let user = user.clone();
                    let vm = vm.clone();
                    let host = host.clone();
                    let alive = worker_alive.clone();
                    std::thread::spawn(move || {
                        let _ = forward(state, user, vm, host, port, stream, alive);
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(15))
                }
                Err(_) => break,
            }
        }
    });
    Ok(Tunnel {
        port: local_port,
        alive,
    })
}
fn forward(
    state: AppState,
    user: String,
    vm: String,
    host: String,
    port: u16,
    mut stream: TcpStream,
    alive: Arc<AtomicBool>,
) -> Result<(), AppError> {
    let session = crate::machines::connect(&state, &user, &vm)?;
    let mut channel = session
        .channel_direct_tcpip(&host, port, None)
        .map_err(|_| AppError::internal("SSH database forwarding failed"))?;
    session.set_blocking(false);
    stream
        .set_nonblocking(true)
        .map_err(|_| AppError::internal("Tunnel socket configuration failed"))?;
    let mut input = Vec::new();
    let mut output = Vec::new();
    let mut buffer = [0u8; 16384];
    while alive.load(Ordering::Acquire) {
        if input.len() < 65536 {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => input.extend_from_slice(&buffer[..n]),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => break,
            }
        }
        if !input.is_empty() {
            match channel.write(&input) {
                Ok(n) => {
                    input.drain(..n);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => break,
            }
        }
        if output.len() < 65536 {
            match channel.read(&mut buffer) {
                Ok(0) if channel.eof() => break,
                Ok(n) => output.extend_from_slice(&buffer[..n]),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => break,
            }
        }
        if !output.is_empty() {
            match stream.write(&output) {
                Ok(n) => {
                    output.drain(..n);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => break,
            }
        }
        std::thread::sleep(Duration::from_millis(3));
    }
    channel.close().ok();
    Ok(())
}
