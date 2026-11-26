use super::models::*;
use crate::{AppError, AppState, core::content_hash};
use axum::http::StatusCode;
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::time::Duration;
use url::Url;

const MAX_RESPONSE: usize = 2 * 1024 * 1024;
const API_VERSION: &str = "2022-11-28";

pub(crate) fn base_url(input: &str) -> Result<Url, AppError> {
    let url = strict_url(input)?;
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::bad_request(
            "Masukkan origin HTTPS GitHub Enterprise tanpa path API.",
        ));
    }
    Ok(url)
}

pub(crate) fn tls_client(pem: &str) -> Result<reqwest::Client, AppError> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(12));
    if !pem.is_empty() {
        if pem.len() > 32 * 1024 || pem.contains("PRIVATE KEY") {
            return Err(AppError::bad_request(
                "CA harus berupa sertifikat PEM publik, maksimal 32 KB.",
            ));
        }
        let certificates = reqwest::Certificate::from_pem_bundle(pem.as_bytes())
            .map_err(|_| AppError::bad_request("Sertifikat CA PEM tidak valid."))?;
        if certificates.is_empty() {
            return Err(AppError::bad_request("Sertifikat CA PEM tidak valid."));
        }
        for certificate in certificates {
            builder = builder.add_root_certificate(certificate);
        }
    }
    builder
        .build()
        .map_err(|_| AppError::bad_request("Konfigurasi TLS konektor tidak valid."))
}

pub(super) fn profile_row(state: &AppState, user: &str) -> Result<Option<Value>, AppError> {
    let mut rows = state.db.query(
        "SELECT * FROM pilot_connectors WHERE user_id=? AND kind='ghes' AND enabled=1 ORDER BY id LIMIT 2",
        &[json!(user)],
    )?;
    if rows.len() > 1 {
        return Err(AppError::bad_request(
            "Aktifkan satu profil GitHub Enterprise di Settings.",
        ));
    }
    Ok(rows.pop())
}

pub(super) struct Ghes {
    pub id: String,
    pub base: Url,
    pub cache_key: String,
    token: String,
    client: reqwest::Client,
}

pub(super) struct Remote {
    pub body: Value,
    pub next: bool,
    pub version: String,
}

fn gh_error(status: StatusCode) -> AppError {
    let (code, message) = match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => (
            StatusCode::FORBIDDEN,
            "GitHub menolak akses. Periksa token dan izin baca repository.",
        ),
        StatusCode::NOT_FOUND => (
            StatusCode::NOT_FOUND,
            "Data GitHub tidak ditemukan atau berada di luar akses token.",
        ),
        StatusCode::TOO_MANY_REQUESTS => {
            (status, "Batas permintaan GitHub tercapai. Coba lagi nanti.")
        }
        status if status.is_redirection() => (
            StatusCode::BAD_GATEWAY,
            "Redirect GitHub ditolak. Gunakan origin profil kanonis.",
        ),
        _ => (
            StatusCode::BAD_GATEWAY,
            "Bagian ini gagal dimuat dari GitHub Enterprise.",
        ),
    };
    AppError::new(code, message)
}

fn transport(error: reqwest::Error) -> AppError {
    // Certificate errors represent a bad connection configuration, not an offline fallback.
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        let reason = cause.to_string().to_ascii_lowercase();
        if reason.contains("certificate") || reason.contains("tls") {
            return AppError::new(
                StatusCode::BAD_GATEWAY,
                "Verifikasi TLS GitHub gagal. Periksa CA perusahaan di Settings.",
            );
        }
        source = cause.source();
    }
    AppError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "GitHub tidak dapat dijangkau.",
    )
}

impl Ghes {
    #[cfg(test)]
    pub(super) fn fixture(base: Url) -> Self {
        Self {
            id: "test".into(),
            cache_key: "test-config".into(),
            base,
            token: "fixture-read-only".into(),
            client: tls_client("").unwrap(),
        }
    }

    pub fn load(state: &AppState, user: &str) -> Result<Self, AppError> {
        let row = profile_row(state, user)?.ok_or_else(|| {
            AppError::bad_request("Siapkan profil GitHub Enterprise di Settings.")
        })?;
        Self::from_row(state, &row)
    }

    fn from_row(state: &AppState, row: &Value) -> Result<Self, AppError> {
        if row["insecure_tls"].as_i64() != Some(0) || row["auth_type"] != "bearer" {
            return Err(AppError::bad_request(
                "Profil GitHub Enterprise memerlukan TLS terverifikasi dan token Bearer.",
            ));
        }
        let base = base_url(value_text(row, "base_url"))?;
        let ct = value_text(row, "token_encrypted");
        let iv = value_text(row, "token_iv");
        let ca = value_text(row, "ghes_ca_pem");
        let id = value_text(row, "id");
        Ok(Self {
            id: id.to_owned(),
            cache_key: content_hash(&format!("{id}\n{base}\n{ct}\n{iv}\n{ca}")),
            base,
            token: state
                .db
                .decrypt(ct, iv, value_text(row, "token_auth_tag"))?,
            client: tls_client(ca)?,
        })
    }

    pub async fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Remote, AppError> {
        let mut url = self.base.clone();
        url.set_path(&format!("/api/v3{path}"));
        let mut response = self
            .client
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Multiplexity/0.3")
            .header("X-GitHub-Api-Version", API_VERSION)
            .bearer_auth(&self.token)
            .query(query)
            .send()
            .await
            .map_err(transport)?;
        if !response.status().is_success() {
            return Err(gh_error(response.status()));
        }
        let next = response
            .headers()
            .get_all("link")
            .iter()
            .filter_map(|line| line.to_str().ok())
            .any(|links| {
                links
                    .split(',')
                    .any(|link| link.split(';').any(|v| v.trim() == "rel=\"next\""))
            });
        let version = bounded(
            response
                .headers()
                .get("x-github-enterprise-version")
                .and_then(|value| value.to_str().ok())
                .unwrap_or(""),
            64,
        );
        let too_large = || {
            AppError::new(
                StatusCode::BAD_GATEWAY,
                "Respons GitHub melebihi batas 2 MiB.",
            )
        };
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE as u64)
        {
            return Err(too_large());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(transport)? {
            if bytes.len() + chunk.len() > MAX_RESPONSE {
                return Err(too_large());
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = serde_json::from_slice(&bytes).map_err(|_| {
            AppError::new(
                StatusCode::BAD_GATEWAY,
                "Respons GitHub bukan JSON yang valid.",
            )
        })?;
        Ok(Remote {
            body,
            next,
            version,
        })
    }

    pub async fn page(&self, path: &str, page: u32) -> Result<Remote, AppError> {
        self.get(
            path,
            &[
                ("per_page", &PAGE_SIZE.to_string()),
                ("page", &page.to_string()),
            ],
        )
        .await
    }

    pub async fn pull(&self, reference: PullRef) -> Result<Pull, AppError> {
        let raw = self.get(&reference.api_path(), &[]).await?;
        Pull::from_remote(reference, &self.id, &self.base, &raw.body)
    }

    pub async fn queue(&self, page: u32) -> Result<Value, AppError> {
        let user = self.get("/user", &[]).await?;
        let login = value_text(&user.body, "login");
        if !search_slug(login) {
            return Err(AppError::new(
                StatusCode::BAD_GATEWAY,
                "Identitas akun GitHub tidak tersedia.",
            ));
        }
        let author_query = format!("author:{login}");
        let reviewer_query = format!("review-requested:{login}");
        let (authored, requested, teams) = tokio::join!(
            self.search(&author_query, "mine", page),
            self.search(&reviewer_query, "requested", page),
            self.get("/user/teams", &[("per_page", "3")]),
        );
        let mut items = Vec::new();
        let mut errors = Vec::new();
        let mut next = false;
        let mut incomplete = false;
        for (group, result) in [("mine", authored), ("requested", requested)] {
            append_group(
                result,
                group,
                &mut items,
                &mut errors,
                &mut next,
                &mut incomplete,
            )?;
        }
        let (team_scope, team_count) = if let Ok(teams) = teams {
            let team_names: Vec<_> = teams
                .body
                .as_array()
                .into_iter()
                .flatten()
                .take(3)
                .filter_map(|team| {
                    let org = value_text(&team["organization"], "login");
                    let slug = value_text(team, "slug");
                    (search_slug(org) && search_slug(slug)).then(|| format!("{org}/{slug}"))
                })
                .collect();
            let team_count = team_names.len();
            let results =
                futures_util::stream::iter(team_names.into_iter().map(|team| async move {
                    self.search(&format!("team-review-requested:{team}"), "team", page)
                        .await
                }))
                .buffer_unordered(3);
            tokio::pin!(results);
            while let Some(result) = results.next().await {
                append_group(
                    result,
                    "team",
                    &mut items,
                    &mut errors,
                    &mut next,
                    &mut incomplete,
                )?;
            }
            (teams.next, team_count)
        } else {
            (false, 0)
        };
        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(
            json!({"items": items, "login": login, "nextPage": next_page(next, page),
            "groupErrors": errors, "partial": incomplete || (next && page == MAX_PAGE),
            "teamCount": team_count, "teamScopeLimited": team_scope}),
        )
    }

    async fn search(
        &self,
        qualifier: &str,
        group: &'static str,
        page: u32,
    ) -> Result<(Vec<QueueItem>, bool, bool), AppError> {
        let result = self
            .get(
                "/search/issues",
                &[
                    ("q", &format!("is:pull-request is:open {qualifier}")),
                    ("sort", "updated"),
                    ("order", "desc"),
                    ("per_page", &PAGE_SIZE.to_string()),
                    ("page", &page.to_string()),
                ],
            )
            .await?;
        let mut items = Vec::new();
        for raw in array(&result.body["items"])? {
            if let Ok(reference) = PullRef::from_url(&self.base, value_text(raw, "html_url")) {
                items.push(QueueItem {
                    reference,
                    title: bounded(value_text(raw, "title"), 512),
                    author: bounded(value_text(&raw["user"], "login"), 100),
                    updated_at: bounded(value_text(raw, "updated_at"), 40),
                    group,
                    draft: raw["draft"].as_bool() == Some(true),
                });
            }
        }
        Ok((
            items,
            result.next,
            result.body["incomplete_results"] == true,
        ))
    }
}

fn search_slug(input: &str) -> bool {
    !input.is_empty()
        && input.len() <= 100
        && input
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn append_group(
    result: Result<(Vec<QueueItem>, bool, bool), AppError>,
    group: &str,
    items: &mut Vec<QueueItem>,
    errors: &mut Vec<Value>,
    next: &mut bool,
    incomplete: &mut bool,
) -> Result<(), AppError> {
    match result {
        Ok((list, more, partial)) => {
            items.extend(list);
            *next |= more;
            *incomplete |= partial;
        }
        Err(error) if error.status == StatusCode::SERVICE_UNAVAILABLE => return Err(error),
        Err(error) => errors.push(json!({"group": group, "message": error.message})),
    }
    Ok(())
}

pub(super) fn next_page(next: bool, page: u32) -> Option<u32> {
    (next && page < MAX_PAGE).then(|| page + 1)
}

pub(super) fn array(value: &Value) -> Result<&Vec<Value>, AppError> {
    value
        .as_array()
        .ok_or_else(|| AppError::new(StatusCode::BAD_GATEWAY, "Daftar dari GitHub tidak valid."))
}

pub(crate) async fn probe(state: &AppState, row: &Value) -> Result<String, AppError> {
    let github = Ghes::from_row(state, row)?;
    let (meta, actor) = tokio::try_join!(github.get("/meta", &[]), github.get("/user", &[]))?;
    let version = [
        value_text(&meta.body, "installed_version"),
        &meta.version,
        &actor.version,
    ]
    .into_iter()
    .find(|version| !version.is_empty())
    .unwrap_or_default()
    .trim_start_matches("enterprise-server@");
    if version.is_empty() || !search_slug(value_text(&actor.body, "login")) {
        return Err(AppError::bad_request(
            "Instans GitHub Enterprise dan identitas token tidak dapat diverifikasi.",
        ));
    }
    Ok(bounded(version, 64))
}

pub(super) fn with_cache(
    state: &AppState,
    user: &str,
    profile_key: &str,
    section: &str,
    result: Result<Value, AppError>,
) -> Result<Value, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let key = json!(profile_key);
    let values = [json!(user), key.clone(), json!(section)];
    match result {
        Ok(mut data) => {
            let enc = state.db.encrypt(&data.to_string())?;
            state.db.execute(
                "INSERT INTO scm_cache VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,profile_key,section_key)
                 DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,updated_at=excluded.updated_at",
                &[values[0].clone(), key, values[2].clone(), json!(enc.ciphertext), json!(enc.iv), json!(enc.auth_tag), json!(now)],
            )?;
            state.db.execute(
                "DELETE FROM scm_cache WHERE user_id=? AND rowid NOT IN
                 (SELECT rowid FROM scm_cache WHERE user_id=? ORDER BY updated_at DESC, rowid DESC LIMIT 32)",
                &[json!(user), json!(user)],
            )?;
            data["stale"] = json!(false);
            Ok(data)
        }
        Err(error) if error.status == StatusCode::SERVICE_UNAVAILABLE => {
            let row = state.db.one(
                "SELECT * FROM scm_cache WHERE user_id=? AND profile_key=? AND section_key=? AND updated_at>?",
                &[values[0].clone(), values[1].clone(), values[2].clone(), json!(now - 86_400_000)],
            )?.ok_or(error)?;
            let decrypted = state.db.decrypt(
                value_text(&row, "ciphertext"),
                value_text(&row, "iv"),
                value_text(&row, "auth_tag"),
            )?;
            let mut data: Value = serde_json::from_str(&decrypted)
                .map_err(|_| AppError::internal("Cache GitHub tidak valid."))?;
            data["stale"] = json!(true);
            data["cachedAt"] = json!(row["updated_at"]);
            Ok(data)
        }
        Err(error) => {
            if matches!(error.status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND) {
                if section
                    .strip_prefix("pr:")
                    .is_some_and(|key| !key.contains(':'))
                {
                    state.db.execute(
                        "DELETE FROM scm_cache WHERE user_id=? AND profile_key=? AND
                          (section_key=? OR instr(section_key, ? || ':')=1 OR instr(section_key, 'queue:')=1)",
                        &[values[0].clone(), values[1].clone(), values[2].clone(), values[2].clone()],
                    )?;
                } else {
                    state.db.execute(
                        "DELETE FROM scm_cache WHERE user_id=? AND profile_key=? AND section_key=?",
                        &values,
                    )?;
                }
            }
            Err(error)
        }
    }
}
