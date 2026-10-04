# Petak IDE — Design System V2 Specification

**Product:** Petak Flutter & Mobile IDE (Desktop Native & Web)  
**Version:** 2.0.0-draft  
**Target:** Shell, Navigation, Menu Bar, Welcome Dashboard, Workspace, Settings Center, AI Agents & Device Mirror  
**Author:** @designer (UI/UX Designer)  
**Date:** 4 Oktober 2026  
**Status:** Approved for Prototyping  
**Companion Prototype:** `docs/redesign/comprehensive-design-system.html`  
**Screenshots:** `docs/redesign/screens/`

---

## 1. Vision & Core Design Principles

Petak IDE dirancang sebagai lingkungan pengembangan terpadu (IDE) berkinerja tinggi, berbobot ringan (<150MB idle RAM), dan difokuskan secara khusus untuk pengembangan Flutter, Dart, Android native, serta alur kerja multi-agen AI (Hermes, Claude, ACP) dan GitLab review.

### 1.1 Prinsip Desain V2
1. **Content-First & Anti-Fatigue:** Kode dan konteks developer adalah pusat perhatian. Menghilangkan elemen bingkai yang tidak bernilai guna (*border overload / jail-cell effect*).
2. **Surface Depth over Hard Borders:** Struktur antarmuka dipisahkan melalui 4-tingkat elevasi warna (*luminance delta*) dan bayangan lembut, bukan garis kisi solid 1px di setiap elemen.
3. **Ergonomi Developer-Grade:** Seluruh aksi berfrekuensi tinggi (Run, Hot Reload, Switch Branch, Prompt AI, Search Everywhere) berada dalam jangkauan 1-klik atau 1-pintasan keyboard tanpa pergeseran fokus mata yang drastis.
4. **Unified Multi-Agent Ergonomics:** Interaksi agen AI tidak membebani ruang vertikal dengan header bertumpuk (*no 4-tier cramp*). Status izin dan disiplin disajikan sebagai *context pills* interaktif di dalam komposer prompt.
5. **Dua Gaya Estetika Berkarakter:**
   - **Varian A (Cursor / Linear Modern):** Fokus pada fleksibilitas visual, context pills interaktif, radius sudut modern (6-12px), dan kontras energetik berbasis Blue 500 (`#3b82f6`).
   - **Varian B (Zed / Fleet Zen Focus):** Fokus pada ketenangan visual ekstrem (*0-clutter*), borderless murni, tipografi monospaced, radius tajam (3-6px), dan palet arang gelap (*charcoal slate*) dengan aksen Indigo/Emerald.

---

## 2. Token Arsitektur 4-Layer Surface Depth

Mengatasi masalah visual fatigue pada V1 di mana semua panel memiliki warna yang hampir identik (`#111215`, `#141518`, `#16171a`, `#1a1b1f`) dan dibatasi border kaku. Sistem V2 mengadopsi arsitektur 4 lapisan kedalaman:

### 2.1 Matriks Token Kedalaman (Depth Tokens)

| Lapisan (Layer) | Peran Komponen | Varian A (Cursor/Linear) | Varian B (Zed/Fleet Zen) | Fungsi & Penggunaan |
|---|---|---|---|---|
| **Layer 0 (Canvas Base)** | Kanvas terluar, titlebar, background jendela dasar | `#0c0d10` | `#0a0b0d` | Dasar terdalam aplikasi. Memberikan anchor visual yang solid. |
| **Layer 1 (Surface Panels)** | Sidebar File Tree, Left Rail, Bottom Dock, Menu Dropdown | `#121317` | `#0f1013` | Panel navigasi struktural di sekeliling area kerja utama. |
| **Layer 2 (Work Surface)** | Code Editor, Diff Viewer, Welcome Project List | `#15161b` | `#141518` | Bidang kerja aktif dengan kontras tinggi terhadap teks kode. |
| **Layer 3 (Elevated / Popovers)** | Floating AI Prompt, Settings Modal, Cards, Dialogs | `#1c1e24` | `#191a1e` | Elemen melayang, kartu tindakan, dan kontrol yang membutuhkan fokus. |
| **Surface Hover** | State hover list item / tombol | `#22242c` | `#1f2025` | Umpan balik visual interaksi mouse. |
| **Surface Active** | State terpilih / tab aktif | `#2a2d36` | `#26282e` | Penanda elemen yang sedang aktif. |

### 2.2 Border Refinement & Pembetulan Bug Semantik
Pada V1 terdapat anomali di mana `--border-subtle` (`#2c2e34`) memiliki nilai luminance lebih terang daripada `--border` (`#26282d`). Pada V2 hal ini diperbaiki secara radikal:

- **Border Default (`--border-default`):**
  - Varian A: `#1e2027` (sangat gelap, kontras rendah, hanya dipakai pada pemisah panel utama).
  - Varian B: `#17181c` (hampir menyatu dengan latar, mengedepankan pemisahan warna antar layer).
- **Border Subtle (`--border-subtle`):**
  - Varian A: `rgba(255, 255, 255, 0.06)` (transparan berbasis alpha, beradaptasi dengan warna latar di bawahnya).
  - Varian B: `rgba(255, 255, 255, 0.035)` (sangat halus untuk divider daftar item).
- **Border Focus (`--border-focus`):**
  - Varian A: `rgba(59, 130, 246, 0.5)` (Blue glow).
  - Varian B: `rgba(99, 102, 241, 0.4)` (Indigo glow).

---

## 3. Tipografi & Skala Spacing (4px Grid)

### 3.1 Skala Tipografi
- **UI Font Family:** `'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Code/Mono Font Family:** `'JetBrains Mono', 'Fira Code', 'Menlo', monospace`

| Tingkat | Ukuran (px) | Line Height | Weight | Tracking | Penggunaan |
|---|---|---|---|---|---|
| `caption-sm` | 10px | 14px | 400 / 500 | +0.02em | Tag status mikro, counter badge, shortcut keycaps |
| `caption-md` | 11px | 15px | 400 / 500 | +0.01em | Breadcrumbs, metadata branch, timestamp, line numbers |
| `body-sm` | 12px | 16px | 400 / 500 | 0 | File tree items, subtabs, status bar text, table cells |
| `body-md` | 13px | 18px | 400 / 500 | 0 | UI default, menu items, tombol, input placeholder |
| `code-base` | 13.5px | 20px | 400 | 0 | Editor code text, terminal console output |
| `heading-sm` | 14px | 20px | 600 | -0.01em | Panel headers, card titles, category sidebar items |
| `heading-md` | 16px | 22px | 600 | -0.015em | Settings section title, modal title, MR title |
| `heading-lg` | 20px | 26px | 600 / 700 | -0.02em | Welcome dashboard header, toolchain doctor status |
| `display` | 26px | 32px | 700 | -0.025em | Petak IDE brand hero banner |

### 3.2 Skala Spacing 4px Grid
Semua margin, padding, dan gap komponen wajib menggunakan kelipatan 4px:
- `--space-1`: `4px` (micro spacing antar icon dan teks, padding keycap)
- `--space-2`: `8px` (jarak internal pill, gap horizontal menu bar)
- `--space-3`: `12px` (padding sel kartu, gap input form)
- `--space-4`: `16px` (padding container modal, margin kartu dashboard)
- `--space-5`: `20px` (padding header panel, jarak antar section settings)
- `--space-6`: `24px` (gutter layout dashboard)
- `--space-8`: `32px` (jarak hero banner dashboard)
- `--space-10`: `40px` (lebar/tinggi kontrol cockpit)

---

## 4. Sistem Ikon Baru (Developer-Grade 1.5px Stroke)

Seluruh ikon antarmuka Petak IDE distandarisasi menggunakan format SVG vektor murni dengan spesifikasi optik seragam:
- **Ketebalan Garis (Stroke Width):** `1.5px` seragam (memberikan rasa presisi teknis ala Lucide & Phosphor).
- **Stroke Linecap & Linejoin:** `round` / `round`.
- **ViewBox Standar:** `0 0 24 24` (skala optik 16×16px atau 18×18px rendering).
- **Fill:** `none` (kecuali status indikator khusus seperti stop / record).

### 4.1 Katalog 26 Ikon Standar Petak IDE
1. `file` — Berkas kode biasa (`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>`)
2. `folder` — Direktori proyek (`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>`)
3. `search` — Pencarian cepat (`<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>`)
4. `git-branch` — Branch aktif (`<line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path>`)
5. `git-merge` — Merge request / pull (`<circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path>`)
6. `play` — Run aplikasi (`<polygon points="5 3 19 12 5 21 5 3"></polygon>`)
7. `bug` — Debugger session (`<rect width="8" height="14" x="8" y="6" rx="4"></rect><path d="m19 7-3 2"></path><path d="m5 7 3 2"></path><path d="m19 19-3-2"></path><path d="m5 19 3-2"></path><path d="M20 13h-4"></path><path d="M4 13h4"></path><path d="m10 4 1 2"></path><path d="m14 4-1 2"></path>`)
8. `zap` — Flutter Hot Reload (`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>`)
9. `refresh-cw` — Flutter Hot Restart (`<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>`)
10. `square` — Hentikan proses / Stop (`<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"></rect>`)
11. `terminal` — Console & CLI dock (`<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>`)
12. `bot` — AI Agents (Hermes/Claude) (`<rect width="18" height="12" x="3" y="6" rx="2"></rect><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><path d="M12 2v4"></path><path d="M2 14h1"></path><path d="M21 14h1"></path>`)
13. `sparkles` — AI Suggestions / Ghost text (`<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>`)
14. `smartphone` — Device Mirroring (`<rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line>`)
15. `settings` — Pengaturan IDE (`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>`)
16. `check` — Selesai / Terverifikasi (`<polyline points="20 6 9 17 4 12"></polyline>`)
17. `x` — Tutup / Dismiss (`<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`)
18. `chevron-down` — Expand dropdown (`<polyline points="6 9 12 15 18 9"></polyline>`)
19. `chevron-right` — Hierarki navigasi (`<polyline points="9 18 15 12 9 6"></polyline>`)
20. `shield` — Privacy / Security mode (`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>`)
21. `tool` — Toolchain Doctor (`<path d="m14.7 13.5-3.7-3.7a2 2 0 0 0-2.8 0L2 16.1a1 1 0 0 0 0 1.4l4.5 4.5a1 1 0 0 0 1.4 0l6.3-6.2a2 2 0 0 0 0-2.8z"></path><path d="m18 8 3 3"></path><path d="m14.5 4.5 5 5"></path>`)
22. `keyboard` — Keymap shortcuts (`<rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="6" y1="10" x2="6.01" y2="10"></line><line x1="10" y1="10" x2="10.01" y2="10"></line><line x1="14" y1="10" x2="14.01" y2="10"></line><line x1="18" y1="10" x2="18.01" y2="10"></line><line x1="8" y1="14" x2="16" y2="14"></line>`)
23. `user` — Akun & Profil (`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>`)
24. `git-commit` — Riwayat commit (`<circle cx="12" cy="12" r="4"></circle><line x1="1.05" y1="12" x2="7" y2="12"></line><line x1="17.05" y1="12" x2="22.95" y2="12"></line>`)
25. `alert-circle` — Peringatan / Masalah (`<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>`)
26. `code` — Editor & syntax (`<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>`)

---

## 5. Spesifikasi Layar & Pola Interaksi

### 5.1 Menu Bar 12 Kategori Standar Profesional
Menempatkan Menu Bar interaktif di puncak jendela (tinggi 28px) dengan 12 kategori standar industri:
1. **File:** New Flutter Project (`⌘N`), Open Folder (`⌘O`), Open Recent, Save (`⌘S`), Save All (`⌥⌘S`), Close Project, Exit (`⌘Q`).
2. **Edit:** Undo (`⌘Z`), Redo (`⇧⌘Z`), Cut (`⌘X`), Copy (`⌘C`), Paste (`⌘V`), Find in File (`⌘F`), Replace (`⌘R`), Search in Project (`⇧⌘F`).
3. **View:** Toggle File Tree (`⌘B`), Toggle Terminal (`⌘J`), Toggle AI Agents (`⌘6`), Toggle Device Mirror (`⇧⌘D`), Full Screen (`⌃⌘F`), Zen Mode (`⌘K Z`).
4. **Navigate:** Go to File (`⌘P`), Go to Symbol (`⌘⌥O`), Go to Line (`⌘G`), Back (`⌘[`), Forward (`⌘]`), Next Problem (`F2`).
5. **Code:** Format Document (`⌥⇧F`), AI Inline Completion (`Tab`), Organize Imports (`⌥⇧O`), Inspect Code, Quick Fix (`⌘.`).
6. **Refactor:** Rename Symbol (`⇧F6`), Extract Widget (`⌥⌘W`), Extract Method (`⌥⌘M`), Move File (`F6`).
7. **Build:** Flutter Build APK, Flutter Build iOS, Gradle Clean Build, Assemble Debug, Sync Toolchains.
8. **Run:** Start Debugging (`F5`), Run Without Debugging (`⌃F5`), Flutter Hot Reload (`⌘\`), Flutter Hot Restart (`⇧⌘\`), Stop (`⇧F5`).
9. **Git:** Commit (`⌘K`), Push (`⇧⌘K`), Pull/Update (`⌘T`), Branches Switcher, GitLab Merge Requests (`⌘5`), Stash Changes.
10. **Tools:** Toolchain Doctor, Kotlin Language Server Manager, Scrcpy Device Manager, Open Terminal Here.
11. **Window:** Minimize (`⌘M`), Zoom, Split Editor Right (`⌘\`), Split Editor Down, Close All Tabs.
12. **Help:** Documentation, Keyboard Shortcuts Reference (`⌘K ⌘S`), Petak Doctor Health Check, Check for Updates, About Petak.

### 5.2 Layar 1: Standalone Welcome Dashboard
- **Brand Hero Banner:** Logo Petak (SVG gradient), Nomor versi (`v0.8.0`), dan deskripsi singkat kinerja tinggi.
- **Action Cards Grid (4 Kartu):**
  - *Open Folder…* (`⌘O`): Dialog pemilihan workspace disk.
  - *Clone from GitLab…* (`⌘⇧O`): Clone URL repository Bank Jatim / GitHub dengan target direktori `/mnt/storage/projects`.
  - *New Flutter Project…* (`⌘N`): Modal pembuatan aplikasi Flutter baru dengan organization `id.co.bankjatim`.
  - *Toolchain Doctor:* Status kesehatan compiler dan SDK.
- **Recent Projects Table:**
  - Input filter instan dengan shortcut keyboard `↑` `↓` `Enter`.
  - Kolom metadata: Nama proyek, path absolut, branch git aktif, waktu terakhir dibuka, dan tombol hapus riwayat.
- **Toolchain Doctor Card (Terintegrasi):**
  - 6 status item: Flutter SDK (3.24.3), Android SDK (API 34), ADB Connected, Scrcpy, Kotlin LS, Xcode Simtouch.
  - Badge visual (Hijau = Siap, Kuning = Opsional, Merah = Perlu Tindakan).
  - Aksi 1-klik: Pindai Ulang & Install Language Server.

### 5.3 Layar 2: Full IDE Workspace
- **Top Cockpit TitleBar (38px):**
  - Selector Proyek & Branch Git di sisi kiri.
  - Tombol Run/Debug/Hot Reload/Hot Restart di tengah sebagai *Cockpit Center*.
  - Search Everywhere (`Shift Shift`) dan toggles panel di kanan.
- **File Tree:**
  - Struktur pohon direktori Flutter (`lib/`, `features/`, `pubspec.yaml`).
  - Indikator git dirty: `M` (Modified - amber), `U` (Untracked - green), `D` (Deleted - red).
- **Tabbed Code Editor:**
  - Tab bar ramping dengan tab aktif terangkat (*elevated tab*).
  - Breadcrumb navigasi hierarki file.
  - Syntax code Dart dengan gutter nomor baris dan folding arrow.
  - Inline AI Ghost Text completion (saran teks abu-abu yang bisa di-accept via `Tab`).
- **Bottom Terminal Dock:**
  - Tabs: `Terminal`, `Flutter Run`, `Dart Analysis`, `Logcat`.
  - Output baris log kompilasi Flutter interaktif.
- **Right AI Agents Panel (Desain Anti-Cramp V2):**
  - **Single Unified Header (38px):** Dropdown Agen (`🤖 Hermes (Techlead) ▾`) + Subtabs (`Chat` / `Diff 2`) + Gear + Close.
  - **Chat Area Lega:** Pesan obrolan bersih, preview kartu tool call ringkas.
  - **Proposed Diff Card:** Kartu review kode dengan tombol `✓ Terima (Accept)` dan `✕ Tolak (Reject)`.
  - **Floating Context Composer:** Area pengetikan melayang di bawah dengan *context pills*:
    - `@Context` (File & Git context picker)
    - `Ask Permission ▾` (Level izin: Read, Ask, Auto, Full)
    - `Ponytail: ON` (Disiplin minimalis)
    - `Caveman: ON` (Komunikasi terarah tanpa basa-basi)
- **Device Mirroring Dock (300px):**
  - Tampilan frame ponsel Android/iOS ramping menampilkan antarmuka mobile banking Bank Jatim JConnect.

### 5.4 Layar 3: Settings Center (Desain Ulang ala Linear / Raycast / macOS)
Mengubah modal settings kaku menjadi control center master-detail 2 kolom yang intuitif:
- **Left Categories Sidebar:**
  - Kolom pencarian cepat di bagian atas (`Cmd-,`).
  - 9 Kategori dengan icon SVG 1.5px:
    1. *Umum (General)* — Tema Tampilan, Reopen last project, Bahasa.
    2. *Editor* — AI Ghost text, Code folding, Vim mode, Format on save (Dart, Kotlin, Swift).
    3. *Pintasan Tombol (Keymap)* — Tabel pemetaan shortcut dengan keycaps badge dan filter.
    4. *Agen AI & Disiplin* — Slot konfigurasi model (Hermes, Claude, ACP), toggle Ponytail, toggle Caveman.
    5. *Toolchain & SDK* — Jalur Flutter SDK, Android SDK, status Kotlin LS installer dengan progress bar.
    6. *Git & Repositori* — Default branch, in-memory commit staging, status GitLab istar.id.
    7. *Akun & Jaringan* — Status OpenVPN Kantor (tun0), Tailscale, sesi GitLab PAT.
    8. *Perangkat & Mirror* — Konfigurasi Scrcpy bitrate, buffer, dan Simtouch iOS bridge.
    9. *Tentang (About)* — Versi build, engine status, lisensi internal.
- **Right Content Panel:**
  - Menggunakan toggle switches modern bergaya iOS/macOS (bukan checkbox HTML standar).
  - Segmented pills untuk pilihan opsi (Dark / Light / OLED Zen).
  - Status pills berwarna dengan feedback langsung saat disimpan.

---

## 6. Standar Aksesibilitas & WCAG 2.1 AA

1. **Rasio Kontras Warna (Contrast Ratio):**
   - Teks Utama (`#f1f2f4`) pada Background Kanvas (`#0c0d10`) = **16.2:1** (Melampaui syarat WCAG AAA 7:1).
   - Teks Sekunder (`#9da1ad`) pada Surface (`#121317`) = **6.8:1** (Memenuhi syarat WCAG AA 4.5:1).
   - Tombol Accent Blue (`#3b82f6`) pada Teks Putih = **4.6:1** (Memenuhi WCAG AA).
2. **Ukuran Target Sentuh & Klik (Touch & Click Targets):**
   - Seluruh tombol toolbar, rail item, dan tab memiliki tinggi minimal 28px dengan padding hit-area 36×36px.
   - Tombol utama dialog minimal 36×36px (desktop) atau 44×44px (touch/mirror).
3. **Navigasi Keyboard Penuh:**
   - Fokus keyboard ditandai dengan outline cincin 2px biru semi-transparan (`--border-focus`).
   - Modal dapat ditutup menggunakan tombol `Esc`.
   - List project dapat dinavigasi dengan panah `Up` / `Down` dan dipilih dengan `Enter`.
4. **Accessible Labels & Semantics:**
   - Semua tombol icon-only wajib memiliki atribut `aria-label` dan `title` tooltip.
   - Screen reader attributes (`role="tab"`, `role="dialog"`, `aria-selected="true"`).

---

## 7. Panduan Salinan Teks (Copywriting & i18n)

Sistem menggunakan Bahasa Indonesia sebagai bahasa utama antarmuka tim lokal, dengan fallback Bahasa Inggris yang setara:

| Komponen | Bahasa Indonesia (Default) | English (Secondary) |
|---|---|---|
| Dashboard Hero Subtitle | Native Flutter & Mobile Engineering IDE Ringan & Cepat | Fast, Lightweight Native Flutter & Mobile Engineering IDE |
| Open Folder Action | Buka Folder Proyek… | Open Project Folder… |
| Clone Action | Clone Repositori Git… | Clone Git Repository… |
| Toolchain Doctor Status | Semua Compiler & Tools Siap Digunakan | All Compilers & Tools Ready |
| Run Cockpit Tooltip | Jalankan Aplikasi (F5) | Run Application (F5) |
| Hot Reload Tooltip | Muat Ulang Cepat Flutter (⌘\) | Flutter Hot Reload (⌘\) |
| Hot Restart Tooltip | Mulai Ulang Aplikasi (⇧⌘\) | Flutter Hot Restart (⇧⌘\) |
| AI Prompt Placeholder | Tanyakan sesuatu atau berikan tugas perbaikan kode… | Ask a question or assign a code task… |
| Proposed Diff Action (Accept) | Terima Perubahan | Accept Changes |
| Proposed Diff Action (Reject) | Tolak | Reject |
| Settings Search | Cari pengaturan atau pintasan (⌘,)… | Search settings or shortcuts (⌘,)… |
| Ponytail Badge | Disiplin Solusi Ringan Aktif | Minimalist Diff Discipline Active |
| Caveman Badge | Output Terarah Tanpa Basa-Basi | Terse Direct Output Mode |

---

## 8. Spesifikasi AI Agents & Teams (Settings & Team Slots)

### 8.1 Model Configuration Editor
Settings Center pada kategori **AI Agents & Disiplin** (`sec-agents`) menyediakan konfigurasi granular per slot agen maupun global:
- **Penyedia Model (Providers):**
  * `Anthropic Claude` (via Antigravity atau proxy 9Router).
  * `Google Gemini` (Gemini 2.5 Pro, Flash).
  * `OpenAI GPT` (GPT-4o, o3-mini).
  * `Local Ollama` (Qwen 2.5 Coder 32B, DeepSeek-R1).
  * `Hermes Agent CLI` (Lokal daemon server uqiflutter1).
- **Model ID & Fallback Chain:**
  * Model ID input fleksibel dengan fallback chain berantai 3 tingkat:
    `1° Primary: claude-3-7-sonnet` ➔ `2° Fallback: gemini-2.5-pro` ➔ `3° Local: ollama:qwen2.5-coder:32b`
- **Keamanan Kunci API:**
  * Seluruh token API disimpan secara aman di OS Keychain (`Stored in OS Keychain`), ditampilkan dalam format masked dengan badge status terenkripsi.
- **Mode Izin (Permission Modes):**
  * `Read-Only` — Agen hanya dapat membaca file, tidak diizinkan mengubah kode.
  * `Ask Before Action (Default)` — Setiap tool call terminal atau patch wajib disetujui developer.
  * `Auto-Run Safe` — Eksekusi command non-destruktif (read, test, analyze) otomatis berjalan; patch file meminta konfirmasi.
  * `Full Autonomous` — Mode otonom penuh untuk background automation task.

### 8.2 Deteksi Bot Hermes Lokal (`~/.hermes/profiles/`)
Sistem secara otomatis memindai profil Hermes yang terpasang di sistem operasi server (`/home/uqi/.hermes/profiles/`):
1. `👑 manager`: Planner & Task Orchestrator (Claude 3.7 Sonnet · Ready).
2. `🧠 techlead`: System Architect & Core Modules (Claude 3.7 Sonnet · Active).
3. `⚡ senior`: Fullstack Flutter & Rust Implementer (Claude 3.7 Sonnet · Busy dengan animasi pulse dot).
4. `⚡ senior2`: Toolchains, Language Servers & Integrations (Gemini 2.5 Pro · Ready).
5. `🔍 reviewer`: QA, Code Reviewer & Security Auditing (Gemini 2.5 Pro · Ready).
6. `🎨 designer`: UI/UX Design System & Interactive Prototypes (Claude 3.7 Sonnet · Ready).
- **Aksi 1-Klik:** Tombol *Terapkan Semua ke Proyek (Adopt All to .petak/team.json)* secara otomatis menyinkronkan profil lokal ke berkas konfigurasi proyek `.petak/team.json`.

### 8.3 9Router Quota & Token Tracker
Pemantauan langsung kuota dan token dari database lokal 9Router (`~/.9router/db/data.sqlite` via proxy `127.0.0.1:20128`):
- **5 Metrik Ringkasan:**
  * *Total Requests:* Counter jumlah request yang diproses proxy.
  * *Prompt Tokens:* Akumulasi token input (misal: `1.82M`).
  * *Completion Tokens:* Akumulasi token output (misal: `486K`).
  * *Total Tokens:* Jumlah gabungan token (misal: `2.31M`).
  * *Estimasi Biaya USD:* Biaya riil pemakaian model (misal: `$4.62 USD`).
- **Alokasi Biaya Model (Stacked Bar):**
  * Visualisasi persentase konsumsi biaya model: Claude 3.7 Sonnet (62% - Indigo `#6366f1`), Gemini 2.5 Pro (28% - Emerald `#10b981`), dan Local Ollama / 9Router (10% - Cyan `#06b6d4`).

---

## 9. Spesifikasi Git VCS Panel (Android Studio Grade)

Mengadopsi tata letak 3 kolom standar industri Git ala Android Studio / IntelliJ IDEA:

### 9.1 Toolbar Atas VCS
- **Branch Selector Pill:** Menampilkan branch aktif (`feat/phase5-agent`), commit SHA singkat (`bc353cf`), dan tracking status terhadap upstream (`origin/feat/phase5-agent`).
- **Action Buttons:** `Commit (⌘K)`, `Push (⇧⌘K)`, `Pull (⌘T)`, `Fetch`, `Stash...`.
- **Search & Filter Bar:** Input filter commit berdasarkan hash/pesan, dropdown filter author (`@designer`, `@senior`, `@techlead`), dan rentang tanggal.

### 9.2 Kolom Kiri: Commit Staging Dual-Section
- **Changes Section (`Changes (N)`):**
  * Menampilkan berkas berstatus Modified / Staged dengan aksen Biru (`#58a6ff`).
  * Checkbox master untuk memilih seluruh berkas sekaligus, dan checkbox per berkas.
  * Tag status: `MODIFIED` (`+115`, `+42 -8`).
- **Unversioned Files Section (`Unversioned Files (M)`):**
  * Menampilkan berkas baru yang belum dilacak git dengan aksen Hijau (`#4ade80`).
  * Checkbox master dan checkbox per berkas.
  * Tag status: `UNTRACKED` (`+320`, `+180`).
- **Commit Message Box:**
  * Chips shortcut tipe commit konvensional: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.
  * Area teks multi-baris untuk pesan commit lengkap.
  * Checkbox `Amend Commit` dan tombol aksi primer `Commit (N files)` dengan dropdown `Commit and Push...`.

### 9.3 Kolom Tengah: Multi-Branch Log Graph (Topological Lanes)
- **Visual Topological Lanes:**
  * Render pita cabang multi-warna (Lane 0: Blue `#3b82f6` untuk `main`, Lane 1: Emerald `#10b981` untuk `feat/phase5-agent`, Lane 2: Purple `#8b5cf6` untuk `feat/b23-ui`, Lane 3: Amber `#f59e0b` untuk `fix/simtouch`).
  * Garis SVG kurva halus yang menghubungkan titik percabangan dan merge commit.
  * Node commit dengan lingkaran padat dan cincin penanda status HEAD.
- **Tabel Commit Riwayat:**
  * Kolom: Graph (72px), Pesan Commit & Branch Tags (Flex), Author (95px), Waktu (80px), SHA Hash (65px monospaced).
  * Badge cabang visual: `HEAD -> feat/phase5-agent` (blue), `origin/feat/phase5-agent` (emerald), tag rilis `v0.8.0-rc1` (amber).
- **Commit Detail Box (Bawah):**
  * Menampilkan SHA hash lengkap, metadata author, waktu commit, parent SHA, dan pesan deskripsi commit lengkap.

### 9.4 Kolom Kanan: Interactive Diff Viewer
- **Tampilan Side-by-Side & Unified:**
  * Menampilkan perbandingan berkas yang dipilih di staging panel (`lib/features/git/git_log_graph.dart`).
  * Kolom kiri: Versi Base (`HEAD~1`) dengan penanda baris terhapus (merah lembut `rgba(239, 68, 68, 0.14)`).
  * Kolom kanan: Versi Working Tree dengan penanda baris tambahan (hijau lembut `rgba(16, 185, 129, 0.14)`).
  * Nomor baris tersinkronisasi dan gutter fold area kode yang tidak berubah.

---

## 10. Spesifikasi Bottom Tool Windows (Interactive Dock)

Dock bawah IDE mengadopsi sistem multi-tab interaktif (tinggi standar 295px) dengan 4 sub-view utama:

### 10.1 Tab 1: Terminal
- Multi-tab session: `zsh #1 (project)`, `bash #2 (server)`, tombol `+ New Terminal`.
- Kontrol panel: Split Vertically, Split Horizontally, Clear Console, Maximize.
- Mendukung ANSI 256-color palette dengan font JetBrains Mono.

### 10.2 Tab 2: Flutter Run (Pixel 7 Pro)
- **Status Cockpit:** Indikator hijau aktif `Running: com.dwidasa.mb.mbjatim (pid: 28419)` pada perangkat target.
- **Tombol Aksi Cepat:**
  * `⚡ Hot Reload (⌘\)` dengan live latency tracker badge (`⚡ 184ms`).
  * `⟳ Hot Restart (⇧⌘\)` dengan latency tracker badge (`⟳ 720ms`).
  * `🌐 DevTools` — Membuka Flutter DevTools di browser.
  * `■ Stop` — Menghentikan proses aplikasi.
- **Live Daemon Console:** Output log kompilasi Flutter interaktif dengan penanda status warna (`[INFO]`, `[SUCCESS]`, `flutter:`).

### 10.3 Tab 3: Logcat (Bank Jatim Mobile)
- **Filter Package:** Input pill `package:mine (com.dwidasa.mb.mbjatim)` membatasi log hanya pada aplikasi Bank Jatim.
- **Filter Log Level Berwarna (Standar `logcat.ts`):**
  * `V` (Verbose): `#6e7380` (Abu-abu netral)
  * `D` (Debug): `#8b8f98` (Abu-abu terang)
  * `I` (Info): `#7fc98f` (Hijau)
  * `W` (Warning): `#e8b45a` (Kuning amber)
  * `E` (Error / Fatal): `#f07a74` (Merah dengan latar belakang baris gelap `#2a1d1e`)
- **Pencarian Tag & Pesan:** Input filter instan untuk tag log (`tag:BankJatimAuth`) dan kata kunci pesan (`pin verification`).
- **Clickable Stack Trace Links:**
  * Tautan berkas stack trace dapat diklik langsung dengan visual underline biru (`#60a5fa`):
    - `package:com.dwidasa.mb.mbjatim/features/auth/pin_screen.dart:142:18`
    - `at id.co.bankjatim.mobile.MainActivity.onPinFailed(MainActivity.kt:89)`
  * Mengarahkan kursor editor langsung ke baris dan kolom yang bersangkutan.

### 10.4 Tab 4: Problems (LSP) & Fix with Agent
- Menampilkan daftar diagnostik aktif dari Dart Analyzer dan Kotlin Language Server:
  * Error (Merah `#ef4444`): Isu kompilasi tipe atau null-safety.
  * Warning (Kuning `#f59e0b`): Unused imports atau potensi bug.
  * Info (Biru muda `#38bdf8`): Rekomendasi linting (`prefer_const_constructors`).
- **Tombol `🔧 Fix with Agent`:**
  * Setiap baris masalah dilengkapi tombol aksi 1-klik untuk meminta bantuan AI.
- **Modal Draf Prompt Transparan (`FixWithAgentModal`):**
  * Menampilkan dialog draf sebelum perintah dikirimkan ke agen.
  * Pilihan agen target (`Techlead`, `Senior`, `Reviewer`).
  * Chip konteks: Berkas & baris yang bermasalah, versi toolchain Flutter, dan branch Git.
  * Area teks draf prompt yang dapat disunting secara bebas oleh developer sebelum menekan `Kirim ke Agen ➤`.

---

## 11. Spesifikasi AI Dock Team Switcher & Context Pills

### 11.1 Team Switcher Grid (Anti-Cramp)
Pada panel AI kanan (`#right-agent-dock`), header 38px terintegrasi dilengkapi switcher tim 6 bot dalam format grid 3×2 yang ringkas tanpa kebutuhan scroll horizontal:
- Baris 1: `👑 Manager`, `🧠 Techlead`, `⚡ Senior`
- Baris 2: `⚡ Senior2`, `🔍 Reviewer`, `🎨 Designer`
- **Indikator Runtime:**
  * Dot Hijau padat: Status `Ready`.
  * Dot Biru dengan animasi pulse glow: Status `Busy` (sedang memproses tugas kode).
  * Dot Abu-abu: Status `Idle`.
- **Banner Bot Aktif:** Menampilkan nama bot, persona spesifik, model AI yang digunakan (`Claude 3.7 Sonnet via 9Router`), serta konsumsi token sesi (`18.4k tokens · $0.04 USD`).

### 11.2 Subtabs & Stream Interaksi
- **Subtabs:** `Chat`, `Proposed Edits (N)` dengan counter badge, `Quota & Usage`, `Memory`.
- **Kartu Tool Call Ringkas:** Menampilkan nama tool (`patch`, `terminal`, `read_file`), path target, dan durasi eksekusi (`14ms`).
- **Proposed Diff Card:** Kartu review kode diff sebelum diterapkan, dilengkapi tombol `✓ Terima (Accept)` dan `✕ Tolak`.

### 11.3 Floating Context Composer
Area pengetikan prompt melayang di bagian bawah dengan context pills interaktif:
- `@ Context (N files)`: Membuka pemilih berkas dan git context.
- `Ponytail: ON / OFF`: Tombol toggle disiplin minimalis (solusi paling sederhana, diff terpendek, YAGNI).
- `Caveman: ON / OFF`: Tombol toggle gaya bahasa langsung tanpa basa-basi percakapan.
- `Ask ▾`: Dropdown tingkat izin eksekusi (`Read`, `Ask`, `Auto-Safe`, `Full`).