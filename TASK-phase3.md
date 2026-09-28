# Petak — Fase 3: Git ala Android Studio

Fase 2 selesai (LSP Dart/Kotlin/Swift, P2.M lolos di Mac, cold start 587 ms). Sekarang git terintegrasi penuh — UQi ga mau pakai app git terpisah (Fork/Sublime Merge), maunya semua di Petak.

Baca dulu:
- Vault `/home/uqi/vault/Projects/Petak/`: `plan.md` §3 Git, `architecture.md` (folder `crates/core/src/git/`: model.rs, ops.rs, graph.rs; git = panggil CLI `git` lewat trait `Exec`, BUKAN libgit2; squash/reword via `git rebase -i` + `GIT_SEQUENCE_EDITOR`), `design.md` layar 2 Git log, 3 Interactive rebase, 5 Diff viewer, 6 Merge conflict.
- Mockup: `design/Git.html`, `design/Rebase.html`, `design/Diff.html`, `design/Conflict.html` (render di Chromium buat lihat).
- Repo `/mnt/storage/uqi-projects/petak`, report fase 1–2 di `docs/phase1`, `docs/phase2`. `NOTE-server-mode.md` = cara kerja di server.

## Scope fase 3
1. **Status & commit**: panel Commit (tab di Git view): daftar file berubah (staged/unstaged/untracked), stage/unstage per file dan per hunk, commit message (subject counter 50, Conventional Commits hint), commit, amend. Warna git status di file tree (M biru, A hijau, untracked hijau, deleted merah, conflict oranye) sesuai token design.
2. **Diff viewer** (`Diff.html`): side-by-side + unified, ignore whitespace, navigasi hunk, word-level highlight. Dipakai buat working tree, staged, dan commit di log. (Accept/Reject per hunk dari agent = fase 5, sekarang cukup view + stage/unstage hunk.)
3. **Log graph** (`Git.html`): `git log --topo-order` + algoritma lane di TS/Rust, badge ref (HEAD, branch, remote, tag), filter branch/user/date/path/teks-hash, panel branch (local/remote/tags), panel detail commit (file berubah → klik buka diff). Harus lancar di repo besar (virtualisasi list, load bertahap — tes di repo 10k+ commit).
4. **Aksi commit (klik kanan, multi-select)**: Squash, Edit Message (reword), Fixup into previous, Drop, Interactively Rebase from Here (dialog `Rebase.html`: pick/squash/reword/fixup/drop/edit, drag urutan, editor pesan hasil squash), Cherry-pick, Revert, Reset (soft/mixed/hard, hard wajib konfirmasi), New Branch, Copy Revision. Tombol "Write message with agent" = placeholder disabled (fase 5).
5. **Backup ref WAJIB** sebelum operasi yang nulis ulang history (squash/reword/fixup/drop/rebase/reset --hard): `refs/petak/backup/<timestamp>`, checkbox di dialog rebase default nyala. Ada cara restore dari UI (minimal: daftar backup + "Reset to this backup"). Info "sudah di-push / belum" per commit (commit yang udah di remote → peringatan butuh force push).
6. **Conflict** (`Conflict.html`): pas merge/rebase/cherry-pick conflict → daftar file conflict, editor 3 kolom Yours | Result | Theirs, Accept yours/theirs/both per blok, Result bisa diedit, Continue/Abort (merge/rebase/cherry-pick). Kartu "Suggested resolution" = placeholder disabled (fase 5).
7. **Branch & remote**: checkout, buat/hapus/rename branch, fetch, pull (merge/rebase), push (+ force-with-lease dengan konfirmasi). Status bar: branch + ahead/behind nyata.

## ATURAN KESELAMATAN GIT (UQi eksplisit — wajib)
- Test HANYA di repo dummy di temp dir (bikin sendiri pakai `git init`, commit bohongan). Identitas commit diset lokal di repo dummy: `git -c user.name="Petak Test" -c user.email=test@petak.local` / `git config --local` — JANGAN ubah `git config --global`.
- Remote buat tes push/pull/fetch = repo bare lokal (`git init --bare` di temp dir, URL `file://`). JANGAN push ke GitLab/GitHub mana pun, JANGAN pakai akun/PAT UQi.
- DILARANG nyentuh repo asli UQi: `jatim-ist-mb-flutter` / JConnect / apa pun di /mnt/storage/uqi-projects selain repo petak sendiri (dan repo petak sendiri jangan dijadiin korban tes rebase/reset).
- Tes squash/rebase/drop/reset wajib buktiin ga ada commit hilang: bandingin isi tree sebelum/sesudah, dan backup ref bisa restore persis ke HEAD lama.
- Push beneran ke GitLab via Keychain = BUKAN scope fase 3 (itu fase 6, di Mac, seizin UQi).

## Budget (tetap)
Ketik ≤ 17 ms, cold start ga naik > 10% dari 587 ms (≤ 646 ms), RAM idle < 150 MB, CPU idle ~0% (git status refresh pakai FS watcher yang udah ada, BUKAN polling). Baru: buka Git log repo 10k commit < 500 ms sampai baris pertama tampil, scroll lancar; `git status` refresh < 200 ms di repo sedang.

## Test
- `cargo test -p petak-core`: parser `git log`/`status --porcelain=v2`/diff, algoritma lane graph (merge, octopus, branch paralel), susun todo rebase, backup+restore, conflict parsing, semua ops di repo dummy beneran (temp dir).
- UI: logic murni ditest (lane → posisi, diff hunk mapping); preview browser boleh buat cek tampilan tapi tandai jelas "preview, bukan app".
- Di Mac di akhir (satu task P3.M, script siap jalan kayak fase 2): build .app, bench, screenshot app asli (commit panel, diff, log graph + context menu, rebase dialog, conflict), install `/Applications` (jangan timpa kalau Petak lagi jalan), plus langkah tes manual buat UQi (bahasa simpel, pakai repo dummy yang disiapin script).

## Lingkungan
- Server dulu (Mac UQi sering offline): Rust di `/mnt/storage/uqi-cache/{cargo,rustup}`, target `/mnt/storage/uqi-cache/cargo-target-petak`, `npm run build` jalan. `crates/app` ga bisa dibuild di server (webkit2gtk) — jangan buang waktu di situ.
- Mac: `ssh 100.100.1.1` (Tailscale, sering offline) — cuma buat P3.M; kalau offline, P3.M blocked nunggu, task lain jangan.
- SSD `/` hampir penuh → semua cache/temp di /mnt/storage.
- Senior & designer pakai Antigravity Gemini 3.8 Flash, fallback OFF. Kalau kena limit, task nunggu (UQi yang nambah akun) — pecah task kecil, commit sering biar kerjaan ga ilang.

## Aturan umum
Ponytail/minimal, ikut architecture.md. Jangan fabrikasi angka/screenshot, jangan hardcode data palsu di UI. Reviewer: re-run test sendiri + coba skenario destruktif di repo dummy + cek screenshot pakai vision. Deliverable: kode + commit, `docs/phase3/report.md` (fitur, tabel budget, bukti no-data-loss), screenshot `docs/phase3/screens/`, append ringkasan ke vault `journal.md`.
