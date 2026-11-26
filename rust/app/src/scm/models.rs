use crate::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

pub(super) const PAGE_SIZE: u32 = 20;
pub(super) const MAX_PAGE: u32 = 50;
const MAX_PATCH: usize = 48_000;
const MAX_PATCH_LINES: usize = 1_800;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct PullRef {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

pub(super) fn slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && !matches!(value, "." | "..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

impl PullRef {
    pub fn validate(self) -> Result<Self, AppError> {
        if !slug(self.owner.strip_prefix('~').unwrap_or(&self.owner))
            || !slug(&self.repo)
            || self.number == 0
            || self.number > i64::MAX as u64
        {
            return Err(AppError::bad_request("Identitas pull request tidak valid."));
        }
        Ok(self)
    }

    pub fn from_url(base: &Url, input: &str) -> Result<Self, AppError> {
        let url = strict_url(input)?;
        if url.origin() != base.origin() {
            return Err(AppError::bad_request(
                "Host PR berada di luar profil GitHub Enterprise.",
            ));
        }
        let segments: Vec<_> = url
            .path()
            .trim_end_matches('/')
            .split('/')
            .skip(1)
            .collect();
        let [owner, repo, "pull", number] = segments.as_slice() else {
            return Err(AppError::bad_request(
                "Gunakan URL pull request GitHub Enterprise.",
            ));
        };
        Self {
            owner: (*owner).to_owned(),
            repo: (*repo).to_owned(),
            number: number.parse().unwrap_or(0),
        }
        .validate()
    }

    pub fn key(&self) -> String {
        format!(
            "{}/{}/{}",
            self.owner.to_ascii_lowercase(),
            self.repo.to_ascii_lowercase(),
            self.number
        )
    }

    pub fn api_path(&self) -> String {
        format!("/repos/{}/{}/pulls/{}", self.owner, self.repo, self.number)
    }

    pub fn web_url(&self, base: &Url) -> String {
        format!(
            "{}/{}/{}/pull/{}",
            base.origin().ascii_serialization(),
            self.owner,
            self.repo,
            self.number
        )
    }
}

pub(super) fn strict_url(input: &str) -> Result<Url, AppError> {
    let invalid = || AppError::bad_request("URL SCM harus HTTPS tanpa kredensial.");
    let input = input.trim();
    let authority = input
        .strip_prefix("https://")
        .ok_or_else(invalid)?
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if input.len() > 2048
        || input.chars().any(|c| c.is_control() || c == '\\')
        || authority.contains('@')
        || authority.is_empty()
    {
        return Err(invalid());
    }
    let url = Url::parse(input).map_err(|_| invalid())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(invalid());
    }
    Ok(url)
}

pub(super) fn sha(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(super) fn value_text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}

pub(super) fn bounded(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct QueueItem {
    #[serde(flatten)]
    pub reference: PullRef,
    pub title: String,
    pub author: String,
    pub updated_at: String,
    pub group: &'static str,
    pub draft: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Pull {
    #[serde(flatten)]
    pub reference: PullRef,
    pub title: String,
    pub description: String,
    pub description_truncated: bool,
    pub author: String,
    pub status: &'static str,
    pub head_branch: String,
    pub base_branch: String,
    pub head_sha: String,
    pub base_sha: String,
    pub updated_at: String,
    pub created_at: String,
    pub closed_at: String,
    pub merged_at: String,
    pub changed_files: Option<u64>,
    pub fetched_at: String,
    pub profile_id: String,
    pub remote_url: Option<String>,
    pub requested_reviewers: Vec<String>,
    pub requested_teams: Vec<String>,
}

impl Pull {
    pub fn from_remote(
        reference: PullRef,
        profile_id: &str,
        base: &Url,
        raw: &Value,
    ) -> Result<Self, AppError> {
        let head = value_text(&raw["head"], "sha");
        let base_sha = value_text(&raw["base"], "sha");
        if !sha(head) || !sha(base_sha) || raw["number"].as_u64() != Some(reference.number) {
            return Err(AppError::new(
                axum::http::StatusCode::BAD_GATEWAY,
                "Revisi PR dari GitHub tidak valid.",
            ));
        }
        let list = |field: &str, key: &str| {
            raw[field]
                .as_array()
                .into_iter()
                .flatten()
                .map(|item| bounded(value_text(item, key), 100))
                .filter(|text| !text.is_empty())
                .take(50)
                .collect()
        };
        let description = value_text(raw, "body");
        Ok(Self {
            remote_url: Some(reference.web_url(base)),
            reference,
            title: bounded(value_text(raw, "title"), 512),
            description: bounded(description, 24_000),
            description_truncated: description.chars().count() > 24_000,
            author: bounded(value_text(&raw["user"], "login"), 100),
            status: if raw["merged"].as_bool() == Some(true) {
                "merged"
            } else if raw["state"] == "closed" {
                "closed"
            } else if raw["draft"].as_bool() == Some(true) {
                "draft"
            } else {
                "open"
            },
            head_branch: bounded(value_text(&raw["head"], "ref"), 256),
            base_branch: bounded(value_text(&raw["base"], "ref"), 256),
            head_sha: head.to_owned(),
            base_sha: base_sha.to_owned(),
            updated_at: bounded(value_text(raw, "updated_at"), 40),
            created_at: bounded(value_text(raw, "created_at"), 40),
            closed_at: bounded(value_text(raw, "closed_at"), 40),
            merged_at: bounded(value_text(raw, "merged_at"), 40),
            changed_files: raw["changed_files"].as_u64(),
            fetched_at: chrono::Utc::now().to_rfc3339(),
            profile_id: profile_id.to_owned(),
            requested_reviewers: list("requested_reviewers", "login"),
            requested_teams: list("requested_teams", "slug"),
        })
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FileChange {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub patch: Option<String>,
    pub patch_status: String,
    pub page: u32,
    #[serde(default)]
    pub comparison_base: Option<String>,
}

impl FileChange {
    pub fn from_remote(raw: &Value, page: u32) -> Option<Self> {
        let path = value_text(raw, "filename");
        if path.is_empty() || path.len() > 4096 {
            return None;
        }
        let additions = raw["additions"].as_u64().unwrap_or(0).min(u32::MAX.into()) as u32;
        let deletions = raw["deletions"].as_u64().unwrap_or(0).min(u32::MAX.into()) as u32;
        let raw_patch = value_text(raw, "patch");
        let binary = raw["binary"].as_bool().unwrap_or(false)
            || raw_patch.starts_with("Binary files ")
            || raw_patch.starts_with("GIT binary patch");
        let (patch, patch_status) = if binary {
            (None, "binary")
        } else if raw_patch.is_empty() {
            (None, "unavailable")
        } else {
            let patch = if raw_patch.len() > MAX_PATCH {
                let end = raw_patch.as_bytes()[..MAX_PATCH]
                    .iter()
                    .rposition(|b| *b == b'\n')
                    .unwrap_or(0);
                &raw_patch[..end]
            } else {
                raw_patch
            };
            let patch = patch
                .match_indices('\n')
                .nth(MAX_PATCH_LINES - 1)
                .map_or(patch, |(end, _)| &patch[..end]);
            let (rows, complete) = parse_patch(patch);
            let actual_add = rows.iter().filter(|row| row.marker == '+').count() as u32;
            let actual_delete = rows.iter().filter(|row| row.marker == '-').count() as u32;
            let status = if rows.is_empty() {
                "unavailable"
            } else if !complete
                || patch.len() < raw_patch.len()
                || actual_add != additions
                || actual_delete != deletions
            {
                "truncated"
            } else {
                "available"
            };
            ((!rows.is_empty()).then(|| patch.to_owned()), status)
        };
        Some(Self {
            path: path.to_owned(),
            previous_path: raw["previous_filename"]
                .as_str()
                .filter(|s| s.len() <= 4096)
                .map(str::to_owned),
            status: bounded(value_text(raw, "status"), 30),
            additions,
            deletions,
            patch,
            patch_status: patch_status.into(),
            page,
            comparison_base: None,
        })
    }
}

pub(super) struct DiffRow<'a> {
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub marker: char,
    pub text: &'a str,
}

fn range(token: &str, prefix: char) -> Option<(u32, u32)> {
    let token = token.strip_prefix(prefix)?;
    let (start, count) = token.split_once(',').unwrap_or((token, "1"));
    let start: u32 = start.parse().ok()?;
    let count: u32 = count.parse().ok()?;
    start.checked_add(count)?;
    Some((start, count))
}

pub(super) fn diff_rows(patch: &str) -> Vec<DiffRow<'_>> {
    parse_patch(patch).0
}

fn parse_patch(patch: &str) -> (Vec<DiffRow<'_>>, bool) {
    let mut old = (0, 0);
    let mut new = (0, 0);
    let mut rows = Vec::new();
    let mut complete = true;
    for line in patch.lines() {
        if line.starts_with("@@ ") {
            complete &= old.1 == 0 && new.1 == 0;
            let mut parts = line.split_whitespace().skip(1);
            old = parts
                .next()
                .and_then(|token| range(token, '-'))
                .unwrap_or_default();
            new = parts
                .next()
                .and_then(|token| range(token, '+'))
                .unwrap_or_default();
            if parts.next() != Some("@@") {
                old.1 = 0;
                new.1 = 0;
                complete = false;
            }
            continue;
        }
        let marker = line.as_bytes().first().copied().unwrap_or_default() as char;
        let read_old = matches!(marker, ' ' | '-');
        let read_new = matches!(marker, ' ' | '+');
        if !read_old && !read_new || read_old && old.1 == 0 || read_new && new.1 == 0 {
            continue;
        }
        rows.push(DiffRow {
            old: read_old.then_some(old.0),
            new: read_new.then_some(new.0),
            marker,
            text: &line[1..],
        });
        if read_old {
            old.0 += 1;
            old.1 -= 1;
        }
        if read_new {
            new.0 += 1;
            new.1 -= 1;
        }
    }
    (rows, complete && old.1 == 0 && new.1 == 0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Reviewer {
    pub id: u64,
    pub login: String,
    pub state: String,
    pub body: String,
    pub submitted_at: String,
    pub revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewComment {
    pub id: u64,
    pub login: String,
    pub body: String,
    pub path: String,
    pub side: Option<&'static str>,
    pub line: Option<u64>,
    pub start_line: Option<u64>,
    pub start_side: Option<&'static str>,
    pub revision: String,
    pub original_revision: String,
    pub created_at: String,
    pub comparison_base: Option<String>,
}

pub(super) fn side(value: &str) -> Option<&'static str> {
    match value {
        "LEFT" => Some("left"),
        "RIGHT" => Some("right"),
        _ => None,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Check {
    pub id: u64,
    pub key: Option<String>,
    pub name: String,
    pub status: &'static str,
    pub detail: String,
    pub revision: String,
    pub source: &'static str,
}

pub(super) fn check_status(value: &str) -> &'static str {
    match value {
        "success" => "success",
        "failure" | "error" | "timed_out" | "action_required" | "startup_failure" => "failure",
        "pending" | "queued" | "in_progress" | "requested" | "waiting" | "pending_deployment" => {
            "pending"
        }
        "skipped" | "neutral" | "cancelled" | "stale" => "neutral",
        _ => "unavailable",
    }
}
