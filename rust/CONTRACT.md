# Shared Rust module contract

The workspace root is `rust/Cargo.toml`; backend library crate `app` exports `multiplexity_backend`.

Modules `ai`, `machines`, `databases`, `integrations` each export `pub fn router() -> axum::Router<crate::AppState>` using full `/api/...` paths. Root installs authentication middleware and merges these routers. Socket.IO may be installed by `machines::layer(&AppState)` if needed; coordinate its concrete type with root. Do not create a second unauthenticated server.

`AppState` is Clone with `pub db: Arc<store::Store>`, `pub data_dir: PathBuf`, `pub client: reqwest::Client`, `pub origin: Arc<std::sync::RwLock<String>>`. Extra manager state should use `Arc` and be coordinated with root.

Handlers read `Extension(user): Extension<crate::User>` (`id: String`, `username: String`) and `State(state): State<AppState>`. `AppState::authenticate(&HeaderMap) -> Result<User, AppError>` validates session cookies for socket handshakes. `AppError` implements `IntoResponse`; constructors `bad_request`, `not_found`, `internal`, `forbidden`, `unauthorized`, `new(StatusCode, message)`. `ApiResult = Result<axum::Json<serde_json::Value>, AppError>`.

`Store::query(&self, sql: &str, params: &[serde_json::Value]) -> Result<Vec<Value>, AppError>`, `Store::one(...) -> Result<Option<Value>, AppError>`, `Store::execute(...) -> Result<usize, AppError>`. Rows are JSON objects using SQL column names. `Store::encrypt(&self, plaintext: &str) -> Result<Encrypted, AppError>` and `Store::decrypt(&self, ciphertext: &str, iv: &str, auth_tag: &str) -> Result<String, AppError>`, Encrypted fields `ciphertext`, `iv`, `auth_tag`. Schema mirrors existing SQL; root adds missing migrations (`users.auth_version`, database user_id, etc.) after inspecting `src/lib/db/index.ts`.

Do not hold a SQLite mutex across await. Do not disclose SQL parameters or underlying errors containing secrets. Root owns shared manifests, store.rs, auth.rs, core.rs, lib.rs, main.rs. Other modules may create submodules under their own module directories. Other agents must request dependency additions from root.
