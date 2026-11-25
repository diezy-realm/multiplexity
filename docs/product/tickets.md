# Backlog Multiplexity

Status: disetujui dan dikunci pada 25 November 2026. Nomor #1–#12 adalah ID lokal untuk dependensi dalam dokumen ini.

Konteks: pilot local-first pada satu tim, satu service non-produksi, satu checkout Git dan satu provider AI yang disetujui. Lihat [roadmap produk](local-first-roadmap.md) dan [riset integrasi enterprise](enterprise-integration-research.md).

## #1 Kaitkan log OpenShift ke Evidence Case — P0

### What to build

Dari log pod, developer memilih cuplikan dan menyimpannya ke kasus lokal dengan service/environment yang dipilih.

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

Dari kasus, developer memilih bukti yang boleh dipakai, melihat preview tujuan/provider dan data yang akan dikirim, lalu menyimpan analisis sebagai Artifact.

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

Developer mengaitkan checkout Git ke kasus, meninjau proposal per file, lalu memilih apply lokal.

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

Dari target yang jelas di kasus, operator meninjau rencana dan menjalankan restart manual melalui izin upstream saat ini.

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

Setelah menyimpan cuplikan melalui tiket 1, developer dapat membuka Investigate, melihat kasus lokal terbaru dan melanjutkan dari kasus yang sama di web lokal atau desktop.

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

Buka diff dari kasus di tab Changes dan akses hasil analisis di tab Artifacts. Pertahankan Snippet pada panel kanan dan tautkan jika diperlukan.

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

Tambahkan menu yang bisa dibuka/tutup untuk VM Machines, Databases, Konga dan OpenShift.

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

Tambahkan satu halaman untuk memasang profil konektor bawaan yang dipilih di tiket 5, memeriksa akses baca, dan membuka entry point-nya pada kasus. Tiket 5 memiliki pengambilan evidence. Tiket 11 menambahkan pengelolaan lifecycle dan penemuan konektor di UI.

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

Buka Activity untuk mencari Operation Receipt yang dibuat lewat tiket 7 dan kembali ke kasus terkait.

### User story

memastikan apa yang terjadi sesudah aksi remote dan menindaklanjuti kegagalan.

### Acceptance criteria

- [ ] Developer dapat memfilter aksi menurut environment, target dan hasil, lalu membuka detail receipt yang tersanitasi.
- [ ] Sukses, ditolak, timeout dan hasil belum diketahui berbeda secara visual dan dapat dibaca pembaca layar.
- [ ] Halaman menguji isolasi akun dan tidak menyediakan tombol menjalankan ulang aksi.

### Blocked by

Tiket #7.
