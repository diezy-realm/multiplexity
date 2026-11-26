# Multiplexity

Versi aktif **0.3.0** menggunakan **Vite + React + backend Rust bersama + Tauri**.
Panduan aktif: [Menjalankan dan memverifikasi versi Rust](docs/rust-migration.md).

```powershell
npm install
npm run dev
# Desktop Tauri
npm run desktop:dev
# Installer Windows
npm run desktop:dist
```

Memerlukan Node.js 22.12+, Rust 1.97+, Windows C++ Build Tools dan WebView2 untuk
build desktop Windows. Data Rust dimulai dari profil baru. Windows Hello dinonaktifkan.
Backend web dan desktop menggunakan library Rust yang sama; Node hanya untuk
tooling development/build. Perintah `legacy:*` mempertahankan implementasi lama
sebagai referensi selama verifikasi.

---

Dokumentasi di bawah mencatat implementasi **Node/Electron sebelumnya**.
Gunakan panduan Rust di atas untuk launcher, data, keamanan dan build versi aktif.

Dashboard modern dan komprehensif untuk monitoring, manajemen Virtual Machine (VM), akses Web SSH Terminal interaktif, serta Multi-Database Query Console.

---

## 📌 Fitur Utama

- ⚡ **VM Monitoring & Status Tracking** — Pantau ketersediaan VM (online, offline, unreachable) secara real-time.
- 💻 **Web-Based SSH Terminal** — Akses konsol SSH langsung dari browser bertenaga **xterm.js** dan **SSH2**.
- 📡 **Real-Time Log Streaming** — Streaming log server dan aktivitas terminal berbasis **Socket.IO**.
- 🗄️ **Multi-Database Query Console** — Query editor interaktif dengan **CodeMirror** yang mendukung **SQLite**, **PostgreSQL**, dan **MySQL**.
- 🔐 **Keamanan Tinggi & Enkripsi Data** — Kredensial VM dienkripsi menggunakan algoritma **AES-256**, serta sesi diamankan dengan **JWE terenkripsi (JOSE), cookie HttpOnly, dan CSRF**.
- 🤖 **AI Provider Integration** — Konfigurasi provider AI terintegrasi untuk bantuan analisis sistem.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite 8.3.8, React Router 7.18.7
- **Backend**: satu server Node.js 22 untuk web dan Electron
- **Styling**: Tailwind CSS
- **Authentication**: Credentials bcrypt, sesi JWE JOSE, kompatibel cookie/token versi sebelumnya
- **Database**: Better-SQLite3
- **SSH & Terminal**: ssh2, @xterm/xterm, @xterm/addon-fit
- **Real-Time Communication**: Socket.IO
- **Database Drivers**: pg (PostgreSQL), mysql2 (MySQL), better-sqlite3 (SQLite)
- **Testing**: Vitest, React Testing Library, Fast-Check

---

## 📋 Prasyarat

- **Node.js** 22.12 atau lebih baru pada major 22
- **npm** atau package manager kompatibel

---

## 🚀 Panduan Instalasi & Menjalankan

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd multiplexity
npm install
```

### 2. Development lokal — web dan desktop berbagi sumber

```powershell
npm run dev
```

Buka [http://localhost:3300](http://localhost:3300). Pada kunjungan pertama,
buat akun lokal melalui halaman login. Tidak perlu seed, installer Electron,
atau dua terminal. `npm run dev:server` adalah alias perintah yang sama.

- Satu server Node menjalankan API dan Socket.IO; Vite middleware melayani frontend development.
- Komponen Chat/P1/P2, Artifact, VM, Database, Konga dan Settings menggunakan
  sumber yang sama dengan Electron. Fast Refresh/HMR tersedia saat development.
- Cache Vite di `node_modules/.vite/`; build di `dist/client/` dan `dist/server/`.
- Database, workspace dan kunci development di `.local-dev/`, di-ignore Git.
  Kunci dibuat otomatis sekali dan dipertahankan antar-restart. Folder ini
  merupakan profil development tersendiri.
- CLI detection/models/chat tersedia pada mesin yang menjalankan server lokal.
  Connect pada Windows membuka terminal login CLI resmi.
- Windows Hello memakai WebAuthn browser pada localhost; ketersediaan PIN/biometrik
  mengikuti browser dan perangkat, serta perlu didaftarkan pada akun dev.

Port alternatif (gunakan satu alamat localhost secara konsisten):

```powershell
$env:PORT = '3301'
npm run dev
```

`MANAGER_DEV_DATA_PATH` dapat menentukan direktori profil development lain.
Mode ini bind ke loopback, memeriksa Host/Origin, dan tidak mengaktifkan CLI
pada deployment web production. `Ctrl+C` menghentikan server dan koneksi lokal.

### Web + Electron dengan live development yang sama

```powershell
npm run desktop:dev
```

Perintah ini menyalakan server web lokal dan membuka Electron development.
Browser juga dapat membuka URL localhost yang tercetak pada terminal.
Pilih salah satu launcher: `dev` untuk browser, atau `desktop:dev` untuk
Electron + browser; keduanya memakai port/profil development yang sama.
Edit komponen/page/style diperbarui melalui HMR Vite. Perubahan backend/API,
handler Socket.IO, route baru dan launcher memerlukan restart. Akun/data berasal
dari backend dev yang sama, sedangkan sesi browser dan Electron login terpisah.
Electron dev memakai sandbox dan profil browser di `.local-dev/electron/`.
Aplikasi desktop terpasang tetap menjalankan hasil build installernya.

### 3. Web production

Konfigurasikan environment deployment berdasarkan nama variabel di
`.env.example`: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`,
`DATABASE_PATH` dan `PORT`. Gunakan kunci deployment sendiri. Kemudian:

```powershell
npm run build
npm start
```

`npm start` menjalankan custom server production beserta Socket.IO.
Bootstrap akun production mengikuti provisioning deployment existing;
first-run setup lokal dan CLI tidak diaktifkan oleh perintah production.

---

## Aplikasi Desktop Electron (Windows x64)

Desktop memuat frontend Vite dan backend Node.js lokal yang sama dengan web. Runtime Node ikut
dikemas sehingga pengguna installer tidak perlu memasang Node.js atau npm.
Mesin pembuat installer memerlukan **Node.js 22.12 atau lebih baru pada seri 22**,
npm, dan Windows x64. Gunakan `npm ci` untuk memasang dependency sesuai lockfile.

```powershell
npm ci
npm run desktop:build
npm run desktop:start
```

Saat pertama dibuka, buat username dan password melalui halaman login. Desktop
membuat database kosong tanpa akun default, data VM contoh, atau kredensial dari
seed. Mode web dan perintah seed existing tetap tersedia secara terpisah.

Untuk membuat installer Windows:

```powershell
npm run desktop:dist
```

Hasil berada di `release/Multiplexity-Setup-0.2.0-x64.exe`.
`npm run desktop:pack` menghasilkan folder aplikasi untuk pengujian tanpa installer.
Build harus dijalankan di Windows x64 karena runtime Node dan modul native
mengikuti OS/arsitektur mesin build. Installer saat ini belum ditandatangani dan
belum menyertakan auto-update.

Perintah verifikasi setelah `desktop:build`:

```powershell
npm run desktop:test
npm run desktop:smoke
```

Build desktop menjalankan pemeriksaan TypeScript. Lint dijalankan terpisah dengan
`npm run lint`; build desktop melewati lint karena kode web existing masih memiliki
pelanggaran lint yang perlu ditangani terpisah.

`desktop:test` memeriksa backend production: pembatasan akses lokal, pembuatan
akun pertama, login, autentikasi Socket.IO, dan shutdown. `desktop:smoke` memeriksa
setup dan login melalui form Electron, menampilkan dashboard sebentar, lalu keluar.
Keduanya memakai direktori data sementara di folder temp OS, bukan data pengguna.

Data desktop tersimpan di folder `app.getPath('userData')`, umumnya
`%APPDATA%/vm-login-dashboard/` saat development dan
`%APPDATA%/Manager System Internal/` setelah dikemas:

- `dashboard.db` beserta file WAL/SHM: konfigurasi VM, database, akun, dan riwayat.
- `desktop-secrets.bin`: kunci enkripsi dan autentikasi yang dilindungi Electron
  `safeStorage`/Windows DPAPI. Jangan menghapus file ini saat database masih dipakai.

Untuk backup, tutup aplikasi lalu salin seluruh folder data. Kunci dilindungi
akun OS perangkat tersebut; penyalinan ke perangkat atau akun OS lain tidak
otomatis membuat kredensial dapat dibuka. Migrasi data web existing belum
disediakan. Uninstall mempertahankan data pengguna.

Backend hanya mendengarkan `127.0.0.1` pada port acak. Jendela desktop memakai
cookie akses sementara, autentikasi sesi JWE, renderer sandbox, dan tidak memiliki
akses Node.js langsung. Menutup aplikasi menghentikan backend beserta koneksinya.
Laptop tetap memerlukan akses jaringan/VPN ke VM dan database tujuan; fitur AI
memerlukan akses ke provider yang dikonfigurasi.

### Desktop 0.1.1: layout dan AI Chat

Pembaruan **0.1.2** menambahkan deteksi executable dari PATH tersimpan Windows
dan lokasi instalasi CLI umum, termasuk instalasi Codex standalone. Pengaturan
mendeteksi ulang saat dibuka atau provider diganti; tombol Deteksi memindai ulang
setelah CLI baru dipasang. Path folder `bin`, path berpetik, dan `%LOCALAPPDATA%`
dinormalisasi menjadi file executable. Connect dan Muat model menyimpan draft
yang valid lebih dahulu, sehingga tidak perlu menekan Simpan secara terpisah.

Card VM dan card Services dapat disusun melalui grip `⠿`, drag-and-drop, atau
panah atas/bawah saat grip mendapat fokus. Urutan disimpan di SQLite per akun;
urutan Services terpisah untuk setiap VM. Connect otomatis menyembunyikan daftar
VM, tanpa menutup sesi terminal ketika daftar ditampilkan kembali melalui panah judul.

AI Settings menyimpan koneksi terpisah untuk OpenAI, Claude, Codex CLI, Kiro CLI,
dan Antigravity CLI. API key dienkripsi; kolom key kosong mempertahankan key yang
tersimpan. Gunakan tombol Hapus key lalu Simpan untuk menghapus key secara eksplisit.

| Koneksi | Implementasi dan batas |
| --- | --- |
| OpenAI | Responses API dengan API key; model dibaca dari API akun. |
| Claude | Messages API dengan API key. Token langganan/OAuth tidak digunakan sebagai key API aplikasi. |
| Codex | CLI resmi dengan login milik pengguna; daftar model melalui app-server `model/list`. Key OpenAI langsung memakai koneksi OpenAI. |
| Kiro | CLI resmi, login CLI atau `KIRO_API_KEY` terenkripsi; daftar model dari CLI. Agent Chat tidak diberi tool lokal. |
| Antigravity | CLI `agy`, login resmi atau Gemini API key. Adapter hanya berjalan bila CLI mendukung `--settings` untuk kebijakan tool `strict`; versi tanpa dukungan ini ditolak. |

CLI dipasang terpisah dan harus tersedia sebagai executable native di PATH atau
melalui path lengkap pada AI Settings. Connect membuka terminal login resmi;
status ditemukan tidak berarti akun sudah login. Tidak ada token OAuth yang
diambil dari aplikasi lain. Model dan effort bergantung pada akses akun serta
versi provider. Dukungan CLI tidak berarti plugin, alias model, atau langganan
Codex desktop otomatis tersedia melalui OpenAI API.

Chat menyediakan attachment teks (maksimal 4 file, masing-masing 64 KB), pilihan
model/effort, dan sumber log `@` berupa unit systemd, container Docker, atau path
absolut file log. Tombol Chat pada card service langsung memilih sumber tersebut.
Sumber dibaca ulang ketika pesan dikirim. Kredensial umum direduksi sebelum dikirim,
tetapi pengguna tetap perlu memilih log yang boleh diproses provider.

`/diagnose`, `/summarize`, dan `/explain` menjalankan workflow bawaan. `!logs`,
`!status`, dan `!resources` menjalankan diagnostik baca-saja yang telah ditentukan;
command shell bebas tidak diterima. Plugins yang tersedia adalah Service logs
dan VM resources, bukan marketplace/MCP atau skill dari aplikasi Codex.

Permission Read only mengizinkan pembacaan sumber yang dipilih saat Kirim; Ask
memerlukan persetujuan tambahan sebelum sumber dibaca dan dikirim ke provider.
Allow All menggunakan flag native provider: Codex
`--dangerously-bypass-approvals-and-sandbox`, Kiro `--trust-all-tools`, dan
Antigravity `--dangerously-skip-permissions`. Mode ini mengizinkan tool CLI tanpa
konfirmasi; batas OS dan kebijakan organisasi tetap berlaku. Provider API hanya
menerima tool workspace aplikasi (list/read, serta write pada `artifacts/` ketika
Allow All), bukan eksekusi OS. Default tetap Read only: Codex memakai sandbox
read-only dengan shell tool dimatikan, Kiro agent tanpa tool, dan Antigravity
kebijakan strict headless. Ask menambah konfirmasi pengiriman sumber aplikasi.
Tombol Stop membatalkan operasi server dan permintaan provider; command SSH yang
sudah berjalan dibatasi dengan timeout. Riwayat per akun disimpan lokal; isi mentah
attachment dan snapshot log tidak disimpan sebagai riwayat tambahan.

Upgrade ini menambah tabel menggunakan `CREATE TABLE IF NOT EXISTS` dan mengimpor
konfigurasi OpenAI lama secara idempoten. Tidak ada penghapusan data VM existing.
Backup seluruh folder data saat aplikasi tertutup sebelum memasang installer baru.

### Desktop 0.1.5: UI dan gateway

- `MarkdownOutput` dipakai bersama Chat utama/kanan dan AI Analyze: heading,
  penekanan, tabel GFM, list, code block, dan unduhan `.md`. HTML mentah diabaikan,
  gambar eksternal tidak dimuat. AI Analyze juga menyimpan hasil ke Artifact.
- Seluruh selector native aplikasi memakai `Select` berbasis Radix dengan portal,
  navigasi keyboard, fokus, dan warna tema. `ModelInput` menggabungkan input ID
  model bebas dan pemilih model. Menu file terminal mempertahankan flow browsing.
- Scrollbar global mengikuti tema; sudut kontrol dan card diperhalus. Dialog
  AI Analyze memakai `Dialog` bersama (judul unik, fokus, Escape).
- Snipet tampil sebagai daftar. Klik item langsung menyalin isi; Tambah baru/Edit
  membuka form, Batal/Simpan menutupnya. Konten tidak dirender pada daftar.
- Appearance menyertakan Tokyo Night, Tokyo Night Storm, dan Tokyo Night Light
  dari upstream MIT dengan commit tersimpan di `src/lib/themes/presets.json`.
  Generator: `node scripts/refresh-theme-presets.cjs`; lisensi dikirim bersama app.
  Ini palette UI/terminal, bukan instalasi ekstensi VSIX atau syntax token themes.
- Menu Konga menyediakan CRUD Services/Routes, pagination, pencarian, dan koneksi
  Kong Admin URL per akun. Admin token disimpan terenkripsi dan tidak dikembalikan
  ke browser. Tombol Konga pada service VM mengisi nama/upstream sebagai draft;
  perubahan baru dikirim setelah Simpan.

Form upstream mendukung HTTP/HTTPS. Edit memakai PATCH agar field lanjutan Kong
yang tidak ditampilkan pada form tetap dipertahankan.

Konga adalah UI terpisah di atas Kong Admin API. Halaman Konga bukan endpoint
Admin API. Gunakan URL dari Connections Konga; default Kong HTTP adalah port 8001,
tetapi port tersebut pada host Konga menolak koneksi saat audit. Admin URL yang
diberikan pengguna, `http://172.18.139.190:4567`, merespons Kong 2.6.0 dan endpoint
Services/Routes dapat dibaca (HTTP 200). URL tersebut menjadi isian awal koneksi;
klik Hubungkan sekali untuk menyimpan konfigurasi per akun.
CRUD diverifikasi menggunakan fixture lokal, tanpa mengubah gateway aktif.
Konga lama mendokumentasikan kompatibilitas Kong 1.x; integrasi aplikasi memakai
endpoint Admin API Services/Routes dan tetap memerlukan versi/izin gateway yang sesuai.

Audit reuse: Dialog, Select, ModelInput, MarkdownOutput, ChatWorkspace,
AppearanceProvider, VMResourceBar, dan useCardOrder dipakai lintas flow.
Modal service/file/terminal yang memiliki lifecycle dan aksi berbeda tetap terpisah;
tidak dilakukan refactor menyeluruh di luar scope tampilan ini.

Referensi: [Kong Admin API](https://developer.konghq.com/admin-api/),
[Konga compatibility](https://github.com/pantsel/konga#compatibility),
[Tokyo Night](https://github.com/tokyo-night/tokyo-night-vscode-theme),
[Radix Select](https://www.radix-ui.com/primitives/docs/components/select),
[Redesign skill](https://github.com/elayadesign/redesign-skill),
[AI UX accessibility](https://aiuxplayground.com/skills/wcag-accessibility).

### Desktop 0.1.4: packaging

Shell Electron dikemas sebagai `resources/app.asar`. Backend tetap menggunakan
Node terpisah dari `resources/backend/`, berisi dependency hasil trace backend Node
dan custom server Socket.IO, driver database/SSH, serta native prebuild Windows.
Script `scripts/stage-desktop.cjs` menghasilkan paket tersebut dan menyertakan
file lisensi dependency. Seluruh dependency pengembangan tidak disalin ke installer.
Data akun, VM, Snipet, dan workspace tetap memakai folder data existing.

Pengukuran resource Windows x64: 10.338 → 2.537 file fisik (turun 75,5%),
343,9 → 119,4 MiB. Hook `afterPack` membandingkan hash seluruh file backend
dengan staging dan menolak paket yang kehilangan dependency atau berbeda versi.
Uji desktop paket dijalankan dari folder temporer di luar repository, termasuk
login, pengurutan card, panel Snipet/Chat, Artifact, tema, dan Windows Hello virtual.

Installer masih mengganti paket penuh. Upgrade pertama dari 0.1.3 tetap perlu
menghapus ribuan file paket lama; pengurangan file terutama membantu penyalinan
paket baru dan upgrade selanjutnya. Kecepatan aktual bergantung disk dan pemindaian OS.

Pengujian backend terisolasi dapat dijalankan dengan PowerShell setelah build:

```powershell
$env:DESKTOP_TEST_STAGED = '1'
node --test tests/desktop/backend.test.cjs
Remove-Item Env:DESKTOP_TEST_STAGED
```

Tes menyalin backend ke folder temporer di luar repository agar dependency lokal
tidak menyamarkan file runtime yang hilang.

### Desktop 0.1.3

- Navigasi: Chat, Artifact, VM Machines, Databases; Setting di bagian bawah.
- Panel kanan Snipet dan Chat dapat dibuka dari rail kanan. Isi Snipet dienkripsi
  pada database lokal, dipisahkan dari folder agent, dan tidak otomatis dikirim ke AI.
- Setiap akun memiliki satu folder `agent-workspace/<account-hash>/` di folder
  data aplikasi, dipakai semua provider. `AGENTS.md`, `rules.md`, `steering.md`,
  dan `skills/` menjadi instruksi bersama. Lokasi lengkap tersedia di Setting → Agent.
- Respons chat otomatis tersimpan sebagai Markdown di `artifacts/`. Halaman
  Artifact menyediakan editor teks dan unduhan, termasuk PDF/Office/gambar/ZIP
  yang dihasilkan CLI di folder tersebut. Batas unduhan 20 MB per file.
- Setting → Account mengubah password dengan password saat ini atau Windows Hello.
  Aktifkan Windows Hello sekali menggunakan password akun. Forget Password pada
  login membutuhkan credential Windows Hello yang sudah didaftarkan. PIN/biometrik
  diverifikasi dialog OS melalui WebAuthn; aplikasi tidak menerima atau menyimpan PIN.
  Perubahan password mencabut sesi lama dan memutus koneksi terminal akun tersebut.
- Setting → Appearance mengatur tema dan font UI/terminal, serta mengimpor palette
  color theme VS Code JSON/JSONC (warna editor/sidebar/panel/input/button/terminal
  dan ANSI). Ekstensi VSIX dan syntax token themes tidak diimpor.
- Perbaikan agy 1.5.16: bantuan `--help` dibaca dari stdout maupun stderr; policy
  `--settings` tidak lagi mengirim key `mcpServers` yang ditolak versi terpasang.
  Prompt sintetis berhasil memperoleh respons langsung pada pengujian lokal.

Installer memperbarui aplikasi existing dengan identitas dan folder data yang sama.
Tutup aplikasi sebelum upgrade. Update otomatis dari server belum dikonfigurasi.

Rujukan resmi yang ditinjau 25 November 2026:
[Codex app-server](https://developers.openai.com/codex/app-server),
[Kiro headless](https://kiro.dev/docs/cli/headless/),
[Kiro authentication](https://kiro.dev/docs/getting-started/authentication/),
[Antigravity authentication](https://antigravity.google/docs/install?tab=cli),
[Antigravity headless](https://antigravity.google/docs/cli/headless/),
[Claude authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).


## ⚙️ Manajemen Data VM

### Menghapus VM dari Seed

Jika Anda ingin membersihkan atau menghapus data test VM yang dibuat oleh seed:

#### Opsi 1: Menggunakan SQLite CLI
```bash
# Buka database SQLite
sqlite3 data/dashboard.db

# Cek daftar VM
SELECT id, label, host, username FROM vms;

# Hapus VM berdasarkan host (relasi vm_status akan terhapus otomatis via CASCADE)
DELETE FROM vms WHERE host = '<VM_HOST>' AND username = '<VM_USERNAME>';

# Verifikasi & keluar
SELECT * FROM vms;
.quit
```

#### Opsi 2: Menggunakan Script Node.js
Buat file `scripts/remove-vm.ts`:
```typescript
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'dashboard.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const result = db.prepare(
  "DELETE FROM vms WHERE host = ? AND username = ?"
).run('<VM_HOST>', '<VM_USERNAME>');

console.log(`Deleted ${result.changes} VM(s).`);
db.close();
```
Jalankan script:
```bash
npx tsx scripts/remove-vm.ts
```

#### Opsi 3: Reset Total Database
```bash
# Hapus file database SQLite
rm -f data/dashboard.db data/dashboard.db-shm data/dashboard.db-wal

# Inisialisasi ulang
npm run db:seed
```

---

## 🗄️ Skema Database

| Tabel | Deskripsi |
|-------|-----------|
| `users` | Data akun pengguna / administrator dashboard |
| `vms` | Daftar Virtual Machine (kredensial host, port, username, password terenkripsi) |
| `vm_status` | Status ketersediaan berkala tiap VM (*online*, *offline*, *unreachable*) |
| `sessions` | Tracking sesi login pengguna |
| `ai_settings` | Konfigurasi preferensi provider model AI |

---

## 📜 Skrip NPM

| Script | Deskripsi |
|--------|-----------|
| `npm run dev` | Development lokal: Vite + Node + Socket.IO + profil lokal |
| `npm run dev:server` | Alias development lokal |
| `npm run build` | Build frontend Vite dan backend Node |
| `npm run start` | Menjalankan aplikasi hasil build production |
| `npm run db:seed` | Inisialisasi dan seeding database SQLite |
| `npm run test` | Menjalankan unit test dengan Vitest |
| `npm run test:watch` | Menjalankan unit test dalam mode watch |
| `npm run test:coverage` | Menjalankan unit test dengan laporan cakupan (coverage) |
| `npm run lint` | Menjalankan audit kode dengan ESLint |

---

## 👨‍💻 Penulis / Author

- **Ariadi Ahmad (SilverBullet)**

---

## 📄 Lisensi & Ketentuan Penggunaan

Proyek ini dirilis di bawah lisensi **Custom Non-Commercial & No-Derivatives (CC BY-NC-ND 4.0 / Setara)**:

- ✅ **Bebas Digunakan**: Terbuka untuk umum digunakan sebagai referensi, pembelajaran, atau penggunaan personal/internal tanpa biaya.




## Multiplexity 0.1.6 — UI, gambar, dan AI Management

Nama produk menjadi Multiplexity; appId installer dan folder data packaged tetap menggunakan identitas lama agar upgrade mempertahankan database, akun, dan kunci. Installer tidak otomatis diperbarui dari server.

- Copy code di kanan atas setiap fenced code block; respons menyediakan ikon download/copy/waktu dan pesan pengguna menyediakan copy/edit/waktu saat hover atau fokus keyboard. Edit mengisi composer untuk pengiriman ulang. Summary menyiapkan prompt ringkasan agar pengguna dapat meninjau sebelum mengirim.
- Pemilih model tunggal berukuran tetap; refresh tidak menambah kontrol baru. Navigasi: Chat, VM Machines, Databases, Konga, Artifact. Logout pada sidebar bawah; header global dihapus. Tombol jendela mengatur panel kanan; Artifact pada composer dapat ditutup dengan klik ulang.
- Paste clipboard dan pemilih file menerima PNG/JPEG/WebP, maksimal 4 attachment total dan 2 MiB per gambar. Server memeriksa MIME, base64, signature dan batas payload 12 MB. SVG tidak diterima. Teks tetap maksimal 64 KB/file. Gambar ditampilkan sebelum Kirim; data gambar tidak otomatis disamarkan dan tidak disimpan dalam riwayat aplikasi. Riwayat lama tidak mengirim ulang gambar sebelumnya.
- Gambar diteruskan melalui OpenAI Responses, Claude Messages, endpoint chat OpenAI-compatible, atau flag --image Codex. File sementara Codex dibersihkan setelah proses. Kiro/Antigravity menolak gambar secara eksplisit sampai adaptor resmi yang sesuai tersedia. Pemilihan model vision menjadi tanggung jawab pengguna; respons provider akan menunjukkan model yang tidak mendukung.
- AI Management menampilkan konfigurasi tersimpan/CLI terdeteksi dan menyediakan Tambah, Edit/Connect serta Hapus. Satu konfigurasi per provider mengikuti skema existing. Menghapus konfigurasi aplikasi tidak melakukan logout akun CLI. Status deteksi executable bukan bukti autentikasi provider.
- Adaptor API tambahan: Gemini, Ollama dan Custom OpenAI-compatible (models dan chat/completions). Endpoint remote wajib HTTPS; HTTP hanya localhost. Tidak mengikuti redirect atau menerima kredensial pada URL. Custom dapat tanpa key untuk server lokal. Adaptor kompatibel ini mengirim chat/gambar, tanpa tool workspace atau effort tambahan. Provider harus benar-benar mendukung protokol/model tersebut; label kompatibel tidak menjamin semua fitur OpenAI.
- Tema tambahan: Vampire, Neon, Nord inspired, Monokai inspired dan Solarized inspired memakai palette UI original. Editor JSON/JSONC menerima type dan colors ala color theme VS Code; validasi warna dan key mengikuti dukungan existing. Preset Tokyo Night beserta lisensinya tetap dipertahankan.
- Skills senior: linux-admin, kong-admin, database, debugger. Dibuat secara idempoten pada workspace akun tanpa menimpa skill pengguna. Instruksi memuat verifikasi versi, bukti, pemeriksaan terbatas, rollback dan validasi. Skills berupa panduan, tidak menambahkan akses SSH/database/Kong baru.

Riset resmi ditinjau 25 November 2026:

| Area | Dasar resmi dan hasil |
| --- | --- |
| Gambar OpenAI | [Images and vision](https://developers.openai.com/api/docs/guides/images-vision): input gambar data URL untuk model vision |
| Claude | [Vision](https://platform.claude.com/docs/en/build-with-claude/vision): image blocks dengan source base64 |
| Codex | [CLI reference](https://developers.openai.com/codex/cli/reference): input gambar CLI, tanpa mengambil token dari aplikasi lain |
| Gemini | [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai): endpoint resmi dan API key Gemini |
| Ollama | [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility): models dan chat; vision tergantung model |
| CLI lain | [Claude Code headless](https://code.claude.com/docs/en/headless), [Gemini CLI headless](https://geminicli.com/docs/cli/headless/), [Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli) memiliki antarmuka programatik resmi. Ini kandidat adaptor terpisah; belum diiklankan sebagai koneksi CLI aktif pada rilis ini. Autentikasi, policy tool, pembatalan dan parsing output masing-masing perlu diuji sebelum diaktifkan |
| Linux / Docker | [journalctl](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html), [docker logs](https://docs.docker.com/reference/cli/docker/container/logs/): filter waktu/unit/container dan output terbatas |
| Kong | [Admin API](https://developer.konghq.com/admin-api/): kontrol gateway, cek versi sebelum CRUD |
| Database | [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html), [MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html): analisis plan sesuai engine; ANALYZE mengeksekusi query |

Koneksi AI berbayar, model vision nyata dan PIN Windows Hello fisik tidak otomatis diuji oleh suite sintetis.

Validasi rilis 0.1.6: 73 tes terkait lulus, build production/TypeScript lulus, lint komponen baru yang diperiksa bersih, backend production terisolasi lulus, serta smoke executable paket dari folder temporer di luar repository lulus (ISOLATED_MULTIPLEXITY_PACKAGE_OK). Verifikasi hash paket mencakup 2.554 file backend. File Terminal masih memiliki temuan lint existing; lint seluruh proyek tidak dinyatakan lulus. Installer Windows x64 berukuran sekitar 146,5 MiB. Pengujian ini tidak melakukan instalasi upgrade pada data pengguna nyata.

## Multiplexity 0.1.7 — topbar, identitas, dan streaming

- `PageHeader` menjadi satu topbar pada layout dashboard. `PageActions` menempatkan
  aksi halaman melalui portal; Chat kanan memakai toolbar inline, tanpa duplikasi judul.
- Footer Markdown memakai ukuran/hover `icon-action` yang sama untuk Download/Copy.
  Logout berada paling bawah rail kanan; toggle jendela kanan dihapus. Toggle kiri
  memakai chevron, bukan logo. Tabs Results/History memakai token tema bersama.
- Chevron Select memakai SVG terpusat agar baseline tidak bergantung glyph font.
- Chat memakai SSE dari route sampai frontend, indikator tahap/elapsed, cursor,
  progressive reveal, dan `prefers-reduced-motion`. Autoscroll berhenti saat pengguna
  menelusuri pesan lama. Stop membatalkan koneksi provider; jawaban parsial tidak
  disimpan sebagai hasil selesai. Riwayat/Artifact hanya diperbarui setelah sukses.

### Kemampuan stream per adaptor

| Provider | Implementasi |
| --- | --- |
| OpenAI API | SSE Responses API, `response.output_text.delta`; hasil/tool arguments direkonstruksi dari event final |
| Claude API | SSE `content_block_delta`, text dan JSON tool terpisah |
| Gemini / Ollama / Custom API | SSE OpenAI-compatible Chat Completions, `choices.delta.content` |
| Codex CLI | JSONL `item.updated`/`item.completed` untuk agent message; snapshot dideduplikasi. Versi CLI dapat hanya mengeluarkan teks pada akhir item |
| Antigravity CLI | JSONL `step_update`, hanya `agent_response.text_delta`; output tool mentah tidak diteruskan ke chat |
| Kiro CLI | Adaptor text existing dipertahankan; status menunggu dan reveal lokal setelah jawaban lengkap. Native stream-json Kiro terdokumentasi, tetapi pemetaan event belum diverifikasi pada CLI terpasang |

Reveal lokal merapikan tampilan fragmen besar dan hasil buffered; tidak diklaim
sebagai token streaming native. Endpoint kompatibel yang mengabaikan `stream:true`
dan mengembalikan JSON tetap ditangani sebagai buffered. Error/truncation stream
menjadi error UI, bukan pesan sukses. Tidak ada token reasoning tersembunyi yang
ditampilkan.

Riset resmi: [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses),
[Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
[Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai),
[Codex noninteractive](https://developers.openai.com/codex/noninteractive),
[Antigravity headless](https://antigravity.google/docs/cli/headless/),
[Kiro headless](https://kiro.dev/docs/cli/headless/).

### Aset produk

Dibuat menggunakan built-in imagegen, transparan; master di
`public/brand/multiplexity-mark.png`. `scripts/prepare-brand.ps1` menyiapkan varian
PNG kecil, ICO, dan `src/app/icon.png` tanpa mengubah master. Identitas installer
serta lokasi data existing dipertahankan agar upgrade tetap kompatibel.

Prompt final:

> Use case: logo-brand. Create a polished product app mark for Multiplexity, an internal desktop workspace unifying virtual machines, terminals, databases, API gateways and AI chat. Square composition, one bold compact abstract M formed from three smoothly interweaving signal paths, conveying multiplexed streams converging into one workspace. Softly rounded geometry, restrained cyan and periwinkle blue palette suitable for dark navy and light UI themes, crisp high-contrast silhouette legible at 24 pixels. Center the mark with modest safe padding. No stacked windows, no text, no letters except abstract M geometry, no decorative background, no mockup, no watermark. Transparent background. Deliver a clean premium raster app mark.

Pengujian langsung dengan prompt sintetis singkat berhasil pada Codex CLI dan agy
CLI terpasang, menggunakan workspace temporer baca-saja. Tidak mengirim log layanan
atau menjalankan tool server aktif. Uji provider API memakai server HTTP lokal
untuk membuktikan fragmen tampil sebelum koneksi ditutup, terminal stream wajib,
UTF-8 terfragmentasi, tool-call assembly, dan cancellation.

Validasi rilis 0.1.7: 105 tes terkait lulus, build production dan TypeScript lulus,
lint komponen/modul yang diubah bersih, backend production terisolasi lulus.
Executable paket dari folder temporer di luar repository lulus seluruh smoke,
termasuk fragmen HTTP sebelum completion, Stop/cancellation, alignment/hover footer,
enam topbar halaman, dan logo (ISOLATED_MULTIPLEXITY_017_PACKAGE_OK).
Verifikasi hash paket mencakup 2.560 file backend serta shell dan aset brand.
Provider cloud berbayar dan upgrade installer pada data pengguna nyata belum diuji.

## Multiplexity 0.1.8 — P1 / P2 workflow

P1: percakapan per akun dengan New/Rename/Search/Archive/Restore, migrasi aditif
pesan lama ke Riwayat, bukti sumber tersimpan, konteks aktif, Retry dari request
asal, informasi kemampuan adaptor, streaming/Stop AI Analyze, tautan hasil Artifact,
dan ConfirmDialog bersama untuk Chat, service actions, query, dan Konga.

P2: Artifact Source/Preview/Perubahan/Versi; 20 versi terakhir per file dari
penyimpanan melalui aplikasi; hash untuk menolak overwrite editor yang sudah stale.
Regenerate menyimpan versi jawaban baru, menggunakan prompt/konteks percakapan asal,
dan membaca ulang sumber terpilih. Jawaban lama tetap dapat dipilih. Lampiran mentah
tidak disimpan, sehingga regenerasi jawaban dengan lampiran memerlukan pesan baru.
Ringkas/Jelaskan pilihan mengisi composer untuk ditinjau sebelum dikirim.
Timeline mencatat event tahap nyata, tanpa reasoning tersembunyi atau persentase palsu.
Starter Analisis log/Cek resource/Ringkas insiden mengikuti sumber yang dipilih.

Batas: 100 pesan terakhir ditampilkan per percakapan dan 20 dipakai sebagai konteks
normal; daftar percakapan mencari judul. Cuplikan bukti maksimal 2.000 karakter per
sumber, berasal dari konteks analisis, bukan log terbaru; redaksi kredensial bersifat
best effort. Metadata model menunjukkan model yang diminta/default, bukan klaim
verifikasi kemampuan setiap model. Kiro tetap buffered + reveal. Perubahan file
langsung oleh CLI di luar aplikasi tidak otomatis menghasilkan versi. Preview
merender Markdown tanpa menjalankan HTML/JavaScript hasil AI.

Dasar eksternal: [output/refinement](https://aiuxplayground.com/teardowns/compare/output-artifacts-refinement),
[citations](https://aiuxplayground.com/teardowns/compare/trust-privacy-settings),
[approval](https://aiuxplayground.com/teardowns/compare/human-in-the-loop),
[contextual starters](https://aiuxplayground.com/teardowns/notion/onboarding),
[W3C dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
[SQLite migration](https://sqlite.org/lang_altertable.html). Teardown adalah
referensi UX; kemampuan produk ditentukan oleh adaptor dan hasil pengujian aplikasi.

Validasi 0.1.8: 163 tes terkait pada 19 file lulus (suite utama dan regresi
lanjutan), build production/TypeScript lulus, serta lint komponen/modul baru bersih.
Backend production terisolasi lulus. Paket executable yang disalin keluar repo
lulus seluruh smoke: ISOLATED_MULTIPLEXITY_018_PACKAGE_OK, termasuk
PRIORITIES_UI_SMOKE_OK untuk New chat, versi Regenerate, deep link Artifact,
Preview, Perubahan dan Versi; STREAMING_UI_SMOKE_OK untuk fragmen sebelum selesai
dan cancellation; KONGA_UI_SMOKE_OK untuk enam operasi CRUD fixture lokal.
Hash 2.563 file backend dan 11 file shell/lisensi cocok dengan hasil staging.

Batas verifikasi: pengujian inferensi memakai provider HTTP lokal sintetis, bukan
panggilan cloud berbayar atau server internal nyata. PIN Windows Hello hanya diuji
dengan authenticator virtual. Upgrade installer terhadap data pengguna nyata belum
dijalankan. Lint seluruh proyek belum bersih (antara lain explicit any pada halaman
Database/Services); tiga tes navigasi lama pada database-page.test.ts masih
mengharapkan markup statis sebelum navigasi dipindahkan ke layout bersama.

## Migrasi 0.2.0 — Vite, React Router, Node dan Electron

Satu implementasi frontend dan satu backend melayani browser maupun Electron.
Next.js dan next-auth telah dilepas dari dependency runtime. Nama environment
`NEXTAUTH_URL`/`NEXTAUTH_SECRET` dan cookie lama dipertahankan untuk kompatibilitas.

```text
src/client/           entry React Router, layout, auth client
src/pages/            VM, Chat, Artifact, Database, Konga, Setting, Login
src/components/       komponen UI bersama
src/styles/           CSS dan font lokal
src/server/routes/    handler HTTP berbasis Request/Response standar
src/server/auth/      JWE, CSRF, request scope dan autentikasi socket
src/lib/              layanan AI, SSH, database, Konga dan workspace bersama
server.ts             listener Node, HTTP streaming, Socket.IO, Vite dev/static
desktop/              host Electron dan verifikasi UI
```

`npm run dev` membuka web di localhost:3300. `npm run desktop:dev` membuka
Electron dan URL browser dari server/profil development yang sama. Jalankan salah
satu launcher. Jika npm belum ada pada PATH, gunakan `node scripts/local-web.cjs`
atau `node scripts/local-web.cjs --electron` setelah dependency terpasang.

`npm run build` membangun `dist/client` dan `dist/server`. `npm start` melayani
hasil build melalui Node; Vite dev server tidak diperlukan pada production.
Jalankan dari root aplikasi dan sertakan dependency production serta
`src/lib/db/schema.sql` (bundle juga menyediakan schema di `dist/server`).
`npm run desktop:dist` mengemas renderer yang sama, Node 22 dan driver native.

API tetap memakai URL sebelumnya. Registry 45 modul route ditambah handler auth
khusus menggantikan 46 modul Next sebelumnya. Registry dibuat oleh
`scripts/generate-routes.cjs`, otomatis pada development/build; jangan edit file
`routes.generated.ts` secara manual. Route/API/backend memerlukan restart pada dev.
Konga tersedia untuk akun web terautentikasi; koneksi dipisahkan per akun.

Sesi mempertahankan JWE dir/A256GCM, derivasi kunci dan nama cookie lama; akun,
password bcrypt, auth_version, enkripsi kredensial, folder desktop, appId dan
workspace tetap memakai format sebelumnya. Logout memakai CSRF. Ganti password
mencabut sesi/socket. HTTP mutation memerlukan Origin yang cocok dengan
`NEXTAUTH_URL`; reverse proxy harus mempertahankan Host publik tersebut.
Environment dimuat dengan urutan .env.<mode>.local, .env.local, .env.<mode>, .env;
variabel dari launcher/deployment memiliki prioritas.

Desktop tetap menjalankan driver native di Node terpisah, bukan di renderer atau
ABI Electron. Renderer memakai sandbox, contextIsolation dan nodeIntegration=false.
Profil development di .local-dev terpisah dari data aplikasi yang sudah terpasang.
Jangan mengganti encryption key saat menggunakan database existing.

Dasar eksternal:
[Vite middleware dan transformIndexHtml](https://vite.dev/guide/ssr#setting-up-the-dev-server),
[Vite backend integration](https://vite.dev/guide/backend-integration),
[React Router](https://reactrouter.com/start/declarative/installation),
[format sesi NextAuth v4 sebelumnya](https://github.com/nextauthjs/next-auth/blob/next-auth%404.24.14/packages/next-auth/src/jwt/index.ts),
[ABI native Electron](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).

Perintah crosscheck:

```powershell
npm run typecheck
npm test -- --maxWorkers=1
npm run web:test
npm run build
npm run desktop:build
npm run desktop:test
npm run desktop:smoke
```

Verifikasi memakai akun/profil temporer dan provider/Kong sintetis lokal. Pengujian
tersebut tidak membuktikan koneksi ke VM/database internal, OAuth CLI nyata, PIN
fisik, atau upgrade pada profil pengguna nyata. Installer tetap paket penuh,
belum menggunakan auto-update server. Angka pengujian 0.1.x di bagian sebelumnya
merupakan catatan versi lama, bukan bukti build 0.2.0.

Validasi migrasi: suite lengkap 912 tes / 69 file lulus; regresi terminal/query/auth
dan routing lulus setelah penyesuaian. TypeScript lulus. ESLint modul migrasi baru
(client, auth, HTTP, environment, entry server dan Vite config) bersih. Aturan
TypeScript recommended tetap dipertahankan; lint seluruh aplikasi masih memiliki
103 temuan pada komponen/handler lama (75 explicit any, 23 unused, 4 prefer-const,
1 require-imports) dan dua warning hook (Terminal dan Databases).
Integration web development, Electron development, web production dan backend
desktop terisolasi lulus. Web production mencakup schema akun lama, CLI nonaktif,
enam operasi Kong CRUD fixture, pemblokiran file privat dan boundary bundle client.
Smoke paket terisolasi mencakup geometri layout, first setup/login, terminal/card,
Windows Hello virtual, workspace/snippet/theme, Markdown, Konga, streaming/Stop,
Regenerate serta deep link/preview/versi Artifact. Build dan staging harus dijalankan
berurutan karena memakai direktori output yang sama.

Installer final: `release/Multiplexity-Setup-0.2.0-x64.exe` (145,9 MiB).
SHA-256: `d49e8bae1b65303e77d4340257b59d651130aa46bd2c6ec8e4296100055d390a`.
Verifikasi paket mencocokkan 1.053 file backend (110 MiB) dengan staging; bundle
backend web dan desktop identik byte per byte. Executable yang disalin ke luar
repository lulus `ISOLATED_MULTIPLEXITY_020_PACKAGE_OK` dengan exit code 0.
Installer belum dijalankan pada profil pengguna existing.

## Perbaikan dependency development lokal

Install dengan `npm install`, lalu `npm run dev` untuk browser atau
`npm run desktop:dev` untuk Electron + browser. Keduanya alternatif launcher;
jangan jalankan bersamaan pada port 3300. Tidak perlu seed atau reinstall aplikasi.

Script `electron-winstaller` sengaja ditolak melalui allowScripts karena target
installer proyek adalah NSIS, bukan Squirrel. Kebijakan paket lain tetap dipertahankan.
Perubahan mengikuti [konfigurasi npm allowScripts](https://docs.npmjs.com/cli/v12/configuring-npm/package-json#allowscripts).
Audit setelah pembaruan: 0 vulnerability pada dependency production; audit lengkap
masih melaporkan 6 moderate pada rantai alat packaging electron-builder/minimatch.
Jangan menjalankan audit fix --force hanya untuk menghilangkan angka ini: resolusi
audit yang ditawarkan mengganti major electron-builder dan perlu uji packaging terpisah.
Konfigurasi koneksi HMR menggunakan server.ws sesuai API Vite yang terpasang.
Pembaruan dependency ini belum dimasukkan ke installer 0.2.0 yang tercatat di atas.

## Composer dengan mode diagnostik

Chat utama dan panel kanan menggunakan ChatComposer yang sama. Tombol + memuat
mode Analisis log, Status service, Resource VM, Log + resource, serta sumber,
file, Artifact dan skill aplikasi. Hanya satu mode diagnostik aktif. Menghapus
mode mempertahankan konteks terpilih tetapi tidak mengirim sumber VM. Lampiran
dan skill terpisah dari mode. Pengaturan AI memuat effort, permission dan refresh
model; provider/model tetap di toolbar. Shortcut @, / dan ! tetap tersedia.

Mode dipetakan ke diagnostic/includeResources/sources API existing, tanpa endpoint
baru. Pemilihan mode tidak menjalankan SSH; service discovery terjadi saat memilih
sumber, dan log/resource dibaca saat kirim. Ask memakai snapshot request dan
approval; perubahan konfigurasi atau konteks membatalkan dialog approval lama.

Verifikasi UI khusus: node --test tests/web/composer-ui.test.cjs. Test memakai
profil temporer, sumber/payload sintetis, serta provider HTTP streaming lokal;
tidak membaca VM internal atau memakai provider cloud berbayar. Screenshot
disimpan di folder temporer yang dicetak oleh test. Test menampilkan window
sementara tanpa mengambil fokus untuk memastikan screenshot bukan frame lama.
Folder dist, desktop-dist, release, profil lokal dan backend tidak memicu HMR
renderer; perubahan backend memerlukan restart. Installer 0.2.0 terdahulu belum
memuat perubahan composer ini.

Validasi composer: 28 tes UI/composer terkait lulus; 34 tes API chat, streaming,
percakapan dan lampiran lulus. Suite penuh mencakup 928 tes/70 file: 927 lulus
pada run awal; satu gagal pada atomic rename Artifact dengan EPERM Windows,
kemudian keenam tes workspace-vault lulus pada run terpisah. TypeScript dan lint
file yang diubah lulus. Smoke web development dan renderer Electron development
lulus (mode/payload, inactive sources, keyboard, tema, panel kanan, reduced motion,
streaming HTTP dan Stop); screenshot final diperiksa setelah window dirender.
Build Vite/backend Node dan staging desktop berhasil. Pengujian executable
production terpisah belum terkonfirmasi; installer tidak dibuat ulang pada tugas ini.
Backend desktop production terisolasi juga lulus: setup/login, autentikasi Socket.IO, pencabutan sesi setelah ganti password, dan shutdown. Server development akhir merespons HTTP 200 pada /login di localhost:3300.
