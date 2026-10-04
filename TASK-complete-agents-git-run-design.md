# Petak UI/UX Complete Suite: AI Team & Model Settings, Hermes Bots, Git VCS & Run/Terminal/Logcat

## 1. Permintaan Spesifik UQi
UQi ingin tampilan Petak IDE benar-benar LENGKAP dan DETAIL sebelum menyetujui revamp kode produksi:
1. **AI Agents & Model Settings**:
   - Bagaimana tampilan Pengaturan Agen AI?
   - Bagaimana cara ganti model (Gemini, Claude, GPT, Ollama, Antigravity via 9Router)?
   - Pemilihan provider, model ID, fallback model, API key / Keychain, dan permission mode.
2. **Hermes Bots & Team Slots**:
   - Bagaimana kalau ada bot Hermes lokal (`manager`, `techlead`, `senior`, `senior2`, `reviewer`, `designer`)?
   - Tampilan auto-deteksi profil Hermes di Settings dan di panel AI dock.
   - Cara atur tim per project (`team.json`): tambah/hapus bot, set peran (role), assign slot, dan switcher bot aktif di panel chat AI (`👑 Manager`, `🧠 Techlead`, `⚡ Senior`, `🔍 Reviewer`).
3. **Tampilan Git ala Android Studio**:
   - Panel Git lengkap: Log Graph commit multi-cabang visual (topological lanes).
   - Commit panel: grup `Changes (N)` (file modified/deleted dengan warna biru) dan `Unversioned Files (M)` (file baru dengan warna hijau), checkbox commit, kotak commit message, tombol Amend dan Commit & Push.
   - Branch switcher & Stash.
4. **Tampilan Dock Bawah: Terminal, Run, Logcat & Problems**:
   - **Terminal**: Multi-tab (`zsh`, `bash`, `+`), clear, split terminal.
   - **Flutter Run**: Console output live daemon, tombol Hot Reload ⚡, Hot Restart ⟳, link DevTools URL.
   - **Logcat**: Filter per PID/Package (`com.dwidasa.mb.mbjatim`), filter level (Verbose/Debug/Info/Warn/Error berwarna), pencarian tag, link klik stack trace ke baris kode.
   - **Problems (LSP)**: Daftar error/warning lint Dart & Kotlin dengan tombol "Fix with Agent".

## 2. Tugas Designer
Perbarui `docs/redesign/comprehensive-design-system.html` dan `docs/redesign/design-system-v2.md`:
1. Tambahkan sub-view interaktif lengkap untuk:
   - **Settings > AI Agents & Teams**: Daftar bot Hermes terdeteksi, Model Configuration Editor per slot, Fallback chain, dan 9Router Quota Tracker.
   - **Git View**: Tab/Panel Git mandiri dengan visual commit graph, Commit staging panel ala Android Studio, dan diff inspector.
   - **Bottom Tool Window Switcher**: Tab Terminal, Flutter Run, Logcat, dan Problems interaktif yang bisa diklik berpindah-pindah.
   - **AI Dock Team Switcher**: Dropdown/tab bot Hermes di panel kanan dengan status runtime.
2. Ambil screenshot visual resolusi tinggi untuk setiap view baru:
   - `docs/redesign/screens/settings-ai-agents-teams.png`
   - `docs/redesign/screens/git-vcs-full.png`
   - `docs/redesign/screens/terminal-run-logcat.png`
   - `docs/redesign/screens/ai-team-switcher.png`
3. Salin file terbaru ke Mac (`100.100.1.1:~/petak/docs/redesign/`) dan pastikan HTTP server port 8090 menyajikan versi terbaru.
4. Tulis rangkuman arsitektur visual di `/home/uqi/vault/Projects/Petak - UI Redesign V2.md`.

## 3. Batasan Keras
- Seluruh pekerjaan dilakukan pada dokumen dan prototype di `docs/redesign/`.
- Jangan menyentuh kode produksi `ui/` atau `crates/` sebelum disetujui UQi.
