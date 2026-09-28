# Petak — Fase 2: Bahasa (LSP: lint, autocomplete, quick fix)

Fase 1 clear (UQi terima cold start ~690 ms & buka 50k ~165 ms sebagai baseline baru). Sekarang bikin Petak "pintar": error/warning otomatis waktu ngetik, autocomplete, dan quick fix kayak "Wrap with widget".

Baca dulu:
- Vault `/home/uqi/vault/Projects/Petak/`: `plan.md` (fase 2 + aturan lazy LSP), `architecture.md` (folder `crates/core/src/lsp/`, UI cuma lewat `ui/lib/api.ts`), `design.md` + `design/Main.html` (popup lint + quick fix + "Ask agent"), `design/Suggest.html` (popup completion LSP: ikon m/f, tipe di kanan, footer shortcut).
- Repo `/mnt/storage/uqi-projects/petak`: `docs/phase0/f03-lsp-acp.md` + `spike/lsp-smoke.mjs` (LSP udah terbukti nyala di Mac), `docs/phase0/f06-kotlin-lsp.md` (Kotlin = fwcd, BUKAN kotlin-lsp JetBrains), `docs/phase1/report.md`.

## Scope fase 2 (urutan prioritas — Dart dulu, UQi harian pakai Flutter)
1. **LSP client di Rust core** (stdio JSON-RPC, `lsp-types` boleh). Lifecycle lazy: server baru nyala pas file bahasanya pertama dibuka, mati kalau idle 10 menit, restart kalau crash. Satu server per (bahasa, root project). Server: `dart language-server` (Dart), `fwcd/kotlin-language-server` (Kotlin), `sourcekit-lsp` (Swift). didOpen/didChange (incremental)/didSave/didClose.
2. **Diagnostics**: squiggle merah/kuning di editor (CM6 lint), gutter marker, hover pesan, panel **Problems** di panel bawah (klik → lompat ke baris), badge jumlah di tab Problems + status bar.
3. **Autocomplete**: popup completion dari LSP sesuai `Suggest.html` (ikon jenis, detail tipe, snippet/placeholder, resolve docs). Trigger otomatis waktu ngetik + Ctrl-Space. Harus ga bikin ketik lag.
4. **Quick fix / code action**: Alt-Enter (dan ikon lampu/popup lint) → daftar code action dari LSP → apply WorkspaceEdit. Wajib jalan: Dart "Wrap with widget / Wrap with Padding / Column / Center", "Remove unused import", "Add missing import". Kotlin/Swift: yang disediain server-nya aja.
5. **Hover docs, go to definition (Cmd-klik / Cmd-B), find usages (Alt-F7), rename (Shift-F6)**, format document (Cmd-Alt-L) lewat LSP.
6. Tombol "Ask agent" di popup lint boleh cuma placeholder (disabled) — agent itu fase 5.

## Budget (tetap wajib, ukur di Mac)
- Ketik 10k baris tetap ≤ 17 ms **dengan LSP nyala** (didChange ga boleh blok UI thread).
- Diagnostics pertama Dart < 3 s setelah buka file (fase 0: ~1,9 s).
- Popup completion muncul < 150 ms setelah ngetik (Dart).
- RAM app idle tanpa file dibuka tetap < 150 MB (LSP belum nyala). Catat RAM per server LSP di report.
- Cold start ga naik > 10% dari ~690 ms.

## Test
- `cargo test -p petak-core`: framing JSON-RPC, lifecycle (lazy start, idle kill pakai waktu palsu, crash restart), apply WorkspaceEdit (multi-edit, urutan offset), mapping posisi UTF-16 ↔ CM6 (emoji/karakter non-ASCII!).
- Manual di app asli di Mac pakai project Flutter asli (petak-sample atau project Flutter UQi di Mac): bikin error sengaja → squiggle + Problems muncul; ketik `Tex` → completion `Text`; kursor di widget → Alt-Enter → Wrap with Padding → kode berubah bener; Cmd-klik ke definisi; rename. Kotlin & Swift: minimal diagnostics + completion jalan.

## Lingkungan
- Mac `ssh 100.100.1.1` (Tailscale), `export PATH=~/.local/bin:~/.cargo/bin:$PATH`, repo `~/petak`, `CARGO_TARGET_DIR=~/petak/target`. Abis build hapus `target/release/{build,deps}` + `target/debug`. Cek `df -h /`.
- fwcd kotlin-language-server udah pernah diinstall di F0.6 (cek lokasinya di f06 report). Flutter di Mac 3.35.7.
- Klik/keyboard lewat SSH diblok macOS (Accessibility). Untuk tes UI pakai jalur test harness yang udah ada di fase 1 (PETAK_TEST_*), dan kalau tetap butuh klik manual → kanban_block minta UQi tes (kasih langkah jelas), jangan loop.
- Screenshot butuh layar Mac unlock.
- Setelah build final, copy ke `/Applications/Petak.app` (`ditto`) biar UQi bisa langsung nyoba — tapi jangan timpa kalau Petak lagi jalan (`pgrep -x petak-app`).
- Server: SSD hampir penuh, semua cache/clone di /mnt/storage.
- Senior pakai Claude Opus 4.6 via Antigravity (ada kuota) — pecah task kecil, commit sering.

## Aturan
- Ponytail/minimal, ikut architecture.md. Jangan fabrikasi angka. Jangan hardcode status/data palsu di UI (pelajaran fase 1).
- Reviewer: re-run test + bench sendiri, cek screenshot pakai vision, coba skenario manual yang bisa.
- Deliverable: kode + commit, `docs/phase2/report.md` (fitur jalan per bahasa, tabel budget, RAM per LSP) + screenshot `docs/phase2/screens/` (squiggle+Problems, completion popup, Alt-Enter wrap widget sebelum/sesudah, hover/go-to-def), append ringkasan ke vault `journal.md`.
