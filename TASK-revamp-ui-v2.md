# Petak IDE UI/UX Revamp V2: Design System, Menu Bar, AI Agent Dock, Settings & VCS Android Studio Colors

## 1. Scope & Objective
Terapkan desain V2 yang telah disetujui UQi (berdasarkan prototype `docs/redesign/comprehensive-design-system.html` dan spec `docs/redesign/design-system-v2.md`):
1. **Design System & 4-Layer Depth (`index.html`)**:
   - Pasang token CSS permukaan 4-layer: Layer 0 (`--p-bg-base: #0c0d10`), Layer 1 (`--p-bg-surface: #121317`), Layer 2 (`--p-bg-workspace: #15161b`), Layer 3 (`--p-bg-elevated: #1c1e24`).
   - Perbaiki bug kontras border: gunakan alpha border lembut `rgba(255, 255, 255, 0.06)` (Varian A default) dan hilangkan efek "kisi penjara".
   - Sediakan toggle class tema di `body`: `.variant-a` (default Cursor/Linear) dan `.variant-b` (Zed/Fleet Zen) di Settings > Appearance.
2. **File Explorer & Tabs: Pewarnaan VCS ala Android Studio**:
   - HAPUS SEMUA badge teks `M` dan `U` pada file tree di `ui/shell/FileTree.svelte` dan `ui/features/git/GitCommitPanel.svelte`.
   - Terapkan pewarnaan teks berkas ala Android Studio:
     * Putih/Abu lembut (`#d8d9dc`) untuk berkas bersih (clean).
     * Biru muda (`#58a6ff`) untuk berkas modified.
     * Hijau segar (`#4ade80`) untuk berkas baru (added / untracked).
     * Abu gelap (`#606470`) untuk berkas ignored (.gitignore).
   - Terapkan pewarnaan yang sama pada tab editor aktif di `ui/features/editor/`.
3. **Menu Bar 12 Kategori & TitleBar Cockpit (`ui/shell/TitleBar.svelte`)**:
   - Tambahkan menu bar atas lengkap: `File`, `Edit`, `View`, `Navigate`, `Code`, `Refactor`, `Build`, `Run`, `Git`, `Tools`, `Window`, `Help` dengan dropdown menu realistis dan shortcuts.
   - Cockpit controls: gabungkan tombol Run, Debug, Hot Reload ⚡, Hot Restart ⟳, Stop ■, Device Picker, dan Search Everywhere `Shift Shift` secara rapi.
4. **AI Agents Panel Refactor (`ui/features/agents/`)**:
   - Pangkas 4-tier stacked header menjadi Single Unified Header 38px:
     * Dropdown selector bot Hermes 6 profil (`👑 Manager`, `🧠 Techlead`, `⚡ Senior`, `⚡ Senior2`, `🔍 Reviewer`, `🎨 Designer`) dengan runtime status dot (Ready / Busy).
     * Ikon model dinamis: Claude, Gemini, Ollama berubah sesuai model yang dipilih.
     * Tab ringkas `Chat` dan `Diff` (dengan badge hitungan hunk, misal `Diff 2`).
   - Pindahkan kontrol izin (`Read`, `Ask`, `Auto`, `Full`) dan toggle disiplin (`Ponytail`, `Caveman`) menjadi **Context Pills** interaktif di komposer prompt `AgentChat.svelte`.
5. **Settings Center Refactor (`ui/features/settings/SettingsModal.svelte`)**:
   - Terapkan layout master-detail 2 kolom ala Raycast / Linear:
     * Sidebar navigasi kiri: *Umum*, *Editor Kode*, *Pintasan Keyboard*, *AI Agents & Disiplin*, *Toolchain & SDK*, *Git & GitLab*, *Akun & Jaringan*, *Perangkat & Mirror*, *Tampilan Antarmuka*.
     * Panel "AI Agents & Disiplin": Model Configuration Editor (Provider, Model ID, Keychain API key, Fallback chain 3-tier), deteksi bot Hermes lokal (`~/.hermes/profiles/`), dan 9Router Quota Tracker riil.
     * Panel "Tampilan Antarmuka": Pilihan tema (Varian A vs Varian B).
6. **Sistem Ikon Baru 1.5px**:
   - Pasang icon set SVG stroke 1.5px seragam di `ui/icons/` atau komponen shell.

## 2. Performance & Quality Budget
- RAM Idle: < 150 MB (app idle).
- Ukuran Biner App: < 20 MB (saat ini 6.61 MB).
- Latensi Ketik: < 17 ms.
- Zero Regresi: 263 unit tests Rust (`cargo test -p petak-core`) dan seluruh test vitest/node (`npm test`) WAJIB PASS 100%.
- DILARANG membuat data palsu / hardcode status fiktif.

## 3. Pembagian Tugas
- `manager`: Pecah task secara paralel:
  * `senior2`: Implementasi CSS tokens V2, pewarnaan file tree VCS Android Studio, Menu Bar 12 kategori di TitleBar.
  * `senior2` (atau sub-task UI terpisah): AI Agents header flattening, context pills, dan Settings Center 2-kolom.
  * `senior`: Pastikan backend Tauri commands mendukung query bot model dinamis, fallback, dan quota 9Router jika ada yang perlu disinkronkan.
  * `reviewer`: Audit QA komprehensif, jalankan test suite, cek visual screenshot.
  * `techlead`: Verifikasi akhir di Mac M2, build release `.app`, deploy ke `/Applications/Petak.app`.

## 4. Environment
- Workspace server: `/mnt/storage/uqi-projects/petak-p4m`
- Branch: `feat/phase5-agent`
- Rust server env: `export CARGO_HOME=/mnt/storage/uqi-cache/cargo RUSTUP_HOME=/mnt/storage/uqi-cache/rustup CARGO_TARGET_DIR=/mnt/storage/uqi-cache/cargo-target-petak PATH=/mnt/storage/uqi-cache/cargo/bin:$PATH`
- Mac deploy: `100.100.1.1:~/petak`
