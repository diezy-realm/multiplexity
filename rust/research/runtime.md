# Shared runtime and migration evidence

Sources inspected 2026-11-25:
- Existing Vite frontend: `src/client/main.tsx`, `vite.config.mts`.
- Existing API/security behavior: `server.ts`, `src/server/http.ts`, `src/server/auth/handler.ts`.
- Axum routing/middleware: https://docs.rs/axum/0.8.9/axum/
- SQLite API: https://docs.rs/rusqlite/0.43.0/rusqlite/
- Tauri Vite integration: https://v2.tauri.app/start/frontend/vite/
- Migration workflow: https://github.com/erkamyaman/rust-anything/tree/7f35f4d73e1fd9cbfd1260224192feae5f8152f4

`rust-anything analyze --whole-app` identified 69 source units, including UI/build units that remain JavaScript. Its generated N-API bridge suggestions are not the final architecture: the user requested a standalone Rust backend. The HTTP replay is an additional characterization tool, not evidence that Socket.IO, CLI process lifecycle or streaming is equivalent.

Use bounded payloads and file reads, connection timeout, SQLite WAL and bound SQL parameters. Password hashing runs on Tokio blocking workers. SQLite locks do not cross async waits. No speedup, memory reduction or installer size claim is made without measurement. Windows keys use the credential manager; plaintext keys are not saved beside Windows databases. Existing Electron data is not imported or deleted.

Tool doctor also reports optional runtimes and unconfigured other coding agents. Installing those is unnecessary for the TypeScript-to-Rust/Codex target. A successful Rust build is the compiler/linker check for this target.
