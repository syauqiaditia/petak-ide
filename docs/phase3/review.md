# P3.10 — Review + QA Destruktif Fase 3 (Server)

Tanggal: 28 September 2026 (re-run independen oleh reviewer)
Branch diperiksa: `feat/phase3-git` @ `2aed832` (HEAD saat review, working tree bersih)
Lingkungan: server Ubuntu, Git 2.43.0, cargo/rustc via `/mnt/storage/uqi-cache/cargo`

## Verdict: **LOLOS DENGAN CATATAN**

Satu bug nyata (argument injection nama branch) ditemukan dan dikonfirmasi via repro nyata di repo dummy — bukan blocker rilis (butuh user lokal mengetik nama branch berbahaya, dampak terbatas), tapi klaim di `docs/phase3/report.md` §7.3 ("seluruh nama cabang ... dilewatkan dengan separator `--` eksplisit") **tidak akurat** dan harus direvisi atau bug-nya diperbaiki.

## 1. Re-run test & build (semua cocok dengan report.md)

| Item | Klaim report.md | Hasil re-run saya | Match? |
|---|---|---|---|
| `cargo test -p petak-core` | 129 test pass | 89+4+1+5+13+3+9+3+1+1 = **129 pass, 0 fail** | ✅ |
| `npm run build` | sukses 0 error, 3.72s | sukses 0 error, **3.78s** | ✅ |
| `node scripts/test_p35_diff.mjs` | PASS | PASS | ✅ |
| `node scripts/test_p36_graph.mjs` | PASS | PASS | ✅ |
| `node scripts/test_p37_rebase_plan.mjs` | PASS | PASS | ✅ |
| `node scripts/test_no_runes_in_plain_ts.mjs` | PASS | PASS | ✅ |

Tidak re-run bench (status 8.66ms, log 10k 47.53ms) secara terpisah — angka di `docs/phase3/logs/bench-*.txt` sudah dari run sebelumnya dan `git_rebase` test suite yang menghasilkan `no-data-loss.md` saya re-run manual (lihat §3), hasilnya regenerasi SHA baru tapi struktur tabel & kesimpulan identik → bukti tabel itu genuinely dihasilkan dari test run nyata (bukan hardcode), karena SHA berubah setiap run.

## 2. Review kode

**Positif:**
- `crates/core/src/exec.rs`: trait `Exec` bersih, `SystemExec` pakai `std::process::Command` dengan `args()` (bukan shell string) → aman dari shell injection secara struktural.
- Semua path (`stage_files`, `unstage_files`, `diff_worktree` dengan path filter) memakai separator `--` sebelum path list — konsisten dan benar (`crates/core/src/git/ops.rs:11,21`, `diff.rs:53,73`).
- 39 dari 40 Tauri command git (`crates/app/src/commands.rs`) menjalankan pemanggilan git lewat `tauri::async_runtime::spawn_blocking` — tidak ada yang blocking main thread. `git_branch` (baris 58-61) memang sync tapi cuma baca file `.git/HEAD` (bukan spawn proses git), jadi bukan pelanggaran aturan "command git di spawn_blocking".
- Tidak ada polling — grep tidak menemukan timer/interval untuk refresh status; FS watcher event-driven (`watch.rs`) sesuai klaim.
- Tidak ada data palsu hardcode di `crates/core/src/git/` — semua data dari parsing output `git` asli.
- Tidak ada penggunaan Dio/http mentah di luar `Exec` trait — kontrak arsitektur terjaga.
- Kontrak tipe Rust↔TS (`docs/phase3/contract.md`) saya cross-check terhadap `model.rs` — field name, `camelCase` mapping, dan enum variant cocok untuk semua struct yang saya periksa (`StatusEntry`, `BranchInfo`, `DiffLine`, `Hunk`, `DiffFile`, `Commit`/`LogPage`, `RebasePlan`, `OpResult`, `ConflictFile`, `Remote`). Tidak bisa build `crates/app` di server (webkit2gtk absen) jadi mismatch runtime baru kelihatan di P3.M — sesuai catatan report.

**BUG — Argument injection nama branch (severity: Medium)**

Klaim `docs/phase3/report.md` baris 118-119:
> "Penolakan Nama Cabang Diawali Dash (`-`): Untuk mencegah injeksi opsi CLI Git (argument injection), seluruh nama cabang dan path diverifikasi dan dilewatkan dengan separator `--` eksplisit."

**Ini salah untuk branch name.** Grep `starts_with("-")` / validasi nama branch di seluruh `crates/core/src/git/` dan `crates/app/src/commands.rs`: nihil hasil. File & lokasi:

- `crates/core/src/git/ops.rs:320-333` (`branch_create`) — `git(exec, repo, &["checkout","-b", name, at_sha])` atau `&["branch", name, at_sha])`, tanpa `--` separator dan tanpa validasi `name`.
- `crates/core/src/git/ops.rs:335-338` (`branch_checkout`) — `git(exec, repo, &["checkout", name])`, no `--`.
- `crates/core/src/git/ops.rs:340-349` (`branch_delete`) — `git(exec, repo, &["branch", flag, name])`, no `--`.
- `crates/core/src/git/ops.rs:351-354` (`branch_rename`) — `git(exec, repo, &["branch", "-m", old, new])`, no `--`.
- `crates/app/src/commands.rs:415-461` — Tauri command layer meneruskan `name`/`old_name`/`new_name` mentah dari frontend ke fungsi core di atas, tanpa validasi tambahan.

Repro nyata (repo dummy `/mnt/storage/uqi-cache/tmp/tmp.it2hDCpW9T`, temp, tidak menyentuh repo lain):
```
$ git checkout -b -x HEAD
fatal: '-x' is not a valid branch name     # git sendiri yang menolak, bukan Petak
$ NAME="-f"; git branch -m br2 "$NAME"
exit=0                                      # BERHASIL — branch di-rename jadi "-f", ambigu dgn flag force
```
Kasus paling nyata yang lolos: `branch_rename(old="br2", new="-f")` sukses membuat branch bernama literal `-f`. Ini bukan RCE (git CLI sendiri masih menolak sebagian besar opsi berbahaya seperti `-x` karena bukan flag valid), tapi:
1. Melanggar klaim eksplisit di report — dokumentasi tidak sesuai implementasi.
2. Branch bernama `-f`, `-d`, `--force`, dll bisa menyebabkan operasi git berikutnya (delete/rename lain yang menerima nama itu sbg argumen) salah interpretasi sebagai flag, berpotensi memicu operasi destruktif yang tidak diinginkan (mis. jika UI mengonstruksi command lain dengan nama branch ini tanpa `--`).

Rekomendasi: tambah validasi nama branch (tolak jika `starts_with('-')`) di layer core sebelum spawn, ATAU sisipkan `--` sebelum argumen posisi terakhir pada `checkout -b`, `branch`, `branch -m`. Ini perbaikan kecil (~4 titik, beberapa baris tiap fungsi) — silakan kirim balik ke pembuat fitur untuk P3.11 kecil, TIDAK saya perbaiki sendiri sesuai protokol reviewer.

Command lain yang SUDAH benar menahan injection: `push` (`remote`, `branch` diletakkan setelah semua flag, dan `force_with_lease="-x"`-style tidak applicable karena itu bool bukan string bebas); path-based commands semua pakai `--`.

## 3. QA destruktif (repo dummy temp, aman)

Semua di `/mnt/storage/uqi-cache/tmp/tmp.it2hDCpW9T` (temp dir, dihapus otomatis oleh sistem, tidak pernah menyentuh `/mnt/storage/uqi-projects` lain atau repo petak).

- **squash/reword/fixup/drop/reorder/reset --hard + backup restore**: di-cover test asli `crates/core/tests/git_rebase.rs` (8 skenario, semua PASS saat re-run `cargo test -p petak-core`). Saya re-run test itu secara spesifik dan diff `no-data-loss.md` menunjukkan SHA berubah tiap run (bukti test benar-benar re-execute git nyata, bukan snapshot statis) — lalu saya `git checkout --` file itu supaya branch tetap bersih.
- **rebase conflict → abort**: dicover `test_rebase_conflict_stop_and_abort` (git_rebase.rs:384), PASS.
- **worktree kotor ditolak**: dicover `test_rebase_dirty_worktree_rejected` (git_rebase.rs:438), PASS. Pesan generik "cannot rebase: working tree has uncommitted changes" (ops.rs juga menolak cherry-pick/revert dgn pesan serupa) — user-friendly, sesuai.
- **stage hunk file tanpa newline akhir**: dicover `test_parse_diff_no_newline_at_eof` (diff.rs:515) — parser `DiffLineKind::NoNewline` PASS.
- **nama file spasi/unicode**: dicover `git_ops.rs` test unstage/stage `"unborn 🚀.txt"` dan `status.rs:236` test `"file with space.txt"` — PASS.
- **repo tanpa commit (unborn HEAD)**: dicover `unstage_files` fallback test (git_ops.rs:107) dan `mod.rs` `branch()` parsing.
- **detached HEAD**: dicover `test_branch_detached_head` (git/mod.rs:125) dan `status.rs` parse `(detached)`.
- **push divergen tanpa & dengan force-with-lease (lease basi ditolak)**: dicover `git_remote.rs:36 test_remote_fetch_pull_push_and_force_with_lease_flow` — PASS, termasuk kasus lease basi ditolak dua kali (baris 142, 179).
- **Branch name argument injection**: saya tambahkan probe manual (lihat §2 bug) — TIDAK ada test coverage untuk kasus ini di test suite, konsisten dengan bug yang ditemukan (tidak divalidasi = tidak dites).

Semua skenario checklist P3.10 sudah tercover oleh test suite asli kecuali argument-injection branch name, yang saya buktikan manual dan memang bug.

## 4. Screenshot preview vs app

Cek visual `docs/phase3/screens/preview-p37-git.png` — label file jelas `preview-*` dan `design-review.md` baris 9 eksplisit menyatakan: "Screenshot yang dievaluasi pada review ini merupakan PREVIEW BROWSER ... Verifikasi visual pada aplikasi macOS native asli dijadwalkan terpisah pada task P3.M." Tidak ada klaim menyesatkan bahwa ini app asli. ✅

## 5. no-data-loss.md

Angka SHA di file berubah tiap kali `cargo test --test git_rebase` dijalankan ulang (saya buktikan dgn re-run, lihat §3) — konsisten dengan test yang genuinely membuat commit baru tiap run, bukan data statis/hardcode. Struktur tabel & kesimpulan (8 skenario, semua "tree sama? ya" & "backup restore = HEAD lama? ya") cocok dengan hasil re-run saya. ✅

## Ringkasan temuan untuk manager

| # | Severity | File:baris | Temuan |
|---|---|---|---|
| 1 | Medium | `crates/core/src/git/ops.rs:320-354`, `crates/app/src/commands.rs:415-461` | Nama branch (create/checkout/delete/rename) tidak divalidasi/tidak pakai `--` separator → argument injection parsial (repro: rename branch jadi `-f` berhasil). Klaim report.md §7.3 tidak akurat, perlu diperbaiki kode ATAU dokumentasi. |

Tidak ada bug lain yang menghalangi lanjut ke P3.M. Rekomendasi: manager buat card kecil untuk fix validasi nama branch sebelum P3.M, atau minimal update report.md agar tidak mengklaim proteksi yang belum ada.
