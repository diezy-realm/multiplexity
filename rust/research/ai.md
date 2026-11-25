# AI backend migration evidence

Scope: Rust replacements in `rust/app/src/ai.rs` and `rust/app/src/ai/`; reference implementation remains `src/server/routes/ai` and `src/lib/ai`.

## Contracts preserved

- Settings, executable detection/login, model discovery, conversation creation/rename/archive, chat history/delete, regeneration/history variants, log analysis and cancellation use existing `/api/ai/...` paths and frontend JSON fields.
- SSE transports `status`, `delta`, `done`, and `error` JSON events with heartbeat comments. Provider completion is required before persisting a chat answer; interrupted responses are not stored as successful answers.
- OpenAI uses Responses API, Claude uses Messages API, Gemini/Ollama/custom use their configured OpenAI-compatible endpoint. OpenAI/Claude retain bounded shared-workspace tool loops. Read-only/Ask omit the artifact-write tool; Allow All exposes it. Workspace traversal/account boundaries are delegated to shared core functions.
- Codex runs `exec --json`, Kiro runs noninteractive text mode, and Antigravity uses stream JSON plus session permission settings. Kiro reports buffered delivery as the reference implementation does. CLI output is capped, timeouts are bounded, prompts are written over stdin, and executable invocation bypasses a shell.
- Codex models are discovered through `app-server` initialize/initialized/model/list rather than invented static model IDs.

## Primary sources

- Codex noninteractive mode and JSON events: https://developers.openai.com/codex/noninteractive/
- Codex app-server initialization and model/list: https://developers.openai.com/codex/app-server/
- Claude streaming event structure, text deltas and partial tool JSON: https://platform.claude.com/docs/en/build-with-claude/streaming
- Kiro CLI chat/headless documentation: https://kiro.dev/docs/cli/chat/ and https://kiro.dev/docs/cli/headless/
- Tokio subprocess kill-on-drop semantics: https://docs.rs/tokio/latest/tokio/process/struct.Command.html#method.kill_on_drop

Installed executable help was checked on 2026-11-25: Codex `exec --help` includes ephemeral, ignore-user-config, ignore-rules, JSON, image, sandbox and bypass flags. Antigravity `--help` includes settings, sandbox, mode, effort, stream input/output and skip-permissions flags. A CLI lacking the required settings flag is rejected rather than silently weakening permissions.

## Semantic traps and validation boundaries

- A final matching HTTP body does not prove incremental delivery. Mock-provider tests check actual delta-before-done delivery and persistence.
- Dropping a stream or outer timeout drops nested futures. A process-tree guard is necessary in addition to `kill_on_drop`; Windows uses hidden `taskkill /t /f`, Unix assigns a process group.
- API error bodies and CLI stderr may contain credentials; user-facing failures expose status/generic diagnostic only, not raw provider payloads.
- Log/file attachments remain untrusted context, with secret redaction, explicit source validation, and image signature/size validation. No actual `.env` or credential config file was read for this port.
- No paid provider request, external service mutation, or real OAuth login was performed for automated validation. Live provider account/model compatibility remains an end-to-end validation item.
- CLI Connect deliberately opens the official interactive login terminal only when the user clicks Connect; it is not executed on application startup or detection.
