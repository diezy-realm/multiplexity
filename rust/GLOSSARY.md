# Migration glossary

| Existing term | Rust representation |
|---|---|
| Shared Node backend | multiplexity_backend library and multiplexity-server binary |
| currentUserId / getServerSession | authenticated User request extension |
| Credential store | Store AES-256-GCM operations |
| Desktop secrets | Windows Credential Manager entry scoped to Rust data directory |
| Agent workspace | per-user bounded artifact and instruction directory |
| Electron BrowserWindow | Tauri WebviewWindow with restricted local origin |
| API route.ts | Axum route with the same browser-facing path |
