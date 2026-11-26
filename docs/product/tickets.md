# Backlog Multiplexity

Status:
- **Gelombang Fondasi (`#1–#12`):** disetujui 25 November 2026; implementasi inti backend Rust ([pilot/](../../rust/app/src/pilot/mod.rs)) dan UI React ([Investigate.tsx](../../src/pages/Investigate.tsx), [Workspace.tsx](../../src/pages/Workspace.tsx), [Activity.tsx](../../src/pages/Activity.tsx), [IntegrationsSettings.tsx](../../src/components/IntegrationsSettings.tsx), [DashboardLayout.tsx](../../src/client/DashboardLayout.tsx)) telah mendarat pada working tree `0.3.0`.
- **Gelombang A + B (`#13–#20`) & Gelombang C (`#21–#24`):** disetujui dan diimplementasikan pada 26 November 2026 (`35` tes Rust, `3` tes Vitest `toolbox.test.ts`, `tsc`, `vite build`, dan `clippy` lulus; pengujian browser/desktop E2E serta konektivitas tenant enterprise nyata tetap menjadi gerbang verifikasi lapangan). Lihat [roadmap produk](local-first-roadmap.md), [riset integrasi enterprise](enterprise-integration-research.md), dan [riset arsitektur plugin & dev toolbox](plugin-and-toolbox-research.md).

Konteks: pilot local-first pada satu tim, satu service non-produksi, satu checkout Git dan satu provider AI yang disetujui.

Basis codebase aktual (`0.3.0` pasca-#1–#24): rute frontend aktif di [main.tsx](../../src/client/main.tsx#L30) adalah `/investigate`, `/chat`, `/workspace`, `/artifacts`, `/activity`, `/`, `/databases`, `/konga`, `/openshift`, `/confluent`, `/settings`; penyimpanan lokal SQLite di [store.rs](../../rust/app/src/store.rs#L83) memuat `evidence_cases`, `evidence_items`, `pilot_connectors`, `user_policies`, `mcp_servers`, `jira_drafts`, dan `operation_receipts`.

## #1 Kaitkan log OpenShift ke Evidence Case — P0

### What to build

Dari log pod pada [OpenshiftLogsModal.tsx](../../src/components/OpenshiftLogsModal.tsx) (yang sudah mengambil log via `ocp_get("logs")` di [integrations.rs](../../rust/app/src/integrations.rs#L512)), developer memilih cuplikan dan menyimpannya ke `Evidence Case` lokal dengan service/environment yang dipilih. Saat ini [context.rs](../../rust/app/src/ai/context.rs#L53) baru menerima sumber `vmId`, sehingga dukungan sumber OpenShift dan penyimpanan case/item baru dibangun di atas `redact()` ([context.rs](../../rust/app/src/ai/context.rs#L39)).

### User story

membaca log tanpa kehilangan konteks.

### Acceptance criteria

- [ ] Kasus terbuka kembali setelah restart pada web lokal dan desktop.
- [ ] Bukti menampilkan cluster/namespace/pod, waktu, sumber, dan status redaksi. Cuplikan dan data yang tersimpan dapat dihapus.
- [ ] Fixture mencakup log hilang, timestamp kosong, dan akses akun lain.

### Blocked by

Tidak ada. Dapat dimulai langsung.

## #2 Buat ringkasan dengan sumber dan preview pengiriman — P0

### What to build

Dari kasus, developer memilih bukti yang boleh dipakai, melihat preview tujuan/provider dan data teredaksi yang akan dikirim, lalu menyimpan analisis sebagai Artifact. Saat ini [ChatWorkspace.tsx](../../src/components/ChatWorkspace.tsx#L300) sudah memiliki dialog persetujuan `permission === 'ask'` (`Izinkan` / `Batal`) dan tautan `message.artifact`, tetapi baru menampilkan jumlah sumber dan nama provider tanpa preview isi payload maupun keterikatan ke `Evidence Case`.

### User story

Ask AI, analisis dan ringkasan yang bisa diperiksa.

### Acceptance criteria

- [ ] Ringkasan merujuk ke Evidence Item yang dipilih dan membedakan fakta serta hipotesis.
- [ ] Preview dan pembatalan tersedia sebelum pengiriman data. Fixture membuktikan tidak ada pengiriman ketika dibatalkan.
- [ ] Instruksi di log diperlakukan sebagai data. Kasus menyimpan jejak provider dan evidence yang digunakan.

### Blocked by

Tiket #1.

## #3 Tinjau dan terapkan diff pada checkout terpilih — P0

### What to build

Developer mengaitkan checkout Git ke kasus, meninjau proposal per file, lalu memilih apply lokal. Saat ini [cli.rs](../../rust/app/src/ai/cli.rs) dan [core.rs](../../rust/app/src/core.rs) baru mengelola `agent-workspace/<account-hash>/` (dengan mode `allow-all` terpisah), sedangkan [Artifacts.tsx](../../src/pages/Artifacts.tsx) baru memiliki `ChangePreview` untuk isi artifact. Tiket ini menambahkan manajemen checkout Git lokal, validasi path/revisi, dan apply/undo terpisah dari `allow-all`.

### User story

AI membantu memperbaiki kode pada komputer lokal.

### Acceptance criteria

- [ ] Tampilkan repo, revisi, dan perubahan per file sebelum apply.
- [ ] Tolak file di luar root, symlink yang keluar, patch basi, dan konflik dengan perubahan pengguna. Apply yang gagal dapat dipulihkan.
- [ ] Tampilkan diff aktual serta cara undo. Commit/push tidak terjadi dari langkah ini.

### Blocked by

Tiket #2.

## #4 Impor report yang tersedia sebagai evidence — P1

### What to build

Impor satu format report yang disepakati bersama pilot, misalnya SARIF 2.1.0, untuk analisis temuan defensif yang sudah tersedia.

### User story

membaca report SAST/SCA/quality dan merencanakan perbaikan.

### Acceptance criteria

- [ ] Temuan mencatat sumber, rule, severity, file/baris, dan revisi jika tersedia. Temuan duplikat dapat dikenali.
- [ ] File rusak/terlalu besar ditolak dengan alasan yang jelas. Impor tidak memicu scan maupun aksi remote.
- [ ] Evidence bisa dibuka kembali dan dipilih untuk alur ringkasan yang sama.

### Blocked by

Tiket #1.

## #5 Buka satu run CI dari Evidence Case — P1

### What to build

Sambungkan satu instance Bamboo read-only, masukkan build key/link, dan ambil status serta log gagal ke kasus. Jika pilot lebih membutuhkan SonarQube, ganti dengan satu adaptor read-only untuk quality gate/finding pada revisi terkait.

### User story

membaca log dan report CI enterprise tanpa berpindah alat.

### Acceptance criteria

- [ ] Developer dapat menguji koneksi dan melihat scope yang efektif pada instance pilot.
- [ ] Source URL, run/branch/commit, waktu, dan kegagalan akses tampil dengan jelas.
- [ ] Fixture mencakup run sukses/gagal, izin ditolak, batas data, dan log tersedia sebagian.

### Blocked by

Tiket #1.

## #6 Serahkan kasus ke Jira dengan draft yang ditinjau — P2

### What to build

Dari Artifact, susun draft Jira dengan ringkasan, link bukti yang boleh dibagikan, dan kriteria selesai. Simpan draft lokal terlebih dahulu.

### User story

menghubungkan hasil audit dan tindak lanjut ke tracker kantor.

### Acceptance criteria

- [ ] Developer dapat mengedit dan menyalin draft. Jika perpindahan manual terbukti menjadi hambatan, tambah submit eksplisit ke project yang diizinkan.
- [ ] Draft tidak menyalin log mentah secara otomatis. Jika submit diaktifkan, tampilkan issue key atau status gagal dan cegah duplikasi saat retry.

### Blocked by

Tiket #2.

## #7 Restart satu workload non-produksi dengan receipt — P2

### What to build

Dari target yang jelas di kasus, operator meninjau rencana dan menjalankan restart manual melalui izin upstream saat ini. Saat ini `ocp_action` (`rollout-restart` untuk `Deployment` dan `DeploymentConfig`) sudah tersedia di [integrations.rs](../../rust/app/src/integrations.rs#L859) dan [Openshift.tsx](../../src/pages/Openshift.tsx), namun belum memiliki pembatasan target non-produksi, preview dampak, maupun penyimpanan `Operation Receipt`.

### User story

menjalankan aksi operasional terkontrol dari aplikasi.

### Acceptance criteria

- [ ] Preview menampilkan cluster, namespace, workload, environment, dan dampak yang diketahui. Target di luar kebijakan pilot ditolak.
- [ ] Receipt lokal mencatat pelaku, target, waktu, hasil, dan pemeriksaan sesudah aksi dalam bentuk tersanitasi.
- [ ] Fixture memisahkan izin ditolak, sukses, timeout, dan kondisi rollout belum selesai.

### Blocked by

Tiket #1.

## #8 Buka kembali kasus dari sidebar Investigate — P0

### What to build

Setelah menyimpan cuplikan melalui tiket 1, developer dapat membuka rute baru `Investigate` (belum ada di [main.tsx](../../src/client/main.tsx#L30) maupun [DashboardLayout.tsx](../../src/client/DashboardLayout.tsx#L14)), melihat kasus lokal terbaru dan melanjutkan dari kasus yang sama di web lokal atau desktop.

### User story

melanjutkan investigasi log dan AI dari satu tempat.

### Acceptance criteria

- [ ] Klik simpan dari OpenShift membuka case yang tepat, dan sidebar menampilkan tujuan aktif.
- [ ] Deep link ke case berfungsi setelah reload atau restart. Case kosong, terhapus dan tidak berizin dibedakan.
- [ ] Tes UI mencakup akses keyboard dan tampilan sidebar yang diciutkan pada permukaan yang didukung.

### Blocked by

Tiket #1.

## #9 Sediakan Workspace di sidebar dengan tab Changes dan Artifacts — P0

### What to build

Evolusikan halaman `/artifacts` yang sudah ada ([Artifacts.tsx](../../src/pages/Artifacts.tsx), yang saat ini sudah memiliki tab `Source`, `Preview`, `Perubahan`, dan `Versi`) menjadi `Workspace` dengan tab `Changes` (diff checkout lokal dari kasus) dan `Artifacts`, sambil mempertahankan kompatibilitas tautan `/artifacts?name=...` dari [ChatWorkspace.tsx](../../src/components/ChatWorkspace.tsx#L292) dan [Settings.tsx](../../src/pages/Settings.tsx#L40). Pertahankan `Snippet` pada panel kanan ([DashboardLayout.tsx](../../src/client/DashboardLayout.tsx#L68)) dan tautkan jika diperlukan.

### User story

melanjutkan perbaikan lokal dari bukti dan menemukan kembali hasil AI.

### Acceptance criteria

- [ ] Tautan hasil AI lama menuju Artifact tertentu tetap dapat dibuka, termasuk setelah reload.
- [ ] Workspace meneruskan identitas case, repo dan revisi ke Changes dan menyediakan jalan kembali ke case.
- [ ] Jika backend lokal tidak dapat mengakses checkout, UI menjelaskan kondisi tersebut dan tetap menampilkan Artifact.

### Blocked by

Tiket #3.

## #10 Kelompokkan alat yang ada di menu Infrastructure — P1

### What to build

Ubah menu datar saat ini di [DashboardLayout.tsx](../../src/client/DashboardLayout.tsx#L14-L21) (`VM Machines`, `Databases`, `Konga`, `Openshift`) menjadi grup `Infrastructure` yang bisa dibuka/tutup. Jika status grup dipersistenkan, perluas validasi `scope_valid` di [core.rs](../../rust/app/src/core.rs#L82-L91) yang saat ini baru mengizinkan `vm-cards` dan `service-cards:*`.

### User story

mengakses alat on-prem dari satu aplikasi.

### Acceptance criteria

- [ ] Semua URL lama, target aktif, tombol back, dan akses keyboard tetap berfungsi. Grup aktif terbuka saat pengguna masuk melalui deep link.
- [ ] Panel kanan Chat dan Snippet tetap bisa dipakai. Kondisi sidebar kecil diuji pada web lokal dan desktop.
- [ ] Jika status grup disimpan, preferensi divalidasi per akun dan tidak bentrok dengan pengaturan urutan kartu.

### Blocked by

Tidak ada. Dapat dimulai langsung.

## #11 Kelola konektor pilot di Settings → Integrations — P1

### What to build

Tambahkan tab/halaman `Integrations` pada [Settings.tsx](../../src/pages/Settings.tsx#L14) (yang saat ini berisi `Account`, `AI`, `Appearance`, `Agent`) untuk memasang profil konektor bawaan yang dipilih di tiket 5, memeriksa akses baca, dan membuka entry point-nya pada kasus. Tiket 5 memiliki pengambilan evidence. Tiket 11 menambahkan pengelolaan lifecycle dan penemuan konektor di UI.

### User story

mengatur sumber CI atau quality perusahaan di Multiplexity.

### Acceptance criteria

- [ ] Developer dapat menambah, menguji, dan menonaktifkan satu koneksi. UI memperlihatkan instance, versi jika tersedia, dan status pemeriksaan izin. Token tersimpan secara lokal dan tidak dikembalikan ke frontend.
- [ ] Konektor tampil sebagai kartu sumber di Investigate ketika aktif. Saat dinonaktifkan, pengambilan baru berhenti dan evidence lama tetap bisa dibaca dengan statusnya ditandai.
- [ ] Fixture mencakup koneksi berhasil, izin kurang, TLS gagal dan konektor nonaktif. Konektor kedua menjustifikasi perluasan kontrak. Tidak ada marketplace atau loader plugin pihak ketiga di tiket ini.

### Blocked by

Tiket #5.

## #12 Temukan riwayat aksi dari sidebar Activity — P2

### What to build

Tambahkan rute `Activity` (belum ada di [main.tsx](../../src/client/main.tsx#L30) maupun [store.rs](../../rust/app/src/store.rs)) untuk mencari `Operation Receipt` yang dibuat lewat tiket 7 dan kembali ke kasus terkait.

### User story

memastikan apa yang terjadi sesudah aksi remote dan menindaklanjuti kegagalan.

### Acceptance criteria

- [ ] Developer dapat memfilter aksi menurut environment, target dan hasil, lalu membuka detail receipt yang tersanitasi.
- [ ] Sukses, ditolak, timeout dan hasil belum diketahui berbeda secara visual dan dapat dibaca pembaca layar.
- [ ] Halaman menguji isolasi akun dan tidak menyediakan tombol menjalankan ulang aksi.

### Blocked by

Tiket #7.

---

## Gelombang A — Penutup Loop Lokal (AI → Patch → Worktree → Verifikasi)

## #13 Hubungkan streaming AI di Investigate ke proposal diff di Workspace — P0

### What to build

Setelah konfirmasi pada dialog **Preview Pengiriman** di [Investigate.tsx](../../src/pages/Investigate.tsx), kirim prompt beserta `caseId` dan `evidenceIds` terpilih ke `/api/ai/chat` (streaming SSE), simpan hasil analisis sebagai Artifact tertaut kasus, dan tampilkan proposal perubahan kode per file yang dapat langsung dibuka ke tab `Changes` di [Workspace.tsx](../../src/pages/Workspace.tsx).

### User story

AI Agent menganalisa bukti kasus dan langsung menghasilkan proposal perubahan kode siap-tinjau di komputer lokal.

### Acceptance criteria

- [ ] Pembatalan pada Preview Pengiriman tetap membatalkan seluruh panggilan `/api/ai/chat`.
- [ ] Proposal perubahan dari respons AI memetakan path relatif, alasan per file, serta referensi `Evidence Item`, dan membuka `Workspace → Changes` dengan prefill patch.
- [ ] Mode `allow-all` tetap terisolasi; perubahan pada checkout Git pengguna hanya terjadi lewat konfirmasi eksplisit di `Workspace`.

### Blocked by

Tiket #2 dan #3.

## #14 Terapkan unified diff melalui `git worktree` dan `git apply --check` — P0

### What to build

Perluas [git_apply.rs](../../rust/app/src/pilot/git_apply.rs) agar mendukung unified diff hunk menggunakan `git apply --check` di dalam *linked worktree* terisolasi (`git worktree add` / `remove`) sebelum menyentuh checkout utama, termasuk menjalankan perintah test lokal yang diizinkan dan menyimpan hasil verifikasinya ke Artifact/Kasus.

### User story

Memastikan patch AI divalidasi dan diuji pada lingkungan terisolasi sebelum diterapkan ke working tree utama.

### Acceptance criteria

- [ ] `preview` menjalankan `git apply --check` pada worktree sementara dan membersihkan worktree setelah selesai atau gagal.
- [ ] Path traversal, symlink keluar root, patch basi (`HEAD` berubah), dan konflik working tree ditolak sebelum penulisan.
- [ ] Hasil dry-run maupun test lokal tersimpan di Artifact tanpa pernah menjalankan `git commit` atau `git push`.

### Blocked by

Tiket #3.

## #15 Samakan gerbang redaksi & preview pengiriman pada `AIAnalyzeModal` — P1

### What to build

Arahkan [AIAnalyzeModal.tsx](../../src/components/AIAnalyzeModal.tsx) (yang digunakan oleh [ServiceLogsModal.tsx](../../src/components/ServiceLogsModal.tsx) dan [OpenshiftLogsModal.tsx](../../src/components/OpenshiftLogsModal.tsx)) agar melewati redaksi backend `redact()` dan menampilkan preview tujuan provider serta cuplikan teredaksi sebelum memanggil `/api/ai/analyze`.

### User story

Mencegah kebocoran kredensial saat developer menganalisis log langsung dari modal VM SSH maupun OpenShift.

### Acceptance criteria

- [ ] Cuplikan log yang dikirim dari `ServiceLogsModal` dan `OpenshiftLogsModal` selalu melewati `redact()` sebelum keluar ke provider AI.
- [ ] Pengguna melihat tujuan provider/model dan cuplikan teredaksi serta dapat membatalkan sebelum pengiriman jaringan terjadi.
- [ ] Fixture membuktikan token `Bearer`, `password=`, dan `sk-*` tidak terkirim ke mock provider.

### Blocked by

Tiket #2.

## #16 Parsing terstruktur log gagal & quality gate untuk Bamboo dan SonarQube — P1

### What to build

Perluas `fetch_ci_run` di [connectors.rs](../../rust/app/src/pilot/connectors.rs) agar mem-parsing respons Bamboo (status build, branch, commit SHA, stage/job gagal, dan cuplikan log ekor) serta SonarQube (status quality gate, metric kondisi gagal, dan ringkasan issues per severity/file/line) menjadi metadata terstruktur pada `Evidence Item`.

### User story

Membaca ringkasan build gagal dan temuan quality gate secara cepat di `Investigate` tanpa membaca JSON mentah.

### Acceptance criteria

- [ ] Kartu `Evidence Item` bertipe `ci_run` menampilkan status build/quality gate, branch, commit SHA, dan tautan sumber resmi.
- [ ] Pemotongan log panjang dan status parsial (mis. hasil build ada namun log job tidak dapat diakses) ditandai eksplisit.
- [ ] Fixture mencakup Bamboo build sukses/gagal dan SonarQube `OK`/`ERROR` quality gate.

### Blocked by

Tiket #5 dan #11.

---

## Gelombang B — Audit Mutasi Operasional & Offline Dev Toolbox

## #17 Sambungkan eksekusi nyata `rollout-restart` OpenShift + status rollout ke `OperationReceipt` — P1

### What to build

Hubungkan `restart_execute` di [ops.rs](../../rust/app/src/pilot/ops.rs) ke eksekusi nyata OpenShift (`ocp_action` di [integrations.rs](../../rust/app/src/integrations.rs#L859)) menggunakan kredensial cluster terenkripsi, diikuti pemeriksaan singkat status rollout replica untuk membedakan `success`, `denied`, `timeout`, dan `unknown` pada `OperationReceipt`.

### User story

Menjalankan restart workload OpenShift non-produksi secara nyata melalui izin cluster dengan jejak audit terverifikasi di `Activity`.

### Acceptance criteria

- [ ] Target cluster produksi atau environment di luar kebijakan pilot tetap ditolak sebelum panggilan HTTP keluar.
- [ ] HTTP 401/403 tercatat sebagai `denied`, timeout jaringan sebagai `timeout`, dan rollout belum siap dalam batas tunggu sebagai `unknown`.
- [ ] Receipt tersanitasi bebas dari token OpenShift dan dapat ditelusuri di `/activity`.

### Blocked by

Tiket #7 dan #12.

## #18 Terapkan Preview, Policy Non-Produksi, dan `OperationReceipt` untuk aksi VM dan Kong — P2

### What to build

Lengkapi aksi mutasi yang sudah ada — `service_action` (systemd restart/start/stop) dan `save_file` (edit config VM) di [machines.rs](../../rust/app/src/machines.rs#L409-L557), serta `kong_mutate` di [integrations.rs](../../rust/app/src/integrations.rs#L362) — dengan alur `Preview → Policy Check → OperationReceipt` agar seluruh trigger perubahan config dan restart server tercatat di `/activity`.

### User story

Menyatukan seluruh aksi operasional (config change & server restart) dalam satu jejak audit terpusat yang aman.

### Acceptance criteria

- [ ] Setiap mutasi VM systemd, edit file VM, dan CRUD Kong menghasilkan `OperationReceipt` dengan aktor, target, waktu, ringkasan tersanitasi, dan status (`success`/`denied`/`timeout`/`unknown`).
- [ ] Perubahan file config VM dan Kong menampilkan preview diff/payload sebelum konfirmasi.
- [ ] Target yang ditandai produksi oleh kebijakan ditolak sebelum eksekusi.

### Blocked by

Tiket #7 dan #12.

## #19 Sediakan `Workspace → Toolbox` (Offline JSON/Nested-JSON, JWT, Regex & Diff) — P1

### What to build

Konsolidasikan parser rekursif dari [log-beautifier.ts](../../src/lib/ocp/log-beautifier.ts#L30) dan [PrettifyModal.tsx](../../src/components/PrettifyModal.tsx#L10) ke modul bersama `src/lib/toolbox/`, lalu tambahkan tab `Toolbox` di [Workspace.tsx](../../src/pages/Workspace.tsx) berisi JSON/Nested-JSON Beautifier, JWT/Base64 decoder offline, penguji regex log/redaksi, dan diff teks lokal.

### User story

Menggunakan JSON Beautifier dan utilitas debug sehari-hari secara 100% lokal/offline tanpa menempel data perusahaan ke situs publik.

### Acceptance criteria

- [ ] Seluruh fitur `Toolbox` bekerja penuh saat offline tanpa satu pun panggilan API eksternal.
- [ ] `PrettifyModal` dan `OpenshiftLogsModal` memakai utilitas parser bersama tanpa duplikasi logika.
- [ ] Tes unit memverifikasi ekspansi nested JSON, strip ANSI, dan decode JWT lokal tanpa mengirim token keluar.

### Blocked by

Tiket #9.

## #20 Tambahkan `Settings → Policies` untuk guardrails lokal dan redaksi kustom — P2

### What to build

Tambahkan tab `Policies` di [Settings.tsx](../../src/pages/Settings.tsx) dan penyimpanan tervalidasi per akun untuk mengelola allowlist environment non-produksi, daftar regex redaksi kustom organisasi (digabung ke `redact()`), batas karakter payload AI, serta daftar perintah test lokal yang diizinkan untuk `Workspace`.

### User story

Mengonfigurasi aturan keamanan lokal perusahaan dan perintah verifikasi kode tanpa mengubah kode sumber atau membypass guardrails.

### Acceptance criteria

- [ ] Regex redaksi kustom divalidasi saat disimpan (menolak pola invalid/ReDoS berlebihan) dan langsung diterapkan pada `/api/ai/preview` serta penangkapan bukti.
- [ ] Kebijakan non-produksi pada `ops.rs` membaca allowlist/denylist per akun dan tetap default-closed menolak `prod`/`production`.
- [ ] Daftar perintah test lokal hanya menerima command yang diizinkan eksplisit oleh pengguna.

### Blocked by

Tiket #11 dan #14.

---

## Gelombang C — Ekspansi Konektor Enterprise & Read-Only MCP

## #21 Tambahkan adaptor read-only Bitbucket Data Center / GitHub Enterprise Server di Investigate — P1

### What to build

Tambahkan profil konektor `bitbucket` dan `ghes` pada [connectors.rs](../../rust/app/src/pilot/connectors.rs) dan [IntegrationsSettings.tsx](../../src/components/IntegrationsSettings.tsx) untuk membaca PR, branch, commit SHA, serta tautan diff/workflow runs, dan menampilkannya sebagai kartu kontekstual di `Investigate`.

### User story

Menelusuri relasi lengkap `Jira Issue → Pull Request & Commit → CI Build → Checkout Lokal` tanpa berpindah alat.

### Acceptance criteria

- [ ] Pengguna dapat menguji koneksi, melihat versi/scope efektif (`REPO_READ` / GHES App read), dan menyimpan token terenkripsi per akun.
- [ ] PR dan commit tertaut ke `Evidence Case` beserta verifikasi kecocokan revisi dengan checkout Git lokal di `Workspace`.
- [ ] Fixture mencakup respons Bitbucket DC PR, GHES PR/Actions, izin ditolak, dan TLS gagal.

### Blocked by

Tiket #11 dan #16.

## #22 Tambahkan adaptor read-only Checkmarx One / CxSAST / SCA (SAC) dengan pemetaan lockfile — P2

### What to build

Tambahkan konektor baca hasil scan Checkmarx (`cxone` / `cxsast`) serta pengaitan temuan SCA/SAC ke manifest/lockfile lokal (`package-lock.json`, `Cargo.lock`, `pom.xml`) pada `Evidence Case`, melengkapi impor manual SARIF 2.1.0 di Tiket #4.

### User story

Mengambil dan memetakan temuan SAST/SCA langsung dari server keamanan perusahaan ke file dan dependensi lokal untuk perbaikan defensif.

### Acceptance criteria

- [ ] Pengambilan bersifat read-only terhadap scan yang sudah ada (tidak memicu scan remote) dengan dukungan paginasi dan batas ukuran respons.
- [ ] Temuan SCA mencatat ekosistem, nama paket, versi terpasang, versi perbaikan, dan status kecocokan terhadap lockfile lokal.
- [ ] Duplikasi terhadap temuan SARIF pada revisi yang sama dapat dikenali.

### Blocked by

Tiket #4 dan #11.

## #23 Tambahkan kartu metadata Confluent (Kafka REST / Schema Registry) di Infrastructure — P2

### What to build

Tambahkan sub-tampilan read-only untuk `Confluent Cloud` / `Confluent Platform` di bawah grup `Infrastructure` ([DashboardLayout.tsx](../../src/client/DashboardLayout.tsx)) guna memeriksa daftar topic, consumer group lag summary, dan versi Schema Registry tanpa membaca event payload.

### User story

Memeriksa lag consumer dan perubahan skema saat triase insiden layanan event-driven dari satu aplikasi.

### Acceptance criteria

- [ ] Hanya metadata (topic, partition count, lag summary, subject/version schema) yang diambil dan ditampilkan; tidak ada endpoint consume payload pesan.
- [ ] Mendukung profil terpisah untuk Confluent Cloud dan self-managed REST Proxy + Schema Registry dengan TLS CA internal.
- [ ] Kartu metadata dapat ditautkan ke `Evidence Case` sebagai konteks investigasi.

### Blocked by

Tiket #10 dan #11.

## #24 Tambahkan Sandboxed Read-Only MCP Client di `Settings → Integrations` — P2

### What to build

Tambahkan klien MCP read-only di backend Rust (`stdio` lokal atau Streamable HTTP internal dengan TLS) yang dikelola lewat `Settings → Integrations` untuk memanggil `tools/list` dan `tools/call` milik server MCP internal perusahaan (termasuk adaptor sistem internal seperti *SAC*), dengan redaksi output dan konfirmasi manusia sebelum pemanggilan.

### User story

Memperluas Multiplexity ke sistem internal kantor yang belum memiliki adaptor bawaan tanpa mengorbankan isolasi desktop atau merilis ulang aplikasi.

### Acceptance criteria

- [ ] Server MCP berjalan di backend Rust dengan batas timeout/ukuran respons dan tidak pernah diberi akses tulis ke checkout Git, terminal SSH, atau `ocp_action`.
- [ ] Setiap pemanggilan tool MCP menampilkan nama server, nama tool, dan parameter untuk dikonfirmasi pengguna (*human-in-the-loop*), lalu output-nya melewati `redact()`.
- [ ] Tidak ada eksekusi kode atau UI bundle pihak ketiga di webview Tauri.

### Blocked by

Tiket #11 dan #20.
