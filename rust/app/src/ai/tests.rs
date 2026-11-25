use super::*;
use axum::{body::Body, http::Request};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};
use tower::ServiceExt;

fn state(directory: &std::path::Path) -> AppState {
    AppState {
        db: Arc::new(crate::store::Store::memory().expect("test database")),
        data_dir: directory.to_owned(),
        client: reqwest::Client::new(),
        origin: Arc::new(RwLock::new(String::new())),
    }
}
fn user() -> User {
    User {
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        username: "fixture".into(),
    }
}
fn body() -> Value {
    json!({"provider":"custom","model":"fixture","message":"hello","effort":"default","permission":"read-only","sources":[],"attachments":[]})
}
fn app(state: AppState) -> Router {
    router().layer(Extension(user())).with_state(state)
}

async fn configure(state: &AppState, endpoint: &str) {
    state
        .db
        .execute(
            "INSERT INTO ai_connections(provider,model,endpoint) VALUES('custom','fixture',?)",
            &[json!(endpoint)],
        )
        .expect("fixture provider");
}
async fn fixture_server() -> (String, tokio::task::JoinHandle<()>) {
    let app=Router::new().route("/v1/chat/completions",post(||async {
        let events=async_stream::stream! {
            yield Ok::<Event,Infallible>(Event::default().data(json!({"choices":[{"delta":{"content":"Halo "},"finish_reason":null}]}).to_string()));
            tokio::time::sleep(Duration::from_millis(80)).await;
            yield Ok(Event::default().data(json!({"choices":[{"delta":{"content":"dunia"},"finish_reason":null}]}).to_string()));
            yield Ok(Event::default().data(json!({"choices":[{"delta":{},"finish_reason":"stop"}]}).to_string()));
            yield Ok(Event::default().data("[DONE]"));
        };Sse::new(events)
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fixture bind");
    let endpoint = format!(
        "http://127.0.0.1:{}/v1",
        listener.local_addr().expect("fixture address").port()
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.expect("fixture serve");
    });
    (endpoint, server)
}

#[tokio::test]
async fn chat_streams_real_provider_deltas_then_persists_history() {
    let directory = tempfile::tempdir().expect("temporary workspace");
    let state = state(directory.path());
    let (endpoint, server) = fixture_server().await;
    configure(&state, &endpoint).await;
    let request = Request::post("/api/ai/chat")
        .header("content-type", "application/json")
        .header("accept", "text/event-stream")
        .body(Body::from(body().to_string()))
        .expect("request");
    let response = app(state.clone()).oneshot(request).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    let mut stream = response.into_body().into_data_stream();
    let mut output = String::new();
    let mut first_delta = None;
    let mut done_at = None;
    let start = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = String::from_utf8(chunk.expect("stream bytes").to_vec()).expect("stream UTF-8");
        if chunk.contains("\"type\":\"delta\"") && first_delta.is_none() {
            first_delta = Some(start.elapsed());
        }
        if chunk.contains("\"type\":\"done\"") {
            done_at = Some(start.elapsed());
        }
        output.push_str(&chunk);
    }
    assert!(output.contains("Halo "));
    assert!(output.contains("dunia"));
    assert!(output.contains("\"message\":\"Halo dunia\""));
    assert!(first_delta.expect("incremental delta") < done_at.expect("final result"));
    let rows = state
        .db
        .query(
            "SELECT role,content FROM ai_chat_messages WHERE user_id=? ORDER BY id",
            &[json!(user().id)],
        )
        .expect("history");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1]["content"], "Halo dunia");
    assert!(!busy(&state, &user().id).expect("idle state"));
    server.abort();
}

#[tokio::test]
async fn cancelled_stream_does_not_save_partial_answer() {
    let directory = tempfile::tempdir().expect("temporary workspace");
    let state = state(directory.path());
    let fixture=Router::new().route("/v1/chat/completions",post(||async {let stream=async_stream::stream! {yield Ok::<Event,Infallible>(Event::default().data(json!({"choices":[{"delta":{"content":"partial"}}]}).to_string()));tokio::time::sleep(Duration::from_secs(30)).await;yield Ok(Event::default().data("[DONE]"));};Sse::new(stream)}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fixture bind");
    let endpoint = format!(
        "http://127.0.0.1:{}/v1",
        listener.local_addr().expect("fixture address").port()
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, fixture)
            .await
            .expect("fixture server");
    });
    configure(&state, &endpoint).await;
    let response = app(state.clone())
        .oneshot(
            Request::post("/api/ai/chat")
                .header("content-type", "application/json")
                .header("accept", "text/event-stream")
                .body(Body::from(body().to_string()))
                .expect("request"),
        )
        .await
        .expect("response");
    let mut stream = response.into_body().into_data_stream();
    while let Some(chunk) = stream.next().await {
        if String::from_utf8_lossy(&chunk.expect("chunk")).contains("partial") {
            break;
        }
    }
    drop(stream);
    tokio::time::timeout(Duration::from_secs(3), async {
        while busy(&state, &user().id).expect("operation state") {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("cancel propagated");
    assert!(
        state
            .db
            .query("SELECT id FROM ai_chat_messages", &[])
            .expect("history")
            .is_empty()
    );
    server.abort();
}

#[tokio::test]
async fn ask_permission_requires_approval_before_reading_logs() {
    let directory = tempfile::tempdir().expect("temporary workspace");
    let state = state(directory.path());
    let mut request_body = body();
    request_body["permission"] = json!("ask");
    request_body["sources"] =
        json!([{"vmId":"missing","kind":"systemd","target":"app.service","label":"test"}]);
    let response = app(state)
        .oneshot(
            Request::post("/api/ai/chat")
                .header("content-type", "application/json")
                .body(Body::from(request_body.to_string()))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::PRECONDITION_REQUIRED);
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let value: Value = serde_json::from_slice(&bytes).expect("JSON");
    assert_eq!(value["approvalRequired"], true);
}

#[tokio::test]
async fn provider_accumulator_preserves_claude_tool_arguments_and_rejects_incomplete_streams() {
    let mut accumulator = provider::Accumulator::new("messages");
    for event in [
        json!({"type":"message_start","message":{"id":"fixture"}}),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"read_artifact","input":{}}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"name\":\"rules.md\"}"}}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"message_stop"}),
    ] {
        accumulator
            .event(&event.to_string(), &None)
            .await
            .expect("event");
    }
    assert_eq!(
        accumulator.finish().expect("completed message")["content"][0]["input"]["name"],
        "rules.md"
    );
    assert!(provider::Accumulator::new("chat").finish().is_err());
}

#[tokio::test]
async fn codex_event_decoder_deduplicates_completed_item_text() {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
    let observer = Some(sender);
    let mut texts = HashMap::new();
    for (kind, value) in [
        ("item.updated", "Halo"),
        ("item.updated", "Halo dunia"),
        ("item.completed", "Halo dunia"),
    ] {
        process::decode_cli(
            "codex",
            &json!({"type":kind,"item":{"type":"agent_message","id":"answer","text":value}}),
            &mut texts,
            &observer,
        )
        .await;
    }
    drop(observer);
    let mut output = String::new();
    while let Some(event) = receiver.recv().await {
        output.push_str(text(&event, "text"));
    }
    assert_eq!(output, "Halo dunia");
}

#[tokio::test]
async fn workspace_tools_enforce_allow_all_and_account_scope() {
    let directory = tempfile::tempdir().expect("temporary workspace");
    let state = state(directory.path());
    let args = json!({"name":"artifacts/result.md","content":"fixture"});
    let denied = provider::execute_tool(&state, &user().id, "read-only", "write_artifact", &args);
    assert!(denied.contains("error"));
    let allowed = provider::execute_tool(&state, &user().id, "allow-all", "write_artifact", &args);
    assert!(allowed.contains("saved"));
    assert!(
        provider::execute_tool(
            &state,
            &user().id,
            "allow-all",
            "read_artifact",
            &json!({"name":"../other/rules.md"})
        )
        .contains("error")
    );
    assert!(
        provider::execute_tool(
            &state,
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "read-only",
            "read_artifact",
            &args
        )
        .contains("error")
    );
}

#[tokio::test]
async fn cli_cancellation_stops_process_promptly() {
    let directory = tempfile::tempdir().expect("temporary fixture");
    let fixture = directory.path().join("wait.js");
    std::fs::write(&fixture, "setInterval(()=>{},1000)").expect("fixture write");
    let cancel = CancellationToken::new();
    let delayed = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        delayed.cancel();
    });
    let start = std::time::Instant::now();
    let result = process::run(
        &PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" }),
        &[fixture.to_string_lossy().into_owned()],
        directory.path(),
        "",
        None,
        &cancel,
        None,
        "",
        Duration::from_secs(10),
        false,
    )
    .await;
    assert!(result.is_err());
    assert!(start.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn codex_permissions_and_image_cleanup_follow_the_requested_mode() {
    let directory = tempfile::tempdir().expect("temporary fixture");
    let state = state(directory.path());
    let cwd = crate::core::workspace_root(&state, &user().id).expect("workspace");
    std::fs::write(cwd.join("exec"),r#"let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:JSON.stringify({args:process.argv.slice(2),input})}})))"#).expect("mock CLI");
    let executable = PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" });
    let connection = settings::Connection {
        provider: "codex".into(),
        model: String::new(),
        key: String::new(),
        cli_path: String::new(),
        endpoint: String::new(),
        saved: true,
    };
    let image = json!({"name":"fixture.png","mediaType":"image/png","content":"iVBORw0KGgo="});
    for permission in ["read-only", "ask", "allow-all"] {
        let result = cli::complete(
            &state,
            &user().id,
            &connection,
            &executable,
            "fixture-model",
            "medium",
            permission,
            "fixture prompt",
            &[&image],
            &CancellationToken::new(),
            None,
        )
        .await
        .expect("mock CLI result");
        let result: Value = serde_json::from_str(&result).expect("mock protocol");
        let args = result["args"].as_array().expect("arguments");
        assert_eq!(result["input"], "fixture prompt");
        assert_eq!(
            args.iter()
                .any(|v| v == "--dangerously-bypass-approvals-and-sandbox"),
            permission == "allow-all"
        );
        if permission != "allow-all" {
            assert!(args.iter().any(|v| v == "read-only"));
            assert!(args.iter().any(|v| v == "features.shell_tool=false"));
            assert!(args.iter().any(|v| v == "features.apply_patch_tool=false"));
        }
        let index = args
            .iter()
            .position(|v| v == "--image")
            .expect("image flag");
        let path = PathBuf::from(args[index + 1].as_str().expect("image path"));
        assert!(
            !path.exists(),
            "temporary image must be removed after completion"
        );
    }
}
