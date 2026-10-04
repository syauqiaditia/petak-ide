# Petak IDE — Visual Audit, Modern References & UI/UX Redesign Specification

**Target:** Antarmuka Utama Petak IDE (Shell, AI Agents Panel, GitLab MR Viewer, Editor)  
**Status:** Design Proposal & Specification for UQi  
**Author:** @designer (UI/UX Designer)  
**Date:** 4 Oktober 2026  
**Interactive Mockup:** `docs/redesign/mockup-v2.html`  

---

## 1. Executive Summary & Problem Statement

Petak IDE dirancang khusus sebagai developer tools modern untuk pengembangan Flutter, Dart, dan integrasi multi-agen (Hermes, Claude Code, ACP) serta alur kerja GitLab MR. Namun, pada iterasi Fase 4.5 dan Fase 5 awal, antarmuka Petak mengalami **visual fatigue** dan **cognitive overload** yang signifikan:

1. **Border Overload ("Jail-Cell" Effect):** Hampir setiap kontainer, bar, tab, dan list item dibatasi oleh garis batas 1px solid (`--border: #26282d`, `--border-subtle: #2c2e34`). Karena background antar kontainer memiliki delta warna yang sangat tipis (`#111215`, `#141518`, `#16171a`, `#1a1b1f`), mata dipaksa memproses puluhan garis kisi yang kaku daripada fokus pada kode dan konteks.
2. **AI Agents Panel: 4-Tier Stacked Header Cramp:** Pada panel AI Agents di sisi kanan (lebar 390px), terdapat 4 tingkat header bertumpuk sebelum pesan pertama muncul:
   - Header 1: Main Panel Header (Title + 4 subtabs: Chat/Diff/Quota/Memory + Close btn) ~38px
   - Header 2: Slot Navigation Tabs Row (Hermes/Claude/Custom pills + Settings) ~36px
   - Header 3: Slot Subbar (Izin dropdown + Ponytail badge + Caveman badge + RSS/PID) ~34px
   - Header 4: Sticky Limitations Banner (Catatan snapshot Local History) ~44px  
   *Total ruang vertikal terbuang:* **152px!** Di layar laptop 900px, ini memangkas lebih dari 20% area percakapan dan membuat kontrol horizontal terhimpit.
3. **GitLab MR Viewer Terhimpit & Kurang Breathing Room:** Panel ulasan MR saat ini terasa seperti formulir kaku. Spacing antar metadata (author, branch, pipeline, SHA) terlalu rapat, aksi persetujuan (Approve, Rebase, Checkout) tidak memiliki hierarki visual yang jelas, dan viewer diff kehilangan ruang horizontal yang lega.
4. **Token Warna Tidak Konsisten:** `--border-subtle` (`#2c2e34`) saat ini justru memiliki nilai luminance lebih tinggi/terang daripada `--border` (`#26282d`), menciptakan kontradiksi semantik di mana elemen "subtle" tampak lebih mencolok.

Dokumen ini menyajikan audit visual menyeluruh, sintesis dari 4 tolok ukur IDE/developer tools modern kelas dunia (**Cursor/Windsurf, Zed, JetBrains Fleet, Linear**), arsitektur token baru, serta spesifikasi detail untuk **Varian A (Cursor / Minimalist Focus)** dan **Varian B (Zed / Fleet Zen Focus)** yang telah diwujudkan dalam prototype interaktif `docs/redesign/mockup-v2.html`.

---

## 2. Audit Visual Mendalam Antarmuka Petak Saat Ini

### 2.1 Analisis Token Warna & Surface Depth (`index.html`)

| Token Saat Ini | Nilai Hex | Isu & Titik Lelah Visual | Rekomendasi Solusi |
|---|---|---|---|
| `--bg-titlebar` | `#111215` | Perbedaan dengan `--bg-panel` hanya ~3%. Tidak ada persepsi kedalaman layer yang nyata. | Layer 0 (Canvas Base): `#0c0d10`. Titlebar dibuat semi-transparan atau menyatu dengan kanvas. |
| `--bg-panel` | `#141518` | Terlalu gelap dan datar, membuat panel terlihat kusam. | Layer 1 (Surface Panel): `#121317`. |
| `--bg-app` | `#16171a` | Nilai di antara panel dan editor yang membingungkan. | Satukan kanvas dasar menjadi Layer 0 `#0c0d10`. |
| `--bg-editor` | `#1a1b1f` | Warna latar editor sedikit terlalu terang dibanding kontras teks syntax. | Layer 2 (Work Surface / Editor): `#15161b`. Kontras terhadap teks dinaikkan. |
| `--bg-raised` | `#23252b` | Terlalu abu-abu/berkabut saat dipakai untuk kartu popover. | Layer 3 (Elevated Cards/Inputs): `#1c1e24` dengan border tipis `#272a32`. |
| `--border` | `#26282d` | Terlalu tegas saat digunakan di setiap perbatasan panel. | Gunakan border ultra-low contrast `#1e2026` atau hilangkan border struktural (borderless). |
| `--border-subtle` | `#2c2e34` | **BUG SEMANTIK:** Lebih terang (`#2c2e34`) daripada border utama (`#26282d`). | Ubah menjadi `#18191f` atau `rgba(255, 255, 255, 0.04)`. |
| `--text` | `#d8d9dc` | Cukup baik, namun hierarki heading dan label sekunder kurang tajam. | `--text-primary: #ededef`, `--text-secondary: #9da1ad`, `--text-muted: #646875`. |
| `--accent` | `#6ea8ff` | Biru muda pucat, kurang energetik pada tombol aksi utama. | Vibrant Blue `#3b82f6` (Varian A) atau Electric Indigo `#6366f1` / Emerald `#10b981` (Varian B). |

---

### 2.2 Titik Lelah Komponen Utama

#### A. AI Agents Panel (`ui/features/agents/AgentsPanel.svelte` & `AgentTabs.svelte`)
1. **Vertical Header Clutter:** Empat baris bertingkat di bagian atas panel membuat pengguna merasa "terintimidasi" oleh konfigurasi sebelum sempat mengetikkan pertanyaan.
2. **Form-Like Controls:** Dropdown `<select>` izin (`read`, `ask`, `auto`, `full`) terlihat seperti formulir web jadul, bukan IDE developer tool.
3. **Badge Disiplin Terpisah:** Tombol `PONYTAIL` dan `CAVEMAN` diletakkan di baris ketiga tanpa indikasi jelas apakah ini filter, prompt modifier, atau status runtime.
4. **Sticky Limitations Banner:** Banner kuning/biru dengan teks panjang memakan ruang berharga sepanjang waktu, padahal ini adalah pesan disclaimer yang hanya perlu diketahui sekali.
5. **Tool Calls Visual Noise:** Kartu tool call menampilkan dump teks panjang dengan tombol "Tampilkan seluruh output" yang merusak ritme membaca chat.

#### B. Shell & TitleBar (`ui/shell/TitleBar.svelte`)
1. **Tombol Terlalu Banyak di TitleBar:** Project picker, branch picker, run config picker, gear modal, gradle sync, run button, hot reload, hot restart, debug, stop, mirror toggle, devices toggle, search button, dan avatar berdesakan dalam satu baris horizontal 46px.
2. **Distribusi Aksi yang Kurang Ergonomis:** Pada resolusi layar sempit (<1366px), elemen di kanan akan terpotong atau saling tumpang tindih.

#### C. GitLab MR Viewer (`ui/features/mr/MrView.svelte`, `MrList.svelte`, `MrDetail.svelte`)
1. **Daftar MR Padat:** Kolom kiri memiliki padding terlalu sempit (`6px 10px`), teks deskripsi dan branch terpotong tanpa tooltip yang nyaman.
2. **Header Detail MR Kaku:** Baris judul MR, badge Draft/State, tombol Approve, Rebase, dan Checkout diletakkan sejajar tanpa visual hierarchy yang membedakan primary vs secondary action.
3. **Tab Review Tidak Rapi:** Tab Discussions, Commits, Changes menggunakan gaya tombol pill yang memisahkan konten dari tab secara artifisial.

---

## 3. Kompilasi & Sintesis 4 Benchmark IDE/Developer Tools Modern

### 3.1 Cursor & Windsurf: Context-First & Seamless AI Integration
- **Floating / Integrated Prompt Composer:** Input prompt agen bukan sekadar textarea di dasar panel, melainkan komposer interaktif yang melayang (*floating rounded card*) dengan border halus saat fokus.
- **Unified Context Pills:** Kontrol agen tidak disebar di header bertingkat, melainkan berupa **interactive pills** di dalam atau di bawah area prompt:
  - `@File`, `@Git`, `@Branch` untuk konteks berkas.
  - `[Hermes 3.8 ▾]` untuk model/agen switcher.
  - `[Ask Permission ▾]` atau `[Ponytail ON]` sebagai toggle pill yang ringkas.
- **Diff Cards Inline:** Usulan perubahan kode disajikan sebagai kartu diff yang bersih langsung di dalam alur chat atau berdampingan dengan editor, lengkap dengan tombol 1-klik *Accept* / *Reject* per hunk tanpa dialog konfirmasi yang mengganggu.

### 3.2 Zed: Borderless Philosophy, Pure Typography & Zen Ergonomics
- **Zero Border Clutter:** Zed hampir sepenuhnya meniadakan border 1px solid antar panel vertikal. Batas panel dibedakan melalui:
  - Perbedaan tonalitas background yang halus (misal: `#121316` vs `#16171b`).
  - Spacing dan alignment tipografi yang presisi.
- **Monospaced Micro-Details:** Indikator baris, status git (`M`, `U`, `D`), branch tags, dan counter angka disajikan dengan font monospaced ramping (JetBrains Mono / Berkeley Mono), memberikan rasa presisi teknis tingkat tinggi.
- **Compact Breadcrumbs:** Menggantikan tab bar horizontal yang memakan tempat dengan breadcrumbs interaktif di bagian atas editor yang memungkinkan navigasi hierarki instan.

### 3.3 JetBrains Fleet: Distributed Controls & Collapsible Dock Rails
- **Integrated Titlebar & Navigation:** Menggabungkan kontrol jendela, project switch, dan quick run ke dalam bar navigasi atas yang sangat ramping (38px-40px).
- **Distribusi Kontrol Cerdas:** Tombol run/debug diletakkan di tengah sebagai "Cockpit Center", sementara switcher panel (Terminal, Git, Agent, Devices) berada di sudut kanan atas atau docking rail yang bisa di-collapse sepenuhnya.
- **Floating Modals & Tool Windows:** Tool windows tidak memakan ruang layar permanen; jendela dapat di-pin atau dibiarkan melayang saat dibutuhkan saja.

### 3.4 Linear: Dark Theme Depth Layers & Micro-Interactions
- **3-Layer Depth Architecture:**
  - *Layer 0 (Base / Canvas):* `#0c0d10` (deepest black/charcoal).
  - *Layer 1 (Panels / Sidebars):* `#121317` (neutral dark slate).
  - *Layer 2 (Cards / Workspace / Editor):* `#16171b` (focused work plane).
  - *Layer 3 (Popovers / Floating Inputs / Active States):* `#1e2026` dengan subtle border `rgba(255, 255, 255, 0.08)`.
- **Subtle Smooth Geometry:** Radius sudut halus (`6px` untuk kontrol kecil, `8px` untuk kartu, `12px` untuk floating dialog).
- **Status & Priority Badges:** Badge pill dengan opasitas background 10-15% dan warna teks yang kontras tinggi (misal: Emerald `#10b981` dengan bg `rgba(16, 185, 129, 0.12)`).

---

## 4. Arsitektur Token Desain Baru Petak (V2 Design System)

```css
:root {
  /* Surface Layers (Linear 3-Depth Model) */
  --p-bg-base:        #0c0d10; /* Canvas dasar, rail background */
  --p-bg-surface:     #121317; /* Sidebar file tree, panel sekunder */
  --p-bg-workspace:   #16171b; /* Editor code background, MR detail area */
  --p-bg-elevated:    #1c1e24; /* Floating agent prompt, cards, dialogs */
  --p-bg-hover:       #24262e; /* State hover umum */
  --p-bg-active:      #2b2e38; /* State active / selected */

  /* Borders (Ultra-Low Contrast & Borderless Concept) */
  --p-border-subtle:  rgba(255, 255, 255, 0.05); /* Divider halus antar list item */
  --p-border-default: #1e2026;                    /* Garis pembatas utama jika diperlukan */
  --p-border-focus:   rgba(99, 102, 241, 0.4);   /* Ring fokus keyboard/input */
  --p-border-active:  #3b82f6;                    /* Indikator aktif */

  /* Typography Scale */
  --p-font-ui:   'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --p-font-mono: 'JetBrains Mono', monospace;

  --p-text-primary:   #f1f2f4; /* Teks utama judul & kode (kontras > 12:1) */
  --p-text-secondary: #9da1ad; /* Teks deskripsi, menu item, branch */
  --p-text-muted:     #606470; /* Placeholder, shortcut hint, timestamp */
  --p-text-disabled:  #40434c;

  /* Accents & Status Semantic */
  --p-accent:         #3b82f6; /* Blue 500 (Varian A) atau Indigo #6366f1 (Varian B) */
  --p-accent-hover:   #2563eb;
  --p-accent-surface: rgba(59, 130, 246, 0.12);

  --p-success:         #10b981; /* Emerald 500 (Run ready, Approved MR, Ready Agent) */
  --p-success-surface: rgba(16, 185, 129, 0.12);

  --p-warning:         #f59e0b; /* Amber 500 (Ask mode, Uncommitted files) */
  --p-warning-surface: rgba(245, 158, 11, 0.12);

  --p-danger:          #ef4444; /* Rose 500 (Full access warning, Build error) */
  --p-danger-surface:  rgba(239, 68, 68, 0.12);

  --p-purple:          #a855f7; /* Ponytail / Assistant token */
  --p-purple-surface:  rgba(168, 85, 247, 0.12);

  /* Geometry & Shadows */
  --p-radius-sm:  4px;
  --p-radius-md:  6px;
  --p-radius-lg:  8px;
  --p-radius-xl:  12px;
  --p-shadow-floating: 0 8px 24px -4px rgba(0, 0, 0, 0.45), 0 2px 6px -1px rgba(0, 0, 0, 0.3);
}
```

---

## 5. Dua Varian Redesign: Komparasi Varian A vs Varian B

| Aspek Desain | Varian A: Cursor / Minimalist Focus | Varian B: Zed / Fleet Zen Focus |
|---|---|---|
| **Inspirasi Utama** | Cursor, Windsurf, Linear | Zed, JetBrains Fleet |
| **Top TitleBar** | Integrated TitleBar 42px dengan Project pill, Branch switcher, Run cockpit terpusat, dan Search Everywhere pill. | Zen Mode TitleBar ultra-ramping 32px; kontrol window menyatu dengan breadcrumbs, Run controls diringkas menjadi ikon status ringkas. |
| **Side Rail & File Tree** | Rail 44px dengan ikon modern ramping; File Tree memiliki icon warna-warni (Dart cyan, YAML amber) dengan jarak baris 26px yang lega. | Ultra-minimal rail (atau hidden rail); File tree bergaya monospaced murni dengan git status single-letter (`M`, `U`), tanpa border pemisah vertikal. |
| **Editor Workspace** | Tab bar modern dengan borderless tabs, active tab elevated card, breadcrumb terintegrasi di bawah tabs. | Tabless breadcrumbs-first editor: navigasi cepat via keyboard (`⌘P` / `⌘⇧O`), workspace kode vertikal maksimal. |
| **Panel AI Agents** | **Seamless Right Dock:**<br>• Header ringkas 38px (Agent dropdown + Subtabs Chat/Diff/Stats)<br>• **Floating Composer Card** di bawah dengan pills terintegrasi (`@Context`, `Hermes`, `Ask`, `Ponytail`)<br>• Kartu tool call ramping dengan preview ekspansif. | **Zen Drawer / Split Flow:**<br>• Panel agen dapat disembunyikan total atau dibuka sebagai floating bottom drawer / clean right split tanpa header berlebihan<br>• Mode percakapan murni teks monospaced tanpa elemen formulir visual. |
| **GitLab MR Viewer** | Split-view lega: Kolom kiri dengan pencarian cepat & filter pills; Detail kanan dengan hero header judul MR, status pipeline visual, dan action group berjenjang. | Full-canvas code review: Focus mode diff viewer side-by-side dengan review shortcuts (`J`/`K` navigasi hunk, `A` approve). |
| **Ergonomi & Titik Berat** | Sangat cocok untuk developer yang sering berinteraksi intensif dengan AI agent dan ingin kontrol visual intuitif 1-klik. | Sangat cocok untuk developer purist yang memprioritaskan ketenangan visual (0-clutter), kecepatan baca kode, dan screen real-estate maksimal. |

---

## 6. Solusi Spesifik untuk Keluhan UQi

### 6.1 Mengatasi "4-Tier Header Cramp" pada Panel AI Agents

Dalam rancangan baru, 4 header bertumpuk dihapus total dan digantikan oleh arsitektur **Single Unified Header + Floating Context Composer**:

```
[SEBELUM REDESIGN - 152px WASTED]
┌────────────────────────────────────────────────────────┐
│ ✨ AI Agents       [Chat] [Diff] [Quota] [Memory]   [✕]│  <- Header 1 (38px)
├────────────────────────────────────────────────────────┤
│ [H Techlead] [C Fixer] [+]                         [⚙] │  <- Header 2 (36px)
├────────────────────────────────────────────────────────┤
│ Izin: [Ask Before Action ▾] [PONYTAIL] [CAVEMAN]  PID  │  <- Header 3 (34px)
├────────────────────────────────────────────────────────┤
│ ℹ️ Catatan: Edit via tool internal agen tidak...       │  <- Header 4 (44px)
└────────────────────────────────────────────────────────┘

[SETELAH REDESIGN - HANYA 38px HEADER RINGKAS]
┌────────────────────────────────────────────────────────┐
│ [🤖 Hermes (Techlead) ▾]    [Chat] [Diff 3]      [⚙] [✕]│  <- Unified Header (38px)
└────────────────────────────────────────────────────────┘
  ... (Area Chat Lega 100% tinggi viewport) ...
┌────────────────────────────────────────────────────────┐
│ ┌────────────────────────────────────────────────────┐ │
│ │ Tanyakan sesuatu atau berikan perintah...          │ │  <- Floating Composer
│ │                                                    │ │
│ │ [@ Context] [Ask ▾] [Ponytail ✓]     [Kirim ↵]     │ │  <- Context Pills Row
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

**Detail Perubahan:**
1. **Agent Slot Switcher:** Disatukan langsung dalam dropdown pill di kiri header (`🤖 Hermes (Techlead) ▾`). Pengguna bisa berpindah slot agen tanpa baris tab ekstra.
2. **Subtab Disederhanakan:** Hanya ada 2 pilihan utama yang relevan saat koding: `Chat` dan `Diff` (dengan badge angka perubahan yang belum di-accept, misal `Diff 3`). Quota dan Memory dipindahkan ke menu dropdown setting (`⚙`).
3. **Izin & Disiplin Menjadi Context Pills:** Dropdown izin dan toggle `Ponytail` / `Caveman` diletakkan langsung di dalam kartu komposer prompt, tepat di bawah area pengetikan. Ini memberikan umpan balik visual langsung: *"Saya sedang mengirim prompt ke Hermes dengan mode Ask dan disiplin Ponytail aktif"*.
4. **Limitations Banner Dihilangkan:** Disclaimer teknis digantikan oleh icon tooltip kecil (ℹ️) di samping nama model atau pesan sistem non-obstruktif saat sesi pertama dibuat.

---

### 6.2 Restrukturisasi GitLab MR Viewer

1. **Header Hero yang Lega:**
   - Judul MR menggunakan font ukuran 18px semibold dengan kontras tinggi (`#f1f2f4`).
   - Nomor `!IID` dan status `Open` / `Merged` disajikan dengan pill halus tanpa border tebal.
   - Metadata (pembuat, waktu, branch `source → target`) diatur dalam satu baris horizontal dengan visual hierarchy jelas.
2. **Hierarki Tombol Aksi yang Terarah:**
   - **Primary Action:** Tombol `Setujui (Approve)` menggunakan warna hijau emerald terisi (`#10b981`), menjadikannya fokus utama reviewer.
   - **Secondary Action:** Tombol `Rebase` dan `Checkout Branch` menggunakan gaya *ghost subtle button* (`#1c1e24` dengan hover `#24262e`), tidak bersaing dengan tombol Approve.
3. **Pipeline & Commit Info Terpadu:**
   - Status pipeline CI/CD disajikan dalam pill ringkas (`✓ Pipeline #4829 passing`), bukan widget kotak bertingkat.
4. **Tab Switcher Bergaya Linear:**
   - Garis bawah aktif biru halus (`2px solid #3b82f6`) tanpa border kotak di sekeliling tab.

---

## 7. Prototype Interaktif `docs/redesign/mockup-v2.html`

File prototype mandiri HTML5/CSS3/Vanilla JS telah dibuat di:
```
/mnt/storage/uqi-projects/petak-p4m/docs/redesign/mockup-v2.html
```

### Fitur Interaktif Prototype:
1. **Interactive Variant Switcher:** Toggle di top-bar untuk beralih instan antara **Varian A (Cursor / Minimalist Focus)** dan **Varian B (Zed / Fleet Zen Focus)** dengan transisi CSS halus.
2. **View Mode Switcher:** Beralih antara tampilan **Editor + AI Agents Panel** dan **GitLab MR Viewer**.
3. **Interactive AI Chat:**
   - Coba klik quick prompt suggestions (*"Review perubahan git"*, *"Optimasi query cache"*) untuk melihat animasi percakapan real-time.
   - Input chat responsif terhadap penekanan tombol `Enter`.
   - Tool calls collapsible (*"⚡ search_files"*).
4. **Interactive Proposed Edits / Diff Review:**
   - Buka tab `Diff (2)` pada panel agen.
   - Klik tombol **✓ Terima (Accept)** atau **✕ Tolak (Reject)** pada hunk kode; lihat counter badge ter-update secara reaktif!
5. **Interactive Context Pills:**
   - Klik pill `[Ponytail]` atau `[Caveman]` untuk melihat toggle status aktif/non-aktif.
   - Klik pill izin untuk membuka popover opsi 4-level (`Read`, `Ask`, `Auto`, `Full ⚠️`).

---

## 8. Rekomendasi Langkah Implementasi Bertahap untuk UQi

Kami merekomendasikan **Varian A (Cursor / Minimalist Focus)** sebagai arah desain utama Petak IDE karena menghadirkan keseimbangan terbaik antara efisiensi kerja sehari-hari, kemudahan navigasi bagi developer tim Bank Jatim/istar.id, dan integrasi AI yang modern.

### Roadmap Penerapan Tanpa Gangguan (Incremental Ponytail Refactor):

1. **Tahap 1: Unifikasi Token & Pembersihan Border (Low Risk, High Impact)**
   - Perbarui CSS variables di `index.html` sesuai spek V2 (Surface depth 3-layer, perbaiki bug `--border-subtle`).
   - Kurangi ketebalan dan jumlah border di `ui/shell/TitleBar.svelte`, `ui/shell/Rail.svelte`, dan `ui/shell/FileTree.svelte`.
2. **Tahap 2: Restrukturisasi Panel AI Agents**
   - Refactor `AgentsPanel.svelte` dan `AgentTabs.svelte`: gabungkan 4 header bertumpuk menjadi 1 header ringkas 38px.
   - Pindahkan kontrol izin dan toggle Ponytail/Caveman ke dalam komposer chat (`AgentChat.svelte`).
3. **Tahap 3: Pembaruan GitLab MR Viewer Layout**
   - Terapkan layout hero header bersih pada `MrDetail.svelte`.
   - Perbaiki spacing dan hierarki tombol aksi (Approve primary vs Rebase ghost).
4. **Tahap 4: Review Bersama UQi**
   - Demonstrasikan hasil langsung pada aplikasi yang berjalan di browser/webview.
