# Rust migration checkpoint

## Repository relocation fix

Active repository: `multiplexity`, moved from sibling `manager-system-internal`.
All 352 pre-existing non-build files were present after the move; the new repository
also has LICENSE. Local profile/workspace paths were compared by presence only,
without reading environment or credential files. No missing local path was found.

Windows encryption references now persist as `keyring-id` inside the data folder,
independent of its path. Original path-based entries upgrade when opened in place.
The moved existing profile was recovered explicitly from the original data path;
AES-GCM records were checked before saving the reference. Database and WAL hashes
were unchanged by recovery. No database reset or key replacement was performed.

The moved existing profile passed a Vite/Rust startup smoke on temporary ports,
including health, login HTML, frontend module and setup endpoint checks. Those
servers were stopped. `.gitignore` no longer suppresses permanent Markdown docs;
recovered documentation files may appear untracked and should be reviewed when
the user requests a commit. New tests cover relocation, legacy upgrade, explicit
recovery, mismatched keys and corrupt/missing references. See the active guide
for the `--recover-key-from` command. No old repository data was modified.

## Previous migration checkpoint

Updated 2026-11-25. Read [MAP.md](MAP.md), [DECISIONS.md](DECISIONS.md) and
[runtime research](research/runtime.md). User authorized full migration, fresh data,
disabling Windows Hello, missing tooling installation, and continuing checkpoints.
Do not commit/push or delete old application data.

Implemented: shared Rust HTTP backend, auth/store/core, VM/SSH/Socket.IO/database,
AI routes/process/API adapters, Konga/OpenShift, and Tauri host. Default npm commands
now use Rust/Tauri; `legacy:*` explicitly identifies the Node reference.

Verified at this checkpoint: 24 Rust tests, 928 existing Vitest tests, Vite build,
TypeScript, Clippy with warnings denied, real HTTP/Socket.IO smoke, browser form
login/navigation smoke, and eight rust-anything HTTP replay cases against Rust.
All generated evidence lives under ignored `.test-artifacts/rust-migration/`.

Fixed during crosscheck: CLI stdin EOF deadlock, Socketioxide async handlers,
SQLx 0.9 intentional dynamic SQL API, CSP-blocked inline theme bootstrap,
JSDOM dialog/scrolling test APIs, and configurable Vite proxy port.

Final local checkpoint: installer generated (7,922,143 bytes), native Tauri startup
smoke passed, Vite launcher smoke passed, Tauri/backend Clippy passed with warnings
denied, and browser screenshot inspected after disabling test background throttling.
The bundler initially failed a GitHub DNS lookup; retry with official tooling
succeeded. Added deterministic frontend staging for the standalone release executable.
Both test and development servers were stopped. No commit or push was performed.

Remaining validation is target-specific: do not claim remote SSH/database/OpenShift
or paid AI verification. Fixtures and negative paths are not live integrations.
No tool unit gate or whole-app lift success is claimed; see the active guide's
characterization scope. Existing Node sources/tests remain available as reference.

Useful commands: `npm run rust:check`, `npm run rust:smoke`,
`npm run rust:browser:test`, `npm run rust:dev:test`, `npm run desktop:dist`,
`npm run desktop:smoke`. Active guide: [docs/rust-migration.md](../docs/rust-migration.md).
