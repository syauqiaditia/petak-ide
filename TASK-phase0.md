# Petak — Fase 0 (spike go/no-go)

Petak = IDE mobile bikinan UQi buat ganti Android Studio (macOS dulu). Baca semua ini dulu sebelum mulai:
- /home/uqi/vault/Projects/Petak/overview.md — scope + keputusan stack
- /home/uqi/vault/Projects/Petak/plan.md — performance budget, fase, toolchain Mac, risiko
- /home/uqi/vault/Projects/Petak/architecture.md — core Rust tanpa Tauri, UI cuma lewat ui/lib/api.ts, Svelte 5
- /home/uqi/vault/Projects/Petak/design.md + design/*.html — visual (Main, Git, Rebase, Settings, Diff, Conflict, Suggest)

## Tujuan fase 0
Bukti nyata (angka + screenshot), bukan mockup, buat mutusin Tauri 2 + CodeMirror 6 lolos atau pindah ke GPUI:
1. Tauri 2 + Svelte 5 + CM6 (+ @replit/codemirror-vim): app kosong dengan layout shell dari design/Main.html (title bar, rail, file tree, editor, status bar), buka folder + buka file.
2. Ukur: cold start sampai bisa ngetik, RAM idle, CPU idle, latency ngetik di file 10k baris, buka file 50k baris, ukuran .app/.dmg. Bandingkan ke budget di plan.md.
3. Highlight tree-sitter WASM buat **Dart, Kotlin, Swift** (tiga-tiganya v1): ukur ms per ketikan di file 10k baris.
4. LSP smoke test: `dart language-server`, `kotlin-lsp`, `sourcekit-lsp` — nyala ngga, diagnostics masuk ngga, RAM berapa.
5. ACP handshake ke minimal satu agent (claude-code-acp atau opencode acp). Cek juga Hermes support ACP atau belum.

## Lingkungan (penting)
- Repo kerja: /mnt/storage/uqi-projects/petak (HDD). SSD server hampir penuh — JANGAN taruh project/cache di /.
- Target = Mac UQi (M2, 8 GB, macOS 26.5, Xcode ada), SSH `ssh 100.100.1.1` lewat Tailscale (cuma nyala kalau Tailscale Mac on). Node 26 ada di ~/.local/bin. Rust lagi di-install via rustup (~/.cargo) oleh Hermes — cek `source ~/.cargo/env; cargo -V`. Disk Mac sisa ~7 GB, hemat (target/ bisa gede; bersihin kalau perlu).
- Server Linux ga punya webkit2gtk + sudo butuh password → build/ukur Tauri di Mac, bukan di server. Kode boleh ditulis di server lalu rsync/git ke Mac.
- Angka performa WAJIB diukur di Mac, bukan di server.

## Aturan
- Minimal/lazy (ponytail): ga ada abstraksi yang belum perlu, dependency seminimal mungkin.
- Jangan fabrikasi angka. Kalau sesuatu gagal (mis. kotlin-lsp ga jalan), laporin jujur + log.
- Deliverable: kode di repo (git init, commit), `/mnt/storage/uqi-projects/petak/docs/phase0-report.md` berisi tabel angka vs budget + rekomendasi go/no-go, dan screenshot app beneran jalan di Mac.
- Pas selesai, append ringkasan ke /home/uqi/vault/Projects/Petak/journal.md.
