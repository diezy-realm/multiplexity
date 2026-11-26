use super::{Scm, ScmKind, Section, fixture, models::*, require_revision};
use crate::{ApiResult, AppError, AppState, User, ai, core::content_hash, pilot::policies};
use axum::{Extension, Json, extract::State, http::StatusCode, response::Response};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Default)]
pub(crate) struct Previews(Mutex<HashMap<String, Pending>>);

struct Pending {
    id: Uuid,
    created: Instant,
    reference: PullRef,
    fixture: bool,
    provider: ScmKind,
    head: String,
    base: String,
    profile: String,
    provider_fingerprint: String,
    policy_fingerprint: String,
    input: String,
    source: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreviewInput {
    reference: PullRef,
    fixture: bool,
    #[serde(default)]
    provider: ScmKind,
    profile_id: Option<String>,
    comparison_base: Option<String>,
    path: String,
    page: u32,
    head_sha: String,
    base_sha: String,
    side: DiffSide,
    start: u32,
    end: u32,
    question: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum DiffSide {
    Left,
    Right,
}

impl DiffSide {
    fn name(&self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
        }
    }

    fn line(&self, row: &DiffRow<'_>) -> Option<u32> {
        match self {
            Self::Left => row.old,
            Self::Right => row.new,
        }
    }
}

fn target(state: &AppState) -> Result<(ai::settings::Connection, String, String), AppError> {
    let provider = ai::settings::active(state)?;
    if ai::settings::is_cli(&provider) {
        return Err(AppError::bad_request(
            "Pilih provider API di Settings → AI Provider untuk review dengan bukti terpilih.",
        ));
    }
    let connection = ai::settings::connection(state, &provider)?;
    connection.check_enabled(&connection.model)?;
    if connection.model.is_empty()
        || ai::settings::needs_key(&provider) && connection.key.is_empty()
    {
        return Err(AppError::bad_request(
            "Lengkapi model dan kredensial di Settings → AI Provider.",
        ));
    }
    let destination = match provider.as_str() {
        "openai" => "https://api.openai.com/v1/responses".to_owned(),
        "claude" => "https://api.anthropic.com/v1/messages".to_owned(),
        _ if !connection.endpoint.is_empty() => format!(
            "{}/chat/completions",
            connection.endpoint.trim_end_matches('/')
        ),
        _ => {
            return Err(AppError::bad_request(
                "Atur endpoint di Settings → AI Provider.",
            ));
        }
    };
    ai::settings::validate_endpoint(&destination)?;
    let fingerprint =
        content_hash(&json!([provider, connection.model, destination, connection.key]).to_string());
    Ok((connection, destination, fingerprint))
}

fn expired() -> AppError {
    AppError::new(
        StatusCode::CONFLICT,
        "Preview kedaluwarsa atau sudah dipakai. Tinjau kembali sumber sebelum mengirim.",
    )
}

pub(super) async fn preview(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<PreviewInput>,
) -> ApiResult {
    let reference = input.reference.validate()?;
    let question = input.question.trim();
    if !(1..=input.provider.max_cursor()).contains(&input.page)
        || input.path.is_empty()
        || input.path.len() > 4096
        || input.start == 0
        || input.end < input.start
        || input.end - input.start >= 40
        || question.is_empty()
        || question.chars().count() > 800
        || !sha(&input.head_sha)
        || !sha(&input.base_sha)
    {
        return Err(AppError::bad_request(
            "Pilih 1–40 baris pada satu sisi diff dan tulis pertanyaan (maksimal 800 karakter).",
        ));
    }
    let (destination, provider_fingerprint) = if input.fixture {
        (
            json!({"provider":"Simulator lokal","model":"Fixture sintetis","endpoint":null}),
            String::new(),
        )
    } else {
        let (connection, endpoint, fingerprint) = target(&state)?;
        (
            json!({"provider":connection.provider,"model":connection.model,"endpoint":endpoint}),
            fingerprint,
        )
    };
    let (pull, profile, files) = if input.fixture {
        let pull = fixture::pull(reference.clone())?;
        require_revision(&pull, &input.head_sha, &input.base_sha)?;
        (
            pull,
            String::new(),
            fixture::section(Section::Files, input.page),
        )
    } else {
        let scm = Scm::load(&state, &user.id, input.provider)?;
        if input.profile_id.as_deref().is_some_and(|id| id != scm.id()) {
            return Err(expired());
        }
        let pull = scm.pull(reference.clone()).await?;
        require_revision(&pull, &input.head_sha, &input.base_sha)?;
        let files = match &scm {
            Scm::Bitbucket(client) => {
                json!({"items":[client.selected_file(&reference, &input.path, input.page, &input.head_sha, &input.base_sha).await?]})
            }
            Scm::Ghes(_) => {
                scm.read(
                    Section::Files,
                    reference.clone(),
                    &input.head_sha,
                    &input.base_sha,
                    input.page,
                )
                .await?
            }
        };
        (pull, scm.cache_key().to_owned(), files)
    };
    let file = files["items"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|file| file["path"] == input.path)
        .ok_or_else(|| AppError::bad_request("File yang dipilih tidak tersedia."))?;
    let patch = file["patch"]
        .as_str()
        .ok_or_else(|| AppError::bad_request("Patch untuk file yang dipilih tidak tersedia."))?;
    let comparison_base = file["comparisonBase"].as_str();
    if input
        .comparison_base
        .as_deref()
        .is_some_and(|sha| Some(sha) != comparison_base)
    {
        return Err(expired());
    }
    let redact = |text| policies::redact_for_user(&state, &user.id, text);
    let selected: Vec<_> = diff_rows(patch)
        .into_iter()
        .filter_map(|row| input.side.line(&row).map(|line| (row, line)))
        .filter(|(_, line)| (input.start..=input.end).contains(line))
        .collect();
    if selected
        .iter()
        .map(|(_, line)| *line)
        .ne(input.start..=input.end)
    {
        return Err(AppError::bad_request(
            "Rentang pilihan memuat baris di luar patch yang tersedia.",
        ));
    }
    let lines: Vec<_> = selected
        .into_iter()
        .map(|(row, line)| json!({"line":line,"kind":row.marker,"text":redact(row.text)}))
        .collect();
    let source = json!({"reference":reference, "headSha":input.head_sha, "baseSha":input.base_sha,
        "profileId":pull.profile_id, "provider":input.provider.name(), "comparisonBase":comparison_base, "fetchedAt":pull.fetched_at, "path":input.path, "page":input.page,
        "side":input.side.name(), "start":input.start, "end":input.end});
    let data = json!({"repository":format!("{}/{}", redact(&reference.owner), redact(&reference.repo)),
        "number":reference.number, "headSha":input.head_sha, "baseSha":input.base_sha, "comparisonBase":comparison_base,
        "path":redact(&input.path), "side":input.side.name(), "start":input.start, "end":input.end, "lines":lines});
    let payload = serde_json::to_string_pretty(&json!({"question":redact(question),"source":data}))
        .map_err(|_| AppError::internal("Payload review tidak dapat disiapkan."))?;
    let policy = policies::load_policy(&state, &user.id)?;
    let max = policy["maxAiPayloadChars"]
        .as_u64()
        .unwrap_or(32_000)
        .min(12_000) as usize;
    if payload.chars().count() > max {
        return Err(AppError::bad_request(
            "Bukti melampaui batas pengiriman. Pendekkan pertanyaan atau pilih lebih sedikit baris.",
        ));
    }
    let id = Uuid::new_v4();
    let now = Instant::now();
    let mut previews = state
        .review_previews
        .0
        .lock()
        .map_err(|_| AppError::internal("Preview review tidak tersedia."))?;
    previews.retain(|_, value| now.duration_since(value.created) < Duration::from_secs(300));
    if previews.len() >= 64 && !previews.contains_key(&user.id) {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "Terlalu banyak preview aktif. Coba lagi nanti.",
        ));
    }
    previews.insert(
        user.id,
        Pending {
            id,
            created: now,
            reference,
            fixture: input.fixture,
            provider: input.provider,
            head: input.head_sha,
            base: input.base_sha,
            profile,
            provider_fingerprint,
            policy_fingerprint: content_hash(&policy.to_string()),
            input: payload.clone(),
            source: source.clone(),
        },
    );
    Ok(Json(
        json!({"id":id.to_string(),"destination":destination,"payload":payload,"source":source}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReviewInput {
    preview_id: String,
}

pub(super) async fn analyze(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<ReviewInput>,
) -> Result<Response, AppError> {
    let pending = {
        let mut previews = state
            .review_previews
            .0
            .lock()
            .map_err(|_| AppError::internal("Preview review tidak tersedia."))?;
        let id = Uuid::parse_str(&input.preview_id).map_err(|_| expired())?;
        if !previews.get(&user.id).is_some_and(|value| {
            value.id == id && value.created.elapsed() < Duration::from_secs(300)
        }) {
            return Err(expired());
        }
        previews.remove(&user.id).ok_or_else(expired)?
    };
    if content_hash(&policies::load_policy(&state, &user.id)?.to_string())
        != pending.policy_fingerprint
    {
        return Err(expired());
    }
    let (connection, endpoint) = if pending.fixture {
        (None, String::new())
    } else {
        let github = Scm::load(&state, &user.id, pending.provider)?;
        let (connection, endpoint, fingerprint) = target(&state)?;
        if github.cache_key() != pending.profile || fingerprint != pending.provider_fingerprint {
            return Err(expired());
        }
        require_revision(
            &github.pull(pending.reference).await?,
            &pending.head,
            &pending.base,
        )?;
        (Some(connection), endpoint)
    };
    ai::review_stream(
        &state,
        &user.id,
        connection,
        endpoint,
        pending.input,
        pending.source,
    )
}
