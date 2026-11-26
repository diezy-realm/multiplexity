# Rust migration decisions

## ADR-001: Shared Rust backend
Accepted: 2026-11-25. Keep Vite, React and React Router. Implement a shared Rust HTTP backend for browser and Tauri, preserving existing HTTP and Socket.IO contracts. Node is permitted only as a build tool or temporary reference implementation.

## ADR-002: Fresh application storage
Accepted by user: 2026-11-25. Existing data compatibility is not required. Use a separate Rust data directory; do not delete the previous installation's data. Encrypt credentials at rest. Never log credential values.

## ADR-003: Disable Windows Hello
Accepted by user: 2026-11-25. Disable passkey registration, Windows Hello and password reset that depends on Hello. Password changes require the current password. Do not provide an unauthenticated replacement password reset.

## ADR-004: Preserve operational behavior
Accepted: 2026-11-25. Preserve provider permissions, cancellation and incremental responses where implemented; incompatibilities are reported explicitly. Test with isolated fixtures, never production mutations or customer logs. Keep the Node implementation as reference until verification succeeds.

## ADR-005: Rust implementation boundaries
Accepted: 2026-11-25. Axum/Tokio HTTP, SQLite for local storage, Rust SSH and database drivers, external official AI CLI processes. Use bounded payloads/timeouts, avoid blocking asynchronous executors with password hashing or subprocess waits, and perform no speculative performance claims.

## ADR-006: Execution authorization
Accepted by user: 2026-11-25. Execute migration through all waves and install missing tooling. Routine implementation choices and checkpoints do not require repeated approval. Keep existing unrelated user changes; no commit or push.
