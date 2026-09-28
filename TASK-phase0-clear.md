# Petak — tutup syarat GO bersyarat fase 0 ("sampai clear")

Konteks: fase 0 udah GO bersyarat, baca `/mnt/storage/uqi-projects/petak/docs/phase0-report.md` (§8–9) + `docs/phase0/f02-treesitter.md` + `docs/phase0/f03-lsp-acp.md`. Vault: `/home/uqi/vault/Projects/Petak/` (overview, plan, architecture, design, journal). UQi minta semua syarat diberesin sampai clear sebelum fase 1.

## Yang harus beres (3 item, boleh paralel kalau ga rebutan Mac)
1. **Verifikasi ulang 3 angka yang belum dicek independen** — cold start, ketik 10k baris, buka 50k baris. Script udah ada: `node scripts/measure-coldstart.mjs`, `python3 scripts/run_f02_bench.py`. Butuh layar Mac UNLOCK (kalau lockscreen → kanban_block minta UQi buka Mac, jangan ngulang terus). Cek dulu: `screencapture -x` + vision, atau `ioreg -n Root -d1 | grep -i CGSSessionScreenIsLocked`.
2. **Swift tree-sitter**: build `alex-pinkus/tree-sitter-swift` terbaru ke wasm (tree-sitter CLI `build --wasm`; emscripten/docker kalau perlu — di server boleh, HDD /mnt/storage aja). Ukur ulang parse awal + ms per ketikan di file 10k baris (node dulu, lalu di app). Kalau tetap > 16 ms/ketikan → pindahin parse Swift ke Web Worker dengan timeout + fallback tanpa highlight (lazy: cara paling kecil yang bikin editor ga nge-freeze). Hasil: `docs/phase0/f05-swift.md`.
3. **kotlin-lsp di project Android asli** (bukan project Java kosong). Cari project Android/Kotlin beneran di Mac (mis. folder `android/` dari project Flutter UQi di Mac, atau clone sample resmi kecil kayak `android/nowinandroid` kalau disk cukup — cek `df -h /` dulu, Mac sisa ~6 GB, JANGAN sampai < 2 GB). Ukur: diagnostics masuk ngga + berapa lama, RAM. Kalau tetap gagal, coba `fwcd/kotlin-language-server` sebagai pembanding. Putuskan: kotlin-lsp / fwcd / tree-sitter-only dulu. Hasil: `docs/phase0/f06-kotlin-lsp.md`.

## Aturan
- Lingkungan Mac: `ssh 100.100.1.1`, `export PATH=~/.local/bin:~/.cargo/bin:$PATH`, repo `~/petak`, `CARGO_TARGET_DIR=~/petak/target`. Abis build, hapus `target/release/{build,deps}` + `target/debug` biar disk ga habis (bundle/ jangan dihapus).
- Server: SSD hampir penuh → semua cache/clone di /mnt/storage.
- Angka jujur + log mentah di `docs/phase0/logs/`. Gagal = tulis gagal + error, jangan dikarang.
- Ponytail/minimal. Commit di repo server.
- Reviewer verifikasi item 2 & 3 (re-run sendiri). Akhir: update `docs/phase0-report.md` jadi verdict final (GO penuh / GO dengan catatan), append ringkasan ke vault `journal.md`, dan update `plan.md` kalau keputusan LSP Kotlin/Swift berubah.
