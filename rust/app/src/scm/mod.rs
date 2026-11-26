mod bitbucket;
mod fixture;
mod ghes;
mod models;
mod review_ai;
#[cfg(test)]
mod tests;

pub(crate) use bitbucket::{bitbucket_base_url, probe_bitbucket};
pub(crate) use ghes::{base_url, probe, tls_client};
pub(crate) use review_ai::Previews;

use crate::{ApiResult, AppError, AppState, User};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use bitbucket::Bitbucket;
use ghes::{Ghes, array, next_page, with_cache};
use models::*;
use serde::Deserialize;
use serde_json::{Value, json};

type PullPath = (String, String, u64);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/scm/profile", get(profile))
        .route("/api/scm/resolve", post(resolve))
        .route("/api/scm/queue", get(queue))
        .route("/api/scm/pulls/{owner}/{repo}/{number}", get(pull_detail))
        .route(
            "/api/scm/pulls/{owner}/{repo}/{number}/{section}",
            get(pull_section),
        )
        .route(
            "/api/scm/pulls/{owner}/{repo}/{number}/open",
            post(open_pull),
        )
        .route(
            "/api/scm/pulls/{owner}/{repo}/{number}/workspace",
            post(verify_workspace),
        )
        .route("/api/scm/review/preview", post(review_ai::preview))
        .route("/api/scm/review/analyze", post(review_ai::analyze))
}

#[derive(Deserialize, Default)]
struct PullQuery {
    #[serde(default)]
    fixture: bool,
    page: Option<u32>,
    #[serde(default)]
    provider: ScmKind,
    file: Option<String>,
    head: Option<String>,
    base: Option<String>,
}

impl PullQuery {
    fn page(&self) -> Result<u32, AppError> {
        let page = self.page.unwrap_or(1);
        if !(1..=self.provider.max_cursor()).contains(&page) {
            return Err(AppError::bad_request("Halaman di luar batas paginasi."));
        }
        Ok(page)
    }

    fn revision(&self) -> Result<(&str, &str), AppError> {
        let head = self.head.as_deref().unwrap_or("");
        let base = self.base.as_deref().unwrap_or("");
        if !sha(head) || !sha(base) {
            return Err(AppError::bad_request("Head dan base SHA wajib diisi."));
        }
        Ok((head, base))
    }
}

fn reference((owner, repo, number): PullPath) -> Result<PullRef, AppError> {
    PullRef {
        owner,
        repo,
        number,
    }
    .validate()
}

fn require_revision(pull: &Pull, head: &str, base: &str) -> Result<(), AppError> {
    if pull.head_sha != head || pull.base_sha != base {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "Revisi PR berubah. Muat ulang PR untuk melihat perubahan terbaru.",
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ScmKind {
    #[default]
    Ghes,
    Bitbucket,
}

impl ScmKind {
    fn name(self) -> &'static str {
        match self {
            Self::Ghes => "ghes",
            Self::Bitbucket => "bitbucket",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Ghes => "GitHub Enterprise",
            Self::Bitbucket => "Bitbucket Data Center",
        }
    }

    fn max_cursor(self) -> u32 {
        match self {
            Self::Ghes => MAX_PAGE,
            Self::Bitbucket => bitbucket::MAX_QUEUE_CURSOR,
        }
    }

    fn profile_row(self, state: &AppState, user: &str) -> Result<Option<Value>, AppError> {
        if self == Self::Ghes {
            return ghes::profile_row(state, user);
        }
        let mut rows = state.db.query(
            "SELECT * FROM pilot_connectors WHERE user_id=? AND kind='bitbucket' AND enabled=1 ORDER BY id LIMIT 2",
            &[json!(user)],
        )?;
        if rows.len() > 1 {
            return Err(AppError::bad_request(
                "Aktifkan satu profil Bitbucket untuk Code Review.",
            ));
        }
        Ok(rows.pop())
    }
}

enum Scm {
    Ghes(Ghes),
    Bitbucket(Bitbucket),
}

impl Scm {
    fn load(state: &AppState, user: &str, kind: ScmKind) -> Result<Self, AppError> {
        match kind {
            ScmKind::Ghes => Ok(Self::Ghes(Ghes::load(state, user)?)),
            ScmKind::Bitbucket => {
                let row = kind.profile_row(state, user)?.ok_or_else(|| {
                    AppError::bad_request("Siapkan profil Bitbucket Data Center di Settings.")
                })?;
                Ok(Self::Bitbucket(Bitbucket::from_row(state, &row)?))
            }
        }
    }

    fn id(&self) -> &str {
        match self {
            Self::Ghes(client) => &client.id,
            Self::Bitbucket(client) => &client.id,
        }
    }

    fn cache_key(&self) -> &str {
        match self {
            Self::Ghes(client) => &client.cache_key,
            Self::Bitbucket(client) => &client.cache_key,
        }
    }

    async fn pull(&self, reference: PullRef) -> Result<Pull, AppError> {
        match self {
            Self::Ghes(client) => client.pull(reference).await,
            Self::Bitbucket(client) => client.pull(reference).await,
        }
    }

    async fn read(
        &self,
        section: Section,
        reference: PullRef,
        head: &str,
        base: &str,
        page: u32,
    ) -> Result<Value, AppError> {
        match self {
            Self::Ghes(client) => section.read(client, reference, head, base, page).await,
            Self::Bitbucket(client) => client.section(section, reference, head, base, page).await,
        }
    }
}

async fn profile(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(query): Query<PullQuery>,
) -> ApiResult {
    let kind = query.provider;
    let (data, error) = match kind.profile_row(&state, &user.id) {
        Ok(Some(row)) => {
            let base = value_text(&row, "base_url");
            let valid = match kind {
                ScmKind::Ghes => ghes::base_url(base).is_ok(),
                ScmKind::Bitbucket => bitbucket_base_url(base).is_ok(),
            };
            let error =
                (!valid || row["insecure_tls"].as_i64() != Some(0) || row["auth_type"] != "bearer")
                    .then(|| {
                        format!(
                            "Perbarui profil {} agar memakai HTTPS terverifikasi.",
                            kind.label()
                        )
                    });
            (
                json!({"id": row["id"], "label": row["label"], "origin": row["base_url"],
                "version": row["last_version"], "status": row["last_status"]}),
                error,
            )
        }
        Ok(None) => (Value::Null, None),
        Err(error) if error.status == StatusCode::BAD_REQUEST => (Value::Null, Some(error.message)),
        Err(error) => return Err(error),
    };
    Ok(Json(
        json!({"profile": data, "configurationError": error, "desktopOpen": state.external_open.is_some()}),
    ))
}

#[derive(Deserialize)]
struct ResolveInput {
    url: String,
    #[serde(default)]
    provider: ScmKind,
}

async fn resolve(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<ResolveInput>,
) -> ApiResult {
    let reference = match Scm::load(&state, &user.id, input.provider)? {
        Scm::Ghes(c) => PullRef::from_url(&c.base, &input.url)?,
        Scm::Bitbucket(c) => c.resolve(&input.url)?,
    };
    Ok(Json(json!({"reference": reference})))
}

async fn queue(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(query): Query<PullQuery>,
) -> ApiResult {
    let page = query.page()?;
    if query.fixture {
        return Ok(Json(fixture::queue(page)));
    }
    let scm = Scm::load(&state, &user.id, query.provider)?;
    let result = match &scm {
        Scm::Ghes(c) => c.queue(page).await,
        Scm::Bitbucket(c) => c.queue(page).await,
    };
    Ok(Json(with_cache(
        &state,
        &user.id,
        scm.cache_key(),
        &format!("queue:{page}"),
        result,
    )?))
}

async fn pull_detail(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(path): Path<PullPath>,
    Query(query): Query<PullQuery>,
) -> ApiResult {
    let reference = reference(path)?;
    if query.fixture {
        return Ok(Json(
            json!({"pull": fixture::pull(reference)?, "stale": false}),
        ));
    }
    let scm = Scm::load(&state, &user.id, query.provider)?;
    let key = format!("pr:{}", reference.key());
    let result = scm.pull(reference).await.map(|pull| json!({"pull": pull}));
    Ok(Json(with_cache(
        &state,
        &user.id,
        scm.cache_key(),
        &key,
        result,
    )?))
}

#[derive(Clone, Copy)]
enum Section {
    Files,
    Reviews,
    Comments,
    Runs,
    Statuses,
}

impl Section {
    fn parse(name: &str) -> Result<Self, AppError> {
        match name {
            "files" => Ok(Self::Files),
            "reviews" => Ok(Self::Reviews),
            "comments" => Ok(Self::Comments),
            "runs" => Ok(Self::Runs),
            "statuses" => Ok(Self::Statuses),
            _ => Err(AppError::not_found("Bagian Code Review tidak tersedia.")),
        }
    }

    async fn read(
        self,
        github: &Ghes,
        reference: PullRef,
        head: &str,
        base: &str,
        page: u32,
    ) -> Result<Value, AppError> {
        require_revision(&github.pull(reference.clone()).await?, head, base)?;
        let pr_path = reference.api_path();
        let commit_path = format!(
            "/repos/{}/{}/commits/{head}",
            reference.owner, reference.repo
        );
        let path = match self {
            Self::Files => format!("{pr_path}/files"),
            Self::Reviews => format!("{pr_path}/reviews"),
            Self::Comments => format!("{pr_path}/comments"),
            Self::Runs => format!("{commit_path}/check-runs"),
            Self::Statuses => format!("{commit_path}/statuses"),
        };
        let result = github.page(&path, page).await?;
        let items = match self {
            Self::Files => json!(
                array(&result.body)?
                    .iter()
                    .filter_map(|item| FileChange::from_remote(item, page))
                    .collect::<Vec<_>>()
            ),
            Self::Reviews => json!(
                array(&result.body)?
                    .iter()
                    .map(reviewer)
                    .collect::<Vec<_>>()
            ),
            Self::Comments => json!(array(&result.body)?.iter().map(comment).collect::<Vec<_>>()),
            Self::Runs => json!(
                array(&result.body["check_runs"])?
                    .iter()
                    .filter(|item| value_text(item, "head_sha").eq_ignore_ascii_case(head))
                    .map(|item| check(item, head, true))
                    .collect::<Vec<_>>()
            ),
            Self::Statuses => json!(
                array(&result.body)?
                    .iter()
                    .map(|item| check(item, head, false))
                    .collect::<Vec<_>>()
            ),
        };
        if matches!(self, Self::Files | Self::Reviews | Self::Comments) {
            require_revision(&github.pull(reference).await?, head, base)?;
        }
        Ok(
            json!({"items": items, "nextPage": next_page(result.next, page),
            "partial": result.next && page == MAX_PAGE, "headSha": head, "baseSha": base}),
        )
    }
}

async fn pull_section(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((owner, repo, number, name)): Path<(String, String, u64, String)>,
    Query(query): Query<PullQuery>,
) -> ApiResult {
    let reference = reference((owner, repo, number))?;
    let page = query.page()?;
    let (head, base) = query.revision()?;
    if query.fixture {
        require_revision(&fixture::pull(reference.clone())?, head, base)?;
        return Ok(Json(fixture::section(Section::parse(&name)?, page)));
    }
    let scm = Scm::load(&state, &user.id, query.provider)?;
    let key = format!("pr:{}:{head}:{base}:{name}:{page}", reference.key());
    if name == "diff" {
        let Scm::Bitbucket(client) = &scm else {
            return Err(AppError::not_found("Endpoint diff tidak tersedia."));
        };
        let path = query
            .file
            .as_deref()
            .ok_or_else(|| AppError::bad_request("Path diff wajib diisi."))?;
        let key = format!("{key}:{}", crate::core::content_hash(path));
        let result = client
            .selected_file(&reference, path, page, head, base)
            .await
            .map(|file| json!({"file":file}));
        return Ok(Json(with_cache(
            &state,
            &user.id,
            scm.cache_key(),
            &key,
            result,
        )?));
    }
    let result = scm
        .read(Section::parse(&name)?, reference, head, base, page)
        .await;
    Ok(Json(with_cache(
        &state,
        &user.id,
        scm.cache_key(),
        &key,
        result,
    )?))
}

fn reviewer(raw: &Value) -> Reviewer {
    Reviewer {
        id: raw["id"].as_u64().unwrap_or(0),
        login: bounded(value_text(&raw["user"], "login"), 100),
        state: bounded(value_text(raw, "state"), 50),
        body: bounded(value_text(raw, "body"), 4_000),
        submitted_at: bounded(value_text(raw, "submitted_at"), 40),
        revision: bounded(value_text(raw, "commit_id"), 64),
    }
}

fn comment(raw: &Value) -> ReviewComment {
    ReviewComment {
        id: raw["id"].as_u64().unwrap_or(0),
        login: bounded(value_text(&raw["user"], "login"), 100),
        body: bounded(value_text(raw, "body"), 4_000),
        path: bounded(value_text(raw, "path"), 4096),
        side: side(value_text(raw, "side")),
        line: raw["line"].as_u64(),
        start_line: raw["start_line"].as_u64(),
        start_side: side(value_text(raw, "start_side")),
        revision: bounded(value_text(raw, "commit_id"), 64),
        original_revision: bounded(value_text(raw, "original_commit_id"), 64),
        created_at: bounded(value_text(raw, "created_at"), 40),
        comparison_base: None,
    }
}

fn check(raw: &Value, head: &str, run: bool) -> Check {
    let conclusion = value_text(raw, "conclusion");
    let state = if run {
        value_text(raw, "status")
    } else {
        value_text(raw, "state")
    };
    Check {
        key: None,
        id: raw["id"].as_u64().unwrap_or(0),
        name: bounded(value_text(raw, if run { "name" } else { "context" }), 256),
        status: check_status(if run && state == "completed" {
            conclusion
        } else {
            state
        }),
        detail: bounded(
            if run {
                value_text(&raw["output"], "title")
            } else {
                value_text(raw, "description")
            },
            400,
        ),
        revision: head.to_owned(),
        source: if run { "run" } else { "status" },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenInput {
    profile_id: String,
    remote_url: String,
    #[serde(default)]
    provider: ScmKind,
}

async fn open_pull(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(path): Path<PullPath>,
    Json(input): Json<OpenInput>,
) -> ApiResult {
    let reference = reference(path)?;
    let scm = Scm::load(&state, &user.id, input.provider)?;
    let url = match &scm {
        Scm::Ghes(c) => reference.web_url(&c.base),
        Scm::Bitbucket(c) => c.web_url(&reference),
    };
    if input.profile_id != scm.id() || input.remote_url != url {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "Profil SCM berubah. Muat ulang pull request.",
        ));
    }
    let opener = state
        .external_open
        .ok_or_else(|| AppError::bad_request("Gunakan tautan platform review."))?;
    opener(&url).map_err(|_| AppError::internal("Browser sistem tidak dapat dibuka."))?;
    Ok(Json(json!({"opened": true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInput {
    path: String,
    #[serde(default)]
    provider: ScmKind,
    profile_id: Option<String>,
    head_sha: String,
    base_sha: String,
}

async fn verify_workspace(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(path): Path<PullPath>,
    Json(input): Json<WorkspaceInput>,
) -> ApiResult {
    let reference = reference(path)?;
    let scm = Scm::load(&state, &user.id, input.provider)?;
    if input.profile_id.as_deref().is_some_and(|id| id != scm.id()) {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "Profil SCM berubah. Muat ulang pull request.",
        ));
    }
    let (pull, remote) = match &scm {
        Scm::Ghes(client) => {
            let pull = client.pull(reference.clone()).await?;
            let remote = format!(
                "{}/{}/{}",
                client.base.origin().ascii_serialization(),
                reference.owner,
                reference.repo
            );
            (pull, remote)
        }
        Scm::Bitbucket(client) => {
            let (pull, source) = client.pull_with_source(reference).await?;
            let source = source.ok_or_else(|| {
                AppError::not_found("Repository asal PR Bitbucket tidak tersedia.")
            })?;
            (pull, client.clone_url(&source))
        }
    };
    require_revision(&pull, &input.head_sha, &input.base_sha)?;
    let checkout =
        crate::pilot::git_apply::verify_review_checkout(input.path, remote, pull.head_sha.clone())
            .await?;
    Ok(Json(
        json!({"repoPath": checkout, "headSha": pull.head_sha}),
    ))
}
