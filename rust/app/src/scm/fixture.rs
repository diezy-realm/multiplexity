use super::{Section, models::*};
use crate::AppError;
use serde_json::{Value, json};
use url::Url;

pub(super) const HEAD: &str = "d9a302ba81cb0fcf7f548c13d34b92d76ca34710";
pub(super) const BASE: &str = "a881b18dd1b9f8be44197de33ce66ddba44cca90";
const TIME: &str = "2026-10-12T09:30:00Z";
const PATCH: &str = "@@ -4,5 +4,7 @@\n export function formatDate(value: Date) {\n-  return value.toLocaleDateString();\n+  return new Intl.DateTimeFormat('en-CA', {\n+    timeZone: 'UTC', dateStyle: 'short',\n+  }).format(value);\n }\n \n export const formatVersion = 2;";

fn item(number: u64, title: &str, author: &str, group: &'static str) -> QueueItem {
    QueueItem {
        reference: PullRef {
            owner: "demo".to_owned(),
            repo: "release-notes".to_owned(),
            number,
        },
        title: title.to_owned(),
        author: author.to_owned(),
        updated_at: TIME.to_owned(),
        group,
        draft: number == 16,
    }
}

fn queue_items(page: u32) -> Vec<QueueItem> {
    match page {
        1 => vec![
            item(
                17,
                "Gunakan tanggal UTC pada catatan rilis",
                "nara-demo",
                "mine",
            ),
            item(
                18,
                "Sertakan nomor rilis pada halaman riwayat",
                "ayu-demo",
                "requested",
            ),
            item(
                17,
                "Gunakan tanggal UTC pada catatan rilis",
                "nara-demo",
                "team",
            ),
        ],
        2 => vec![
            item(
                16,
                "Perjelas petunjuk penerbitan catatan rilis",
                "nara-demo",
                "mine",
            ),
            item(15, "Tambah contoh ringkasan perubahan", "bima-demo", "team"),
        ],
        _ => vec![],
    }
}

pub(super) fn queue(page: u32) -> Value {
    json!({"items": queue_items(page), "nextPage": (page == 1).then_some(2),
        "groupErrors": [], "teamCount": 1, "teamScopeLimited": false, "stale": false})
}

pub(super) fn pull(reference: PullRef) -> Result<Pull, AppError> {
    let candidate = queue_items(1)
        .into_iter()
        .chain(queue_items(2))
        .find(|item| item.reference.key() == reference.key())
        .ok_or_else(|| AppError::not_found("Pull request fixture tidak ditemukan."))?;
    let description = if reference.number == 17 {
        "Format tanggal catatan rilis berubah sesuai zona waktu perangkat. PR ini menetapkan **UTC** agar label tanggal konsisten.\n\n- Pusatkan format tanggal pada src/format-date.ts.\n- Tambah contoh regresi untuk tanggal dekat tengah malam.\n- Perbarui nama file dokumentasi format rilis."
    } else {
        "Pull request sintetis untuk mencoba antrean dan deep link Code Review."
    };
    let raw = json!({"number": reference.number, "title": candidate.title, "body": description,
        "state": "open", "draft": candidate.draft, "user": {"login":candidate.author},
        "head":{"ref":"feat/release-format","sha":HEAD}, "base":{"ref":"main","sha":BASE},
        "updated_at":TIME, "created_at":"2026-10-11T13:10:00Z", "changed_files":4,
        "requested_reviewers":[{"login":"ayu-demo"}], "requested_teams":[{"slug":"release-demo"}]});
    let mut pull = Pull::from_remote(
        reference,
        "fixture",
        &Url::parse("https://fixture.invalid").unwrap(),
        &raw,
    )?;
    pull.remote_url = None;
    Ok(pull)
}

pub(super) fn section(section: Section, page: u32) -> Value {
    let mut next = None;
    let mut items = json!([]);
    if page == 1 {
        items = match section {
            Section::Files => {
                next = Some(2);
                let files = [
                    json!({"filename":"src/format-date.ts","status":"modified","additions":3,"deletions":1,"patch":PATCH}),
                    json!({"filename":"docs/release-format.md","previous_filename":"docs/format.md","status":"renamed","additions":0,"deletions":0}),
                    json!({"filename":"assets/release-badge.png","status":"modified","binary":true}),
                ];
                json!(
                    files
                        .iter()
                        .filter_map(|file| FileChange::from_remote(file, page))
                        .collect::<Vec<_>>()
                )
            }
            Section::Reviews => {
                json!([{"id":1,"login":"bima-demo","state":"COMMENTED","body":"Format UTC konsisten di lingkungan build.","submittedAt":TIME,"revision":HEAD}])
            }
            Section::Comments => json!([
                {"id":1,"login":"bima-demo","body":"Apakah tanggal dekat tengah malam sudah tercakup?","path":"src/format-date.ts","side":"right","line":6,"revision":HEAD,"originalRevision":HEAD,"createdAt":TIME},
                {"id":2,"login":"nara-demo","body":"Komentar ini berasal dari revisi sebelumnya.","path":"src/format-date.ts","side":"right","line":6,"revision":"f0e3a5b878f641b1797c9f791f5c0818de7ebeaf","originalRevision":"f0e3a5b878f641b1797c9f791f5c0818de7ebeaf","createdAt":TIME}
            ]),
            Section::Runs => json!([
                {"id":1,"name":"Unit tests","status":"success","detail":"36 tes lulus","revision":HEAD,"source":"run"},
                {"id":2,"name":"Visual preview","status":"failure","detail":"Snapshot memerlukan pembaruan","revision":HEAD,"source":"run"},
                {"id":3,"name":"Desktop build","status":"pending","detail":"Menunggu runner","revision":HEAD,"source":"run"}
            ]),
            Section::Statuses => {
                json!([{"id":4,"name":"docs/preview","status":"success","detail":"Preview tersedia","revision":HEAD,"source":"status"}])
            }
        };
    } else if page == 2 && matches!(section, Section::Files) {
        let raw = json!({"filename":"tests/release-date.test.ts","status":"added","additions":7,"deletions":0,
            "patch":"@@ -0,0 +1,7 @@\n+test('formats date in UTC', () => {\n+  expect(formatDate(NIGHT)).toBe(EXPECTED);"});
        items = json!([FileChange::from_remote(&raw, page)]);
    }
    json!({"items":items,"nextPage":next,"headSha":HEAD,"baseSha":BASE,"stale":false,"partial":false})
}
