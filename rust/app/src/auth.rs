use crate::{AppError, AppState, User};
use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::any,
};
use rand::RngCore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use subtle::ConstantTimeEq;

const SESSION_COOKIE: &str = "next-auth.session-token";
const CSRF_COOKIE: &str = "multiplexity.csrf";
const MAX_AGE: i64 = 8 * 60 * 60;
static ATTEMPTS: OnceLock<Mutex<HashMap<String, (u32, i64)>>> = OnceLock::new();
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/{action}", any(auth_action))
        .route("/api/auth/callback/credentials", any(auth_action))
}
pub fn random_token() -> String {
    let mut bytes = [0; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
pub fn hash(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
pub fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|item| {
            let (key, value) = item.trim().split_once('=')?;
            (key == name).then(|| value.to_owned())
        })
}
pub fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<User, AppError> {
    let token =
        cookie(headers, SESSION_COOKIE).ok_or_else(|| AppError::unauthorized("Unauthorized"))?;
    if token.len() != 64 {
        return Err(AppError::unauthorized("Unauthorized"));
    }
    let row=state.db.one("SELECT users.id,users.username FROM rust_sessions JOIN users ON users.id=rust_sessions.user_id WHERE token_hash=? AND expires>?",&[json!(hash(&token)),json!(chrono::Utc::now().timestamp())])?.ok_or_else(||AppError::unauthorized("Unauthorized"))?;
    Ok(User {
        id: row["id"].as_str().unwrap_or_default().into(),
        username: row["username"].as_str().unwrap_or_default().into(),
    })
}
pub async fn check_origin(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let expected = state
        .origin
        .read()
        .map_err(|_| AppError::internal("Origin unavailable"))?
        .clone();
    let expected_url =
        url::Url::parse(&expected).map_err(|_| AppError::internal("Origin unavailable"))?;
    let expected_host =
        expected_url[url::Position::BeforeHost..url::Position::AfterPort].to_string();
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != Some(expected_host.as_str())
    {
        return Err(AppError::forbidden("Forbidden host"));
    }
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    if origin.is_some_and(|value| value != expected) {
        return Err(AppError::forbidden("Forbidden origin"));
    }
    if !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) && origin != Some(expected.as_str())
    {
        return Err(AppError::forbidden("Origin required"));
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("same-origin"),
    );
    response.headers_mut().insert(header::CONTENT_SECURITY_POLICY,header::HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://localhost:*; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"));
    Ok(response)
}
pub async fn require_user(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let user = state.authenticate(request.headers())?;
    request.extensions_mut().insert(user);
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}
fn respond(value: Value, cookies: &[String]) -> Result<Response, AppError> {
    let mut response = Json(value).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    for cookie in cookies {
        response.headers_mut().append(
            header::SET_COOKIE,
            cookie
                .parse()
                .map_err(|_| AppError::internal("Cannot create cookie"))?,
        );
    }
    Ok(response)
}
fn set_cookie(name: &str, value: &str, age: i64) -> String {
    format!("{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}")
}
fn callback(value: &Value, origin: &str) -> String {
    url::Url::parse(origin)
        .ok()
        .and_then(|base| base.join(value["callbackUrl"].as_str().unwrap_or("/")).ok())
        .filter(|url| url.origin().ascii_serialization() == origin)
        .map(|url| url.into())
        .unwrap_or_else(|| origin.into())
}
async fn body(request: Request) -> Result<Value, AppError> {
    let is_json = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("application/json"));
    let bytes = axum::body::to_bytes(request.into_body(), 16384)
        .await
        .map_err(|_| AppError::bad_request("Invalid request"))?;
    let value = if is_json {
        serde_json::from_slice(&bytes).map_err(|_| AppError::bad_request("Invalid JSON"))?
    } else {
        let fields = url::form_urlencoded::parse(&bytes)
            .into_owned()
            .map(|(key, value)| (key, Value::String(value)))
            .collect::<serde_json::Map<_, _>>();
        Value::Object(fields)
    };
    if !value.is_object() {
        return Err(AppError::bad_request("Invalid request"));
    }
    Ok(value)
}
pub fn valid_password(value: &str) -> bool {
    value.chars().count() >= 12 && value.len() <= 72
}
async fn auth_action(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, AppError> {
    let path = request.uri().path().to_owned();
    let method = request.method().clone();
    let headers = request.headers().clone();
    let origin = state
        .origin
        .read()
        .map_err(|_| AppError::internal("Origin unavailable"))?
        .clone();
    match (method.clone(), path.as_str()) {
        (Method::GET, "/api/auth/csrf") => {
            let token = random_token();
            return respond(
                json!({"csrfToken":token}),
                &[set_cookie(CSRF_COOKIE, &token, 3600)],
            );
        }
        (Method::GET, "/api/auth/providers") => {
            return respond(
                json!({"credentials":{"id":"credentials","name":"Credentials","type":"credentials"}}),
                &[],
            );
        }
        (Method::GET, "/api/auth/session") => {
            return match state.authenticate(&headers) {
                Ok(user) => respond(
                    json!({"user":{"id":user.id,"name":user.username},"expires":(chrono::Utc::now()+chrono::Duration::seconds(MAX_AGE)).to_rfc3339()}),
                    &[],
                ),
                Err(error) if error.status == StatusCode::UNAUTHORIZED => respond(json!({}), &[]),
                Err(error) => Err(error),
            };
        }
        (Method::GET, "/api/auth/desktop-setup") => {
            return respond(
                json!({"setupRequired":state.db.one("SELECT id FROM users LIMIT 1",&[])?.is_none()}),
                &[],
            );
        }
        (_, "/api/auth/hello" | "/api/auth/reset-password") => {
            return Err(AppError::new(
                StatusCode::GONE,
                "Windows Hello dinonaktifkan. Gunakan password akun.",
            ));
        }
        _ => {}
    }
    if method != Method::POST {
        return Err(AppError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed",
        ));
    }
    let value = body(request).await?;
    if path == "/api/auth/desktop-setup" {
        let username = value["username"].as_str().unwrap_or_default();
        let password = value["password"].as_str().unwrap_or_default();
        if !(3..=64).contains(&username.len())
            || !username
                .bytes()
                .all(|v| v.is_ascii_alphanumeric() || b"_.-".contains(&v))
            || !valid_password(password)
        {
            return Err(AppError::bad_request(
                "Username 3–64 karakter; password minimal 12 karakter dan maksimal 72 byte.",
            ));
        }
        if state.db.one("SELECT id FROM users LIMIT 1", &[])?.is_some() {
            return Err(AppError::new(StatusCode::CONFLICT, "Akun sudah dibuat"));
        }
        let password = password.to_owned();
        let encoded = tokio::task::spawn_blocking(move || bcrypt::hash(password, 12))
            .await
            .map_err(|_| AppError::internal("Password operation failed"))?
            .map_err(|_| AppError::internal("Password operation failed"))?;
        let changed=state.db.execute("INSERT INTO users(username,password_hash) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM users)",&[json!(username),json!(encoded)])?;
        if changed != 1 {
            return Err(AppError::new(StatusCode::CONFLICT, "Akun sudah dibuat"));
        }
        return Ok((StatusCode::CREATED, Json(json!({"success":true}))).into_response());
    }
    let csrf = value["csrfToken"].as_str().unwrap_or_default();
    let expected = cookie(&headers, CSRF_COOKIE).unwrap_or_default();
    if csrf.len() != 64 || !bool::from(csrf.as_bytes().ct_eq(expected.as_bytes())) {
        return Err(AppError::forbidden("Invalid CSRF token"));
    }
    if path == "/api/auth/signout" {
        if let Some(token) = cookie(&headers, SESSION_COOKIE) {
            state.db.execute(
                "DELETE FROM rust_sessions WHERE token_hash=?",
                &[json!(hash(&token))],
            )?;
        }
        return respond(
            json!({"url":callback(&value,&origin)}),
            &[set_cookie(SESSION_COOKIE, "", 0)],
        );
    }
    if path != "/api/auth/callback/credentials" {
        return Err(AppError::not_found("Not found"));
    }
    let username = value["username"].as_str().unwrap_or_default();
    let password = value["password"].as_str().unwrap_or_default();
    if username.len() > 64 || password.len() > 72 {
        return Err(AppError::unauthorized("CredentialsSignin"));
    }
    let now = chrono::Utc::now().timestamp();
    let attempt_key = format!("{}:{username}", state.data_dir.display());
    {
        let mut attempts = ATTEMPTS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| AppError::internal("Login unavailable"))?;
        attempts.retain(|_, (_, until)| *until > now);
        if attempts.len() > 10000 {
            return Err(AppError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "Try again later",
            ));
        }
        let attempt = attempts
            .entry(attempt_key.clone())
            .or_insert((0, now + 900));
        if attempt.0 >= 20 {
            return Err(AppError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "Try again later",
            ));
        }
        attempt.0 += 1;
    }
    let row = state.db.one(
        "SELECT id,username,password_hash FROM users WHERE username=?",
        &[json!(username)],
    )?;
    let encoded = row
        .as_ref()
        .and_then(|value| value["password_hash"].as_str())
        .unwrap_or("$2b$12$invalidhashinvalidhashinvalidhashinvalidhashinvalidhash")
        .to_owned();
    let password = password.to_owned();
    let verified = tokio::task::spawn_blocking(move || bcrypt::verify(password, &encoded))
        .await
        .map_err(|_| AppError::internal("Password operation failed"))?
        .unwrap_or(false);
    let row = row
        .filter(|_| verified)
        .ok_or_else(|| AppError::unauthorized("CredentialsSignin"))?;
    if let Ok(mut attempts) = ATTEMPTS.get_or_init(Default::default).lock() {
        attempts.remove(&attempt_key);
    }
    let token = random_token();
    state
        .db
        .execute("DELETE FROM rust_sessions WHERE expires<=?", &[json!(now)])?;
    state.db.execute(
        "INSERT INTO rust_sessions(token_hash,user_id,expires) VALUES(?,?,?)",
        &[json!(hash(&token)), row["id"].clone(), json!(now + MAX_AGE)],
    )?;
    state.db.execute(
        "UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?",
        &[row["id"].clone()],
    )?;
    respond(
        json!({"url":callback(&value,&origin)}),
        &[set_cookie(SESSION_COOKIE, &token, MAX_AGE)],
    )
}
