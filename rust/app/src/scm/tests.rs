use super::*;
use axum::{
    body::Body,
    http::{Method, Request},
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tower::ServiceExt;

const NEXT_HEAD: &str = "ee3f518bc0d3580a8d625d16f2f53802d61eabf3";

fn test_state(directory: &std::path::Path) -> AppState {
    AppState {
        db: Arc::new(crate::store::Store::memory().unwrap()),
        data_dir: directory.to_owned(),
        client: reqwest::Client::new(),
        origin: Arc::default(),
        external_open: None,
        review_previews: Arc::default(),
    }
}

fn user(name: &str) -> User {
    User {
        id: name.into(),
        username: name.into(),
    }
}

async fn call(router: &Router, account: &str, method: Method, url: &str, body: Value) -> Response {
    let mut request = Request::builder()
        .uri(url)
        .method(method)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    request.extensions_mut().insert(user(account));
    router.clone().oneshot(request).await.unwrap()
}

async fn json_body(response: Response) -> Value {
    let bytes = axum::body::to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn pull_ref() -> PullRef {
    PullRef {
        owner: "demo".into(),
        repo: "release-notes".into(),
        number: 17,
    }
}

#[test]
fn parses_only_profile_origin_and_clean_pr_urls() {
    let origin = ghes::base_url("https://ghes.example.test:8443").unwrap();
    let accepted = PullRef::from_url(
        &origin,
        "https://ghes.example.test:8443/Org/repo/pull/17#discussion",
    )
    .unwrap();
    assert_eq!(accepted.key(), "org/repo/17");
    for link in [
        "https://other.example.test:8443/Org/repo/pull/17",
        "https://ghes.example.test/Org/repo/pull/17",
        "http://ghes.example.test:8443/Org/repo/pull/17",
        "https://person@ghes.example.test:8443/Org/repo/pull/17",
        "https://@ghes.example.test:8443/Org/repo/pull/17",
        "https://ghes.example.test:8443/Org/%2fsecret/pull/17",
        "https://ghes.example.test:8443/Org/repo/pull/0",
    ] {
        assert_eq!(
            PullRef::from_url(&origin, link).unwrap_err().status,
            StatusCode::BAD_REQUEST,
            "{link}"
        );
    }
}

#[test]
fn patch_states_and_numbering_cover_partial_rename_and_binary() {
    let file = FileChange::from_remote(
        &json!({"filename":"lib.rs","previous_filename":"old.rs","status":"renamed",
        "additions":2,"deletions":1,"patch":"@@ -3,2 +8,3 @@\n before\n-old\n+new"}),
        2,
    )
    .unwrap();
    assert_eq!(file.patch_status, "truncated");
    assert_eq!(file.previous_path.as_deref(), Some("old.rs"));
    let rows = diff_rows(file.patch.as_deref().unwrap());
    assert_eq!(rows[0].old, Some(3));
    assert_eq!(rows[0].new, Some(8));
    assert_eq!((rows[1].old, rows[1].new), (Some(4), None));
    assert_eq!((rows[2].old, rows[2].new), (None, Some(9)));
    let binary = FileChange::from_remote(
        &json!({"filename":"logo.bin","patch":"GIT binary patch"}),
        1,
    )
    .unwrap();
    assert_eq!(binary.patch_status, "binary");
    assert!(binary.patch.is_none());
}

#[tokio::test]
async fn profile_and_encrypted_offline_cache_are_account_scoped() {
    let dir = tempfile::tempdir().unwrap();
    let state = test_state(dir.path());
    for name in ["alice", "bob"] {
        state
            .db
            .execute(
                "INSERT INTO users(id,username,password_hash) VALUES(?,?,?)",
                &[json!(name), json!(name), json!("test")],
            )
            .unwrap();
    }
    let app = router()
        .merge(crate::pilot::router())
        .with_state(state.clone());
    let connector = json!({"kind":"ghes","label":"Fixture server","baseUrl":"https://ghes.example.test",
        "token":"example-test-token","authType":"bearer"});
    let saved = call(
        &app,
        "alice",
        Method::POST,
        "/api/connectors",
        connector.clone(),
    )
    .await;
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = json_body(saved).await;
    assert!(saved["connector"]["hasToken"] == true);
    assert!(!saved.to_string().contains("example-test-token"));
    assert_eq!(
        call(&app, "alice", Method::POST, "/api/connectors", connector)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    let profile =
        json_body(call(&app, "bob", Method::GET, "/api/scm/profile", Value::Null).await).await;
    assert!(profile["profile"].is_null());
    let foreign = call(
        &app,
        "alice",
        Method::POST,
        "/api/scm/resolve",
        json!({"url":"https://other.example.test/a/b/pull/17"}),
    )
    .await;
    assert_eq!(foreign.status(), StatusCode::BAD_REQUEST);
    let github = Ghes::load(&state, "alice").unwrap();
    let offline = || Err(AppError::new(StatusCode::SERVICE_UNAVAILABLE, "offline"));
    super::ghes::with_cache(
        &state,
        "alice",
        &github.cache_key,
        "pr:demo/release-notes/17:files",
        Ok(json!({"items":["synthetic-source"]})),
    )
    .unwrap();
    let ciphertext = state
        .db
        .one("SELECT ciphertext FROM scm_cache", &[])
        .unwrap()
        .unwrap();
    assert!(!ciphertext.to_string().contains("synthetic-source"));
    let cached = super::ghes::with_cache(
        &state,
        "alice",
        &github.cache_key,
        "pr:demo/release-notes/17:files",
        offline(),
    )
    .unwrap();
    assert_eq!(cached["stale"], true);
    assert_eq!(
        super::ghes::with_cache(
            &state,
            "bob",
            &github.cache_key,
            "pr:demo/release-notes/17:files",
            offline()
        )
        .unwrap_err()
        .status,
        StatusCode::SERVICE_UNAVAILABLE
    );
    let _ = super::ghes::with_cache(
        &state,
        "alice",
        &github.cache_key,
        "pr:demo/release-notes/17",
        Err(AppError::forbidden("revoked")),
    );
    assert!(
        super::ghes::with_cache(
            &state,
            "alice",
            &github.cache_key,
            "pr:demo/release-notes/17:files",
            offline()
        )
        .is_err()
    );
}

#[tokio::test]
async fn fixture_pages_are_bounded_and_check_failures_are_independent() {
    let changed = Arc::new(AtomicBool::new(false));
    let did_change = changed.clone();
    let base = fixture::BASE;
    let head = fixture::HEAD;
    let remote = Router::new()
        .route("/api/v3/repos/demo/release-notes/pulls/17", get(move || {
            let sha = if did_change.load(Ordering::SeqCst) { NEXT_HEAD } else { head };
            async move { Json(json!({"number":17,"title":"Fixture","body":"Fixture description","head":{"sha":sha},"base":{"sha":base}})) }
        }))
        .route("/api/v3/repos/demo/release-notes/pulls/17/files", get({
            let changed = changed.clone();
            move |Query(query): Query<PullQuery>, headers: axum::http::HeaderMap| {
                let changed = changed.clone();
                async move {
                    assert_eq!(headers["authorization"], "Bearer fixture-read-only");
                    assert_eq!(headers["x-github-api-version"], "2022-11-28");
                    if query.page == Some(2) { changed.store(true, Ordering::SeqCst); }
                    ([(axum::http::header::LINK, "<https://foreign.test/never-follow>; rel=\"next\"")],
                        Json(json!([{"filename":"main.rs","additions":3,"deletions":0,"patch":"@@ -0,0 +1,3 @@\n+first"}]))).into_response()
                }
            }
        }))
        .route(&format!("/api/v3/repos/demo/release-notes/commits/{head}/check-runs"), get(|| async { StatusCode::FORBIDDEN }))
        .route(&format!("/api/v3/repos/demo/release-notes/commits/{head}/statuses"), get(|| async {
            Json(json!([{"id":7,"state":"pending","context":"ci/component"}]))
        }))
        .route("/api/v3/redirect", get(|| async {
            (StatusCode::TEMPORARY_REDIRECT, [(axum::http::header::LOCATION, "https://foreign.test/")])
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, remote).await.unwrap() });
    let github = Ghes::fixture(url::Url::parse(&format!("http://{addr}")).unwrap());
    assert_eq!(
        github.pull(pull_ref()).await.unwrap().description,
        "Fixture description"
    );
    assert_eq!(
        Section::Runs
            .read(&github, pull_ref(), head, base, 1)
            .await
            .unwrap_err()
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        Section::Statuses
            .read(&github, pull_ref(), head, base, 1)
            .await
            .unwrap()["items"][0]["status"],
        "pending"
    );
    assert_eq!(
        github.get("/redirect", &[]).await.err().unwrap().status,
        StatusCode::BAD_GATEWAY
    );
    let first = Section::Files
        .read(&github, pull_ref(), head, base, 1)
        .await
        .unwrap();
    assert_eq!(first["nextPage"], 2);
    assert_eq!(first["items"][0]["patchStatus"], "truncated");
    assert_eq!(
        Section::Files
            .read(&github, pull_ref(), head, base, 2)
            .await
            .unwrap_err()
            .status,
        StatusCode::CONFLICT
    );
    assert_eq!(github.pull(pull_ref()).await.unwrap().head_sha, NEXT_HEAD);
    assert_eq!(next_page(true, MAX_PAGE), None);
    server.abort();
}

#[tokio::test]
async fn review_preview_is_single_use_scoped_and_cancellation_releases_run() {
    let dir = tempfile::tempdir().unwrap();
    let state = test_state(dir.path());
    let app = router().with_state(state);
    let preview_url = "/api/scm/review/preview";
    let analyze_url = "/api/scm/review/analyze";
    let payload = json!({"reference":pull_ref(),"fixture":true,"path":"src/format-date.ts","page":1,
        "headSha":fixture::HEAD,"baseSha":fixture::BASE,"side":"right","start":5,"end":6,
        "question":"Authorization: Bearer example-private-token"});
    let created =
        json_body(call(&app, "alice", Method::POST, preview_url, payload.clone()).await).await;
    assert_eq!(created["source"]["headSha"], fixture::HEAD);
    assert_eq!(created["source"]["side"], "right");
    let reviewed = created["payload"].as_str().unwrap();
    assert!(reviewed.contains("REDACTED"));
    assert!(!reviewed.contains("example-private-token"));
    assert!(reviewed.contains("timeZone"));
    let id = json!({"previewId":created["id"]});
    assert_eq!(
        call(&app, "bob", Method::POST, analyze_url, id.clone())
            .await
            .status(),
        StatusCode::CONFLICT
    );
    let response = call(&app, "alice", Method::POST, analyze_url, id.clone()).await;
    assert_eq!(response.status(), StatusCode::OK);
    let mut stream = response.into_body();
    let frame = stream.frame().await.unwrap().unwrap().into_data().unwrap();
    assert!(String::from_utf8_lossy(&frame).contains("running"));
    drop(stream);
    assert_eq!(
        call(&app, "alice", Method::POST, analyze_url, id)
            .await
            .status(),
        StatusCode::CONFLICT
    );
    let another =
        json_body(call(&app, "alice", Method::POST, preview_url, payload.clone()).await).await;
    let response = call(
        &app,
        "alice",
        Method::POST,
        analyze_url,
        json!({"previewId":another["id"]}),
    )
    .await;
    let finished = axum::body::to_bytes(response.into_body(), 16_000)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&finished).contains("Simulasi lokal"));

    let mut stale = payload;
    stale["headSha"] = json!(NEXT_HEAD);
    assert_eq!(
        call(&app, "alice", Method::POST, preview_url, stale)
            .await
            .status(),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn bitbucket_context_path_pat_dashboard_and_revision_bound_diff() {
    use std::sync::atomic::AtomicUsize;
    let count = Arc::new(AtomicUsize::new(0));
    let counted = count.clone();
    let api = Router::new().fallback(move |request: axum::extract::Request| {
        let counted = counted.clone();
        async move {
            assert_eq!(request.method(), Method::GET);
            assert_eq!(request.headers()["authorization"], "Bearer fixture-pat");
            let Some(path) = request.uri().path().strip_prefix("/bitbucket/rest/api/latest") else {
                return StatusCode::NOT_FOUND.into_response();
            };
            let query: std::collections::HashMap<_, _> = url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes()).into_owned().collect();
            let repo = json!({"slug":"release-notes","project":{"key":"DEMO"}});
            let pull = json!({"id":17,"title":"Fixture Bitbucket","state":"OPEN","description":"Synthetic pull request",
                "fromRef":{"displayId":"feat","latestCommit":fixture::HEAD,"repository":repo},
                "toRef":{"displayId":"main","latestCommit":fixture::BASE,"repository":repo},
                "author":{"user":{"slug":"demo-reviewer"}}});
            let base = "/projects/DEMO/repos/release-notes/pull-requests/17";
            let data = if path == "/application-properties" { json!({"version":"10.5.0"}) }
            else if path == "/dashboard/pull-requests" {
                let role = query.get("role").unwrap().as_str();
                let start = query.get("start").unwrap().as_str();
                match (role,start) {
                    ("AUTHOR","0") => json!({"values":[pull],"isLastPage":false,"nextPageStart":7}),
                    ("AUTHOR","7") | ("REVIEWER","0") => json!({"values":[pull],"isLastPage":true}),
                    _ => panic!("unexpected dashboard cursor"),
                }
            } else if path == base { pull }
            else if path == format!("{base}/changes") {
                assert_eq!(query.get("limit").map(String::as_str), Some("1000"));
                json!({"values":[{"path":{"components":["src","new name.rs"]},"srcPath":{"toString":"src/old.rs"},"type":"MOVE"}],
                    "isLastPage":false,"limit":1})
            } else if path.starts_with(&format!("{base}/diff/")) {
                counted.fetch_add(1, Ordering::SeqCst);
                assert_eq!(url::Url::parse(&format!("http://localhost{}",request.uri())).unwrap().query_pairs().find(|(key,_)| key == "srcPath").unwrap().1,"src/old.rs");
                json!({"fromHash":fixture::BASE,"toHash":fixture::HEAD,
                    "diffs":[{"binary":false,"hunks":[{"sourceLine":1,"sourceSpan":1,"destinationLine":1,"destinationSpan":2,
                        "segments":[{"type":"REMOVED","lines":[{"line":"old"}]},{"type":"ADDED","lines":[{"line":"new"},{"line":"next"}]}]}]}]})
            } else if path == format!("{base}/participants") {
                json!({"values":[{"role":"REVIEWER","status":"NEEDS_WORK","lastReviewedCommit":fixture::HEAD,"user":{"id":2,"slug":"reviewer"}}],"isLastPage":true})
            } else if path == format!("{base}/activities") {
                json!({"values":[{"action":"COMMENTED","comment":{"id":1,"text":"Fixture comment","author":{"slug":"reviewer"}},
                    "commentAnchor":{"path":{"components":["src","new name.rs"]},"fileType":"TO","line":2,"diffType":"EFFECTIVE","fromHash":fixture::BASE,"toHash":fixture::HEAD}}],"isLastPage":true})
            } else if path.ends_with(&format!("/commits/{}/builds",fixture::HEAD)) {
                json!({"values":[{"key":"CI","state":"INPROGRESS"}],"isLastPage":true})
            } else if path == "/redirect" {
                return (StatusCode::TEMPORARY_REDIRECT, [(axum::http::header::LOCATION,"https://external.invalid")]).into_response();
            } else { return StatusCode::NOT_FOUND.into_response(); };
            Json(data).into_response()
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let remote = tokio::spawn(async move { axum::serve(listener, api).await.unwrap() });
    let client = Bitbucket::fixture(url::Url::parse(&format!("http://{addr}/bitbucket")).unwrap());
    let reference = PullRef {
        owner: "DEMO".into(),
        repo: "release-notes".into(),
        number: 17,
    };
    assert_eq!(client.probe().await.unwrap(), "10.5.0");
    let queue = client.queue(1).await.unwrap();
    assert_eq!(queue["items"].as_array().unwrap().len(), 2);
    let next = client
        .queue(queue["nextPage"].as_u64().unwrap() as u32)
        .await
        .unwrap();
    assert!(next["nextPage"].is_null());
    assert_eq!(next["items"].as_array().unwrap().len(), 1);
    let list = client
        .section(
            Section::Files,
            reference.clone(),
            fixture::HEAD,
            fixture::BASE,
            1,
        )
        .await
        .unwrap();
    assert_eq!(list["items"][0]["patchStatus"], "not_loaded");
    assert!(list["nextPage"].is_null());
    assert_eq!(list["partial"], true);
    assert_eq!(count.load(Ordering::SeqCst), 0);
    let file = client
        .selected_file(
            &reference,
            "src/new name.rs",
            1,
            fixture::HEAD,
            fixture::BASE,
        )
        .await
        .unwrap();
    assert_eq!(
        file.patch.as_deref(),
        Some("@@ -1,1 +1,2 @@\n-old\n+new\n+next")
    );
    assert_eq!(file.previous_path.as_deref(), Some("src/old.rs"));
    assert_eq!(file.comparison_base.as_deref(), Some(fixture::BASE));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert!(
        client
            .selected_file(&reference, "src/new name.rs", 1, NEXT_HEAD, fixture::BASE)
            .await
            .is_err()
    );
    let review = client
        .section(
            Section::Reviews,
            reference.clone(),
            fixture::HEAD,
            fixture::BASE,
            1,
        )
        .await
        .unwrap();
    assert_eq!(review["items"][0]["state"], "CHANGES_REQUESTED");
    let comments = client
        .section(
            Section::Comments,
            reference.clone(),
            fixture::HEAD,
            fixture::BASE,
            1,
        )
        .await
        .unwrap();
    assert_eq!(comments["items"][0]["path"], "src/new name.rs");
    assert_eq!(comments["items"][0]["comparisonBase"], fixture::BASE);
    let statuses = client
        .section(
            Section::Statuses,
            reference,
            fixture::HEAD,
            fixture::BASE,
            1,
        )
        .await
        .unwrap();
    assert_eq!(statuses["items"][0]["status"], "pending");
    assert_eq!(statuses["items"][0]["revision"], fixture::HEAD);
    remote.abort();
}

#[test]
fn bitbucket_pr_url_keeps_custom_origin_and_context() {
    let base = bitbucket_base_url("https://git.example.test:9443/bitbucket").unwrap();
    let client = Bitbucket::fixture(base);
    let valid = "https://git.example.test:9443/bitbucket/projects/DEMO/repos/release-notes/pull-requests/17/diff";
    assert_eq!(
        client.resolve(valid).unwrap().key(),
        "demo/release-notes/17"
    );
    let user_pr =
        "https://git.example.test:9443/bitbucket/users/nara/repos/release-notes/pull-requests/17";
    assert_eq!(client.resolve(user_pr).unwrap().owner, "~nara");
    for bad in [
        valid.replace("git.example.test", "foreign.test"),
        valid.replace("/bitbucket/", "/other/"),
        valid.replace("https://", "https://user@"),
        valid.replace(":9443", ""),
    ] {
        assert!(client.resolve(&bad).is_err());
    }
}
