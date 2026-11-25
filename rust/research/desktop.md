# Desktop and HTTP integration migration

Reviewed 2026-11-25. This is a permanent record of migration choices, not a benchmark.

- Tauri supports Vite build output: https://v2.tauri.app/start/frontend/vite/ . Existing output is `dist/client` (`vite.config.mts`). React Router and browser APIs remain shared with the browser application.
- The host starts the shared Rust HTTP server on an ephemeral loopback port and restricts main-window navigation to that origin. No IPC commands or remote capabilities are granted. A loopback server still requires Host/Origin checks and authenticated sessions; Tauri does not replace application authorization. https://v2.tauri.app/security/ and https://v2.tauri.app/plugin/localhost/
- Tauri bundles static resources using the resources mapping and resolves them through resource_dir: https://v2.tauri.app/reference/config/#bundleresources . Rust backend runs in-process, not through a Node sidecar.
- Backend lifecycle uses a cancellation token on desktop exit. Native runtime dependencies and installer/WebView2 behavior require a Windows build and launch check: https://v2.tauri.app/distribute/windows-installer/
- Existing Windows Hello is intentionally disabled by user instruction. Password changes still require the current password. The official biometric plugin is mobile only: https://v2.tauri.app/plugin/biometric/ . No unauthenticated password recovery was substituted.
- Konga is a management UI; CRUD uses the configured Kong Admin API and the Kong-Admin-Token header, preserving existing routes and validation: https://developer.konghq.com/admin-api/ . Network responses are bounded and redirects disabled; credentials stay encrypted in SQLite.
- OpenShift retains bearer-token and OAuth login plus cluster-scoped resource requests. Authentication headers must never be logged. https://kubernetes.io/docs/reference/access-authn-authz/authentication/ and https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/authentication_and_authorization/configuring-oauth-clients
- Kubernetes pod exec uses `v4.channel.k8s.io` frames (stdin=0, stdout=1, stderr=2, status=3, resize=4). Existing Socket.IO event names remain unchanged. Skip TLS is explicit per cluster, matching the existing implementation; its compatibility must be verified against a real authorized cluster before claiming production parity.

Verification is recorded in HANDOFF/MAP after commands run. No live cluster or gateway mutation is authorized as part of isolated migration tests.
