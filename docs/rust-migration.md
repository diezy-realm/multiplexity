# Multiplexity 0.3: Rust, Vite, React and Tauri

## Requirements

- Node.js 22.12+ on major 22 and npm for Vite/build tooling.
- Rust 1.97+ with Cargo, rustfmt and Clippy.
- Windows desktop: Microsoft C++ Build Tools with Windows SDK, and WebView2 runtime. https://v2.tauri.app/start/prerequisites/
- AI CLI providers require their official CLI installation and login separately.

## Local web development

```powershell
npm install
npm run dev
```

Open http://localhost:3300 and create the local account. The launcher compiles the
Rust backend, starts it on port 3301, waits for health, then starts Vite on 3300.
Vite proxies `/api` and Socket.IO to Rust. React HMR remains available. Restart the
launcher after changing Rust code. `Ctrl+C` stops the launcher and child processes.

```powershell
$env:PORT = '3390'
npm run dev
```

The API defaults to `PORT + 1`; `MULTIPLEXITY_API_PORT` overrides that API port.
Use the printed localhost URL consistently because Host and Origin are checked.
Do not run web development and desktop builds simultaneously against generated
frontend output. Frontend source is shared, not copied into a second app.

## Desktop

```powershell
npm run desktop:dev
npm run desktop:build
npm run desktop:dist
```

`desktop:dev` builds the Vite frontend and starts the Tauri development host.
It currently requires restarting that command after frontend changes; browser
development provides HMR. `desktop:build` builds the application without an
installer. `desktop:dist` also creates the Windows NSIS installer. The runner sets
the Cargo target directory to `rust/target`; bundles appear under
`rust/target/release/bundle/nsis/`. No Electron or Node executable is bundled.
`scripts/rust-stage-frontend.cjs` stages current frontend resources beside the
standalone release executable. Installer resources are taken from the Vite build.
Signing and automatic updates are not configured in this migration.

The Tauri window loads the loopback Rust backend on an automatically selected port.
It has no frontend filesystem/shell IPC permissions. Navigation stays on that
origin. Selected allowlisted documentation links and the Konga link
(`http://172.18.136.92/`, matching `src/pages/Konga.tsx`) open through the OS
browser. The backend applies Host/Origin checks, CSP, HttpOnly session cookies,
authentication and CSRF for login/signout. Local setup permits creation of the
first account only.

## Data and accounts

- Web default: `.local-dev/rust/`; override with `MULTIPLEXITY_DATA_DIR`.
- Desktop: Tauri application data for `com.multiplexity.desktop.rust`.
- Local database: `multiplexity.db`, including WAL/SHM when open.
- Credentials: AES-256-GCM. Windows stores the master key in Credential Manager.
  The data directory contains a non-secret `keyring-id` reference. Keep this file
  with the database when moving the project under the same Windows account.
  Neither the directory name nor its absolute path is used for new key identities.
- Agent files: `agent-workspace/<account-hash>/`, shared by the application's AI
  providers with account isolation and path restrictions.

Existing Electron data is neither imported nor deleted. Create the account and
connections again in the Rust version. Windows Hello and the Hello-based password
reset are disabled (HTTP 410). Change password requires the current password and
revokes existing sessions. There is no unauthenticated password reset endpoint.

SSH uses trust-on-first-use SHA256 host-key pinning. A changed host key is rejected.
This is documented migration behavior, not proof of a host's identity on first
connection. Credentials and host-key records remain local.

## Build and run the standalone backend

### Moving an existing development profile

Profiles created before `keyring-id` used the absolute data directory as their
Credential Manager identity. Opening an old profile at its original location
automatically adds the portable reference. If it was already copied to a new
project directory without that file, recover using the original data directory:

```powershell
cargo run --manifest-path rust/Cargo.toml --bin multiplexity-server -- --recover-key-from '..\manager-system-internal\.local-dev\rust'
npm run dev
```

Run this under the same Windows account. `MULTIPLEXITY_DATA_DIR`, if set, selects
the target profile; otherwise it is `.local-dev/rust`. Recovery verifies encrypted
records before saving a reference and never replaces an existing reference or
creates a replacement key for an existing database. No secret is printed or stored
in the reference file. Moving to another Windows account/machine still requires
separate credential provisioning; a directory copy is insufficient.

### Standalone commands

```powershell
npm run build
npm start
```

The launcher is a convenience; the compiled backend can run without Node:

```powershell
$env:MULTIPLEXITY_DATA_DIR = 'C:\MultiplexityData'
$env:MULTIPLEXITY_FRONTEND_DIR = (Resolve-Path 'dist/client').Path
$env:PORT = '3300'
& '.\rust\target\release\multiplexity-server.exe'
```

The current deployment binds loopback only. LAN/Internet deployment is outside
this local-desktop migration; do not assume previous Node deployment variables
configure Rust. `NEXTAUTH_*` and the old Electron secrets file are not used.

## Verification

```powershell
npm run typecheck
npm test -- --maxWorkers=4
npm run rust:test
npm run rust:check
cargo build --manifest-path rust/Cargo.toml --bin multiplexity-server
node tests/rust/smoke.cjs
npm run rust:browser:test
npm run rust:dev:test
npm run desktop:smoke
```

The Rust tests cover authenticated account/snippet/artifact operations, path and
account isolation, encryption tampering, provider SSE fixtures, CLI cancellation,
permission flags, and remote HTTP fixtures. The smoke test starts an isolated
backend and tests real HTTP and Socket.IO without mutating remote services.

`rust-anything 4.1.0` is installed for Codex. Reproducible characterization:

```powershell
New-Item -ItemType Directory -Force '.test-artifacts/rust-migration/reference' | Out-Null
rust-anything analyze . --whole-app --lang ts --out .test-artifacts/rust-migration/analyze.md
rust-anything app record .test-artifacts/rust-migration/reference --http --no-traps --inputs tests/rust/http-inputs.jsonl -- node "$PWD/tests/rust/reference.cjs"
rust-anything app replay .test-artifacts/rust-migration/reference --build "node $PWD/tests/rust/candidate.cjs"
```

The eight HTTP cases cover anonymous session/provider responses and unauthenticated
access rejection. They do not prove full feature parity. Unit `gate`/whole-app
`lift` are not claimed: the final Axum backend is manually implemented, rather than
the tool's N-API unit scaffolds. Streaming and process lifecycle use separate tests.
Reference scripts use disposable fixtures, not existing application databases.

Test logs and generated tool recordings belong under ignored `.test-artifacts/`.
Permanent fixture inputs and tests remain in `tests/rust/`. Production SSH/database,
OpenShift OAuth/exec and paid AI behavior require target-specific validation; passing
mock tests is not evidence that those remote systems have been exercised.

Decisions and progress: [DECISIONS](../rust/DECISIONS.md), [MAP](../rust/MAP.md).
