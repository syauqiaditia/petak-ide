# Spesifikasi Desain UI/UX: Redesign Git Petak IDE (ala Android Studio New UI)

**Status:** Proposed / Ready for Review  
**Penulis:** UI/UX Designer (JConnect / Petak Team)  
**Target:** Petak IDE v0.8.3+  
**File Output Terkait:** `docs/git-redesign/mockup.html`

---

## 1. Latar Belakang & Masalah UX

Berdasarkan audit dan masukan pengguna (UQi), workflow dan tampilan Git di Petak saat ini menimbulkan beberapa friksi usability utama:

| No | Masalah Saat Ini | Dampak UX | Solusi Android Studio New UI |
|---|---|---|---|
| 1 | **Layar Penuh Menutupi Editor** | Membuka tab Git menghilangkan context code editor, tab file yang sedang diedit tertutup total. | **Tool Window Mode (⌘K)**: Commit panel dapat dibuka di dock samping tanpa menutup editor tengah; atau Diff dibuka sebagai tab editor. |
| 2 | **Proporsi Kaku (Fixed 320px)** | Panel kiri kaku, nama file panjang terpotong di layar kecil, dan menyisakan ruang kosong berlebih di layar lebar. | **Resizable Splitter**: Gutter pembagi interaktif dengan batasan min/max dan snap reset, serta splitter vertikal antara tree dan commit box. |
| 3 | **Header Bertumpuk (8+ Tombol)** | Header Git dijejali `[Commit] [Log] [Stashes] [Conflicts] [Fetch] [Update ▾] [Stash] [Push] [Refresh]` secara bercampur. | **Segmented Navigation + Unified VCS Bar**: Pisahkan tab kerja repository (Changes, History, Conflicts) dengan aksi remote (Update, Push, More dropdown). |
| 4 | **Alur Kerja Membingungkan** | Batasan antara stage/unstage, checkbox commit, dan unversioned files tidak jelas. | **4-Step Pipeline yang Jelas**: Changes Tree → Diff Preview → Commit Message (AI Assisted) → Split Action (Commit / Commit & Push). |

---

## 2. Tujuan Desain (Design Goals)

1. **Clean & Uncluttered**: Mengurangi cognitive load dengan mengelompokkan aksi remote dan menyederhanakan header.
2. **Proporsional & Fleksibel**: Menyediakan resizable splitter horizontal dan vertikal agar nyaman di semua resolusi layar (laptop 13" hingga monitor ultrawide).
3. **Context-Preserving**: Mendukung mode Tool Window samping (⌘K) sehingga developer bisa commit sembari melihat editor code.
4. **Kejelasan Workflow**: Siklus *Review → Stage → Compose → Ship* terasa intuitif, cepat, dan minim klik.

---

## 3. Arsitektur Tata Letak (Layout Architecture)

### 3.1 Pilihan Mode Tampilan (Dual-Mode Support)

#### Mode A: Side Tool Window (Default ala Android Studio New UI / ⌘K)
- **Posisi:** Panel Commit berada di dock tool window kiri (menggantikan atau berdampingan dengan Project Tree).
- **Lebar:** Default `360px` (resizable: min `280px`, max `560px`).
- **Editor Area:** Code editor utama tetap terbuka dan aktif di tengah.
- **Diff Behavior:** Mengklik file pada Changes Tree membuka Diff sebagai tab editor khusus (`[Diff] File.svelte`) atau split-editor di sisi kanan.
- **Shortcut:** `⌘K` untuk toggle buka/tutup Commit tool window.

#### Mode B: Dedicated VCS Center Tab (Fokus Review & History)
- **Posisi:** Workspace utama tengah difokuskan untuk Git (Full-screen VCS Workstation).
- **Pembagian Area (Changes View):**
  - **Pane Kiri (35-40%):** Changes Tree (atas) + Commit Message Box (bawah) dengan splitter vertikal.
  - **Pane Kanan (60-65%):** Side-by-Side / Unified Diff Preview interaktif dengan sticky header dan hunk navigator.
- **Pembagian Area (History/Log View):**
  - **Kolom 1 (220px):** Branches Tree (Local, Remote, Tags, Stashes).
  - **Kolom 2 (Flex 1):** Interactive Commit Graph & Table (Graph beads, SHA, Subject, Author, Date).
  - **Kolom 3 (380px):** Commit Detail Inspector (Metadata, changed files list, mini diff preview).

---

## 4. Rincian Komponen & Workflow (Revamp: Clean & Lapang ala Android Studio New UI)

### 4.1 Header Panel Commit & Pemindahan Aksi Remote
Berdasarkan feedback tegas UQi terkait header yang tumpuk-tumpuk di lebar 300px:
1. **Pemisahan Tempat:**
   - **Top Toolbar IDE (Window Titlebar):** Menampung branch pill (`feat/p3-git ↑2`) serta aksi remote utama `[ ↓ Update ]` (⌘T) dan `[ ↑ Push 2 ]` (⌘⇧K).
   - **Bottom Status Bar:** Menampilkan status sinkronisasi Git cabang aktif `⑂ feat/p3-git ↑2 Git: Ready`, encoding `UTF-8`, `Spaces: 2`, dan bahasa `Svelte`.
2. **Header Panel Commit Bersih & Lapang:**
   - Kiri: Judul clean `Commit` (font 13px, weight 600, color text-main).
   - Kanan: 3 icon aksi kecil yang rapi:
     - `Show Diff` (Membuka / switch diff ke tab editor)
     - `Refresh (⟳)` (Sinkronisasi perubahan berkas)
     - `View Options (⚙)` (Dropdown opsi group by directory, ignored files, atau buka Full Git Tab).
   - Tanpa branch pill, tanpa tombol Update/Push, dan tanpa segmented tab berdesakan.

---

### 4.2 Changes Tree: Single Clean Header & Berkas Tanpa Badge Kotak
1. **Single Group Header (Hapus Double Header Redundan):**
   - Baris redundan `All Changes (3 files)` dihapus total.
   - Cukup SATU header grup yang fungsional:
     `▼ [✓] Changes (3)`
   - Berkas unversioned berada di grup collapsible terpisah: `▶ [ ] Unversioned Files (1)`.
2. **Daftar Berkas Bersih & Nyaman di Mata:**
   - Badge teks kotak `[M]` dan `[A]` dihapus total karena memakan tempat dan membuat tampilan sesak.
   - Status file dikomunikasikan secara natural lewat **warna teks nama berkas** ala Android Studio New UI:
     - **Modified:** Biru `#58a6ff`
     - **Added / Untracked:** Hijau `#56c989`
     - **Deleted:** Merah `#f85149` (dengan line-through)
   - Ikon berkas netral/minimalis dan path folder berwarna abu-abu redup di sebelah kanan nama file.
   - Hover actions minimalis (diff icon dan rollback ↺) di ujung kanan.

---

### 4.3 Commit Message Box: Lapang & Minimalis
1. **Single Spacious Textarea:**
   - Rentetan chip tag (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`) dihapus total.
   - Header teks `COMMIT MESSAGE` dan counter angka dihapus.
   - Menggunakan SATU textarea luas dan bersih dengan font proporsional (sans-serif / system-ui, bukan monospace) dan placeholder `Commit message`.
2. **Baris Aksi Minimal:**
   - Kiri: Checkbox sederhana `[ ] Amend`.
   - Kanan: Tombol utama beraksen biru `[ Commit ▾ ]` dengan dropdown caret untuk pilihan `Commit and Push…` (⌘⌥K) dan `Create Patch…`.
   - Tidak ada tombol tambahan yang membuat sesak.

---

### 4.4 Diff Preview (Pane Kanan)

Menyajikan perbandingan perubahan berkas secara instan:

1. **Diff Sticky Toolbar:**
   - Path file aktif: `ui/features/git/CommitPanel.svelte` (dengan tombol copy path).
   - Indikator baris: `+32 -14`.
   - Toggle Tampilan: `[ Side-by-Side ]` vs `[ Unified ]`.
   - Navigator Hunk: `[ ▲ Prev Hunk ]` `[ ▼ Next Hunk ]` `(Hunk 1 of 4)`.
   - Setting: `[ Ignore Whitespace ]`.
2. **Gutter & Code Canvas:**
   - Nomor baris lama dan baru yang presisi.
   - Gutter action untuk pementasan per-hunk (`Stage Hunk [✓]`).
   - Warna diff yang nyaman di mata:
     - Addition: Background `rgba(127, 201, 143, 0.12)`, text border `#7fc98f`.
     - Deletion: Background `rgba(240, 122, 116, 0.12)`, text border `#f07a74`.
   - Sinkronisasi scroll horizontal & vertikal 1:1.

---

### 4.5 History & Branches View (Tab Log)

Struktur 3 kolom proporsional:
1. **Sidebar Branches (220px, resizable):**
   - Search input filter branch.
   - Tree kategori: `Local Branches`, `Remote Branches`, `Tags`, `Stashes`.
2. **Commit Graph Table (Flex 1):**
   - Interactive SVG/Canvas commit graph beads (cabang branch multi-warna).
   - Kolom: Graph + Subject, Branch Pills (`HEAD -> main`, `origin/main`), Author, Date, Commit SHA.
   - Klik kanan untuk aksi: *Cherry-pick*, *Revert*, *Reset Current Branch to Here*, *Rebase onto Here*.
3. **Commit Details Panel (360px, resizable):**
   - Detail author, avatar, timestamp, full commit message.
   - List berkas yang diubah pada commit tersebut dengan mini diff inspector.

---

## 5. Token Desain & Konsistensi UI

Semua elemen menggunakan token desain Petak (Varian A: Modern Linear / Cursor):

| Kategori | Token / Nilai | Penggunaan |
|---|---|---|
| **Base Background** | `--p-bg-base: #0c0d10` | App frame, Titlebar, Background utama |
| **Surface** | `--p-bg-surface: #121317` | Panel commit, toolbars, sidebar branch |
| **Workspace** | `--p-bg-workspace: #15161b` | Canvas diff editor, log table background |
| **Elevated / Popups** | `--p-bg-elevated: #1c1e24` | Modal dialog, dropdown menu, cards |
| **Hover State** | `--p-bg-hover: #22242c` | Hover baris file, hover tombol toolbar |
| **Active / Selected** | `--p-bg-active: #2a2d36` | Baris file terpilih, tab aktif |
| **Border Default** | `--border-default: #1e2027` | Border panel, splitter line, separator |
| **Accent Primary** | `--accent: #6ea8ff` | Splitter hover glow, branch pill, primary focus |
| **Success / Add** | `--success: #7fc98f` | Diff additions, badge `A`, staged counter |
| **Danger / Del** | `--danger: #f07a74` | Diff deletions, badge `D`, conflict alert |
| **Warning / Mod** | `--warning: #e8b45a` | Badge `M`, rebase in-progress banner |
| **Font UI** | `Geist, system-ui, sans-serif` | Label, tombol, pesan, menu |
| **Font Code** | `JetBrains Mono, monospace` | Diff viewer, commit SHA, file path |

---

## 6. Aksesibilitas (WCAG 2.2 AA) & Ergonomi Interaksi

1. **Kontras Teks:** Semua teks memiliki rasio kontras >= 4.5:1 terhadap background masing-masing.
2. **Keyboard Navigation:**
   - `⌘K`: Buka / fokus ke Commit panel.
   - `⌘T`: Buka dialog Update Project (Pull / Rebase).
   - `⌘⇧K`: Buka dialog Push.
   - `Space`: Toggle checkbox file yang sedang dipilih.
   - `Enter` / `Double Click`: Buka diff file.
   - `⌘Enter`: Eksekusi Commit langsung dari input textarea.
   - `▲ / ▼`: Navigasi daftar file dan hunk diff.
3. **Target Ukuran Klik (Hit Target):**
   - Tombol dan baris file memiliki tinggi minimal 28px - 32px dengan padding nyaman.
   - Splitter gutter memiliki invisible hit zone selebar 8px untuk kemudahan drag mouse.
4. **Screen Reader & Label:**
   - Semua tombol icon-only memiliki atribut `aria-label` dan `title`.
   - Counter file terpilih (`X of Y files selected`) diumumkan secara kontekstual.

---

## 7. Penanganan Edge Cases

1. **Nama File / Path Sangat Panjang:**
   - Menggunakan flex-shrink dengan `text-overflow: ellipsis` pada direktori tengah, sementara leaf file tetap terbaca.
   - Tooltip native menampilkan full path lengkap pada saat hover.
2. **Tidak Ada Perubahan (Clean Working Tree):**
   - Menampilkan empty state visual yang elegan dengan tombol `Check for Remote Updates` atau `Switch Branch`.
3. **Rebase / Merge Conflict Berlangsung:**
   - Muncul banner peringatan sticky di atas: `⚡ Rebasing 2/5 — 2 files in conflict`.
   - Tombol navigasi langsung: `Resolve Conflicts`, `Abort`, `Continue`.
   - Tab `Conflicts (!2)` otomatis aktif dan disorot dengan warna peringatan.
4. **Koneksi Jaringan Offline Saat Push:**
   - Push error ditampilkan inline di dalam modal dengan tombol `Retry` dan penjelasan error yang manusiawi tanpa merusak state commit lokal.

---

## 8. Panduan Teks Antarmuka (Copy Matrix ID & EN)

| Konteks | Teks Indonesia (ID) | Teks Inggris (EN) |
|---|---|---|
| Tab Perubahan | Perubahan | Changes |
| Tab Riwayat | Riwayat Commit | History & Log |
| Tombol Update | Perbarui Proyek | Update Project |
| Tombol Push | Push Commit | Push |
| Tombol AI | ✨ Tulis dengan AI | ✨ Write with AI |
| Amend Checkbox | Perbaiki Commit Terakhir (Amend) | Amend Commit |
| Subjek Kosong | Subjek pesan commit wajib diisi | Commit subject is required |
| Peringatan Baris 2 | Baris 2 sebaiknya kosong sebagai pemisah | Line 2 should be empty |
| Empty State | Tidak ada perubahan berkas | No changes detected |
| Toast Berhasil | Berhasil commit X berkas | Committed X files successfully |
| Tombol Undo | Batalkan (Undo) | Undo |
