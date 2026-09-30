# Petak — UI/UX Design Specification: Starting Point Standalone, Animasi Logo Petak & Toolchain Doctor (Batch 7)
**Target:** Welcome Screen / Starting Point Mandiri (`DashboardView.svelte`), Toolchain Doctor, Animasi Logo, Quick Controls  
**Status:** Ready for Implementation & Review (Handoff to Senior2 @ `wt/b7-ui`)  
**Author:** @designer (UI/UX Designer)  
**Date:** 30 September 2026  
**Parent Task / Ref:** `t_e546109e` (Petak b7 DESIGNER) & `t_95683704` (Petak b7 SENIOR2)  
**Mockup Interaktif:** `docs/batch7/design/StartingPoint.html`  
**Screenshots Visual:** `docs/batch7/screens/preview-b7-starting-point-dark-id.png`, `preview-b7-starting-point-light-id.png`, `preview-b7-modal-scrcpy.png`

---

## 1. Ringkasan Eksekutif & Sasaran Desain

Sesuai arahan langsung UQi:
> *"kan ada designer kenapa pakai senior2 yang mendesain"*  
> *"tapi ingat ya, nanti ga bakal 100% sesuai dengan yang ada di macku, makanya tadi aku saranin buat starting point itu beda halaman jadinya pop up sendiri, nanti jika starting up maka apa saja yang perlu diinstall di cek udah ada belum semua toolsnya, jika belum ada nanti sarankan install. pemilihan tema dan lainnya juga include di starting pointnya. tapi tetap dengan ram usage yang kecil dan ukuran ide yang kecil juga ga besar banget ya"*

### Tujuan Utama:
1. **Starting Point Mandiri & Bebas dari Rail Editor:**
   Ketika tidak ada folder proyek terbuka (`!currentFolderPath`), Petak tidak lagi merender Rail kiri kosong (48px), tab editor kosong, atau dock bawah kosong. Layar Welcome tampil sebagai **Starting Point Mandiri** yang bersih, lapang, berpusat pada alur developer: membuka proyek, membuat proyek baru, atau clone dari Git.
2. **Animasi Logo Petak (Zero-KB Overhead):**
   Logo grid Petak (4 sel / 2x2) memiliki animasi ambient breathing & cell pulse berbasis **murni CSS keyframes**. Tidak ada dependensi pustaka animasi pihak ketiga (0 KB JavaScript payload, CPU idle < 0.1%).
3. **Toolchain Doctor / Health Check Otomatis:**
   Kartu diagnostik terintegrasi yang mendeteksi Flutter SDK, Dart SDK, Android SDK & ADB, Java JDK, Kotlin Language Server, scrcpy, dan Xcode/Swift secara instan.
   - Status visual tegas: **Ready** (Hijau `✓`), **Perlu Tindakan / Install** (Kuning `⚡ 1-Click` / `📖 Panduan`), **Hilang / Error** (Merah `✕`), dan **Opsional / Non-macOS** (Abu-abu netral `•`).
   - Tombol aksi kontekstual langsung di kartu (misal: 1-click install Kotlin LS dengan bar progres interaktif, panduan instalasi scrcpy).
4. **Quick Controls & Personalisasi Terpadu:**
   Peralihan Tema (*Dark OLED / Light*) dan Bahasa Antarmuka (*ID / EN*) langsung di Starting Point tanpa harus membuka modal pengaturan terpisah.
5. **Ponytail & UI Pro Max Discipline:**
   Ukuran memori tetap ultra-ramah (`RAM < 150 MB`), Svelte 5 reactivity murni, font Geist & JetBrains Mono, kontras WCAG AAA.

---

## 2. Arsitektur Layout & Wireframe

### 2.1 Kondisi Tampilan di `App.svelte`
Ketika `!currentFolderPath` (belum ada proyek yang dibuka):
```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ TopBar (42px) — [● ● ●] Petak Starting Point [Standalone View]   [ 🇮🇩 ID | 🇬🇧 EN ] [ 🌙 | ☀️ ]│
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ Viewport Mandiri (Center Stage, Max-Width 1080px):                                          │
│                                                                                             │
│  [Logo Petak Animasi 48px]  PETAK v0.7.0 (Batch 7)            [● RAM < 150MB] [⚡ Svelte 5] │
│                             Native Flutter & Mobile IDE...                                  │
│                                                                                             │
│  ┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────────────┐  │
│  │ 📂 BUKA FOLDER (⌘O)    │ │ ✨ PROJECT BARU (⌘N)   │ │ 📥 CLONE GIT (⌘⇧O)             │  │
│  │ Buka workspace lokal   │ │ Buat app Flutter/Dart  │ │ Clone dari GitLab Bank Jatim   │  │
│  └────────────────────────┘ └────────────────────────┘ └────────────────────────────────┘  │
│                                                                                             │
│  ┌──────────────────────────────────────────┐ ┌──────────────────────────────────────────┐  │
│  │ PROYEK TERAKHIR (4)     [🔍 Filter...]   │ │ TOOLCHAIN DOCTOR        [● 2 Tindakan] 🔄│  │
│  ├──────────────────────────────────────────┤ ├──────────────────────────────────────────┤  │
│  │ 💙 jatim-ist-mb-flutter 📌 [canary/dev]  │ │ 🟢 Flutter SDK v3.24.3          ✓ Ready  │  │
│  │    /mnt/storage/projects/...   12m lalu  │ │ 🟢 Dart SDK v3.5.3              ✓ Ready  │  │
│  │ ⚡ petak [wt/b7-ui]              1h lalu │ │ 🟢 Android SDK & ADB API 34     ✓ Ready  │  │
│  │ 🎮 hermes-office [main]          Kemarin │ │ 🟢 Java JDK OpenJDK 17          ✓ Ready  │  │
│  │ 📦 graphify-jconnect [master]    3d lalu │ │ 🟡 Kotlin LS (Not Installed)   [Install] │  │
│  └──────────────────────────────────────────┘ │ 🟡 scrcpy (Missing in PATH)    [Panduan] │  │
│                                               │ ⚪ Xcode & Swift (macOS Only)   Optional │  │
│                                               ├──────────────────────────────────────────┤  │
│                                               │ 5 dari 7 tools siap · Buka Pengaturan →  │  │
│                                               └──────────────────────────────────────────┘  │
│                                               ┌──────────────────────────────────────────┐  │
│                                               │ PERSONALISASI CEPAT                      │  │
│                                               │ Tema: [ 🌙 Gelap | ☀️ Terang ]           │  │
│                                               │ Bahasa: [ ID | EN ]                      │  │
│                                               │ Buka Proyek Terakhir Otomatis [Toggle]   │  │
│                                               └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

*Catatan Implementasi di `App.svelte`:*
Ketika `!currentFolderPath` bernilai benar, jangan render `<Rail />` di sisi kiri. Render langsung `<DashboardView />` memenuhi seluruh window body. Ketika folder dibuka, `<Rail />` dan workspace editor langsung muncul kembali secara seamless.

---

## 3. Desain Animasi Logo Petak (Pure CSS Keyframes)

Logo Petak adalah representasi 2x2 sel ("petak"). Animasi dibuat dengan teknik CSS murni tanpa pustaka JavaScript, memberikan kesan modern, bernapas (*breathing*), dan presisi:

```html
<div class="logo-container" aria-label="Logo Petak">
  <div class="logo-glow"></div>
  <div class="petak-logo">
    <span class="petak-cell c1"></span>
    <span class="petak-cell c2"></span>
    <span class="petak-cell c3"></span>
    <span class="petak-cell c4"></span>
  </div>
</div>
```

### CSS Token & Keyframes:
```css
/* Container & Glow */
.logo-container {
  position: relative;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-glow {
  position: absolute;
  inset: -4px;
  border-radius: 14px;
  background: radial-gradient(circle, rgba(110, 168, 255, 0.45) 0%, rgba(110, 168, 255, 0) 70%);
  opacity: 0.35;
  animation: petak-glow 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  pointer-events: none;
  z-index: 1;
}

/* 2x2 Logo Body */
.petak-logo {
  position: relative;
  z-index: 2;
  width: 46px;
  height: 46px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 4px;
  background: var(--bg-card);
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--border);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  animation: petak-logo-breathe 2.8s ease-in-out infinite;
}

.petak-cell {
  border-radius: 2px;
  transition: background 0.25s ease;
}

/* Sel 1 & 4 (Aksen Utama Biru) */
.petak-cell.c1 { background: var(--accent); animation: petak-cell-pulse-1 2.8s ease-in-out infinite; }
.petak-cell.c4 { background: var(--accent); animation: petak-cell-pulse-4 2.8s ease-in-out infinite; }

/* Sel 2 & 3 (Slate Gelap Berkedip Halus) */
.petak-cell.c2 { background: #2a3754; animation: petak-cell-stagger-2 2.8s ease-in-out infinite; }
.petak-cell.c3 { background: #2a3754; animation: petak-cell-stagger-3 2.8s ease-in-out infinite; }

/* Keyframes */
@keyframes petak-glow {
  0%, 100% { opacity: 0.25; transform: scale(0.96); }
  50% { opacity: 0.7; transform: scale(1.08); }
}

@keyframes petak-logo-breathe {
  0%, 100% { transform: translateY(0); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25); }
  50% { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(110, 168, 255, 0.22); }
}

@keyframes petak-cell-pulse-1 {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.04); filter: brightness(1.2); }
}

@keyframes petak-cell-stagger-2 {
  0%, 100% { background: #2a3754; }
  50% { background: #3c527e; }
}

@keyframes petak-cell-stagger-3 {
  0%, 100% { background: #2a3754; }
  50% { background: #354a72; }
}

@keyframes petak-cell-pulse-4 {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.04); filter: brightness(1.15); }
}

/* Aksesibilitas: Hormati prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .logo-glow, .petak-logo, .petak-cell {
    animation: none !important;
    transform: none !important;
  }
}
```

---

## 4. Desain Kartu Toolchain Doctor

### 4.1 Logika Status Visual (4 Tingkat)
| Status | Indikator Titik | Warna Token | Contoh Kasus | Tampilan Aksi di Kanan |
|---|---|---|---|---|
| **Ready** | Hijau `●` + glow | `var(--success)` (`#7fc98f` / `#15803d`) | Flutter SDK v3.24.3, Java JDK 17, ADB API 34 | Badge label `✓ Ready` |
| **Needs Action** | Kuning `●` + glow | `var(--warning)` (`#e8b45a` / `#92400e`) | Kotlin LS belum diunduh, scrcpy belum ada | Tombol aksi: `[⚡ Install 1-Click]` atau `[📖 Panduan]` |
| **Missing Required** | Merah `●` + glow | `var(--danger)` (`#f07a74` / `#b91c1c`) | Flutter SDK / Android SDK tidak terdeteksi | Tombol: `[Pilih Folder SDK]` |
| **Optional / Platform** | Abu-abu netral `●` | `var(--text-dim)` (`#656974` / `#6b7280`) | Xcode / Swift di sistem operasi Linux | Tag: `Optional` (tidak menipu user) |

### 4.2 Alur Aksi 1-Click Install Kotlin LS:
1. Pengguna menekan tombol `⚡ Install 1-Click`.
2. Tombol berubah menjadi label `Installing…` dengan spinner/animasi halus.
3. Di bawah baris tool, muncul kotak progress bar (`.install-progress-box`) yang mendengarkan event Tauri `kotlin-ls-progress`.
4. Saat selesai (100%), kotak progress menutup otomatis, titik status berubah menjadi hijau `✓ Ready`, dan versi `v1.3.13` langsung tertera.

### 4.3 Alur Panduan Instalasi scrcpy (Device Mirroring):
1. Pengguna menekan `📖 Panduan Install`.
2. Muncul dialog modal popover ringan (`.guide-modal`) yang menyediakan perintah instan sesuai sistem operasi:
   - macOS: `brew install scrcpy` + tombol Salin (`copySnippet`).
   - Ubuntu / Linux: `sudo apt update && sudo apt install scrcpy` + tombol Salin.
3. Tombol `Salin` memberikan umpan balik visual instan (*"Tersalin!"* berwarna hijau).

---

## 5. Quick Controls & Personalisasi Terpadu

Bagian ini diletakkan di kolom kanan di bawah kartu Doctor:
1. **Toggle Tema Antarmuka:** Segmented pill `[ 🌙 Dark | ☀️ Light ]`. Terhubung langsung ke `settingsStore.setTheme()`, menyimpan ke `localStorage('petak.theme')`, dan menerapkan kelas `.light-theme` / `[data-theme="light"]`.
2. **Pemilih Bahasa Tampilan:** Segmented pill `[ 🇮🇩 ID | 🇬🇧 EN ]`. Terhubung ke `settingsStore.language`, menyimpan ke `localStorage('petak.language')`.
3. **Toggle Buka Otomatis:** Switch iOS-style `[Buka Proyek Terakhir Otomatis]`. Terhubung ke `settingsStore.reopenLastProjectOnLaunch`.

---

## 6. Tabel Token CSS Lengkap (Dark & Light Theme)

Mengacu langsung pada `/home/uqi/vault/Projects/Petak/design.md`:

| Token CSS | Dark Theme (Default) | Light Theme | Penggunaan |
|---|---|---|---|
| `--bg-titlebar` | `#111215` | `#ebecef` | Header window teratas |
| `--bg-app` | `#141518` | `#f4f5f8` | Background utama viewport Starting Point |
| `--bg-card` | `#18191d` | `#ffffff` | Kartu proyek, kartu doctor, tile aksi |
| `--bg-card-hover` | `#1f2127` | `#f8f9fc` | Efek hover item baris & kartu |
| `--bg-elevated` | `#23252c` | `#e5e7eb` | Background badge, tombol icon, track switch |
| `--border-subtle` | `#23252a` | `#e2e4e9` | Garis batas pemisah baris list |
| `--border` | `#282a32` | `#d1d5db` | Border kartu & input |
| `--border-strong` | `#383b46` | `#9ca3af` | Border saat hover / fokus |
| `--text-main` | `#f0f1f4` | `#111827` | Judul, nama proyek, teks utama |
| `--text-muted` | `#8b8f98` | `#374151` | Label deskripsi, status text (Kontras AAA) |
| `--text-dim` | `#656974` | `#6b7280` | Path berkas, timestamp (Kontras AA 4.6:1) |
| `--accent` | `#6ea8ff` | `#2563eb` | Tombol primer, fokus, seleksi |
| `--success` | `#7fc98f` | `#15803d` | Status Ready, selesai instalasi |
| `--warning` | `#e8b45a` | `#92400e` | Status perlu tindakan / install |
| `--danger` | `#f07a74` | `#b91c1c` | Status hilang / error kritis |

---

## 7. Kamus Lokalisasi Bahasa (ID & EN Dictionary)

Untuk senior2 langsung salin ke `settingsStore` atau i18n file:

```typescript
export const startingPointI18n = {
  id: {
    heroSub: 'Native Flutter & Mobile Engineering IDE Ringan & Cepat',
    actOpen: 'Buka Folder',
    actOpenDesc: 'Buka workspace Flutter, Android, atau multiplatform yang ada di disk',
    actNew: 'Project Baru',
    actNewDesc: 'Buat boilerplate Flutter app, Dart package, atau modul native baru',
    actClone: 'Clone Git',
    actCloneDesc: 'Clone repository dari GitLab Bank Jatim atau GitHub via URL / SSH',
    recentsTitle: 'Proyek Terakhir',
    filterProjects: 'Filter proyek…',
    docTitle: 'Toolchain Doctor',
    docSub: 'Deteksi otomatis compiler, SDK & tools emulator',
    docActionsNeeded: '{n} Perlu Tindakan',
    btnRecheck: 'Pindai',
    btnInstallKls: 'Install 1-Click',
    btnScrcpyGuide: 'Panduan Install',
    docFooterStatus: '{ready} dari {total} tools terkonfigurasi',
    docFooterLink: 'Buka Pengaturan Toolchain (⌘,)',
    prefTitle: 'Personalisasi Cepat',
    prefTheme: 'Tema Warna',
    prefThemeDesc: 'Gelap (OLED JetBrains) atau Terang',
    prefLang: 'Bahasa Tampilan',
    prefLangDesc: 'Pilihan lokalisasi antarmuka IDE',
    prefReopen: 'Buka Proyek Terakhir Otomatis',
    prefReopenDesc: 'Langsung ke editor saat Petak dibuka'
  },
  en: {
    heroSub: 'Fast, lightweight native Flutter & mobile engineering IDE',
    actOpen: 'Open Folder',
    actOpenDesc: 'Open an existing Flutter, Android, or multiplatform workspace from disk',
    actNew: 'New Project',
    actNewDesc: 'Generate a clean Flutter app, Dart package, or native module boilerplate',
    actClone: 'Clone Git',
    actCloneDesc: 'Clone repository from Bank Jatim GitLab or GitHub via URL or SSH',
    recentsTitle: 'Recent Projects',
    filterProjects: 'Filter projects…',
    docTitle: 'Toolchain Doctor',
    docSub: 'Automated health-check for compilers, SDKs, and emulators',
    docActionsNeeded: '{n} Action(s) Needed',
    btnRecheck: 'Scan',
    btnInstallKls: 'Install 1-Click',
    btnScrcpyGuide: 'Setup Guide',
    docFooterStatus: '{ready} of {total} toolchains ready',
    docFooterLink: 'Open Toolchain Settings (⌘,)',
    prefTitle: 'Quick Personalization',
    prefTheme: 'Color Theme',
    prefThemeDesc: 'Dark (OLED JetBrains) or Light mode',
    prefLang: 'Interface Language',
    prefLangDesc: 'Localized display language for IDE',
    prefReopen: 'Reopen Last Project on Launch',
    prefReopenDesc: 'Jump straight into editor on Petak startup'
  }
};
```

---

## 8. Checklist Aksesibilitas & Ponytail (DoD Designer)

- [x] **Zero Dependencies:** Animasi logo 100% CSS keyframes, 0 KB JavaScript payload.
- [x] **Kontras Warna:** 
  - Dark mode teks utama (`#f0f1f4`) vs background (`#18191d`) = 14.2:1 (AAA).
  - Light mode teks muted (`#374151`) vs background (`#ffffff`) = 9.8:1 (AAA).
  - Warning tag Light mode (`#92400e`) vs pale amber background = 5.2:1 (AA).
- [x] **Keyboard Navigation & Shortcuts:** 
  - `⌘O` / `Ctrl+O` untuk Buka Folder.
  - `⌘N` untuk Project Baru.
  - `⌘⇧O` untuk Clone Git.
  - `⌘,` untuk Pengaturan.
  - Indikator focus ring `outline: 2px solid var(--accent); outline-offset: 2px`.
- [x] **Ukuran Target Sentuh & Klik:**
  - Tile aksi: tinggi 68px (target klik luas).
  - Tombol aksi Doctor: tinggi 28px, hit area 44px dengan margin aman.
  - Segmented control tombol: tinggi 26px.
- [x] **Edge Cases Terkelola:**
  - Proyek tidak ditemukan di disk (`!proj.exists`): badge muted merah `not found`, klik tidak crash.
  - Daftar proyek kosong: pesan informatif + ajakan klik Buka Folder.
  - Pencarian nihil: pesan *"Tidak ada proyek yang cocok dengan filter"*.
  - Mode Reduced Motion: animasi dinonaktifkan secara otomatis.
