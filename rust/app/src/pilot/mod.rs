pub mod cases;
pub mod connectors;
pub mod git_apply;
pub mod mcp;
pub mod ops;
pub mod policies;
#[cfg(test)]
mod tests;

use crate::AppState;
use axum::{
    Router,
    routing::{delete, get, patch, post},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/cases", get(cases::list_cases).post(cases::save_case))
        .route(
            "/api/cases/{id}",
            get(cases::get_case).delete(cases::delete_case),
        )
        .route("/api/cases/{id}/evidence", post(cases::add_evidence))
        .route(
            "/api/cases/{id}/evidence/{item_id}",
            delete(cases::delete_evidence),
        )
        .route("/api/cases/{id}/import-sarif", post(cases::import_sarif))
        .route("/api/cases/{id}/ci-run", post(connectors::fetch_ci_run))
        .route(
            "/api/cases/{id}/jira-drafts",
            get(connectors::list_jira_drafts).post(connectors::save_jira_draft),
        )
        .route(
            "/api/cases/{id}/jira-drafts/{draft_id}/submit",
            post(connectors::submit_jira_draft),
        )
        .route("/api/cases/{id}/restart/preview", post(ops::restart_preview))
        .route("/api/cases/{id}/restart/execute", post(ops::restart_execute))
        .route("/api/ops/preview", post(ops::ops_preview))
        .route("/api/ops/execute", post(ops::ops_execute))
        .route("/api/activity", get(ops::list_activity))
        .route(
            "/api/connectors",
            get(connectors::list_connectors).post(connectors::save_connector),
        )
        .route("/api/connectors/{id}/test", post(connectors::test_connector))
        .route(
            "/api/connectors/{id}/confluent-metadata",
            get(connectors::confluent_metadata),
        )
        .route(
            "/api/connectors/{id}",
            patch(connectors::toggle_connector).delete(connectors::delete_connector),
        )
        .route("/api/workspace/git/inspect", post(git_apply::inspect_repo))
        .route("/api/workspace/git/preview", post(git_apply::preview_patch))
        .route("/api/workspace/git/worktree-check", post(git_apply::worktree_check))
        .route("/api/workspace/git/apply", post(git_apply::apply_patch))
        .route("/api/workspace/git/apply-diff", post(git_apply::apply_diff))
        .route("/api/workspace/git/undo", post(git_apply::undo_patch))
        .route("/api/ai/preview", post(cases::preview_ai_send))
        .route(
            "/api/policies",
            get(policies::get_policies).put(policies::save_policies),
        )
        .route("/api/mcp", get(mcp::list_mcp).post(mcp::save_mcp))
        .route("/api/mcp/{id}", delete(mcp::delete_mcp))
        .route("/api/mcp/{id}/probe", post(mcp::probe_mcp))
        .route("/api/mcp/{id}/call", post(mcp::call_mcp_tool))
}
