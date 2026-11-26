use crate::{AppError, AppState, User};
use axum::http::{Method, Request, StatusCode};
use axum::{Router, body::Body};
use serde_json::{Value, json};
use tower::ServiceExt;

fn test_app() -> Result<(AppState, Router), AppError> {
    let dir = tempfile::tempdir().map_err(|_| AppError::internal("tempdir failed"))?;
    let state = AppState::new(dir.keep())?;
    let router = super::router().with_state(state.clone());
    Ok((state, router))
}

async fn call(
    router: &Router,
    user: &User,
    method: Method,
    uri: &str,
    body: Option<Value>,
) -> Result<(StatusCode, Value), AppError> {
    let payload = body.map(|v| v.to_string()).unwrap_or_default();
    let mut builder = Request::builder().method(method).uri(uri);
    if !payload.is_empty() {
        builder = builder.header("content-type", "application/json");
    }
    let mut req = builder
        .body(Body::from(payload))
        .map_err(|_| AppError::internal("request build failed"))?;
    req.extensions_mut().insert(user.clone());
    let resp = router
        .clone()
        .oneshot(req)
        .await
        .map_err(|_| AppError::internal("router failed"))?;
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .map_err(|_| AppError::internal("body read failed"))?;
    let json: Value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({}));
    Ok((status, json))
}

#[tokio::test]
async fn ticket1_evidence_case_persistence_redaction_and_account_isolation() -> Result<(), AppError> {
    let (_state, router) = test_app()?;
    let alice = User { id: "alice".into(), username: "alice".into() };
    let bob = User { id: "bob".into(), username: "bob".into() };

    let (st, created) = call(
        &router,
        &alice,
        Method::POST,
        "/api/cases",
        Some(json!({ "title": "Pod OOM", "serviceName": "orders", "environment": "staging" })),
    )
    .await?;
    assert_eq!(st, StatusCode::OK);
    let case_id = created["case"]["id"].as_str().unwrap_or("").to_owned();
    assert!(!case_id.is_empty());

    // Empty log rejected
    let (st_empty, _) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/cases/{case_id}/evidence"),
        Some(json!({ "content": "   " })),
    )
    .await?;
    assert_eq!(st_empty, StatusCode::BAD_REQUEST);

    // Empty timestamp defaults gracefully and Bearer token is redacted
    let (st_add, added) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/cases/{case_id}/evidence"),
        Some(json!({
            "clusterLabel": "ocp-stg",
            "namespace": "orders",
            "pod": "orders-1",
            "sourceTime": "",
            "content": "Authorization: Bearer secret-token-123"
        })),
    )
    .await?;
    assert_eq!(st_add, StatusCode::OK);
    assert_eq!(added["item"]["source_time"], "tidak tersedia");
    assert_eq!(added["item"]["redaction_status"], "redacted");
    assert!(added["item"]["content"].as_str().unwrap_or("").contains("[REDACTED]"));

    // Bob cannot access Alice's case
    let (st_bob, _) = call(&router, &bob, Method::GET, &format!("/api/cases/{case_id}"), None).await?;
    assert_eq!(st_bob, StatusCode::NOT_FOUND);
    Ok(())
}

#[tokio::test]
async fn ticket4_sarif_import_dedup_and_rejects_malformed() -> Result<(), AppError> {
    let (_state, router) = test_app()?;
    let alice = User { id: "alice".into(), username: "alice".into() };
    let (_, created) = call(
        &router,
        &alice,
        Method::POST,
        "/api/cases",
        Some(json!({ "title": "SAST Triage" })),
    )
    .await?;
    let case_id = created["case"]["id"].as_str().unwrap_or("");

    let (st_bad, _) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/cases/{case_id}/import-sarif"),
        Some(json!({ "sarif": "{bad json" })),
    )
    .await?;
    assert_eq!(st_bad, StatusCode::BAD_REQUEST);

    let sarif = json!({
        "version": "2.1.0",
        "runs": [{
            "tool": { "driver": { "name": "Checkmarx" } },
            "results": [{
                "ruleId": "SQLI-01",
                "level": "error",
                "message": { "text": "Unsanitized query" },
                "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "src/db.ts" }, "region": { "startLine": 42 } } }]
            }]
        }]
    }).to_string();

    let (st1, r1) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/cases/{case_id}/import-sarif"),
        Some(json!({ "sarif": sarif })),
    )
    .await?;
    assert_eq!(st1, StatusCode::OK);
    assert_eq!(r1["imported"], 1);

    let (st2, r2) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/cases/{case_id}/import-sarif"),
        Some(json!({ "sarif": sarif })),
    )
    .await?;
    assert_eq!(st2, StatusCode::OK);
    assert_eq!(r2["imported"], 0);
    assert_eq!(r2["duplicates"], 1);
    Ok(())
}

#[tokio::test]
async fn ticket3_git_apply_rejects_traversal_and_applies_safely() -> Result<(), AppError> {
    let (_state, router) = test_app()?;
    let alice = User { id: "alice".into(), username: "alice".into() };
    let repo_dir = tempfile::tempdir().map_err(|_| AppError::internal("tempdir failed"))?;
    let root = repo_dir.path();
    std::process::Command::new("git").args(["init"]).current_dir(root).output().ok();
    std::process::Command::new("git").args(["config", "user.email", "t@example.com"]).current_dir(root).output().ok();
    std::process::Command::new("git").args(["config", "user.name", "Tester"]).current_dir(root).output().ok();
    std::fs::write(root.join("app.txt"), "before\n").ok();
    std::process::Command::new("git").args(["add", "."]).current_dir(root).output().ok();
    std::process::Command::new("git").args(["commit", "-m", "init"]).current_dir(root).output().ok();

    let (st_trav, _) = call(
        &router,
        &alice,
        Method::POST,
        "/api/workspace/git/preview",
        Some(json!({
            "repoPath": root.to_string_lossy(),
            "files": [{ "path": "../escape.txt", "content": "x" }]
        })),
    )
    .await?;
    assert_eq!(st_trav, StatusCode::BAD_REQUEST);

    let (st_apply, applied) = call(
        &router,
        &alice,
        Method::POST,
        "/api/workspace/git/apply",
        Some(json!({
            "repoPath": root.to_string_lossy(),
            "files": [{ "path": "app.txt", "content": "after\n" }]
        })),
    )
    .await?;
    assert_eq!(st_apply, StatusCode::OK);
    assert!(applied["undoCommand"].as_str().unwrap_or("").contains("git checkout -- app.txt"));
    assert_eq!(std::fs::read_to_string(root.join("app.txt")).unwrap_or_default(), "after\n");
    Ok(())
}

#[tokio::test]
async fn ticket7_and_12_restart_policy_and_activity_isolation() -> Result<(), AppError> {
    let (_state, router) = test_app()?;
    let alice = User { id: "alice".into(), username: "alice".into() };
    let bob = User { id: "bob".into(), username: "bob".into() };
    let (_, created) = call(
        &router,
        &alice,
        Method::POST,
        "/api/cases",
        Some(json!({ "title": "Ops Restart" })),
    )
    .await?;
    let case_id = created["case"]["id"].as_str().unwrap_or("");

    // Production target rejected
    let (st_prod, _) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/cases/{case_id}/restart/preview"),
        Some(json!({ "namespace": "orders", "workload": "api", "environment": "production" })),
    )
    .await?;
    assert_eq!(st_prod, StatusCode::FORBIDDEN);

    for outcome in ["success", "denied", "timeout", "unknown"] {
        let (st, _) = call(
            &router,
            &alice,
            Method::POST,
            &format!("/api/cases/{case_id}/restart/execute"),
            Some(json!({
                "namespace": "orders-stg",
                "workload": "orders-api",
                "environment": "staging",
                "simulatedOutcome": outcome
            })),
        )
        .await?;
        assert_eq!(st, StatusCode::OK);
    }

    let (st_act, act) = call(&router, &alice, Method::GET, "/api/activity", None).await?;
    assert_eq!(st_act, StatusCode::OK);
    assert_eq!(act["receipts"].as_array().map(|a| a.len()), Some(4));

    let (_, bob_act) = call(&router, &bob, Method::GET, "/api/activity", None).await?;
    assert_eq!(bob_act["receipts"].as_array().map(|a| a.len()), Some(0));
    Ok(())
}

#[tokio::test]
async fn ticket14_worktree_check_and_apply_diff() -> Result<(), AppError> {
    let (_state, router) = test_app()?;
    let alice = User { id: "alice".into(), username: "alice".into() };
    let repo_dir = tempfile::tempdir().map_err(|_| AppError::internal("tempdir failed"))?;
    let root = repo_dir.path();
    std::process::Command::new("git").args(["init"]).current_dir(root).output().ok();
    std::process::Command::new("git").args(["config", "user.email", "t@example.com"]).current_dir(root).output().ok();
    std::process::Command::new("git").args(["config", "user.name", "Tester"]).current_dir(root).output().ok();
    std::fs::write(root.join("hello.txt"), "line1\nline2\n").ok();
    std::process::Command::new("git").args(["add", "."]).current_dir(root).output().ok();
    std::process::Command::new("git").args(["commit", "-m", "init"]).current_dir(root).output().ok();

    let diff = "--- a/hello.txt\n+++ b/hello.txt\n@@ -1,2 +1,2 @@\n line1\n-line2\n+line2-fixed\n";
    let (st_bad_cmd, _) = call(
        &router,
        &alice,
        Method::POST,
        "/api/workspace/git/worktree-check",
        Some(json!({ "repoPath": root.to_string_lossy(), "diffText": diff, "testCommand": "rm -rf /" })),
    )
    .await?;
    assert_eq!(st_bad_cmd, StatusCode::FORBIDDEN);

    let (st_ok, res_ok) = call(
        &router,
        &alice,
        Method::POST,
        "/api/workspace/git/worktree-check",
        Some(json!({ "repoPath": root.to_string_lossy(), "diffText": diff })),
    )
    .await?;
    assert_eq!(st_ok, StatusCode::OK);
    assert_eq!(res_ok["applicable"], true);

    let (st_apply, applied) = call(
        &router,
        &alice,
        Method::POST,
        "/api/workspace/git/apply-diff",
        Some(json!({ "repoPath": root.to_string_lossy(), "diffText": diff })),
    )
    .await?;
    assert_eq!(st_apply, StatusCode::OK);
    assert!(applied["actualDiff"].as_str().unwrap_or("").contains("line2-fixed"));
    Ok(())
}

#[tokio::test]
async fn ticket16_18_20_24_parsers_policies_ops_and_mcp() -> Result<(), AppError> {
    let (_state, router) = test_app()?;
    let alice = User { id: "alice".into(), username: "alice".into() };

    let (b_sum, b_meta) = super::connectors::format_bamboo_summary(
        &json!({
            "buildState": "Failed",
            "plan": { "shortName": "main" },
            "vcsRevisionKey": "abc123",
            "stages": { "stage": [{ "results": { "result": [{ "buildState": "Failed", "planName": "Unit", "buildResultKey": "P-1" }] } }] }
        }),
        "P-1",
    );
    assert!(b_sum.contains("Failed"));
    assert_eq!(b_meta["commit"], "abc123");

    let (s_sum, s_meta) = super::connectors::format_sonarqube_summary(
        &json!({ "projectStatus": { "status": "ERROR", "conditions": [{ "status": "ERROR", "metricKey": "bugs", "actualValue": "2", "errorThreshold": "0" }] } }),
        "orders",
    );
    assert!(s_sum.contains("ERROR"));
    assert_eq!(s_meta["qualityGate"], "ERROR");

    // Policies: invalid regex rejected, valid custom redaction applied
    let (st_bad_re, _) = call(
        &router,
        &alice,
        Method::PUT,
        "/api/policies",
        Some(json!({ "customRedactionPatterns": ["([unclosed"] })),
    )
    .await?;
    assert_eq!(st_bad_re, StatusCode::BAD_REQUEST);

    let (st_pol, _) = call(
        &router,
        &alice,
        Method::PUT,
        "/api/policies",
        Some(json!({
            "allowedNonprodEnvs": ["staging", "sit"],
            "customRedactionPatterns": ["CORP-[0-9]{4}"],
            "maxAiPayloadChars": 8000,
            "allowedTestCommands": ["cargo test"]
        })),
    )
    .await?;
    assert_eq!(st_pol, StatusCode::OK);

    let (_, created) = call(&router, &alice, Method::POST, "/api/cases", Some(json!({ "title": "Policy Test" }))).await?;
    let cid = created["case"]["id"].as_str().unwrap_or("");
    let (_, added) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/cases/{cid}/evidence"),
        Some(json!({ "content": "token CORP-1234 failed" })),
    )
    .await?;
    let eid = added["item"]["id"].as_str().unwrap_or("");
    let (_, prev) = call(
        &router,
        &alice,
        Method::POST,
        "/api/ai/preview",
        Some(json!({ "caseId": cid, "evidenceIds": [eid], "message": "cek" })),
    )
    .await?;
    assert!(prev["redactedPayload"].as_str().unwrap_or("").contains("[REDACTED]"));

    // Ops preview rejects production
    let (st_ops, _) = call(
        &router,
        &alice,
        Method::POST,
        "/api/ops/preview",
        Some(json!({ "opType": "vm_service", "target": "nginx", "environment": "production" })),
    )
    .await?;
    assert_eq!(st_ops, StatusCode::FORBIDDEN);

    // MCP call requires explicit confirmation
    let (st_mcp_save, mcp_res) = call(
        &router,
        &alice,
        Method::POST,
        "/api/mcp",
        Some(json!({ "label": "SAC MCP", "transport": "http", "target": "https://mcp.internal/rpc" })),
    )
    .await?;
    assert_eq!(st_mcp_save, StatusCode::OK);
    let mid = mcp_res["server"]["id"].as_str().unwrap_or("");
    let (st_mcp_call, _) = call(
        &router,
        &alice,
        Method::POST,
        &format!("/api/mcp/{mid}/call"),
        Some(json!({ "tool": "get_scan", "confirmed": false })),
    )
    .await?;
    assert_eq!(st_mcp_call, StatusCode::PRECONDITION_REQUIRED);
    Ok(())
}
