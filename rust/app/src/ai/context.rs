use super::settings::text;
use crate::{AppError, AppState};
use base64::Engine;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::OnceLock;

pub const SKILLS: [(&str, &str); 7] = [
    (
        "linux-admin",
        "Act as a senior Linux SRE. Establish distro/version, incident window and impact. Correlate bounded journalctl/systemctl evidence, CPU, OOM, disk/inodes and sockets. Start read-only, distinguish symptoms, causes and hypotheses. Include rollback and validation.",
    ),
    (
        "kong-admin",
        "Act as a senior Kong gateway engineer. Verify deployed version, mode, Admin API endpoint, TLS and authorization. Distinguish Konga UI from Kong Gateway. Trace routes, upstream targets, health checks and plugin scope. Before CRUD propose export, impact, validation and rollback.",
    ),
    (
        "database",
        "Act as a senior PostgreSQL/MySQL/SQLite engineer. Establish engine/version, topology and incident window. Investigate locks, pool exhaustion and query plans. EXPLAIN ANALYZE executes statements; assess load and authorization. Include bounded checks, rollback and validation.",
    ),
    (
        "debugger",
        "Act as a senior incident debugger. Build a timeline, expected/actual behavior, reproduction and evidence matrix. Rank falsifiable hypotheses with bounded checks. Never invent execution or claim resolution without evidence.",
    ),
    (
        "diagnose",
        "Analisis akar masalah, bukti log, dan langkah verifikasi. Bedakan fakta dan hipotesis.",
    ),
    (
        "summarize",
        "Ringkas kejadian penting dan urutan waktunya. Sebut sumber dan timestamp.",
    ),
    (
        "explain",
        "Jelaskan log atau error secara ringkas dengan konteks teknis.",
    ),
];

pub fn redact(value: &str) -> String {
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let patterns=PATTERNS.get_or_init(||[
        (r"(?i)\b(Bearer\s+)[A-Za-z0-9._~+/=-]+","${1}[REDACTED]"),
        (r#"(?i)\b(api[_-]?key|password|passwd|access[_-]?token|refresh[_-]?token|secret)\b(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)"#,"${1}${2}[REDACTED]"),
        (r"\bsk-[a-zA-Z0-9_-]{16,}\b","[REDACTED]")
    ].into_iter().filter_map(|(pattern,replacement)|Regex::new(pattern).ok().map(|regex|(regex,replacement))).collect());
    patterns
        .iter()
        .fold(value.to_owned(), |current, (regex, replacement)| {
            regex.replace_all(&current, *replacement).into_owned()
        })
}

pub fn valid_source(source: &Value) -> bool {
    let vm = text(source, "vmId");
    let target = text(source, "target");
    let label = source.get("label").and_then(Value::as_str);
    if vm.is_empty()
        || vm.len() > 80
        || !vm.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        || target.len() > 512
        || label.is_none_or(|l| l.len() > 200)
    {
        return false;
    }
    match text(source, "kind") {
        "systemd" => {
            !target.is_empty()
                && !target.starts_with('-')
                && target
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.@-".contains(&c))
        }
        "docker" => {
            target
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
                && target
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        }
        "file" => {
            target.starts_with('/')
                && !target.split('/').any(|part| part == "..")
                && target
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_./@ -".contains(&c))
                && Regex::new(r"\.(log|out|err|txt)(\.[0-9]+)?$")
                    .is_ok_and(|pattern| pattern.is_match(target))
        }
        _ => false,
    }
}

pub fn valid_attachment(file: &Value) -> bool {
    let Some(name) = file.get("name").and_then(Value::as_str) else {
        return false;
    };
    let Some(content) = file.get("content").and_then(Value::as_str) else {
        return false;
    };
    if name.len() > 200
        || name.split(['\\', '/']).any(|part| {
            part.to_lowercase().starts_with(".env") || part.eq_ignore_ascii_case("config.json")
        })
    {
        return false;
    }
    let media = text(file, "mediaType");
    if media.is_empty() {
        return content.len() <= 64000;
    }
    if !matches!(media, "image/png" | "image/jpeg" | "image/webp")
        || content.len() > 2 * 1024 * 1024 * 4 / 3 + 4
    {
        return false;
    }
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(content) else {
        return false;
    };
    bytes.len() <= 2 * 1024 * 1024
        && match media {
            "image/png" => bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]),
            "image/jpeg" => bytes.starts_with(&[255, 216, 255]),
            _ => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        }
}

pub async fn sources(
    state: &AppState,
    user: &str,
    sources: &[Value],
    diagnostic: &str,
) -> Result<Vec<Value>, AppError> {
    let mut output = Vec::new();
    for source in sources {
        if !valid_source(source) {
            return Err(AppError::bad_request("Sumber log tidak valid."));
        }
        let vm = state
            .db
            .one(
                "SELECT id,label FROM vms WHERE id=? AND user_id=?",
                &[source["vmId"].clone(), json!(user)],
            )?
            .ok_or_else(|| AppError::not_found("VM sumber log tidak ditemukan."))?;
        let target = text(source, "target");
        let argument = crate::machines::quote(target);
        let command = if diagnostic == "resources" {
            "uptime; free -m; df -h /".to_owned()
        } else if diagnostic == "status" {
            match text(source, "kind") {
                "systemd" => format!(
                    "timeout 12s systemctl status --no-pager -- {argument} 2>&1 | head -c 12000"
                ),
                "docker" => format!(
                    "timeout 12s docker ps --filter {} --format '{{{{.Names}}}} {{{{.Status}}}}' 2>&1 | head -c 12000",
                    crate::machines::quote(&format!("name={target}"))
                ),
                _ => format!("timeout 12s stat -- {argument} 2>&1 | head -c 12000"),
            }
        } else {
            match text(source, "kind") {
                "systemd" => format!(
                    "timeout 12s journalctl -u {argument} -n 150 --no-pager 2>&1 | head -c 24000"
                ),
                "docker" => {
                    format!("timeout 12s docker logs --tail 150 {argument} 2>&1 | head -c 24000")
                }
                _ => format!("timeout 12s tail -n 150 -- {argument} 2>&1 | head -c 24000"),
            }
        };
        let content = crate::machines::execute(state, user, text(source, "vmId"), &command).await?;
        let mut evidence = source.clone();
        evidence["label"] = json!(format!(
            "{} · {}",
            text(&vm, "label"),
            if diagnostic == "logs" {
                target
            } else {
                diagnostic
            }
        ));
        evidence["timestamp"] = json!(chrono::Utc::now().to_rfc3339());
        evidence["content"] = json!(redact(&content.chars().take(24000).collect::<String>()));
        output.push(evidence);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_paths_are_bounded_and_quoted() {
        assert!(valid_source(
            &json!({"vmId":"vm-1","kind":"systemd","target":"app@one.service","label":"App"})
        ));
        for target in [
            "../../etc/passwd",
            "/var/log/../secret.log",
            "/tmp/app.log';whoami",
            "/tmp/app.log\nwhoami",
        ] {
            assert!(!valid_source(
                &json!({"vmId":"vm-1","kind":"file","target":target,"label":"App"})
            ));
        }
    }
    #[test]
    fn attachments_reject_secrets_and_mislabeled_images() {
        assert!(!valid_attachment(
            &json!({"name":"folder/.env.local","content":"test"})
        ));
        assert!(!valid_attachment(
            &json!({"name":"x.png","mediaType":"image/png","content":"YWJj"})
        ));
        assert!(valid_attachment(
            &json!({"name":"readme.md","content":"hello"})
        ));
    }
    #[test]
    fn logs_are_redacted() {
        assert_eq!(
            redact("Bearer abc123 password=secret"),
            "Bearer [REDACTED] password=[REDACTED]"
        );
    }
}
