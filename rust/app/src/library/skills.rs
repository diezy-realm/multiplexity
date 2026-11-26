use crate::{ApiResult, AppError, AppState, User, ai::context::SKILLS, core};
use axum::{
    Extension, Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

const INACTIVE: &str = ".inactive-skills/";

pub fn router() -> Router<AppState> {
    Router::new().route("/api/library/skills", get(list)).route(
        "/api/library/skill",
        get(detail).patch(update).delete(remove),
    )
}

#[derive(Deserialize)]
struct SkillQuery {
    id: String,
}

#[derive(Deserialize)]
struct SkillUpdate {
    id: String,
    enabled: Option<bool>,
    content: Option<String>,
    hash: Option<String>,
}

fn builtin(id: &str) -> Option<&'static str> {
    SKILLS
        .iter()
        .find_map(|(key, prompt)| (*key == id).then_some(*prompt))
}

fn custom(id: &str) -> Option<&str> {
    id.strip_prefix("skills/").filter(|name| {
        !name.is_empty()
            && name.to_ascii_lowercase().ends_with(".md")
            && !name
                .split('/')
                .any(|part| part.is_empty() || part.starts_with('.'))
            && (!name.contains('/')
                || name
                    .rsplit('/')
                    .next()
                    .is_some_and(|file| file.eq_ignore_ascii_case("SKILL.md")))
    })
}

pub(crate) fn is_workspace_skill(id: &str) -> bool {
    custom(id).is_some()
}

fn state_rows(state: &AppState, user: &str) -> Result<BTreeMap<String, Value>, AppError> {
    Ok(state
        .db
        .query(
            "SELECT id,enabled,content,deleted FROM library_skill_state WHERE user_id=?",
            &[json!(user)],
        )?
        .into_iter()
        .filter_map(|row| Some((row["id"].as_str()?.to_owned(), row)))
        .collect())
}

fn set_builtin(
    state: &AppState,
    user: &str,
    id: &str,
    enabled: bool,
    content: &str,
    deleted: bool,
) -> Result<(), AppError> {
    state.db.execute("INSERT INTO library_skill_state(user_id,id,enabled,content,deleted) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id,id) DO UPDATE SET enabled=excluded.enabled,content=excluded.content,deleted=excluded.deleted",
        &[json!(user),json!(id),json!(i64::from(enabled)),json!(content),json!(i64::from(deleted))])?;
    Ok(())
}

fn walk(root: &Path, prefix: &str, depth: usize, files: &mut Vec<String>) -> Result<(), AppError> {
    let fail = |_| AppError::internal("Direktori skill tidak dapat dibaca.");
    for entry in std::fs::read_dir(root).map_err(fail)? {
        let entry = entry.map_err(fail)?;
        let file = entry.file_name().to_string_lossy().into_owned();
        if file.starts_with('.') {
            continue;
        }
        let meta = entry.file_type().map_err(fail)?;
        if core::is_link(&entry.metadata().map_err(fail)?) || meta.is_symlink() {
            continue;
        }
        let name = format!("{prefix}{file}");
        if meta.is_dir() && depth < 4 {
            walk(&entry.path(), &format!("{name}/"), depth + 1, files)?;
        } else if meta.is_file() && custom(&format!("skills/{name}")).is_some() {
            files.push(name);
        }
    }
    Ok(())
}

fn entries(state: &AppState, user: &str) -> Result<BTreeMap<String, bool>, AppError> {
    let root = core::workspace_root(state, user)?;
    let mut entries = BTreeMap::new();
    for (directory, enabled) in [(".inactive-skills", false), ("skills", true)] {
        let mut files = Vec::new();
        walk(&root.join(directory), "", 0, &mut files)?;
        for name in files {
            entries.insert(format!("skills/{name}"), enabled);
        }
    }
    Ok(entries)
}

fn lookup(state: &AppState, user: &str, id: &str) -> Result<(String, bool), AppError> {
    let missing = || AppError::not_found("Skill tidak ditemukan.");
    if let Some(default) = builtin(id) {
        let row = state
            .db
            .one(
                "SELECT enabled,content,deleted FROM library_skill_state WHERE user_id=? AND id=?",
                &[json!(user), json!(id)],
            )?
            .unwrap_or(Value::Null);
        if row["deleted"] == 1 {
            return Err(missing());
        }
        return Ok((
            row["content"].as_str().unwrap_or(default).to_owned(),
            row["enabled"] != 0,
        ));
    }
    let name = custom(id).ok_or_else(missing)?;
    let active = core::workspace_file(state, user, id)?.is_file();
    let storage = if active {
        id.to_owned()
    } else {
        format!("{INACTIVE}{name}")
    };
    if !core::workspace_file(state, user, &storage)?.is_file() {
        return Err(missing());
    }
    Ok((core::read_workspace(state, user, &storage)?, active))
}

fn title(id: &str, content: &str) -> String {
    let name = content.lines().find_map(|line| {
        line.strip_prefix("name: ")
            .or_else(|| line.strip_prefix("# "))
    });
    name.filter(|name| !name.trim().is_empty())
        .unwrap_or(id.strip_prefix("skills/").unwrap_or(id))
        .trim_matches(['"', '\''])
        .chars()
        .take(100)
        .collect()
}

async fn list(State(state): State<AppState>, Extension(user): Extension<User>) -> ApiResult {
    let rows = state_rows(&state, &user.id)?;
    let mut skills=SKILLS.iter().filter_map(|(id,prompt)| {
        let row=rows.get(*id).unwrap_or(&Value::Null);
        (row["deleted"]!=1).then(||json!({"id":id,"name":title(id,row["content"].as_str().unwrap_or(prompt)),"enabled":row["enabled"]!=0,"source":"builtin"}))
    }).collect::<Vec<_>>();
    for (id, enabled) in entries(&state, &user.id)? {
        let name = id.strip_prefix("skills/").unwrap_or(&id);
        if core::workspace_file(
            &state,
            &user.id,
            &if enabled {
                id.clone()
            } else {
                format!("{INACTIVE}{name}")
            },
        )
        .is_err()
        {
            continue;
        }
        let display = lookup(&state, &user.id, &id)
            .map_or_else(|_| name.to_owned(), |(body, _)| title(&id, &body));
        skills.push(json!({"id":id,"name":display,"enabled":enabled,"source":"workspace"}));
    }
    Ok(Json(json!({"skills":skills})))
}

fn skill_detail(state: &AppState, user: &str, id: &str) -> ApiResult {
    let (content, enabled) = lookup(state, user, id)?;
    Ok(Json(
        json!({"id":id,"name":title(id,&content),"enabled":enabled,"source":if builtin(id).is_some() {"builtin"} else {"workspace"},
        "hash":core::content_hash(&content),"content":content}),
    ))
}

async fn detail(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(query): Query<SkillQuery>,
) -> ApiResult {
    skill_detail(&state, &user.id, &query.id)
}

fn check_hash(content: &str, hash: &str) -> Result<(), AppError> {
    if hash != core::content_hash(content) {
        return Err(AppError::new(
            StatusCode::CONFLICT,
            "Skill berubah. Muat ulang sebelum menyimpan.",
        ));
    }
    Ok(())
}

async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(input): Json<SkillUpdate>,
) -> ApiResult {
    let _guard = core::skill_mutation_lock()?;
    let (current, current_enabled) = lookup(&state, &user.id, &input.id)?;
    let enabled = input.enabled.unwrap_or(current_enabled);
    let content = input.content.as_deref().unwrap_or(&current);
    if input.content.is_some() {
        check_hash(&current, input.hash.as_deref().unwrap_or(""))?;
        if content.trim().is_empty() || content.len() > 512_000 {
            return Err(AppError::bad_request(
                "Isi skill kosong atau terlalu besar.",
            ));
        }
    }
    if builtin(&input.id).is_some() {
        set_builtin(&state, &user.id, &input.id, enabled, content, false)?;
    } else if let Some(name) = custom(&input.id) {
        let inactive = format!("{INACTIVE}{name}");
        let from = if current_enabled {
            &input.id
        } else {
            &inactive
        };
        if input.content.is_some() && enabled != current_enabled {
            return Err(AppError::bad_request(
                "Simpan isi dan ubah status secara terpisah.",
            ));
        }
        if input.content.is_some() {
            core::write_workspace(&state, &user.id, from, content, input.hash.as_deref())?;
        }
        if enabled != current_enabled {
            core::move_workspace_file(
                &state,
                &user.id,
                from,
                if enabled { &input.id } else { &inactive },
                None,
            )?;
        }
    }
    skill_detail(&state, &user.id, &input.id)
}

#[derive(Deserialize)]
struct DeleteQuery {
    id: String,
    hash: String,
}

async fn remove(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Query(query): Query<DeleteQuery>,
) -> ApiResult {
    let _guard = core::skill_mutation_lock()?;
    let (content, enabled) = lookup(&state, &user.id, &query.id)?;
    check_hash(&content, &query.hash)?;
    if let Some(name) = custom(&query.id) {
        let storage = if enabled {
            query.id.clone()
        } else {
            format!("{INACTIVE}{name}")
        };
        core::move_workspace_file(
            &state,
            &user.id,
            &storage,
            &format!(".deleted-skills/{}.md", uuid::Uuid::new_v4()),
            Some(&query.hash),
        )?;
    } else {
        set_builtin(&state, &user.id, &query.id, false, &content, true)?;
    }
    Ok(Json(json!({"deleted":true})))
}

pub(crate) fn selected_prompt(
    state: &AppState,
    user: &str,
    id: &str,
) -> Result<Option<String>, AppError> {
    if id.is_empty() {
        return Ok(None);
    }
    let (content, enabled) = lookup(state, user, id)?;
    if !enabled {
        return Err(AppError::bad_request("Skill ini dinonaktifkan di Library."));
    }
    Ok(Some(content.chars().take(8000).collect()))
}
