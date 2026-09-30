# Petak — UI/UX Design Specification: Panel Agents & GitLab MR Viewer (Fase 5)
**Target:** Panel AI Agents (ACP / Hermes / Claude Code) & GitLab Merge Request Viewer  
**Status:** Ready for Implementation  
**Author:** @designer (UI/UX Designer)  
**Date:** 30 September 2026  
**Parent Task / Ref:** `t_ecd6474a` (Petak F5 D5a)  
**Dokumen Referensi:**
- `/mnt/storage/uqi-projects/petak-p4m/docs/phase5/spec.md` (Arsitektur Core, ACP, GitLab REST v4)
- `docs/batch3/contract.md` (Panel exclusivity B1)
- `docs/phase4/design-device-panel.md` (Slot layout, visual tokens, multi-dock)
- `/home/uqi/vault/Projects/Petak/design.md` (Fondasi token warna & tipografi Petak)

---

## 1. Ringkasan Eksekutif & Sasaran Desain

Fase 5 menghadirkan dua pilar kolaborasi modern ke dalam Petak IDE:
1. **Panel AI Agents:** Lingkungan multi-agen berbasis Agent Client Protocol (ACP) dan Hermes agent/kanban, yang memberikan kemampuan pair-programming, eksekusi otomatis dengan guardrail izin 4-tingkat, review perubahan kode interaktif (*proposed edits diff*), serta integrasi perbaikan cepat (*Fix with Agent*) dari Logcat dan diagnostic LSP.
2. **GitLab Merge Request (MR) Viewer:** Antarmuka peninjauan kode terintegrasi yang memungkinkan pengembang menelusuri MR tim, menyaring daftar (Open, Mine, Assigned, Review Requested), memeriksa ringkasan pipeline CI/CD, mengulas perubahan diff berkas (*side-by-side* dan *unified*), membalas/menyelesaikan diskusi komentar, serta melakukan merge aman dengan verifikasi commit SHA.

### Prinsip Desain Utama (Ponytail Discipline & UI Pro Max)
- **Komponen yang Sudah Ada Dipakai Ulang (Reuse):** Tidak ada viewer diff baru. Seluruh ulasan diff (baik Proposed Edits agent maupun MR) memanfaatkan `DiffView.svelte` (`sbs.ts` / `wordDiff.ts`). Penanganan konflik memakai `ConflictView.svelte`.
- **Nol Polling Latar Belakang (Zero Background Overhead):** Tidak ada permintaan jaringan atau konsumsi siklus CPU saat panel tertutup. Refresh hanya terjadi ketika panel difokuskan atau atas aksi eksplisit pengguna.
- **Transparansi & Kejujuran UI:** Menampilkan batasan teknis apa adanya (misal banner peringatan jika alat agen menulis berkas secara langsung di luar ACP, atau indikator abu-abu *"agen tidak melapor"* jika metrik token tidak tersedia).
- **Keamanan & Guardrails Bertingkat:** Pembedaan jelas mode token GitLab (`read_api` vs `api`), tombol aksi berbahaya memiliki konfirmasi eksplisit (khususnya verifikasi SHA sebelum merge), serta penanda visual kontras tinggi (label merah) untuk mode izin agen `full`.

---

## 2. Arsitektur Layout & Penempatan di IDE

### 2.1 Penempatan di Rail Kiri (`ui/shell/Rail.svelte`)
Rail navigasi utama (lebar tetap `48px`) di sisi paling kiri IDE diperluas dengan urutan item berikut:

| Urutan | ID Tab | Ikon | Label / Tooltip | Target Layar / Aksi |
|---|---|---|---|---|
| 1 | `project` | Folder / File Tree | Project Explorer (`⌘1`) | Menampilkan `FileTree.svelte` di sidebar kiri |
| 2 | `git` | Git branch & commits | Source Control / Git (`⌘2`) | Menampilkan `GitView.svelte` di area kerja utama |
| 3 | `mr` | Git pull / GitLab MR | GitLab Merge Requests (`⌘5`) | Menampilkan `MrView.svelte` di area kerja utama |
| 4 | `agents` | Bot / Sparkle (`M12 3l...`) | AI Agents Panel (`⌘6`) | Membuka/menutup `AgentsPanel.svelte` (slot kanan) |
| 5 | `devices` | Smartphone outline | Devices & Emulators (`⌘⇧D`) | Membuka `DevicesPanel.svelte` / `DeviceMirrorPanel.svelte` |
| Bawah | `settings` | Gear / Preferences | Settings / Toolchains (`⌘,`) | Membuka pengaturan Petak |

### 2.2 Hirarki Kolom & Multi-Dock Concurrency
Struktur baris horizontal di dalam `.app-body` (antara TitleBar 46px dan StatusBar 26px, tinggi bersih `828px` pada viewport 900px):

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ TitleBar (46px) — Brand · Project · Git Branch · [Run Config] · [MRs] · [Agents] · Search   │
├──────┬────────────┬──────────────────────────────────────┬──────────────────┬───────────────┤
│ Rail │ File Tree  │ Center Workspace (flex: 1)           │ Panel Agents     │ Device Mirror │
│ 48px │ 200–250px  │                                      │ (Slot Phase 5)   │ Panel         │
│      │            │ • Mode Editor: Tabs + CM6 Editor     │                  │ (Outer Dock)  │
│      │            │ • Mode Git: GitView (Commit/Log)     │ Lebar: 320–500px │ Lebar:        │
│      │            │ • Mode MR: MrView (List + Detail)    │ (Default: 390px) │ 300–600px     │
│      │            │ ──────────────────────────────────── │                  │ (Default:     │
│      │            │ Bottom Panel (Run / Logcat / Term)   │ Collapsible &    │  380px)       │
│      │            │ (Hanya di dalam Center Workspace)    │ Resizable        │ Full Height!  │
├──────┴────────────┴──────────────────────────────────────┴──────────────────┴───────────────┤
│ StatusBar (26px) — Git Branch · PAT Scope · LSP · Agent Status · Device · Line/Col          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Aturan Eksklusivitas & Ukuran Panel
1. **MR Viewer (`MrView.svelte`):** Menempati `Center Workspace` (menggantikan area Editor atau GitView saat tab Rail `mr` aktif).
   - Lebar: Responsif `flex: 1` (minimum `600px`).
   - Memberikan area ulasan luas untuk deskripsi, daftar berkas, dan perbandingan diff dua kolom (*side-by-side*).
2. **Panel Agents (`AgentsPanel.svelte`):** Ditempatkan pada slot vertikal khusus langsung di **sebelah kiri** dock Device Mirror (antara Center Workspace dan Device Mirror).
   - Lebar default: `390px`.
   - Rentang resize: `320px` (min) s/d `500px` (max).
   - Tinggi: `100%` area kerja vertikal (`828px`).
   - Sesuai kontrak `docs/batch3/contract.md` (B1) & `panelExclusivity.ts`:
     - Panel Agents dapat dibuka bersamaan dengan Editor dan FileTree.
     - Bila layar berukuran standar `1440px` membuka Panel Agents (`390px`) dan Device Mirror (`380px`) sekaligus: FileTree memadat otomatis ke `200px`, Editor tetap memiliki ruang kerja `422px` (`min-width: 360px` terjamin).

---

## 3. Spesifikasi UI: Panel Agents

Panel Agents bertindak sebagai kokpit interaksi multi-agen di Petak. Pengembang dapat mempekerjakan beberapa slot agen secara paralel, meninjau rancangan kode sebelum ditulis ke disk, serta mengontrol izin eksekusi.

### 3.1 Struktur Komponen Svelte
```
ui/features/agents/
├── AgentsPanel.svelte       # Kontainer utama panel, header slot, status bar, banner batas edit
├── AgentTabs.svelte         # Tab navigasi per slot agen, status dot, unread badge, tombol add
├── AgentChat.svelte         # Log percakapan virtualized, streaming bubble, kartu tool-call, prompt input
├── ProposedEdits.svelte     # Panel ulasan berkas berubah, kontrol Terima/Tolak, embed DiffView
├── TeamEditor.svelte        # Modal/drawer konfigurasi tim (.petak/team.json & deteksi Hermes)
├── FixWithAgentModal.svelte # Modal draf prompt dari Logcat/Problems sebelum dikirim ke agen
└── agents.svelte.ts         # Reaktif store Svelte 5 ($state) untuk koneksi ACP & sesi
```

### 3.2 Daftar Slot & Tab per Slot
Model slot dimuat dari konfigurasi `.petak/team.json`:
- **Komponen Tab Bar (`AgentTabs.svelte`):**
  - Ketinggian bar: `36px`, background `bg-titlebar` (`#111215`), border bawah `border-subtle` (`#26282d`).
  - Item tab memuat:
    - Ikon jenis agen (Hermes bot, Claude, custom terminal).
    - Label slot (mis. *"Techlead"*, *"Reviewer"*, *"Flutter-Fixer"*).
    - Status runtime dot:
      - `idle`: Abu-abu `#8b8f98`.
      - `running` / `thinking`: Hijau berkedip lambat `#7fc98f` (animasi pulse 1.5s).
      - `error`: Merah `#f07a74`.
    - Badge belum dibaca (*unread count*): Bulatan pill biru `#6ea8ff` dengan angka pesan baru jika tab sedang tidak aktif.
    - Tombol New Session (`+`): Mereset riwayat aktif dan memulai sesi ACP baru.
    - Tombol Konfigurasi Tim (⚙️): Membuka `TeamEditor.svelte`.

### 3.3 Sistem Izin 4-Tingkat (Permission Modes)
Setiap slot agen memiliki izin operasi yang dapat diatur pengguna melalui dropdown pada sub-header tab:

| Mode | Label UI | Warna Badge & Border | Perilaku Operasional |
|---|---|---|---|
| **1. Read** | `Read-Only` | Text `#8b8f98`, Bg `#1a1b1f`, Border `#2c2e34` | Tolak semua aksi penulisan berkas dan eksekusi terminal. Agen murni konsultatif. |
| **2. Ask (Default)** | `Ask Before Action` | Text `#e8b45a`, Bg `#2e2717`, Border `#4a3d22` | Setiap eksekusi perintah shell atau modifikasi berkas menampilkan kartu persetujuan di dalam chat. |
| **3. Auto** | `Auto-Run Safe` | Text `#6ea8ff`, Bg `#1c2b42`, Border `#2c3e60` | Mengizinkan otomatis perintah allowlist aman (`flutter`, `dart`, `gradlew`, `npm test`, `cargo test`, `pod install`); lainnya tetap meminta izin. |
| **4. Full** | `FULL ACCESS ⚠️` | **Text `#f07a74`, Bg `#3d1a1c`, Border `#d9534f`** | **LABEL MERAH TEGAS**. Mengizinkan seluruh aksi tanpa konfirmasi. |

#### Proteksi Mode Full (Safety Gate):
Ketika pengguna beralih ke mode `Full`, modal konfirmasi darurat wajib muncul:
> **Peringatan Akses Penuh (Full Access Warning)**  
> Mode ini mengizinkan agen mengeksekusi perintah terminal apa pun dan mengubah berkas secara otomatis tanpa persetujuan manual. Disarankan hanya untuk agen terpercaya dalam lingkungan git bersih.  
> `[ Batal ]` `[ Aktifkan Mode Full ]`

### 3.4 Review Diff Usulan Perubahan (`ProposedEdits.svelte`)
Setiap permintaan perubahan berkas via ACP `fs/write_text_file` dicegat oleh core Petak dan dikirim ke buffer `ProposedEdits` tanpa langsung menulis disk.

- **Penempatan:** Drawer yang dapat diperluas (*expandable drawer*) di atas area input chat atau tab terpisah di dalam panel.
- **Header Proposal:**
  - Jumlah berkas berubah: mis. *"3 berkas diusulkan oleh Claude Code"*.
  - Tombol Aksi Massal:
    - `Terima Semua` (`Accept All`): Tombol hijau solid `#7fc98f`, menulis seluruh perubahan via `fsops.rs` dan mencatat snapshot ke `local_history.rs`.
    - `Tolak Semua` (`Reject All`): Tombol merah ghost `#f07a74`, membersihkan buffer dan memberi notifikasi penolakan ke agen.
- **Navigasi Berkas:**
  - Daftar berkas ringkas berupa horizontal chip pills dengan status `M` (Modified), `A` (Added), atau `D` (Deleted).
- **Embedded Diff Container:**
  - Menggunakan komponen **`DiffView.svelte`** yang sudah ada di codebase:
    ```svelte
    <DiffView
      diffFile={activeProposedFile}
      sourceKind="worktree"
      filePath={activeProposedFile.newPath}
    />
    ```
  - Mode tampilan: Mendukung toggle *Side-by-side* dan *Unified*.
  - Aksi per hunk: Tombol inline centang `✓` (Terima Hunk) dan silang `✕` (Tolak Hunk) pada baris header setiap hunk diff.
- **Integrasi Resolusi Konflik:**
  - Jika berkas telah diubah oleh pengguna di editor sebelum proposal agen sempat di-review, sistem memunculkan modal resolusi konflik menggunakan **`ConflictView.svelte`** (3-way merge: Base, Local User, Agent Proposal).

### 3.5 Banner Kejujuran: Batasan Edit Tak Tercegat (Honest Limitations Banner)
Beberapa agen (seperti Claude Code CLI yang memakai internal tool `Edit`) dapat menulis langsung ke disk tanpa melalui `fs/write_text_file` ACP. Sesuai prinsip kejujuran produk:

- **Bentuk Visual:** Sticky subtle banner di bagian atas riwayat percakapan.
- **Token:** Background `#232018`, border `#3d3420`, text `#d4b36a`, ikon info outline.
- **Salinan Teks:**
  - *ID:* `"Catatan: Edit yang dilakukan via tool internal agen tidak dapat dicegat sebelum penulisan. Petak otomatis membuat snapshot Local History sebelum sesi berjalan agar dapat di-rollback kapan pun."*
  - *EN:* `"Notice: Direct edits made by an agent's internal tool cannot be pre-intercepted. Petak automatically creates a Local History snapshot prior to each session for safe rollback."*
- **Aksi Cepat:** Tautan kecil `"Lihat Local History (⌘⇧H)"`.

### 3.6 Usage Meter Realistis
- **Lokasi:** Footer status bar panel Agents (ketinggian 24px, di bawah input prompt).
- **Kondisi Ada Data (Agen Melaporkan `usage_update` / `_meta`):**
  - Teks monospaced ringkas:
    `Context: 24.5k / 200k (12%) · Tokens: 51.2k · Biaya: ~$0.14`
  - Bar visual mini tipis (tinggi 2px) dengan persentase konteks window.
- **Kondisi Tanpa Data (Agen Tidak Melaporkan):**
  - Teks abu-abu miring (`#8b8f98`, font-size `11px`):
    - *ID:* `"Penggunaan kuota: agen tidak melapor"`
    - *EN:* `"Usage meter: agent does not report metrics"`
  - **Dilarang keras mengarang angka dummy / persentase palsu.**

### 3.7 Fitur "Fix with Agent" (Integrasi Diagnostik)
- **Sumber Pemicu:**
  - Klik kanan pada baris error di `LogcatPanel.svelte`.
  - Tombol Quick Fix / Code Action di `ProblemsPanel.svelte` atau popup `CodeActionPopup.svelte`.
  - Tombol "Tanya Agen" pada tab build gagal di `BuildPanel.svelte`.
- **Alur Interaksi:**
  1. Pengguna memilih baris masalah dan menekan `"Fix with Agent"`.
  2. Dialog modal `FixWithAgentModal.svelte` terbuka menampilkan draf prompt yang telah disusun otomatis:
     - Target Slot: Dropdown memilih slot agen aktif.
     - Pesan error & stack trace.
     - Lokasi berkas dan baris (`path:line:col`).
     - Potongan kode ±30 baris sekitar error.
     - Ringkasan toolchain & status git.
  3. Pengguna dapat meninjau dan mengedit isi prompt secara leluasa (menjaga privasi kode sensitif dan kuota token).
  4. Tombol: `"Kirim ke Agen"` (`Primary Button`, `#6ea8ff`) atau `"Batal"`.

### 3.8 Editor Tim (`TeamEditor.svelte`)
- **Akses:** Tombol ⚙️ pada header tab Agents.
- **Fungsi:** Mengelola entri slot di `.petak/team.json`.
- **Integrasi Hermes Auto-Detect:**
  - Menjalankan deteksi read-only `hermes profile list` di core.
  - Menampilkan daftar kandidat profil Hermes yang ditemukan beserta badge status kanban (misal: `designer: 1 running, 2 ready`, `reviewer: idle`).
  - Tombol 1-klik `"Tambah ke Tim"` untuk setiap profil Hermes.
- **Field Pengaturan Slot:**
  - Label Slot, Jenis Agen (`claude-code`, `hermes`, `acp-custom`, `openai`), Model, Fallback Model, Mode Izin Awal, serta Direktori Kerja (`cwd`).

### 3.9 State per Layar (Panel Agents)

| State | Tampilan Visual & Perilaku | Aksi Pengguna |
|---|---|---|
| **Loading** | Spinner biru tipis (`#6ea8ff`) di tengah area chat. Teks: *"Menghubungkan ke proses agen..."*. Area input nonaktif (*disabled*). | Tombol Batal (*Cancel connection*). |
| **Empty (Belum Ada Tim)** | Ilustrasi minimal bot offline. Teks: *"Belum ada agen yang dikonfigurasi dalam tim proyek ini."* | Tombol CTA utama: `[ Konfigurasi Tim Agen ]` (membuka `TeamEditor`). |
| **Empty (Sesi Baru Dimulai)** | Kartu sambutan sederhana per slot dengan model aktif. Tiga chip saran prompt cepat: `Review perubahan git`, `Cari penyebab build error`, `Jelaskan fungsi berkas ini`. | Pengguna mengetik prompt atau mengklik saran cepat. |
| **Error (Proses Putus / Gagal Spawn)** | Banner merah (`bg #2a1d1e`, `border #4a2225`, `text #f07a74`). Pesan error teknis: *"Proses agen berhenti mendadak (Exit code 1)"*. | Tombol `[ Mulai Ulang Sesi ]` dan link `[ Buka Log Diagnostik ]`. |
| **Rate Limit / 429** | Toast peringatan kuning-oranye di atas input: *"Agen mengalami batas kuota (Rate limit). Mengalihkan otomatis ke model cadangan (sonnet)..."* | Tombol Batal atau `[ Coba Lagi ]` dengan countdown waktu jeda. |

---

## 4. Spesifikasi UI: GitLab MR Viewer

MR Viewer menyediakan alur peninjauan kode terpadu tanpa perlu keluar dari Petak ke browser.

### 4.1 Struktur Komponen Svelte
```
ui/features/mr/
├── MrView.svelte       # Kontainer utama di center workspace, split layout list & detail
├── MrList.svelte       # Filter tabs (Open/Mine/Assigned/Review requested), search, paginasi
├── MrDetail.svelte     # Header MR, status pipeline CI/CD, approvals, subtabs Overview/Files/Thread
├── MrFiles.svelte      # Pohon berkas berubah, integrasi DiffView, trigger komentar inline
├── MrThread.svelte     # Daftar diskusi thread, balasan komentar, tombol resolve/unresolve
├── MrMergeBar.svelte   # Bar bawah eksekusi merge, detailed_merge_status, verifikasi SHA
└── mr.svelte.ts        # Reaktif store Svelte 5 ($state) untuk API GitLab v4 & cache LRU
```

### 4.2 Daftar MR & Tab Filter (`MrList.svelte`)
- **Penempatan:** Kolom kiri di dalam `MrView.svelte` (lebar `340px`, resizable dari `280px` hingga `420px`).
- **Header & Filter Tabs:**
  - Tab kategori filter:
    1. `Open`: Seluruh MR terbuka di proyek (`state=opened&scope=all`).
    2. `Mine`: MR yang dibuat oleh pengguna login (`scope=created_by_me`).
    3. `Assigned`: MR yang ditugaskan ke pengguna (`scope=assigned_to_me`).
    4. `Review requested`: MR yang meminta ulasan pengguna (`reviewer_username=<user>`).
  - Baris Pencarian: Input teks instan (*fuzzy filter* judul, nomor IID, atau nama author).
- **Kartu Item MR:**
  - Tinggi kartu: `68px`, padding `10px 12px`, border bawah `border-subtle` (`#26282d`).
  - Elemen kartu:
    - Baris 1: Judul MR (font weight 500, truncate) + nomor `!124`.
    - Baris 2: Nama author, waktu relatif (misal *"2 jam lalu"*), serta badge pipeline mini (hijau centang / merah silang / biru berputar).
    - Baris 3: Nama branch asal `feat/login` → `main`, badge jumlah diskusi yang belum selesai `💬 2/3`.
  - State aktif: Background `#1f2228`, border kiri `3px solid #6ea8ff`.
- **Paginasi:** Mengambil data per halaman (`per_page=30`) dengan indikator scroll lazy via header `X-Next-Page`.

### 4.3 Mode Token PAT & Enforce Scope (`read_api` vs `api`)
Aplikasi mendeteksi cakupan (*scope*) token pengguna saat inisialisasi via `GET /personal_access_tokens/self`:

| Fitur / Operasi | Token Scope: `api` (Mode Penuh) | Token Scope: `read_api` (Mode Lihat Saja) |
|---|---|---|
| Baca daftar MR, detail, & berkas | ✅ Diizinkan | ✅ Diizinkan |
| Lihat diff berkas & pipeline CI | ✅ Diizinkan | ✅ Diizinkan |
| Baca thread diskusi & komentar | ✅ Diizinkan | ✅ Diizinkan |
| Tulis komentar baru / balas thread | ✅ Diizinkan | ❌ **Nonaktif (Disabled)** + Tooltip |
| Selesaikan thread (*Resolve discussion*) | ✅ Diizinkan | ❌ **Nonaktif (Disabled)** + Tooltip |
| Tombol Approve / Unapprove | ✅ Diizinkan | ❌ **Nonaktif (Disabled)** + Tooltip |
| Eksekusi Merge / Batalkan MWPS | ✅ Diizinkan | ❌ **Nonaktif (Disabled)** + Tooltip |
| Checkout branch MR ke git lokal | ✅ Diizinkan (Via Git CLI lokal) | ✅ Diizinkan (Via Git CLI lokal) |

#### Desain Tombol Nonaktif pada Mode `read_api`:
- Setiap tombol tulis menampilkan opacity `0.4`, kursor `not-allowed`.
- Pada hover, muncul tooltip informatif:
  - *ID:* `"Aksi dinonaktifkan: token membutuhkan scope 'api' untuk mengirim data ke GitLab."`
  - *EN:* `"Action disabled: personal access token requires 'api' scope to perform write actions."`
- Banner penanda di sub-header MR: Badge pill abu-biru: `[ Mode Lihat Saja · Scope: read_api ]`.

### 4.4 Detail MR & Status CI/Approval (`MrDetail.svelte`)
- **Header MR:**
  - Baris atas: Judul besar, nomor IID `!124`, tombol Checkout Branch Lokal (`git switch mr-124`), dan status pill (`Open`, `Merged`, `Closed`).
  - Baris metadata: Author avatar + nama, target branch, waktu pembaruan.
  - Widget Pipeline CI/CD:
    - Status badge pipeline head commit: `Passed` (hijau), `Running` (biru spinner), `Failed` (merah).
    - Daftar jobs penting (mis. `test`, `build`, `lint`) yang dapat diklik untuk melihat detail.
  - Widget Approvals:
    - Indikator persetujuan: misal `Disetujui 2 dari 2 reviewer (Lolos)`.
    - Daftar avatar pengguna yang telah menyetujui.
- **Sub-Tab Konten:**
  1. `Overview`: Deskripsi markdown dari pembuat MR (dibersihkan via sanitasi HTML ketat tanpa mengeksekusi tag skrip atau gambar eksternal tak dikenal).
  2. `Perubahan Berkas (Changes)`: Menampilkan `MrFiles.svelte`.
  3. `Diskusi & Catatan (Discussions)`: Menampilkan `MrThread.svelte`.

### 4.5 Perubahan Berkas & Reusable `DiffView.svelte` (`MrFiles.svelte`)
- **Navigasi Berkas:** Sisi kiri berupa daftar pohon berkas (*mini file tree*) yang berubah dengan indikator `+12 -4` baris.
- **Integrasi `DiffView.svelte`:**
  - Core Rust mentransformasikan patch diff GitLab menjadi struktur `GitDiffFile`.
  - Komponen menggunakan kembali `DiffView.svelte`:
    ```svelte
    <DiffView
      diffFile={activeMrDiffFile}
      sourceKind="commit"
      filePath={activeMrDiffFile.newPath}
    />
    ```
- **Komentar Inline:**
  - Gutter nomor baris memiliki tombol `+` pada saat hover baris diff.
  - Mengklik `+` membuka formulir inline untuk memulai thread diskusi pada nomor baris dan SHA yang tepat.

### 4.6 Diskusi & Komentar (`MrThread.svelte`)
- Tampilan thread bergaya kartu terkelompok (*grouped discussion cards*).
- Setiap thread menampilkan:
  - Konteks potongan kode (jika komentar inline pada diff).
  - Pesan utama author + avatar + stempel waktu.
  - Status thread: `Resolved` (centang hijau) atau `Unresolved` (titik kuning).
  - Tombol `"Selesaikan Diskusi"` (*Resolve thread*) — disabled jika mode `read_api`.
  - Daftar balasan komentar di bawahnya.
  - Formulir input balasan cepat di bagian bawah thread.

### 4.7 Bar Eksekusi Merge & Verifikasi SHA (`MrMergeBar.svelte`)
Bar aksi sticky di bagian bawah tab detail MR (ketinggian `56px`, background `bg-panel` `#141518`, border atas `border-normal` `#2c2e34`):

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ [✓] Squash commits   [✓] Hapus branch sumber   │ Status: Siap di-merge                      │
│                                                │ [ Approve ]   [ Lakukan Merge... ]         │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Pemetaan `detailed_merge_status`:
- `mergeable`: Tombol "Lakukan Merge..." aktif hijau solid (`#7fc98f`).
- `ci_still_running`: Tombol berubah menjadi "Merge Saat Pipeline Sukses (MWPS)" (kuning-hijau).
- `cannot_be_merged` / `conflict`: Tombol disabled merah redup dengan teks `"Ada konflik branch"`.
- `blocked_status`: Tombol disabled dengan keterangan `"Menunggu dependensi MR"`.
- `not_approved`: Tombol disabled dengan keterangan `"Membutuhkan persetujuan reviewer"`.
- `discussions_not_resolved`: Tombol disabled dengan keterangan `"Selesaikan semua diskusi"`.
- `draft_status`: Tombol disabled dengan keterangan `"MR masih berstatus Draft"`.

#### Modal Konfirmasi Merge (Wajib):
Untuk mencegah eksekusi merge pada commit yang tidak sengaja terperbarui saat pengguna sedang meninjau, modal konfirmasi menampilkan detail mutlak:
> **Konfirmasi Merge MR !124**  
> Anda akan menggabungkan branch `feat/login` ke dalam `main`.  
> - **Head Commit SHA:** `a1b2c3d4e5f67890abcdef1234567890abcdef12`  
> - **Metode:** Squash 4 commit menjadi 1 commit  
> - **Opsi:** Hapus branch sumber setelah merge  
>  
> `[ Batal ]` `[ Konfirmasi & Merge ]`

### 4.8 State per Layar (GitLab MR Viewer)

| State | Tampilan Visual & Perilaku | Aksi Pengguna |
|---|---|---|
| **Loading** | Skeleton bar abu-abu berkedip halus pada daftar kartu MR; spinner tipis di area detail. | Tunggu proses fetch selesai. |
| **Empty (Belum Ada Token)** | Kartu terpusat dengan ikon kunci. Teks: *"Kredensial GitLab belum terpasang. Tambahkan Personal Access Token untuk melihat Merge Request proyek ini."* | Tombol CTA: `[ Tambah Token di Akun ]`. |
| **Empty (Daftar Kosong)** | Ilustrasi minimalis. Teks: *"Tidak ada Merge Request terbuka yang cocok dengan filter aktif."* | Tombol `[ Segarkan ]` atau ganti tab filter. |
| **Empty (Diff Kosong)** | Pesan informasi: *"Tidak ada berkas yang berubah pada revisi MR ini."* | - |
| **Error (401 / Token Expired)** | Banner merah: *"Token GitLab tidak valid atau masa berlaku telah habis. Perbarui token Anda di pengaturan akun."* | Tombol `[ Perbarui Token ]`. |
| **Error (404 / Repo Tidak Ada)** | Banner peringatan: *"Proyek GitLab tidak ditemukan berdasarkan URL remote origin."* | Link periksa konfigurasi remote Git. |
| **Rate Limit / 429** | Banner atas kuning tebal: *"Batas akses API GitLab tercapai (Rate limited). Menunggu pemulihan dalam 42 detik..."* dengan hitung mundur otomatis dari header `Retry-After`. Seluruh polling background dihentikan. | Tunggu countdown selesai atau tombol manual retry. |

---

## 5. Daftar Komponen Svelte & Kontrak Props Kunci

### 5.1 Komponen Panel Agents (`ui/features/agents/`)

#### 1. `AgentsPanel.svelte`
Kontainer utama panel slot agen.
```typescript
interface AgentsPanelProps {
  onClose?: () => void;
  onOpenTeamEditor?: () => void;
}
```

#### 2. `AgentTabs.svelte`
Header tab bar navigasi slot aktif.
```typescript
interface AgentTabsProps {
  slots: AgentSlot[];
  activeSlotId: string;
  unreadCounts: Record<string, number>;
  onSelectSlot: (slotId: string) => void;
  onNewSession: (slotId: string) => void;
  onOpenSettings: () => void;
}
```

#### 3. `AgentChat.svelte`
Log percakapan dan input pengiriman prompt.
```typescript
interface AgentChatProps {
  slot: AgentSlot;
  messages: AgentMessage[];
  isStreaming: boolean;
  permissionMode: 'read' | 'ask' | 'auto' | 'full';
  usageInfo?: AgentUsageMetrics | null;
  onSendPrompt: (text: string) => Promise<void>;
  onCancelSession: () => void;
  onChangePermission: (mode: 'read' | 'ask' | 'auto' | 'full') => void;
  onResolvePermissionRequest: (requestId: string, approved: boolean) => void;
}
```

#### 4. `ProposedEdits.svelte`
Peninjauan berkas yang diusulkan oleh agen sebelum ditulis ke disk.
```typescript
interface ProposedEditsProps {
  proposals: ProposedFileEdit[];
  onAcceptFile: (filePath: string) => Promise<void>;
  onRejectFile: (filePath: string) => void;
  onAcceptAll: () => Promise<void>;
  onRejectAll: () => void;
  onAcceptHunk: (filePath: string, hunkIndex: number) => Promise<void>;
  onRejectHunk: (filePath: string, hunkIndex: number) => void;
}
```

#### 5. `FixWithAgentModal.svelte`
Modal draf prompt perbaikan error sebelum dikirim ke slot agen.
```typescript
interface FixWithAgentModalProps {
  isOpen: boolean;
  slots: AgentSlot[];
  initialSlotId?: string;
  sourceType: 'logcat' | 'lsp' | 'build';
  errorPayload: {
    message: string;
    filePath?: string;
    line?: number;
    column?: number;
    codeSnippet?: string;
    stackTrace?: string;
  };
  onClose: () => void;
  onSubmit: (slotId: string, promptText: string) => Promise<void>;
}
```

---

### 5.2 Komponen GitLab MR Viewer (`ui/features/mr/`)

#### 1. `MrView.svelte`
Kontainer utama layar MR di center workspace.
```typescript
interface MrViewProps {
  folderPath: string;
}
```

#### 2. `MrList.svelte`
Daftar MR dengan filter kategori dan pencarian.
```typescript
interface MrListProps {
  mergeRequests: GitLabMrSummary[];
  activeFilter: 'opened' | 'mine' | 'assigned' | 'reviewer';
  selectedIid: number | null;
  isLoading: boolean;
  onSelectFilter: (filter: 'opened' | 'mine' | 'assigned' | 'reviewer') => void;
  onSelectMr: (iid: number) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}
```

#### 3. `MrDetail.svelte`
Panel detail ulasan MR terpilih.
```typescript
interface MrDetailProps {
  mrDetail: GitLabMrDetail;
  tokenScope: 'api' | 'read_api';
  onCheckoutBranch: (iid: number, sourceBranch: string) => Promise<void>;
  onRefresh: () => void;
}
```

#### 4. `MrFiles.svelte`
Daftar berkas perubahan dan peninjauan diff.
```typescript
interface MrFilesProps {
  diffFiles: GitDiffFile[];
  selectedFilePath: string | null;
  tokenScope: 'api' | 'read_api';
  onSelectFile: (path: string) => void;
  onCreateInlineNote: (path: string, line: number, text: string) => Promise<void>;
}
```

#### 5. `MrThread.svelte`
Daftar thread diskusi dan komentar.
```typescript
interface MrThreadProps {
  discussions: GitLabDiscussion[];
  tokenScope: 'api' | 'read_api';
  onAddNote: (discussionId: string, body: string) => Promise<void>;
  onResolveDiscussion: (discussionId: string, resolved: boolean) => Promise<void>;
  onCreateNewThread: (body: string) => Promise<void>;
}
```

#### 6. `MrMergeBar.svelte`
Bar kontrol bawah eksekusi merge dan proteksi commit SHA.
```typescript
interface MrMergeBarProps {
  mrDetail: GitLabMrDetail;
  tokenScope: 'api' | 'read_api';
  isMerging: boolean;
  onApprove: () => Promise<void>;
  onUnapprove: () => Promise<void>;
  onExecuteMerge: (options: {
    sha: string;
    squash: boolean;
    removeSourceBranch: boolean;
  }) => Promise<void>;
}
```

---

## 6. Fondasi Desain, Token Visual & Aksesibilitas

### 6.1 Token Warna Resmi Petak (`design.md`)

| Kategori Token | Nama Token | Nilai Hex | Penggunaan di Fitur Fase 5 |
|---|---|---|---|
| **Backgrounds** | `bg-titlebar` | `#111215` | Tab bar agen, header list MR, status bar IDE |
| | `bg-panel` | `#141518` | Latar panel Agents, panel MR list, toolbar bawah |
| | `bg-app` | `#16171a` | Latar utama area center workspace |
| | `bg-editor` | `#1a1b1f` | Latar bubble chat, kartu diskusi MR, kotak input |
| | `bg-raised` | `#23252b` | Hover tombol, kartu MR terseleksi, pill tab aktif |
| **Borders** | `border-subtle` | `#26282d` | Pembatas kolom list MR, divider antar bubble pesan |
| | `border-normal` | `#2c2e34` | Outline tombol, frame kartu proposal, batas panel |
| | `border-focus` | `#3a4f75` | Outline fokus input prompt chat dan komentar |
| **Text Colors** | `text-primary` | `#d8d9dc` | Judul MR, isi teks chat, kode dalam diff |
| | `text-active` | `#e6efff` | Label tab aktif, tautan hover |
| | `text-muted` | `#8b8f98` | Stempel waktu, nomor baris, label "agen tidak melapor" |
| | `text-dim` | `#5b5f68` | Placeholder input, divider titik |
| **Semantic Accents**| `accent` | `#6ea8ff` | Tombol kirim prompt, tautan utama, tab indicator |
| | `success` | `#7fc98f` | Tombol Terima Berkas, status Pipeline Passed, Mergeable |
| | `warning` | `#e8b45a` | Mode Izin Ask, banner batas edit, status Unresolved |
| | `danger` | `#f07a74` | Label merah Mode Full, tombol Tolak, Pipeline Failed |

### 6.2 Standar Aksesibilitas (WCAG 2.1 AA)
1. **Rasio Kontras Minimum 4.5:1:**
   - Teks `#d8d9dc` pada latar `#1a1b1f` menghasilkan kontras **11.2:1** (Lolos AAA).
   - Teks muted `#8b8f98` pada latar `#141518` menghasilkan kontras **5.1:1** (Lolos AA).
   - Teks danger `#f07a74` pada `#3d1a1c` (Mode Full) menghasilkan kontras **6.4:1** (Lolos AA).
2. **Target Sentuh & Klik Keyboard-First:**
   - Tinggi tombol aksi minimal `32px` di desktop, dengan padding klik minimum `44px` target area sentuh.
   - Semua elemen interaktif memiliki `focus-visible` ring `2px solid #3a4f75`.
3. **Pintasan Keyboard (Keyboard Shortcuts):**
   - `F7` / `Shift+F7`: Lompat ke perubahan berikutnya / sebelumnya pada `DiffView`.
   - `Esc`: Menutup dialog `FixWithAgentModal`, `TeamEditor`, atau membatalkan proposal.
   - `⌘Enter` / `Ctrl+Enter`: Mengirim prompt chat atau mengirim balasan komentar MR.

---

## 7. Tabel Teks Antarmuka (Copy Matrix ID & EN)

| Kunci UI | Bahasa Indonesia (ID) | English (EN) |
|---|---|---|
| `agents.title` | Panel Agen | Agents Panel |
| `agents.new_session` | Sesi Baru | New Session |
| `agents.mode.read` | Hanya Baca | Read-Only |
| `agents.mode.ask` | Tanya Sebelum Aksi | Ask Before Action |
| `agents.mode.auto` | Eksekusi Aman Otomatis | Auto-Run Safe |
| `agents.mode.full` | AKSES PENUH ⚠️ | FULL ACCESS ⚠️ |
| `agents.honest_banner` | Catatan: Edit via tool internal agen tidak dapat dicegat. Local History otomatis dicatat. | Notice: Edits via agent internal tools cannot be intercepted. Local History is auto-recorded. |
| `agents.usage.none` | Penggunaan kuota: agen tidak melapor | Usage meter: agent does not report metrics |
| `agents.proposals.accept_all` | Terima Semua | Accept All |
| `agents.proposals.reject_all` | Tolak Semua | Reject All |
| `mr.tab.open` | Terbuka | Open |
| `mr.tab.mine` | Dibuat Oleh Saya | Mine |
| `mr.tab.assigned` | Ditugaskan ke Saya | Assigned |
| `mr.tab.reviewer` | Permintaan Ulasan | Review Requested |
| `mr.scope.read_api_badge` | Mode Lihat Saja (Scope: read_api) | View-Only Mode (Scope: read_api) |
| `mr.scope.disabled_tooltip` | Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab. | Action disabled: token requires 'api' scope to write to GitLab. |
| `mr.merge.confirm_title` | Konfirmasi Merge | Confirm Merge |
| `mr.merge.confirm_sha` | Head Commit SHA Terverifikasi: | Verified Head Commit SHA: |
| `mr.merge.squash` | Squash commit saat merge | Squash commits |
| `mr.merge.delete_branch` | Hapus branch sumber | Delete source branch |
| `mr.empty.no_token` | Tambahkan token GitLab di Akun untuk melihat Merge Request. | Add a GitLab token in Accounts to view Merge Requests. |
| `mr.empty.no_token_btn` | Tambah Token di Akun | Add Token in Accounts |
| `mr.empty.no_mrs` | Tidak ada Merge Request terbuka pada filter ini. | No open Merge Requests found for this filter. |
| `mr.rate_limit_banner` | Batas akses API tercapai. Menunggu pemulihan dalam {n} detik... | API rate limit reached. Retrying automatically in {n}s... |

---

## 8. Penanganan Kasus Tepi (Edge Cases) & Pertimbangan Kinerja

1. **Ukuran Diff Raksasa (>1.000 Baris / >50 Berkas):**
   - Komponen `DiffView.svelte` menggunakan virtualisasi DOM baris agar rendering tidak memblokir thread UI.
   - Berkas di atas batas 2.000 baris diff diberi peringatan pemotongan (*truncation warning*) dengan tombol *"Muat Diff Lengkap"*.
2. **Koneksi Terputus Saat Sesi Agen Berjalan:**
   - Event `session/cancel` dipanggil secara bersih ke child-process jika panel ditutup atau tombol cancel ditekan.
   - Peringatan error jelas di chat tanpa menghilangkan riwayat pesan sebelumnya.
3. **Pencegahan Konflik Merge (GitLab Race Condition):**
   - Sebelum mengeksekusi merge, parameter `sha` wajib dikirimkan ke endpoint `PUT /merge`. Jika ada commit baru yang masuk dari rekan tim saat modal konfirmasi terbuka, GitLab akan merespon status `409 Conflict` / `405`, dan UI Petak akan menampilkan pemberitahuan ramah: *"Revisi branch telah diperbarui di server. Silakan segarkan dan tinjau ulang diff sebelum merge."*
4. **Perlindungan Token & Privasi Kredensial:**
   - Token Personal Access Token (PAT) disimpan di Keychain sistem via `git credential fill` di layer Rust. Token tidak pernah disimpan di local storage webview atau dicatat di berkas log.
