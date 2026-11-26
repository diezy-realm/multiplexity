use super::{Section, models::*, require_revision};
use crate::{AppError, AppState, core::content_hash};
use axum::http::StatusCode;
use serde_json::{Value, json};
use url::Url;

const API: &str = "/rest/api/latest";
const MAX_OFFSET: u32 = 1000;
const CURSOR_RADIX: u32 = MAX_OFFSET + 2;
pub(super) const MAX_QUEUE_CURSOR: u32 = CURSOR_RADIX * CURSOR_RADIX;
const MAX_CHANGES: usize = 1000;
const MAX_BODY: u64 = 2 * 1024 * 1024;

fn invalid_data() -> AppError {
    AppError::new(
        StatusCode::BAD_GATEWAY,
        "Respons Bitbucket Data Center tidak valid.",
    )
}

pub(crate) fn bitbucket_base_url(input: &str) -> Result<Url, AppError> {
    let url = strict_url(input)?;
    if url.query().is_some()
        || url.fragment().is_some()
        || url
            .path()
            .trim_matches('/')
            .split('/')
            .any(|part| !part.is_empty() && !slug(part))
        || url.path().contains("//")
    {
        return Err(AppError::bad_request(
            "Gunakan base URL HTTPS Bitbucket dengan path instalasi yang valid.",
        ));
    }
    Ok(url)
}

fn root(base: &Url) -> &str {
    base.as_str().trim_end_matches('/')
}

pub(super) struct Bitbucket {
    pub id: String,
    pub base: Url,
    pub cache_key: String,
    token: String,
    client: reqwest::Client,
}

impl Bitbucket {
    pub fn from_row(state: &AppState, row: &Value) -> Result<Self, AppError> {
        if row["insecure_tls"].as_i64() != Some(0) || row["auth_type"] != "bearer" {
            return Err(AppError::bad_request(
                "Profil Bitbucket memerlukan HTTPS terverifikasi dan token Bearer.",
            ));
        }
        let base = bitbucket_base_url(value_text(row, "base_url"))?;
        let ct = value_text(row, "token_encrypted");
        let iv = value_text(row, "token_iv");
        let ca = value_text(row, "ghes_ca_pem");
        let id = value_text(row, "id");
        Ok(Self {
            id: id.to_owned(),
            cache_key: content_hash(&format!("bitbucket\n{id}\n{base}\n{ct}\n{iv}\n{ca}")),
            base,
            token: state
                .db
                .decrypt(ct, iv, value_text(row, "token_auth_tag"))?,
            client: super::tls_client(ca)?,
        })
    }

    #[cfg(test)]
    pub(super) fn fixture(base: Url) -> Self {
        Self {
            id: "fixture".into(),
            cache_key: "bb-test".into(),
            base,
            token: "fixture-pat".into(),
            client: super::tls_client("").unwrap(),
        }
    }

    pub fn resolve(&self, input: &str) -> Result<PullRef, AppError> {
        let url = strict_url(input)?;
        let context = self.base.path().trim_end_matches('/');
        let path = url
            .path()
            .strip_prefix(context)
            .filter(|path| path.starts_with('/'));
        if url.origin() != self.base.origin() || path.is_none() {
            return Err(AppError::bad_request(
                "URL PR berada di luar profil Bitbucket.",
            ));
        }
        let segments: Vec<_> = path
            .unwrap_or_default()
            .trim_matches('/')
            .split('/')
            .collect();
        let [
            scope @ ("projects" | "users"),
            project,
            "repos",
            repo,
            "pull-requests",
            id,
            tail @ ..,
        ] = segments.as_slice()
        else {
            return Err(AppError::bad_request(
                "Gunakan URL pull request Bitbucket Data Center.",
            ));
        };
        if !matches!(tail, [] | ["overview" | "diff" | "commits" | "activity"]) {
            return Err(AppError::bad_request(
                "Path pull request Bitbucket tidak valid.",
            ));
        }
        PullRef {
            owner: if *scope == "users" {
                format!("~{}", project.to_ascii_lowercase())
            } else {
                project.to_ascii_uppercase()
            },
            repo: repo.to_ascii_lowercase(),
            number: id.parse().unwrap_or(0),
        }
        .validate()
    }

    pub fn web_url(&self, reference: &PullRef) -> String {
        let location = if let Some(user) = reference.owner.strip_prefix('~') {
            format!("users/{}", user.to_ascii_lowercase())
        } else {
            format!("projects/{}", reference.owner.to_ascii_uppercase())
        };
        format!(
            "{}/{location}/repos/{}/pull-requests/{}/overview",
            root(&self.base),
            reference.repo.to_ascii_lowercase(),
            reference.number
        )
    }

    pub fn clone_url(&self, source: &PullRef) -> String {
        format!("{}/scm/{}/{}", root(&self.base), source.owner, source.repo)
    }

    async fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, AppError> {
        let url = format!("{}{API}{path}", root(&self.base));
        let transport = |error: reqwest::Error| {
            let mut source = std::error::Error::source(&error);
            while let Some(cause) = source {
                let detail = cause.to_string().to_ascii_lowercase();
                if detail.contains("certificate") || detail.contains("tls") {
                    return AppError::new(
                        StatusCode::BAD_GATEWAY,
                        "Verifikasi TLS Bitbucket gagal. Periksa CA perusahaan.",
                    );
                }
                source = cause.source();
            }
            AppError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Bitbucket tidak dapat dijangkau.",
            )
        };
        let mut response = self
            .client
            .get(url)
            .bearer_auth(&self.token)
            .header("Accept", "application/json")
            .header("User-Agent", "Multiplexity/0.3")
            .query(query)
            .send()
            .await
            .map_err(transport)?;
        let status = response.status();
        if !status.is_success() {
            let (code, message) = match status {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => (
                    StatusCode::FORBIDDEN,
                    "Bitbucket menolak akses. Periksa PAT dan izin baca repository.",
                ),
                StatusCode::NOT_FOUND => (
                    status,
                    "Data Bitbucket tidak ditemukan atau berada di luar akses token.",
                ),
                StatusCode::TOO_MANY_REQUESTS => (status, "Batas permintaan Bitbucket tercapai."),
                status if status.is_redirection() => (
                    StatusCode::BAD_GATEWAY,
                    "Redirect Bitbucket ditolak. Periksa base URL kanonis.",
                ),
                _ => (
                    StatusCode::BAD_GATEWAY,
                    "Bagian ini gagal dimuat dari Bitbucket.",
                ),
            };
            return Err(AppError::new(code, message));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_BODY)
        {
            return Err(AppError::new(
                StatusCode::BAD_GATEWAY,
                "Respons Bitbucket melebihi batas 2 MiB.",
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(transport)? {
            if bytes.len() + chunk.len() > MAX_BODY as usize {
                return Err(AppError::new(
                    StatusCode::BAD_GATEWAY,
                    "Respons Bitbucket melebihi batas 2 MiB.",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| invalid_data())
    }

    async fn page(
        &self,
        path: &str,
        start: u32,
        query: &[(&str, &str)],
    ) -> Result<RemotePage, AppError> {
        let offset = start.to_string();
        let limit = PAGE_SIZE.to_string();
        let mut params = vec![("start", offset.as_str()), ("limit", limit.as_str())];
        params.extend_from_slice(query);
        let raw = self.get(path, &params).await?;
        let items = raw["values"].as_array().ok_or_else(invalid_data)?.to_vec();
        let (next, partial) = match raw["isLastPage"].as_bool() {
            Some(true) => (None, false),
            Some(false) => {
                let next = raw["nextPageStart"]
                    .as_u64()
                    .filter(|next| *next > u64::from(start))
                    .ok_or_else(invalid_data)?;
                if next <= u64::from(MAX_OFFSET) {
                    (Some(next as u32), false)
                } else {
                    (None, true)
                }
            }
            None => return Err(invalid_data()),
        };
        Ok(RemotePage {
            items,
            next,
            partial,
        })
    }

    async fn dashboard(&self, role: &str, offset: Option<u32>) -> Result<RemotePage, AppError> {
        if let Some(start) = offset {
            self.page(
                "/dashboard/pull-requests",
                start,
                &[("role", role), ("state", "OPEN")],
            )
            .await
        } else {
            Ok(RemotePage::default())
        }
    }

    pub async fn queue(&self, cursor: u32) -> Result<Value, AppError> {
        let (mine, review) = if cursor == 1 {
            (Some(0), Some(0))
        } else if (2..=MAX_QUEUE_CURSOR).contains(&cursor) {
            let encoded = cursor - 1;
            (
                (encoded / CURSOR_RADIX).checked_sub(1),
                (encoded % CURSOR_RADIX).checked_sub(1),
            )
        } else {
            return Err(AppError::bad_request(
                "Kursor antrean Bitbucket tidak valid.",
            ));
        };
        let results = tokio::join!(
            self.dashboard("AUTHOR", mine),
            self.dashboard("REVIEWER", review)
        );
        let mut items = Vec::new();
        let mut errors = Vec::new();
        let mut partial = false;
        let mut starts = [0, 0];
        for (index, (group, result)) in [("mine", results.0), ("requested", results.1)]
            .into_iter()
            .enumerate()
        {
            match result {
                Ok(page) => {
                    starts[index] = page.next.map_or(0, |start| start + 1);
                    partial |= page.partial;
                    items.extend(page.items.iter().filter_map(|raw| {
                        let reference =
                            repo_ref(&raw["toRef"]["repository"], raw["id"].as_u64()?).ok()?;
                        Some(QueueItem {
                            reference,
                            title: bounded(value_text(raw, "title"), 512),
                            author: login(&raw["author"]["user"]),
                            updated_at: date(raw, "updatedDate"),
                            group,
                            draft: raw["draft"] == true,
                        })
                    }));
                }
                Err(error) if error.status == StatusCode::SERVICE_UNAVAILABLE => return Err(error),
                Err(error) => errors.push(json!({"group":group,"message":error.message})),
            }
        }
        let next = (starts != [0, 0]).then_some(1 + starts[0] * CURSOR_RADIX + starts[1]);
        Ok(
            json!({"items":items,"nextPage":next,"groupErrors":errors,"partial":partial,
            "teamCount":0,"teamScopeLimited":false}),
        )
    }

    pub async fn probe(&self) -> Result<String, AppError> {
        let (meta, _) = tokio::try_join!(
            self.get("/application-properties", &[]),
            self.dashboard("AUTHOR", Some(0)),
        )?;
        let version = value_text(&meta, "version");
        if version.is_empty() {
            return Err(invalid_data());
        }
        Ok(bounded(version, 64))
    }

    pub async fn pull(&self, reference: PullRef) -> Result<Pull, AppError> {
        Ok(self.pull_with_source(reference).await?.0)
    }

    pub async fn pull_with_source(
        &self,
        reference: PullRef,
    ) -> Result<(Pull, Option<PullRef>), AppError> {
        let raw = self.get(&pull_path(&reference), &[]).await?;
        let number = raw["id"]
            .as_u64()
            .filter(|id| *id == reference.number)
            .ok_or_else(invalid_data)?;
        let target = repo_ref(&raw["toRef"]["repository"], number).map_err(|_| invalid_data())?;
        let source = repo_ref(&raw["fromRef"]["repository"], number).ok();
        if target.key() != reference.key() {
            return Err(invalid_data());
        }
        let head = &raw["fromRef"];
        let base = &raw["toRef"];
        let status = value_text(&raw, "state");
        let closed = if matches!(status, "MERGED" | "DECLINED" | "SUPERSEDED") {
            date(&raw, "closedDate")
        } else {
            String::new()
        };
        let mut pull = Pull::from_remote(
            target.clone(),
            &self.id,
            &self.base,
            &json!({
                "number":number,"title":raw["title"],"body":raw["description"],"user":{"login":login(&raw["author"]["user"])},
                "head":{"sha":head["latestCommit"],"ref":head["displayId"]},
                "base":{"sha":base["latestCommit"],"ref":base["displayId"]},
                "state":if matches!(status,"DECLINED" | "SUPERSEDED") {"closed"} else {"open"},
                "merged":status=="MERGED","draft":raw["draft"],"created_at":date(&raw,"createdDate"),
                "updated_at":date(&raw,"updatedDate"),"closed_at":closed,"merged_at":if status=="MERGED" {closed.as_str()} else {""}
            }),
        )?;
        pull.remote_url = Some(self.web_url(&target));
        Ok((pull, source))
    }

    pub async fn section(
        &self,
        section: Section,
        reference: PullRef,
        head: &str,
        base: &str,
        page: u32,
    ) -> Result<Value, AppError> {
        let start = offset(page)?;
        let (pull, source) = self.pull_with_source(reference.clone()).await?;
        require_revision(&pull, head, base)?;
        let path = pull_path(&reference);
        let result = match section {
            Section::Files => {
                if start != 0 {
                    return Err(AppError::bad_request(
                        "Daftar perubahan Bitbucket tersedia dalam satu halaman.",
                    ));
                }
                self.changes(&path).await?
            }
            Section::Reviews => {
                self.page(&format!("{path}/participants"), start, &[])
                    .await?
            }
            Section::Comments => self.page(&format!("{path}/activities"), start, &[]).await?,
            Section::Statuses => {
                self.page(
                    &format!(
                        "{}/commits/{head}/builds",
                        repo_path(&source.ok_or_else(|| AppError::not_found(
                            "Repository asal commit Bitbucket tidak tersedia."
                        ))?)
                    ),
                    start,
                    &[],
                )
                .await?
            }
            Section::Runs => return Ok(page_result(json!([]), None, false, head, base)),
        };
        let items = match section {
            Section::Files => json!(
                result
                    .items
                    .iter()
                    .filter_map(change_meta)
                    .map(|file| FileChange {
                        path: file.path,
                        previous_path: file.old,
                        status: file.status.into(),
                        additions: 0,
                        deletions: 0,
                        patch: None,
                        patch_status: "not_loaded".into(),
                        page,
                        comparison_base: None
                    })
                    .collect::<Vec<_>>()
            ),
            Section::Reviews => json!(
                result
                    .items
                    .iter()
                    .filter_map(participant)
                    .collect::<Vec<_>>()
            ),
            Section::Comments => json!(
                result
                    .items
                    .iter()
                    .flat_map(activity_comments)
                    .collect::<Vec<_>>()
            ),
            Section::Statuses => json!(
                result
                    .items
                    .iter()
                    .filter_map(|item| build(item, head))
                    .collect::<Vec<_>>()
            ),
            Section::Runs => unreachable!(),
        };
        if !matches!(section, Section::Statuses) {
            require_revision(&self.pull(reference).await?, head, base)?;
        }
        let mut payload = page_result(
            items,
            result.next.map(|offset| offset + 1),
            result.partial,
            head,
            base,
        );
        if matches!(section, Section::Comments) {
            payload["activities"] = json!(
                result
                    .items
                    .iter()
                    .filter_map(activity_event)
                    .collect::<Vec<_>>()
            );
        }
        Ok(payload)
    }

    pub async fn selected_file(
        &self,
        reference: &PullRef,
        file: &str,
        page: u32,
        head: &str,
        base: &str,
    ) -> Result<FileChange, AppError> {
        require_revision(&self.pull(reference.clone()).await?, head, base)?;
        let path = pull_path(reference);
        if page != 1 {
            return Err(AppError::bad_request("Halaman file Bitbucket tidak valid."));
        }
        let changes = self.changes(&path).await?;
        let meta = changes
            .items
            .iter()
            .filter_map(change_meta)
            .find(|item| item.path == file)
            .ok_or_else(|| AppError::not_found("File tidak ada pada halaman perubahan ini."))?;
        let file = self.file_diff(&path, meta, page, head).await?;
        require_revision(&self.pull(reference.clone()).await?, head, base)?;
        Ok(file)
    }

    async fn changes(&self, pr: &str) -> Result<RemotePage, AppError> {
        // Bitbucket ignores start on this endpoint and returns at most one page.
        let raw = self
            .get(
                &format!("{pr}/changes"),
                &[
                    ("limit", &MAX_CHANGES.to_string()),
                    ("withComments", "false"),
                ],
            )
            .await?;
        let items = raw["values"].as_array().ok_or_else(invalid_data)?;
        let limit = raw["limit"].as_u64().unwrap_or(MAX_CHANGES as u64);
        Ok(RemotePage {
            items: items.iter().take(MAX_CHANGES).cloned().collect(),
            next: None,
            partial: raw["isLastPage"] == false
                || raw["truncated"] == true
                || items.len() as u64 >= limit
                || items.len() >= MAX_CHANGES,
        })
    }

    async fn file_diff(
        &self,
        pull: &str,
        meta: Change,
        page: u32,
        head: &str,
    ) -> Result<FileChange, AppError> {
        let file = encode_path(&meta.path)?;
        let mut params = vec![("contextLines", "3"), ("withComments", "false")];
        if let Some(old) = &meta.old {
            params.push(("srcPath", old));
        }
        let raw = self.get(&format!("{pull}/diff/{file}"), &params).await?;
        normalize_file(meta, &raw, page, head)
    }
}

pub(crate) async fn probe_bitbucket(state: &AppState, row: &Value) -> Result<String, AppError> {
    Bitbucket::from_row(state, row)?.probe().await
}

#[derive(Default)]
struct RemotePage {
    items: Vec<Value>,
    next: Option<u32>,
    partial: bool,
}

fn offset(page: u32) -> Result<u32, AppError> {
    (1..=MAX_OFFSET + 1)
        .contains(&page)
        .then(|| page - 1)
        .ok_or_else(|| AppError::bad_request("Kursor bagian Bitbucket tidak valid."))
}

fn page_result(items: Value, next: Option<u32>, partial: bool, head: &str, base: &str) -> Value {
    json!({"items":items,"nextPage":next,"partial":partial,"headSha":head,"baseSha":base})
}

fn repo_path(reference: &PullRef) -> String {
    format!(
        "/projects/{}/repos/{}",
        project_key(&reference.owner),
        reference.repo.to_ascii_lowercase()
    )
}

fn pull_path(reference: &PullRef) -> String {
    format!(
        "{}/pull-requests/{}",
        repo_path(reference),
        reference.number
    )
}

fn project_key(raw: &str) -> String {
    if raw.starts_with('~') {
        raw.to_ascii_lowercase()
    } else {
        raw.to_ascii_uppercase()
    }
}

fn repo_ref(repository: &Value, number: u64) -> Result<PullRef, AppError> {
    PullRef {
        owner: project_key(value_text(&repository["project"], "key")),
        repo: value_text(repository, "slug").to_ascii_lowercase(),
        number,
    }
    .validate()
}

fn login(user: &Value) -> String {
    bounded(
        user["slug"]
            .as_str()
            .or_else(|| user["name"].as_str())
            .unwrap_or(""),
        100,
    )
}

fn date(value: &Value, field: &str) -> String {
    value[field]
        .as_i64()
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|value| value.to_rfc3339())
        .unwrap_or_default()
}

struct Change {
    path: String,
    old: Option<String>,
    status: &'static str,
}

fn path(value: &Value) -> String {
    if let Some(path) = value.as_str().or_else(|| value["toString"].as_str()) {
        return path.to_owned();
    }
    if let Some(parts) = value["components"].as_array() {
        return parts
            .iter()
            .map(Value::as_str)
            .collect::<Option<Vec<_>>>()
            .unwrap_or_default()
            .join("/");
    }
    let name = value_text(value, "name");
    let parent = value_text(value, "parent");
    if name.is_empty() || parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}

fn change_meta(raw: &Value) -> Option<Change> {
    let file = path(&raw["path"]);
    let old = path(&raw["srcPath"]);
    if encode_path(&file).is_err() {
        return None;
    }
    Some(Change {
        old: (!old.is_empty() && old != file).then_some(old),
        path: file,
        status: match value_text(raw, "type") {
            "ADD" => "added",
            "DELETE" => "removed",
            "MOVE" => "renamed",
            "COPY" => "copied",
            _ => "modified",
        },
    })
}

fn encode_path(file: &str) -> Result<String, AppError> {
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
    if file.is_empty()
        || file.len() > 4096
        || file.chars().any(|c| c.is_control() || c == '\\')
        || file.split('/').any(|part| matches!(part, "" | "." | ".."))
    {
        return Err(AppError::bad_request("Path diff Bitbucket tidak valid."));
    }
    Ok(file
        .split('/')
        .map(|part| utf8_percent_encode(part, NON_ALPHANUMERIC).to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn normalize_file(
    meta: Change,
    raw: &Value,
    page: u32,
    head: &str,
) -> Result<FileChange, AppError> {
    use std::fmt::Write;
    let diff = raw["diffs"]
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or(raw);
    let mismatched = raw["toHash"]
        .as_str()
        .or_else(|| diff["toHash"].as_str())
        .is_some_and(|hash| !hash.eq_ignore_ascii_case(head));
    if mismatched {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "Revisi diff Bitbucket berubah.",
        ));
    }
    let (mut additions, mut deletions) = (0, 0);
    let mut patch = String::new();
    let mut incomplete = raw["truncated"] == true || diff["truncated"] == true;
    for hunk in diff["hunks"].as_array().into_iter().flatten() {
        let [Some(old), Some(old_count), Some(new), Some(new_count)] = [
            "sourceLine",
            "sourceSpan",
            "destinationLine",
            "destinationSpan",
        ]
        .map(|field| hunk[field].as_u64()) else {
            incomplete = true;
            continue;
        };
        let _ = writeln!(patch, "@@ -{old},{old_count} +{new},{new_count} @@");
        incomplete |= hunk["truncated"] == true;
        let (mut old_line, mut new_line) = (old, new);
        'segments: for segment in hunk["segments"].as_array().into_iter().flatten() {
            let marker = match value_text(segment, "type") {
                "ADDED" => '+',
                "REMOVED" => '-',
                "CONTEXT" => ' ',
                _ => {
                    incomplete = true;
                    break;
                }
            };
            incomplete |= segment["truncated"] == true;
            for row in segment["lines"].as_array().into_iter().flatten() {
                let text = value_text(row, "line");
                let old_mismatch =
                    marker != '+' && row["source"].as_u64().is_some_and(|line| line != old_line);
                let new_mismatch = marker != '-'
                    && row["destination"]
                        .as_u64()
                        .is_some_and(|line| line != new_line);
                if text.contains('\n') || old_mismatch || new_mismatch {
                    incomplete = true;
                    break 'segments;
                }
                old_line = old_line.saturating_add(u64::from(marker != '+'));
                new_line = new_line.saturating_add(u64::from(marker != '-'));
                let _ = writeln!(patch, "{marker}{text}");
                additions += u32::from(marker == '+');
                deletions += u32::from(marker == '-');
                incomplete |= row["truncated"] == true;
            }
        }
    }
    let mut file = FileChange::from_remote(&json!({"filename":meta.path,"previous_filename":meta.old,"status":meta.status,
        "additions":additions,"deletions":deletions,"patch":patch.trim_end_matches('\n'),"binary":diff["binary"]}),page)
        .ok_or_else(invalid_data)?;
    file.comparison_base = raw["fromHash"]
        .as_str()
        .or_else(|| diff["fromHash"].as_str())
        .filter(|hash| sha(hash))
        .map(str::to_owned);
    if incomplete && file.patch_status != "binary" {
        file.patch_status = "truncated".into();
    }
    Ok(file)
}

fn participant(raw: &Value) -> Option<Reviewer> {
    if raw["role"] != "REVIEWER" {
        return None;
    }
    Some(Reviewer {
        id: raw["user"]["id"].as_u64()?,
        login: login(&raw["user"]),
        state: match value_text(raw, "status") {
            "APPROVED" => "APPROVED",
            "NEEDS_WORK" => "CHANGES_REQUESTED",
            _ if raw["approved"] == true => "APPROVED",
            _ => "PENDING",
        }
        .into(),
        body: String::new(),
        submitted_at: date(raw, "lastReviewedDate"),
        revision: bounded(value_text(raw, "lastReviewedCommit"), 64),
    })
}

fn activity_event(item: &Value) -> Option<Value> {
    let label = match value_text(item, "action") {
        "APPROVED" => "Disetujui",
        "UNAPPROVED" => "Persetujuan ditarik",
        "NEEDS_WORK" => "Perubahan diminta",
        "REVIEWED" => "Direview",
        "RESCOPED" => "Revisi diperbarui",
        "REOPENED" => "Dibuka kembali",
        _ => return None,
    };
    Some(
        json!({"id":item["id"].as_u64()?,"label":label,"login":login(&item["user"]),"createdAt":date(item,"createdDate")}),
    )
}

fn activity_comments(activity: &Value) -> Vec<ReviewComment> {
    let anchor = activity
        .get("commentAnchor")
        .or_else(|| activity["comment"].get("anchor"))
        .unwrap_or(&Value::Null);
    let side = match value_text(anchor, "fileType") {
        "FROM" => Some("left"),
        "TO" => Some("right"),
        _ => None,
    };
    let revision = if value_text(anchor, "diffType") == "EFFECTIVE"
        && anchor["orphaned"] != true
        && activity["comment"]["anchored"] != false
    {
        bounded(value_text(anchor, "toHash"), 64)
    } else {
        String::new()
    };
    let original_revision = bounded(value_text(anchor, "toHash"), 64);
    let mut result = Vec::new();
    let mut comments = vec![&activity["comment"]];
    while let Some(comment) = comments.pop() {
        let Some(id) = comment["id"].as_u64() else {
            continue;
        };
        result.push(ReviewComment {
            id,
            login: login(&comment["author"]),
            body: bounded(value_text(comment, "text"), 4000),
            path: bounded(&path(&anchor["path"]), 4096),
            side,
            line: anchor["line"].as_u64(),
            start_line: None,
            start_side: None,
            revision: revision.clone(),
            original_revision: original_revision.clone(),
            created_at: date(comment, "createdDate"),
            comparison_base: anchor["fromHash"]
                .as_str()
                .filter(|hash| sha(hash))
                .map(str::to_owned),
        });
        if result.len() >= 50 {
            break;
        }
        if let Some(replies) = comment["comments"].as_array() {
            comments.extend(replies.iter().take(50).rev());
        }
    }
    result
}

fn build(raw: &Value, head: &str) -> Option<Check> {
    let key = value_text(raw, "key");
    if key.is_empty() {
        return None;
    }
    let label = value_text(raw, "name");
    Some(Check {
        id: 0,
        key: Some(bounded(key, 256)),
        name: bounded(if label.is_empty() { key } else { label }, 256),
        status: match value_text(raw, "state") {
            "SUCCESSFUL" => "success",
            "FAILED" => "failure",
            "INPROGRESS" => "pending",
            "CANCELLED" => "neutral",
            _ => "unavailable",
        },
        detail: bounded(value_text(raw, "description"), 400),
        revision: head.to_owned(),
        source: "status",
    })
}
