# Migration map

Goal: Vite + React + shared Rust backend + Tauri. Decisions: [DECISIONS.md](DECISIONS.md). Contracts: [CONTRACT.md](CONTRACT.md).

| Unit | State | Verification |
|---|---|---|
| Tool installation and baseline | implemented | rust-anything 4.1.0 Codex setup; analyze; 8/8 HTTP replay against Rust |
| Shared storage, authentication and account | implemented and locally verified | Rust tests + real HTTP/browser account creation/login/logout |
| Preferences, appearance, snippets and artifacts | implemented and locally verified | Encryption/path isolation/version conflict tests + HTTP smoke |
| VM, SSH, terminal and database | implemented; remote validation pending | Scoped CRUD + Socket.IO authentication/error path smoke; parser tests |
| AI provider and conversation adapters | implemented; live provider validation pending | SSE mock/CLI fixtures, cancellation, permissions, attachment cleanup tests |
| Konga and OpenShift | implemented; remote validation pending | HTTP fixture tests, OAuth/URL/route validation; no production mutations |
| Tauri and development/build integration | locally verified | Native Tauri startup, Vite proxy/setup, formatting and Tauri Clippy passed; NSIS installer generated |
| End-to-end crosscheck and cutover | local cutover verified | 928/928 existing tests, 24/24 Rust tests, Clippy clean, HTTP/Socket.IO/browser/native desktop smokes passed |

Existing Node/Electron code remains reference-only. Default launch/build commands use Rust/Tauri.
Generated characterization and transient logs are ignored under `.test-artifacts/rust-migration/`.
Tool unit `gate` and whole-app `lift` were not used; do not infer universal parity from replay.

Installer: `rust/target/release/bundle/nsis/Multiplexity_0.3.0_x64-setup.exe`,
7,922,143 bytes. Initial bundling failed on a transient GitHub DNS lookup; retry
with the official Tauri bundler succeeded. Installer script includes current
`dist/client/index.html` and `theme-bootstrap.js`. Native executable resources
are also staged by `scripts/rust-stage-frontend.cjs`.
