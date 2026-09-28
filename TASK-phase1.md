# Petak — Fase 1: Editor inti

Fase 0 selesai, verdict GO penuh (baca `docs/phase0-report.md` §10). Sekarang bikin Petak bisa dipakai beneran buat buka project, ngedit, dan save — belum ada LSP/git/run.

Baca dulu:
- Vault `/home/uqi/vault/Projects/Petak/`: `plan.md` (fase 1 + performance budget + aturan lazy), `architecture.md` (core Rust tanpa Tauri, UI cuma lewat `ui/lib/api.ts`, Svelte 5, trait cuma kalau ≥2 impl), `design.md` + `design/Main.html` (layout, token warna, ukuran px).
- Repo `/mnt/storage/uqi-projects/petak` (kode fase 0 udah ada: shell, file tree dasar, CM6 + vim, tree-sitter Dart/Kotlin/Swift, bench scripts).

## Scope fase 1
1. **File**: buka folder (dialog + recent), file tree ikut `.gitignore` (crate `ignore`), lazy expand, warna/ikon sesuai design. Tab banyak file (dirty dot, close, Cmd-W), save (Cmd-S), deteksi file berubah dari luar (FSEvents / crate `notify`, tanpa polling).
2. **Keymap**: vim mode tetap. JetBrains: Shift-Shift (search everywhere), Cmd-Shift-A (actions), Cmd-Shift-O / Cmd-P (cari file), Cmd-Shift-F (cari di project), Cmd-E (recent files). Alt-Enter disiapin di keymap tapi baru ada isinya di fase 2.
3. **Cari**: fuzzy file finder (index di Rust, target < 50 ms di 20k file), command palette, find in project pakai `rg` kalau ada (fallback crate `grep`/`ignore`), hasil klik → lompat ke baris.
4. **Terminal**: panel bawah, xterm.js + `portable-pty`, shell default user, resize bener, bisa banyak tab terminal.
5. Hapus polling `/tmp/petak_open.txt` sisa fase 0 kalau udah ga perlu (bench pakai jalur lain).

## Performance budget (wajib tetap lolos, ukur ulang di Mac di akhir)
Cold start (patokan sekarang 624 ms, jangan naik > 10%), RAM idle < 150 MB, CPU idle ~0%, ketik 10k baris ≤ 17 ms, buka 50k < 300 ms, fuzzy finder < 50 ms di 20k file, ukuran app < 20 MB. Ada yang jebol → benerin dulu sebelum nambah fitur.

## Test
- `cargo test -p petak-core` di Mac: file tree ikut gitignore, fuzzy ranking, search, save (atomic write — jangan sampai file kepotong kalau gagal).
- Tes manual di app beneran: buka project Flutter asli di Mac (JConnect / project Flutter UQi yang ada di Mac; kalau ga ada, clone sample kecil), buka file Dart/Kotlin/Swift, edit, save, cari file, cari teks, jalanin `flutter --version` / `ls` di terminal.

## Lingkungan
- Mac: `ssh 100.100.1.1` (Tailscale), `export PATH=~/.local/bin:~/.cargo/bin:$PATH`, repo `~/petak`, `CARGO_TARGET_DIR=~/petak/target`. Abis build hapus `target/release/{build,deps}` + `target/debug` (bundle/ jangan). Cek `df -h /` sebelum build besar.
- Screenshot butuh layar Mac unlock; kalau lockscreen → kanban_block minta UQi buka, jangan loop.
- Server: SSD hampir penuh, semua cache/clone di /mnt/storage.
- Senior pakai Gemini 3.8 Flash via Antigravity — pecah task kecil biar ga kehabisan 150 iterasi (fase 0 kena ini berkali-kali). Commit sering.

## Aturan
- Ponytail/minimal, ikut architecture.md. Jangan fabrikasi angka, gagal = tulis gagal + log.
- Reviewer: re-run test + bench sendiri, cek screenshot pakai vision, review arah dependency.
- Deliverable: kode + commit, `docs/phase1/report.md` (fitur jalan + tabel budget vs hasil + screenshot di `docs/phase1/screens/`: tree+tabs, fuzzy finder, find in project, terminal), append ringkasan ke vault `journal.md`.
