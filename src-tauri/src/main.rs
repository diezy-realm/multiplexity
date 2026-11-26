#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, sync::mpsc, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio_util::sync::CancellationToken;

fn open_external(url: &str) -> std::io::Result<()> {
    open::that_detached(url)
}

fn frontend_directory(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/client"))
    } else {
        Ok(app.path().resource_dir()?.join("frontend"))
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let smoke = std::env::args().any(|value| value == "--smoke-test");
    let shutdown = CancellationToken::new();
    let setup_shutdown = shutdown.clone();
    let application = tauri::Builder::default()
        .setup(move |app| {
            let data_dir = if smoke {
                PathBuf::from(
                    std::env::var_os("MULTIPLEXITY_SMOKE_DATA_DIR")
                        .ok_or("Smoke data directory is required")?,
                )
            } else {
                app.path().app_data_dir()?
            };
            let frontend_dir = frontend_directory(app)?;
            if !frontend_dir.join("index.html").is_file() {
                return Err("Frontend build is missing. Run npm run build:web first.".into());
            }
            let (ready, receiver) = mpsc::channel();
            let worker_shutdown = setup_shutdown.clone();
            std::thread::Builder::new()
                .name("multiplexity-backend".into())
                .spawn(move || {
                    let runtime = tokio::runtime::Builder::new_multi_thread()
                        .enable_all()
                        .build();
                    match runtime {
                        Ok(runtime) => {
                            if let Err(error) =
                                runtime.block_on(multiplexity_backend::serve_with_external_open(
                                    data_dir,
                                    frontend_dir,
                                    0,
                                    ready,
                                    worker_shutdown,
                                    Some(open_external),
                                ))
                            {
                                eprintln!("Backend stopped: {error}");
                            }
                        }
                        Err(_) => eprintln!("Backend runtime could not start."),
                    }
                })?;
            let origin = receiver
                .recv_timeout(Duration::from_secs(30))
                .map_err(|_| "Backend startup timed out; inspect the application log.")?;
            let url = format!("{origin}/login").parse()?;
            let allowed_origin = origin.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Multiplexity")
                .inner_size(1440.0, 960.0)
                .min_inner_size(1000.0, 680.0)
                .devtools(cfg!(debug_assertions))
                .on_navigation(move |url| url.origin().ascii_serialization() == allowed_origin)
                .on_new_window(|url, _features| {
                    let allowed = [
                        "https://platform.openai.com/api-keys",
                        "https://platform.claude.com/settings/keys",
                        "https://developers.openai.com/codex/auth",
                        "https://kiro.dev/docs/cli/authentication/",
                        "https://antigravity.google/docs/cli/install/",
                        "http://172.18.136.92/",
                    ];
                    if allowed.contains(&url.as_str()) {
                        let _ = open::that_detached(url.as_str());
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_permission_request(|_webview, kind| match kind {
                    tauri::webview::PermissionKind::ClipboardRead => {
                        tauri::webview::PermissionResponse::Allow
                    }
                    _ => tauri::webview::PermissionResponse::Deny,
                })
                .build()?;
            if smoke {
                println!("MULTIPLEXITY_DESKTOP_READY {origin}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())?;
    application.run(move |_app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            shutdown.cancel();
        }
    });
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Multiplexity startup failed: {error}");
        std::process::exit(1);
    }
}
