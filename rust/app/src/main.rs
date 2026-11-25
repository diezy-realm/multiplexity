use multiplexity_backend::{AppError, serve};
use std::{path::PathBuf, sync::mpsc};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> Result<(), AppError> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let data = std::env::var_os("MULTIPLEXITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".local-dev/rust"));
    let frontend = std::env::var_os("MULTIPLEXITY_FRONTEND_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("dist/client"));
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3300".into())
        .parse()
        .map_err(|_| AppError::bad_request("Invalid PORT"))?;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        if let Ok(origin) = receive.recv() {
            println!("Multiplexity Rust: {origin}");
        }
    });
    let cancel = CancellationToken::new();
    let interrupt = cancel.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        interrupt.cancel();
    });
    serve(data, frontend, port, send, cancel).await
}
