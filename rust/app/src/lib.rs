pub mod ai;
pub mod auth;
pub mod core;
pub mod databases;
pub mod integrations;
pub mod machines;
pub mod pilot;
pub mod scm;
pub mod store;
#[cfg(test)]
mod tests;

use axum::{
    Json, Router,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<store::Store>,
    pub data_dir: PathBuf,
    pub client: reqwest::Client,
    pub origin: Arc<RwLock<String>>,
    pub(crate) external_open: Option<fn(&str) -> std::io::Result<()>>,
    pub(crate) review_previews: Arc<scm::Previews>,
}

#[derive(Clone, Debug)]
pub struct User {
    pub id: String,
    pub username: String,
}

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub message: String,
}
pub type ApiResult = Result<Json<Value>, AppError>;
impl AppError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, message)
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for AppError {}
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (
            self.status,
            [("cache-control", "no-store")],
            Json(json!({"error":self.message})),
        )
            .into_response()
    }
}
impl AppState {
    pub fn new(data_dir: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&data_dir)
            .map_err(|_| AppError::internal("Cannot create data directory"))?;
        let db = Arc::new(store::Store::open(&data_dir)?);
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|_| AppError::internal("Cannot create HTTP client"))?;
        Ok(Self {
            db,
            data_dir,
            client,
            origin: Arc::new(RwLock::new(String::new())),
            external_open: None,
            review_previews: Arc::default(),
        })
    }
    pub fn authenticate(&self, headers: &HeaderMap) -> Result<User, AppError> {
        auth::authenticate(self, headers)
    }
}

pub fn router(state: AppState, frontend_dir: PathBuf) -> Router {
    use axum::{
        middleware,
        routing::{any, get},
    };
    use tower_http::services::{ServeDir, ServeFile};
    let socket_layer = machines::socket_layer(&state);
    let protected = Router::new()
        .merge(core::router())
        .merge(ai::router())
        .merge(machines::router())
        .merge(databases::router())
        .merge(integrations::router())
        .merge(pilot::router())
        .merge(scm::router())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_user,
        ));
    Router::new()
        .merge(protected)
        .merge(auth::router())
        .route(
            "/api/{*path}",
            any(|| async { AppError::not_found("Not found") }),
        )
        .route(
            "/api/health",
            get(|| async {
                Json(json!({"status":"ok","backend":"rust","version":env!("CARGO_PKG_VERSION")}))
            }),
        )
        .fallback_service(
            ServeDir::new(&frontend_dir)
                .not_found_service(ServeFile::new(frontend_dir.join("index.html"))),
        )
        .layer(axum::extract::DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(socket_layer)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::check_origin,
        ))
        .with_state(state)
}

pub async fn serve(
    data_dir: PathBuf,
    frontend_dir: PathBuf,
    port: u16,
    ready: std::sync::mpsc::Sender<String>,
    shutdown: CancellationToken,
) -> Result<(), AppError> {
    serve_with_external_open(data_dir, frontend_dir, port, ready, shutdown, None).await
}

pub async fn serve_with_external_open(
    data_dir: PathBuf,
    frontend_dir: PathBuf,
    port: u16,
    ready: std::sync::mpsc::Sender<String>,
    shutdown: CancellationToken,
    external_open: Option<fn(&str) -> std::io::Result<()>>,
) -> Result<(), AppError> {
    let mut state = AppState::new(data_dir)?;
    state.external_open = external_open;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|_| AppError::internal("Cannot bind local HTTP server"))?;
    let port = listener
        .local_addr()
        .map_err(|_| AppError::internal("Cannot read server port"))?
        .port();
    let origin = std::env::var("MULTIPLEXITY_PUBLIC_ORIGIN")
        .unwrap_or_else(|_| format!("http://localhost:{port}"));
    let public =
        url::Url::parse(&origin).map_err(|_| AppError::bad_request("Invalid public origin"))?;
    if public.scheme() != "http"
        || !matches!(public.host_str(), Some("localhost" | "127.0.0.1"))
        || public.origin().ascii_serialization() != origin
    {
        return Err(AppError::bad_request(
            "Public origin must be an exact local HTTP origin",
        ));
    }
    *state
        .origin
        .write()
        .map_err(|_| AppError::internal("Origin lock unavailable"))? = origin.clone();
    let shutdown_state = state.clone();
    let app = router(state, frontend_dir);
    ready
        .send(origin)
        .map_err(|_| AppError::internal("Startup receiver closed"))?;
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown.cancelled().await;
            ai::shutdown();
            machines::shutdown(&shutdown_state).await;
            databases::shutdown(&shutdown_state).await;
        })
        .await
        .map_err(|_| AppError::internal("HTTP server stopped unexpectedly"))
}
