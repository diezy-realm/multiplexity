# Riset Arsitektur Plugin & Dev Toolbox Local-First Multiplexity

Tanggal kajian: 26 November 2026. Dokumen ini mengkaji arsitektur plugin dan *offline dev toolbox* untuk Multiplexity `0.3.0` berdasarkan fakta codebase aktual serta spesifikasi primer (Model Context Protocol, Tauri v2 Security, VS Code Contribution Points, Backstage Composability, dan Git Worktree/Apply).

---

## 1. Titik Awal Codebase Internal (`0.3.0`)

| Area | Fakta pada codebase saat ini | Implikasi arsitektur plugin & toolbox |
| --- | --- | --- |
| **Host Desktop & Web** | [Tauri host](../../src-tauri/src/main.rs) memuat loopback Axum ([lib.rs](../../rust/app/src/lib.rs)) dengan `capabilities: []` di [tauri.conf.json](../../src-tauri/tauri.conf.json#L12) dan tanpa izin IPC filesystem/shell di frontend. | Seluruh eksekusi plugin, kredensial, dan akses file lokal **harus tetap berada di backend Rust**, bukan di webview React atau plugin UI pihak ketiga. |
| **Konektor Pilot** | [pilot/connectors.rs](../../rust/app/src/pilot/connectors.rs) mengimplementasikan adaptor bawaan `bamboo`, `sonarqube`, dan `jira` dengan token AES-256-GCM di [store.rs](../../rust/app/src/store.rs). | Pola adaptor terenkripsi per-akun sudah tersedia dan siap diekstrak menjadi trait/registry internal yang seragam sebelum membuka integrasi eksternal (MCP). |
| **AI Workspace & Guard** | [ai/provider.rs](../../rust/app/src/ai/provider.rs#L246-L275) baru mengekspos tool `read_artifact` dan `write_artifact` di `agent-workspace/<account-hash>/`; [pilot/cases.rs](../../rust/app/src/pilot/cases.rs#L319) menambahkan `/api/ai/preview`. | Perlu pemisahan tegas antara tool baca (*evidence/toolbox*) dan tool tulis (*proposal diff* via [pilot/git_apply.rs](../../rust/app/src/pilot/git_apply.rs)), dengan konfirmasi manusia wajib sebelum eksekusi. |
| **Log Beautifier & Utilitas** | [log-beautifier.ts](../../src/lib/ocp/log-beautifier.ts#L30) (`expandNestedJsonStrings`) dan [PrettifyModal.tsx](../../src/components/PrettifyModal.tsx#L10) (`expandJsonStrings`) menduplikasi logika ekspansi JSON-dalam-string dan strip ANSI. | Keduanya dapat disatukan menjadi satu modul **Offline Dev Toolbox** tanpa koneksi jaringan, lalu diekspos sebagai tab/panel cepat bersama `SnippetPanel`. |
| **Navigasi & Preferensi** | [DashboardLayout.tsx](../../src/client/DashboardLayout.tsx#L25-L162) membagi jangkar utama (`Investigate`, `Chat`, `Workspace`, `Infrastructure`, `Activity`, `Setting`) dan [core.rs](../../rust/app/src/core.rs#L82-L91) memvalidasi scope preferensi per akun (`vm-cards`, `service-cards:*`, `infra-nav`). | Fitur baru tidak boleh menambah menu top-level per vendor; gunakan slot kontekstual dan utilitas yang terdaftar eksplisit. |

---

## 2. Riset Sumber Primer untuk Arsitektur Plugin

### A. Declarative Contribution Points vs Arbitrary UI Plugins
- **VS Code Contribution Points & Extension Host** mendokumentasikan bahwa UI (menu, view container, command) dideklarasikan secara statis pada manifest, sementara eksekusi kode terisolasi di Extension Host dan baru aktif saat dipakai (*lazy activation*). [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- **Backstage Composability** memisahkan komponen rute yang terdaftar eksplisit dari ekstensi UI terpadu agar shell navigasi tetap konsisten. [Backstage Composability](https://backstage.io/docs/plugins/composability/)
- **Keputusan untuk Multiplexity:** Jangan memuat bundle JS/HTML plugin pihak ketiga ke dalam webview Tauri (berisiko XSS terhadap CSP dan origin loopback). Gunakan **daftar slot UI bawaan** di frontend (mis. kartu sumber di `Investigate`, tab utilitas di `Workspace`, kartu metadata di `Infrastructure`) yang dipicu oleh kemampuan (*capabilities*) konektor dari backend.

### B. Model Context Protocol (MCP) sebagai Boundary Ekstensi Read-Only
- **Spesifikasi Tools MCP (`2025-11-25`)** mendefinisikan `tools/list` dan `tools/call` dengan skema JSON ketat, serta menekankan prinsip **human-in-the-loop** (indikator visual jelas dan konfirmasi eksplisit sebelum eksekusi tool). [MCP Tools Specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- **Transports & Otorisasi MCP** membedakan dua jalur:
  1. **`stdio`:** Komunikasi proses-ke-proses lokal untuk tool same-host dengan isolasi proses dan kredensial via environment minimal untuk satu klien.
  2. **Streamable HTTP:** Untuk server bersama/remote dengan TLS dan standar **OAuth 2.1 / RFC 8414 / RFC 9728**. [MCP Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- **Keputusan untuk Multiplexity:**
  1. **Fase 1 (Built-in Rust Adapter Trait):** Pertahankan Jira, Bamboo, SonarQube, Bitbucket/GHES, Checkmarx, dan Confluent sebagai adaptor native di Rust agar memakai satu pool HTTP, trust store CA perusahaan, dan penyimpanan kredensial `Store`.
  2. **Fase 2 (Sandboxed Read-Only MCP Client di Backend Rust):** Izinkan tim internal mendaftarkan server MCP (`stdio` lokal atau Streamable HTTP internal) di `Settings → Integrations` **khusus untuk tool baca** (mengambil tiket/report/metadata sistem internal perusahaan seperti *SAC*). Server MCP tidak pernah diberi akses tulis ke checkout Git, terminal SSH, atau `ocp_action`, dan seluruh output-nya melewati `ai::context::redact()`.

### C. Isolasi Desktop Tauri v2 & Validasi Patch Git
- **Tauri v2 Capabilities & Isolation Pattern** menegaskan bahwa webview secara default memiliki akses nol terhadap perintah sistem dan seluruh batas akses diatur via whitelist capability per window + CSP ketat. [Tauri v2 Security Capabilities](https://v2.tauri.app/security/capabilities/), [Tauri v2 CSP](https://v2.tauri.app/security/csp/)
- **Git Worktree & `git apply --check`** memungkinkan backend membuat direktori kerja sementara yang terisolasi dari checkout utama (`git worktree add`), memvalidasi patch unified diff tanpa menulis (`git apply --check`), menjalankan tes yang disetujui user, lalu menghapus worktree setelah verifikasi. [Git Worktree](https://git-scm.com/docs/git-worktree), [Git Apply](https://git-scm.com/docs/git-apply)

---

## 3. Desain Arsitektur Target: Plugin Registry & Dev Toolbox

### A. Kontrak Internal Rust (`ConnectorAdapter`)
Setiap konektor (bawaan maupun MCP *bridge* nantinya) dipetakan ke kontrak kemampuan yang terpisah antara baca dan tulis:

1. **`probe()`** → Memverifikasi konektivitas, versi server, dan scope efektif (mengisi `last_status` & `last_version` di `pilot_connectors`).
2. **`fetch_evidence(query)`** → Mengembalikan `EvidenceItem` ternormalisasi (judul, URL sumber, timestamp, revisi/commit, status redaksi, konten terbatas ukuran).
3. **`health_policy()`** → Menerapkan timeout, batas ukuran payload, pemblokiran redirect lintas-origin, dan verifikasi TLS berbasis CA perusahaan.
4. **Pemisahan Write:** Aksi tulis (submit Jira, edit config VM/Kong, restart workload) tidak pernah dipanggil otomatis oleh AI atau MCP; semuanya harus melewati endpoint terpisah dengan **Preview → Policy Check → Human Confirmation → `OperationReceipt`**.

### B. Dev Toolbox Local-First (100% Offline, Zero Network)
Untuk menggantikan kebiasaan developer menempel data sensitif kantor ke situs formatter eksternal:

1. **Konsolidasi Parser Lokal:** Gabungkan `expandNestedJsonStrings` dari [log-beautifier.ts](../../src/lib/ocp/log-beautifier.ts#L30) dan `expandJsonStrings` dari [PrettifyModal.tsx](../../src/components/PrettifyModal.tsx#L10) menjadi satu utilitas bersama di `src/lib/toolbox/`.
2. **Fitur Toolbox Tahap Awal (di tab `Workspace → Toolbox` atau drawer cepat):**
   - **JSON / Nested-JSON Beautifier & Path Filter** (mendukung log mentah dengan prefix timestamp + ANSI).
   - **JWT / Base64 Inspector Offline** (decode header/claims lokal tanpa verifikasi/pengiriman token keluar).
   - **Regex & Log Line Filter** (uji pola pencarian dan uji aturan redaksi terhadap contoh log sebelum dikirim ke AI).
   - **Local Diff Compare** (memanfaatkan [ChangePreview.tsx](../../src/components/ChangePreview.tsx) yang sudah ada).

### C. Policies & Redaction Guardrails (`Settings → Policies`)
- **Environment Allowlist / Denylist:** Konfigurasi eksplisit environment non-produksi yang diizinkan untuk restart/mutasi (menggantikan deteksi string statis di [pilot/ops.rs](../../rust/app/src/pilot/ops.rs#L8)).
- **Pola Redaksi Kustom:** Daftar regex tambahan milik organisasi (mis. format token internal, ID pelanggan, host internal) yang digabungkan ke `ai::context::redact()`.
- **Approved Local Check Commands:** Whitelist perintah validasi lokal per repo/service (mis. `cargo test`, `npm test`, `mvn test`) yang boleh dijalankan oleh Agent setelah patch diterapkan di `Workspace`.

---

## 4. Peta Evolusi Menu

Pertahankan 6 menu utama di [DashboardLayout.tsx](../../src/client/DashboardLayout.tsx) tanpa menambah menu per vendor:

1. **`Investigate`** — Kasus aktif + kartu kontekstual dari konektor yang aktif (OpenShift log, SARIF, Bamboo/Sonar, dan selanjutnya Jira/Bitbucket/GHES/Checkmarx).
2. **`Chat`** — Tanya AI Agent dengan lampiran *Evidence Case* dan preview payload teredaksi.
3. **`Workspace`** — Tab `Changes` (Git worktree + unified diff + local test runner), tab `Artifacts`, dan tab `Toolbox` (offline JSON/JWT/regex utilities).
4. **`Infrastructure`** — Grup collapsible `VM Machines`, `Databases`, `Konga`, `Openshift`, dan (tahap berikut) `Confluent Metadata`.
5. **`Activity`** — Audit log `OperationReceipt` tersanitasi untuk seluruh mutasi (OpenShift rollout, VM systemd restart, edit config VM, dan mutasi Kong).
6. **`Setting`** — `Account`, `AI`, `Appearance`, `Agent`, `Integrations` (konektor + MCP read-only), dan `Policies`.
