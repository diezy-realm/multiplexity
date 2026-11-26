use super::*;
use axum::{
    body::{Body, to_bytes},
    http::{Method, Request},
    response::Response,
};
use tower::ServiceExt;

fn fixture() -> Result<(AppState, tempfile::TempDir), AppError> {
    let directory =
        tempfile::tempdir().map_err(|_| AppError::internal("Cannot create test directory"))?;
    let state = AppState {
        db: Arc::new(store::Store::memory()?),
        data_dir: directory.path().to_owned(),
        client: reqwest::Client::new(),
        origin: Arc::new(RwLock::new("http://localhost:3399".into())),
        external_open: None,
        review_previews: Arc::default(),
    };
    Ok((state, directory))
}
async fn request(
    app: &Router,
    method: Method,
    path: &str,
    cookies: &str,
    value: Value,
) -> Response {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "localhost:3399")
        .header("origin", "http://localhost:3399")
        .header("content-type", "application/json");
    if !cookies.is_empty() {
        builder = builder.header("cookie", cookies);
    }
    app.clone()
        .oneshot(
            builder
                .body(if value.is_null() {
                    Body::empty()
                } else {
                    Body::from(value.to_string())
                })
                .expect("valid fixture request"),
        )
        .await
        .expect("router is infallible")
}
async fn value(response: Response) -> Value {
    serde_json::from_slice(
        &to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("bounded fixture response"),
    )
    .expect("JSON fixture response")
}
fn response_cookie(response: &Response) -> String {
    response
        .headers()
        .get("set-cookie")
        .expect("session cookie")
        .to_str()
        .expect("ASCII cookie")
        .split(';')
        .next()
        .expect("cookie value")
        .into()
}
async fn sign_in(app: &Router) -> String {
    let setup = request(
        app,
        Method::POST,
        "/api/auth/desktop-setup",
        "",
        json!({"username":"testuser","password":"test-password-12345"}),
    )
    .await;
    assert_eq!(setup.status(), StatusCode::CREATED);
    let csrf = request(app, Method::GET, "/api/auth/csrf", "", Value::Null).await;
    let cookie = response_cookie(&csrf);
    let token = value(csrf).await["csrfToken"].clone();
    let response = request(
        app,
        Method::POST,
        "/api/auth/callback/credentials",
        &cookie,
        json!({"username":"testuser","password":"test-password-12345","csrfToken":token}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    response_cookie(&response)
}
#[tokio::test]
async fn account_snippet_artifact_and_session_flow() -> Result<(), AppError> {
    let (state, _directory) = fixture()?;
    let app = router(state.clone(), state.data_dir.join("frontend"));
    assert_eq!(
        request(&app, Method::GET, "/api/vms", "", Value::Null)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let cookies = sign_in(&app).await;
    assert_eq!(
        value(
            request(
                &app,
                Method::GET,
                "/api/auth/session",
                &cookies,
                Value::Null
            )
            .await
        )
        .await["user"]["name"],
        "testuser"
    );
    let snippet = value(
        request(
            &app,
            Method::POST,
            "/api/snippets",
            &cookies,
            json!({"title":"Sample","kind":"credential","content":"fixture-value"}),
        )
        .await,
    )
    .await;
    let path = format!(
        "/api/snippets?id={}",
        snippet["id"].as_str().expect("snippet ID")
    );
    assert_eq!(
        value(request(&app, Method::GET, &path, &cookies, Value::Null).await).await["content"],
        "fixture-value"
    );
    let rows = state.db.query("SELECT ciphertext FROM snippets", &[])?;
    assert_ne!(rows[0]["ciphertext"], "fixture-value");
    let saved = request(
        &app,
        Method::POST,
        "/api/artifacts",
        &cookies,
        json!({"name":"artifacts/a.md","content":"# Fixture"}),
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    let file = value(
        request(
            &app,
            Method::GET,
            "/api/artifacts?name=artifacts/a.md",
            &cookies,
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(file["content"], "# Fixture");
    assert_eq!(
        request(
            &app,
            Method::POST,
            "/api/artifacts",
            &cookies,
            json!({"name":"artifacts/a.md","content":"overwrite","expectedHash":"0".repeat(64)})
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &app,
            Method::POST,
            "/api/account",
            &cookies,
            json!({"currentPassword":"test-password-12345","newPassword":"changed-password-12345"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&app, Method::GET, "/api/snippets", &cookies, Value::Null)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    Ok(())
}
#[tokio::test]
async fn rejects_cross_origin_and_disables_hello() -> Result<(), AppError> {
    let (state, _directory) = fixture()?;
    let app = router(state.clone(), state.data_dir.clone());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/csrf")
                .header("host", "localhost:3399")
                .header("origin", "https://untrusted.example")
                .body(Body::empty())
                .expect("valid fixture"),
        )
        .await
        .expect("infallible");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        request(&app, Method::POST, "/api/auth/hello", "", json!({}))
            .await
            .status(),
        StatusCode::GONE
    );
    assert_eq!(
        request(
            &app,
            Method::POST,
            "/api/auth/reset-password",
            "",
            json!({})
        )
        .await
        .status(),
        StatusCode::GONE
    );
    assert_eq!(
        request(&app, Method::GET, "/api/not-a-route", "", Value::Null)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    Ok(())
}
#[test]
fn workspace_rejects_traversal_and_accounts_are_isolated() -> Result<(), AppError> {
    let (state, _directory) = fixture()?;
    for name in [
        "../outside.md",
        "a/../../secret.txt",
        "/absolute.md",
        "C:/secret.txt",
        ".env",
        "config.json",
        "nested/.env.json",
        "a\\b.md",
    ] {
        assert!(
            core::workspace_file(&state, "a", name).is_err(),
            "accepted {name}"
        );
    }
    core::write_workspace(&state, "a", "artifacts/a.md", "account a", None)?;
    assert!(core::read_workspace(&state, "b", "artifacts/a.md").is_err());
    assert!(
        core::write_workspace(
            &state,
            "a",
            "artifacts/a.md",
            "wrong",
            Some(&"0".repeat(64))
        )
        .is_err()
    );
    Ok(())
}
