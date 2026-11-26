use crate::{ApiResult, AppError, AppState, User};
use axum::{Extension, Json, extract::State};
use serde_json::{Value, json};
use std::{
    path::{Component, Path, PathBuf},
    process::Command,
};

fn run_git(repo: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|_| AppError::internal("Gagal menjalankan perintah git."))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::bad_request(format!(
            "Perintah git gagal: {}",
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn validate_repo_root(raw_path: &str) -> Result<PathBuf, AppError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("Path checkout Git wajib diisi."));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_dir() {
        return Err(AppError::bad_request("Direktori checkout tidak ditemukan."));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| AppError::bad_request("Direktori checkout tidak dapat diakses."))?;
    let inside = run_git(&canonical, &["rev-parse", "--is-inside-work-tree"])?;
    if inside != "true" {
        return Err(AppError::bad_request("Direktori bukan repository Git."));
    }
    Ok(canonical)
}

fn resolve_safe_file(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let rel = Path::new(relative.trim());
    if relative.trim().is_empty() || rel.is_absolute() {
        return Err(AppError::bad_request(
            "Path file patch harus relatif terhadap root repo.",
        ));
    }
    for comp in rel.components() {
        if matches!(comp, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err(AppError::bad_request(
                "Path file di luar root repo ditolak.",
            ));
        }
    }
    let candidate = root.join(rel);
    if let Ok(meta) = std::fs::symlink_metadata(&candidate)
        && meta.file_type().is_symlink()
    {
        let target = candidate
            .canonicalize()
            .map_err(|_| AppError::bad_request("Symlink tidak dapat diselesaikan."))?;
        if !target.starts_with(root) {
            return Err(AppError::bad_request(
                "Symlink yang keluar dari root repo ditolak.",
            ));
        }
    }
    if let Some(parent) = candidate.parent() {
        let mut cursor = Some(parent);
        while let Some(dir) = cursor {
            if dir == root {
                break;
            }
            if let Ok(meta) = std::fs::symlink_metadata(dir)
                && meta.file_type().is_symlink()
            {
                let resolved = dir
                    .canonicalize()
                    .map_err(|_| AppError::bad_request("Symlink direktori tidak valid."))?;
                if !resolved.starts_with(root) {
                    return Err(AppError::bad_request(
                        "Symlink direktori keluar dari root repo ditolak.",
                    ));
                }
            }
            cursor = dir.parent();
        }
    }
    Ok(candidate)
}

type ValidatedPatch = (String, PathBuf, String);

fn validate_patches(root: &Path, body: &Value) -> Result<(String, Vec<ValidatedPatch>), AppError> {
    let head = run_git(root, &["rev-parse", "HEAD"])?;
    if let Some(expected) = body.get("expectedHead").and_then(Value::as_str) {
        let exp = expected.trim();
        if !exp.is_empty() && exp != head {
            return Err(AppError::new(
                axum::http::StatusCode::CONFLICT,
                format!("Patch basi: HEAD saat ini {head}, bukan {exp}."),
            ));
        }
    }
    let dirty_output = run_git(root, &["status", "--porcelain"])?;
    let dirty_files: Vec<String> = dirty_output
        .lines()
        .filter_map(|line| line.get(3..).map(|s| s.trim().replace('\\', "/")))
        .collect();
    let files = body
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::bad_request("Daftar perubahan per file wajib diisi."))?;
    if files.is_empty() {
        return Err(AppError::bad_request("Minimal satu file perubahan diperlukan."));
    }
    let mut validated = Vec::with_capacity(files.len());
    for entry in files {
        let rel = entry
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::bad_request("Path file patch tidak valid."))?;
        let norm_rel = rel.trim().replace('\\', "/");
        if dirty_files.iter().any(|d| d == &norm_rel) {
            return Err(AppError::new(
                axum::http::StatusCode::CONFLICT,
                format!("Konflik dengan perubahan lokal pada {norm_rel}."),
            ));
        }
        let content = entry
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::bad_request("Isi file patch wajib berupa teks."))?;
        let full = resolve_safe_file(root, &norm_rel)?;
        validated.push((norm_rel, full, content.to_owned()));
    }
    Ok((head, validated))
}

pub async fn inspect_repo(
    State(_state): State<AppState>,
    Extension(_user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let raw = body
        .get("repoPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    tokio::task::spawn_blocking(move || {
        let root = validate_repo_root(&raw)?;
        let branch = run_git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        let head = run_git(&root, &["rev-parse", "HEAD"])?;
        let status = run_git(&root, &["status", "--porcelain"])?;
        let dirty: Vec<&str> = status.lines().filter(|l| !l.trim().is_empty()).collect();
        Ok(Json(json!({
            "repoPath": root.to_string_lossy(),
            "branch": branch,
            "head": head,
            "dirtyFiles": dirty,
        })))
    })
    .await
    .map_err(|_| AppError::internal("Gagal memeriksa repository."))?
}

pub(crate) async fn verify_review_checkout(raw: String, expected_remote: String, expected_head: String) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        let root = validate_repo_root(&raw)?;
        let git_root = run_git(&root, &["rev-parse", "--show-toplevel"])?;
        if !std::fs::canonicalize(git_root).is_ok_and(|path| path == root) {
            return Err(AppError::bad_request("Gunakan direktori root checkout Git."));
        }
        let remote = run_git(&root, &["remote", "get-url", "origin"])
            .map_err(|_| AppError::bad_request("Remote origin checkout tidak tersedia."))?;
        let actual = url::Url::parse(&remote).ok().filter(|url| url.scheme() == "https"
            && url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none());
        let expected = url::Url::parse(&expected_remote).map_err(|_| AppError::internal("Origin PR tidak valid."))?;
        if !actual.is_some_and(|url| {
            let path = url.path().trim_end_matches('/');
            url.origin() == expected.origin()
                && path.strip_suffix(".git").unwrap_or(path).eq_ignore_ascii_case(expected.path())
        }) {
            return Err(AppError::bad_request("Remote origin HTTPS checkout berbeda dari repository PR."));
        }
        let head = run_git(&root, &["rev-parse", "HEAD"])?;
        if head != expected_head {
            return Err(AppError::new(axum::http::StatusCode::CONFLICT, "HEAD checkout berbeda dari head SHA PR."));
        }
        Ok(root.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| AppError::internal("Gagal memeriksa checkout Code Review."))?
}

pub async fn preview_patch(
    State(_state): State<AppState>,
    Extension(_user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let raw = body
        .get("repoPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    tokio::task::spawn_blocking(move || {
        let root = validate_repo_root(&raw)?;
        let (head, files) = validate_patches(&root, &body)?;
        let items: Vec<Value> = files
            .iter()
            .map(|(rel, full, after)| {
                let before = std::fs::read_to_string(full).unwrap_or_default();
                json!({ "path": rel, "before": before, "after": after })
            })
            .collect();
        Ok(Json(json!({
            "repoPath": root.to_string_lossy(),
            "head": head,
            "files": items,
        })))
    })
    .await
    .map_err(|_| AppError::internal("Gagal memvalidasi patch."))?
}

pub async fn apply_patch(
    State(_state): State<AppState>,
    Extension(_user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let raw = body
        .get("repoPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    tokio::task::spawn_blocking(move || {
        let root = validate_repo_root(&raw)?;
        let (head, files) = validate_patches(&root, &body)?;
        let mut backups: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::with_capacity(files.len());
        for (_, full, _) in &files {
            let prev = std::fs::read(full).ok();
            backups.push((full.clone(), prev));
        }
        for (_, full, content) in &files {
            if let Some(parent) = full.parent()
                && let Err(err) = std::fs::create_dir_all(parent)
            {
                rollback_backups(&backups);
                return Err(AppError::internal(format!("Gagal membuat direktori: {err}")));
            }
            if let Err(err) = std::fs::write(full, content.as_bytes()) {
                rollback_backups(&backups);
                return Err(AppError::internal(format!("Apply gagal dan dipulihkan: {err}")));
            }
        }
        let paths: Vec<&str> = files.iter().map(|(rel, _, _)| rel.as_str()).collect();
        let diff = run_git(&root, &["diff", "--"])?;
        let undo = format!("git checkout -- {}", paths.join(" "));
        Ok(Json(json!({
            "repoPath": root.to_string_lossy(),
            "head": head,
            "appliedFiles": paths,
            "actualDiff": diff,
            "undoCommand": undo,
        })))
    })
    .await
    .map_err(|_| AppError::internal("Gagal menerapkan patch."))?
}

pub async fn undo_patch(
    State(_state): State<AppState>,
    Extension(_user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let raw = body
        .get("repoPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    tokio::task::spawn_blocking(move || {
        let root = validate_repo_root(&raw)?;
        let paths_val = body
            .get("paths")
            .and_then(Value::as_array)
            .ok_or_else(|| AppError::bad_request("Daftar path untuk undo wajib diisi."))?;
        let mut restored = Vec::new();
        for entry in paths_val {
            let rel = entry
                .as_str()
                .ok_or_else(|| AppError::bad_request("Path tidak valid."))?;
            let _ = resolve_safe_file(&root, rel)?;
            let _ = run_git(&root, &["checkout", "--", rel])?;
            restored.push(rel.to_owned());
        }
        Ok(Json(json!({ "restored": restored })))
    })
    .await
    .map_err(|_| AppError::internal("Gagal melakukan undo patch."))?
}

fn rollback_backups(backups: &[(PathBuf, Option<Vec<u8>>)]) {
    for (path, prev) in backups {
        match prev {
            Some(bytes) => {
                let _ = std::fs::write(path, bytes);
            }
            None => {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn validate_diff_paths(root: &Path, diff_text: &str) -> Result<Vec<String>, AppError> {
    if diff_text.trim().is_empty() || diff_text.len() > 2 * 1024 * 1024 {
        return Err(AppError::bad_request("Unified diff kosong atau terlalu besar."));
    }
    let mut paths = Vec::new();
    for line in diff_text.lines() {
        if let Some(rest) = line.strip_prefix("+++ ").or_else(|| line.strip_prefix("--- ")) {
            let trimmed = rest.trim();
            if trimmed == "/dev/null" {
                continue;
            }
            let rel = trimmed
                .strip_prefix("a/")
                .or_else(|| trimmed.strip_prefix("b/"))
                .unwrap_or(trimmed);
            let _ = resolve_safe_file(root, rel)?;
            if !paths.iter().any(|p| p == rel) {
                paths.push(rel.to_owned());
            }
        }
    }
    if paths.is_empty() {
        return Err(AppError::bad_request(
            "Unified diff tidak memuat target file yang valid.",
        ));
    }
    Ok(paths)
}

fn run_git_with_stdin(repo: &Path, args: &[&str], stdin_bytes: &[u8]) -> Result<String, AppError> {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| AppError::internal("Gagal menjalankan perintah git."))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(stdin_bytes);
    }
    let output = child
        .wait_with_output()
        .map_err(|_| AppError::internal("Gagal membaca keluaran git."))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::bad_request(format!(
            "git apply gagal: {}",
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

pub async fn worktree_check(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let raw = body
        .get("repoPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let diff_text = body
        .get("diffText")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let expected_head = body
        .get("expectedHead")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let test_cmd = body
        .get("testCommand")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    if !test_cmd.is_empty() {
        let policy = super::policies::load_policy(&state, &user.id)?;
        let allowed = policy["allowedTestCommands"]
            .as_array()
            .is_some_and(|arr| arr.iter().filter_map(Value::as_str).any(|c| c == test_cmd));
        if !allowed {
            return Err(AppError::forbidden(
                "Perintah test belum terdaftar pada Settings → Policies.",
            ));
        }
    }

    tokio::task::spawn_blocking(move || {
        let root = validate_repo_root(&raw)?;
        let head = run_git(&root, &["rev-parse", "HEAD"])?;
        if !expected_head.is_empty() && expected_head != head {
            return Err(AppError::new(
                axum::http::StatusCode::CONFLICT,
                format!("Patch basi: HEAD saat ini {head}, bukan {expected_head}."),
            ));
        }
        let touched = validate_diff_paths(&root, &diff_text)?;
        let wt_path = std::env::temp_dir().join(format!("multiplexity-wt-{}", uuid::Uuid::new_v4()));
        let wt_str = wt_path.to_string_lossy().to_string();
        run_git(&root, &["worktree", "add", "--detach", &wt_str, "HEAD"])?;

        let check_res = run_git_with_stdin(&wt_path, &["apply", "--check", "-"], diff_text.as_bytes());
        let mut test_output = String::new();
        let mut test_ok = None;
        if check_res.is_ok() && !test_cmd.is_empty() {
            let apply_ok = run_git_with_stdin(&wt_path, &["apply", "-"], diff_text.as_bytes());
            if apply_ok.is_ok() {
                let parts: Vec<&str> = test_cmd.split_whitespace().collect();
                if let Some((bin, args)) = parts.split_first()
                    && let Ok(out) = Command::new(bin).args(args).current_dir(&wt_path).output()
                {
                    test_ok = Some(out.status.success());
                    let combined = format!(
                        "{}\n{}",
                        String::from_utf8_lossy(&out.stdout),
                        String::from_utf8_lossy(&out.stderr)
                    );
                    test_output = combined.chars().take(8000).collect();
                }
            }
        }
        let _ = run_git(&root, &["worktree", "remove", "--force", &wt_str]);
        let _ = std::fs::remove_dir_all(&wt_path);

        match check_res {
            Ok(_) => Ok(Json(json!({
                "applicable": true,
                "head": head,
                "touchedFiles": touched,
                "testPassed": test_ok,
                "testOutput": test_output,
            }))),
            Err(err) => Ok(Json(json!({
                "applicable": false,
                "head": head,
                "touchedFiles": touched,
                "error": err.message,
            }))),
        }
    })
    .await
    .map_err(|_| AppError::internal("Gagal memvalidasi worktree."))?
}

pub async fn apply_diff(
    State(_state): State<AppState>,
    Extension(_user): Extension<User>,
    Json(body): Json<Value>,
) -> ApiResult {
    let raw = body
        .get("repoPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let diff_text = body
        .get("diffText")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let expected_head = body
        .get("expectedHead")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    tokio::task::spawn_blocking(move || {
        let root = validate_repo_root(&raw)?;
        let head = run_git(&root, &["rev-parse", "HEAD"])?;
        if !expected_head.is_empty() && expected_head != head {
            return Err(AppError::new(
                axum::http::StatusCode::CONFLICT,
                format!("Patch basi: HEAD saat ini {head}, bukan {expected_head}."),
            ));
        }
        let touched = validate_diff_paths(&root, &diff_text)?;
        run_git_with_stdin(&root, &["apply", "--check", "-"], diff_text.as_bytes())?;
        run_git_with_stdin(&root, &["apply", "-"], diff_text.as_bytes())?;
        let actual_diff = run_git(&root, &["diff", "--"])?;
        let undo_cmd = format!("git checkout -- {}", touched.join(" "));
        Ok(Json(json!({
            "repoPath": root.to_string_lossy(),
            "head": head,
            "appliedFiles": touched,
            "actualDiff": actual_diff,
            "undoCommand": undo_cmd,
        })))
    })
    .await
    .map_err(|_| AppError::internal("Gagal menerapkan unified diff."))?
}
