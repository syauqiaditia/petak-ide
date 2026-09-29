# Laporan Verifikasi Fase 3 Petak (Git ala Android Studio)

Tanggal: 28 September 2026  
Lingkungan Pengujian Server: Ubuntu Linux x86_64, Git 2.43.0, Rust 1.80+ (`/mnt/storage/uqi-cache/cargo`), Node v20.18.0  
Baseline Lingkungan Mac: Apple Silicon M2, RAM 8 GB, macOS Sequoia (Darwin 25.5.0)  
Branch / Commit: `feat/phase3-git` (`docs (p3.8)`)  
Verdict Server: **GO KE REVIEW + QA DESTRUKTIF (P3.10) & VERIFIKASI MAC (P3.M)**  
Catatan: Verifikasi akhir binary macOS `.app`, screenshot window Mac riil, dan instalasi `/Applications/Petak.app` dialokasikan ke task penutup **P3.M** sesuai protokol pemisahan server/Mac.

---

## 1. Ringkasan Eksekutif

Fase 3 mengimplementasikan kapabilitas kontrol versi Git terintegrasi penuh pada Petak tanpa ketergantungan pada aplikasi eksternal (Fork, Sublime Merge):

1. **Git Engine di Rust Core (`crates/core/src/git/`):**
   - **Arsitektur Tanpa libgit2:** Seluruh interaksi Git menggunakan pemanggilan CLI Git melalui trait `Exec` (`SystemExec`), menjamin kompatibilitas 100% dengan konfigurasi Git lokal pengguna, hooks, ignore rules, serta atribut Git.
   - **Status Porcelain v2 Parser:** Mengurai status berkas secara lengkap (staged, unstaged, untracked, copied, renamed, deleted, type-changed, conflicted, unborn HEAD, detached HEAD, serta counter ahead/behind tracking branch).
   - **Diff & Hunk Engine:** Parser unified diff per file dan per hunk, mendukung binary diff, newline-at-EOF, rename detection, dan ekstraksi patch hunk mandiri untuk stage/unstage per hunk (`git apply --cached`).
   - **Lane Graph Layout Algorithm:** Mengurai riwayat commit secara topologically-sorted (`--topo-order`), menghitung penempatan lajur cabang (lane), persimpangan cabang (*branch out*), penggabungan (*merge in*), octopus merge, multi-root, dan transisi kontinu antar halaman log berpaginasi.
   - **Garansi Keselamatan No-Data-Loss & Backup Ref:** Pembuatan snapshot otomatis `refs/petak/backup/<YYYYMMDD-HHMMSS>-<op>` sebelum setiap operasi rewrite (`squash`, `reword`, `fixup`, `drop`, `rebase`, `reset --hard`), lengkap dengan penanganan bentrok detik sama (`-2`, `-3`), penolakan worktree kotor, dan verifikasi identitas tree hash (`HEAD^{tree}`).
   - **Interactive Rebase Sequencer Engine:** Penyusunan todo rebase berbasis file sequencer editor (`GIT_SEQUENCE_EDITOR`), mendeteksi konflik (`StopKind::Conflict`), serta kontrol operasi `rebase_continue` dan `rebase_abort`.
   - **Conflict Engine & 3-Way Parser:** Parser marker konflik 1 blok maupun multi-blok, diff3 base marker (`|||||||`), resolusi murni blok (*Yours/Theirs/Both/BothTheirsFirst*), dan penulisan berkas terselesaikan.
   - **Remote Sync Engine:** Konfigurasi remote, `fetch` (prune option), `pull` (rebase atau merge), dan `push` aman dengan dukungan `--force-with-lease` serta penolakan lease basi.
   - **Asynchronous Execution:** Seluruh pemanggilan proses Git dibungkus dalam `spawn_blocking` pada thread-pool Tokio terpisah sehingga thread utama dan thread event loop UI tidak pernah terblokir.

2. **Antarmuka Git di Frontend Svelte (`ui/features/git/`):**
   - **Git Activity Rail & Status Badges:** Tab Git terdedikasi pada sidebar dengan indikator hitung perubahan berkas real-time.
   - **Panel Commit:** Daftar perubahan terkelompok (Staged Changes, Changes, Untracked), Stage/Unstage per file dan per hunk, editor subject commit dengan counter batas 50 karakter visual, badge tipe Conventional Commits, opsi amend commit terakhir, dan pintasan keyboard `Cmd+Enter`.
   - **DiffView Lanjutan:** Tampilan Side-by-Side (2 kolom tersinkronisasi) dan Unified, toggle abaikan whitespace, navigasi lompat hunk, word-level inline diff highlight yang mendukung karakter Unicode dan emoji, serta aksi stage hunk langsung dari header diff.
   - **Tab Log & Visual Graph:** Virtual scroll list 30px ultra-ringan yang hanya merender ~40 elemen DOM bahkan pada repositori 10.000+ commit, grafik SVG jalur cabang berbasis geometri presisi (`straight`, `branchOut`, `mergeIn`, `passThrough`), badge referensi warna-warni (HEAD, local branch, remote branch, tag), bilah filter reaktif (cabang, user, tanggal, path, teks pesan/hash dengan debounce 250ms), panel daftar branch kiri, dan panel detail commit dengan diff perubahan.
   - **Menu Aksi Commit Lengkap:** Klik kanan baris commit untuk aksi instan: Squash into previous, Edit Message (reword), Fixup, Drop, Cherry-pick, Revert, Reset (soft/mixed/hard dengan modal konfirmasi), New Branch, Copy Revision SHA.
   - **Dialog Interactive Rebase (960×620):** Dialog komprehensif untuk menyusun urutan commit via drag & drop, mengubah aksi baris (`pick`, `reword`, `squash`, `fixup`, `drop`, `edit`), ringkasan transformasi commit real-time, validasi rencana rebase (mencegah squash di baris pertama atau rencana kosong), dan checkbox backup otomatis.
   - **Panel Backups & Undo:** Riwayat backup snapshot ref Petak di sidebar kiri dengan aksi satu-klik **Restore** untuk membatalkan kesalahan rebase/reset dan mengembalikan posisi HEAD secara sempurna.
   - **ConflictView 3-Kolom & Banner Status Operasi:** Banner peringatan oranye saat rebase/merge berkonflik, editor 3 kolom (Yours | Result | Theirs), tombol aksi per-blok (*Accept Yours*, *Accept Theirs*, *Accept Both*), Result editor interaktif, serta tombol *Continue* dan *Abort*.
   - **Remote Toolbar & Push Dialog:** Tombol toolbar Fetch, Pull, dan Push; modal Push dengan pilihan remote, cabang tujuan, dan toggle aman *Force with lease*.
   - **Status Bar Integration:** Informasi cabang aktif real-time di status bar bawah lengkap dengan indikator panah hitung commit ahead/behind terhadap remote tracking.

3. **Verifikasi & Kualitas:**
   - **129 pengujian unit & integrasi Rust** berstatus **PASS (100%)** tanpa kegagalan (`docs/phase3/logs/cargo-test.txt`).
   - Pengujian logika murni UI (Diff & SBS pairing, Graph geometry, Rebase plan validation & calculation, Svelte 5 plain TS rune guard) berstatus **PASS (100%)** (`docs/phase3/logs/ui-tests.txt`).
   - `npm run build` sukses 0 error dalam waktu 3.72 detik (`docs/phase3/logs/build.txt`).
   - Seluruh batasan *performance budget* terlampaui dengan margin keunggulan signifikan.

---

## 2. Matriks Fitur per Scope (Scope 1 – 7)

Evaluasi implementasi fitur berdasarkan spesifikasi mandat Fase 3:

| Scope | Fitur / Komponen | Status | Detail Implementasi & Bukti | Bukti Pengujian |
|---|---|---|---|---|
| **1** | **Status & Commit** | **JALAN** | Status porcelain v2 (`git_status`), grouping staged/changes/untracked, stage/unstage per file & per hunk, subject counter 50 char, Conventional Commits hint, amend commit, warna git status pada file tree (M biru, A hijau, untracked hijau, D merah, conflict oranye). | `crates/core/tests/git_ops.rs`, `scripts/test_p35_diff.mjs`, `docs/phase3/screens/preview-p35-git.png` |
| **2** | **Diff Viewer** | **JALAN** | Tampilan Side-by-Side & Unified, ignore whitespace option, word-level highlight (token split & LCS diff) mendukung emoji/multibyte, navigasi hunk, stage/unstage hunk button di header diff. | `crates/core/src/git/diff.rs`, `scripts/test_p35_diff.mjs`, `docs/phase3/screens/design-diff.png` |
| **3** | **Log Graph** | **JALAN** | `git log --topo-order` layout lane Rust (`graph.rs`), SVG rendering per baris (`graphGeom.ts`), virtual list 30px, badge ref (HEAD, local, remote, tag), filter debounce 250ms (branch, author, date, path, text), panel branch & detail commit diff. | `crates/core/tests/git_log.rs`, `scripts/test_p36_graph.mjs`, `scripts/bench_p36_preview.mjs`, `docs/phase3/screens/design-git.png` |
| **4** | **Aksi Commit & Rebase** | **JALAN** | Context menu commit, multi-select, Squash, Reword, Fixup, Drop, Interactively Rebase from Here (dialog Rebase 960×620: pick/squash/reword/fixup/drop/edit, drag urutan, editor pesan squash), Cherry-pick, Revert, Reset (soft/mixed/hard dialog konfirmasi), New Branch, Copy Revision. | `crates/core/tests/git_rebase.rs`, `scripts/test_p37_rebase_plan.mjs`, `docs/phase3/screens/design-rebase.png` |
| **5** | **Backup Ref & No-Data-Loss**| **JALAN** | Snapshot otomatis `refs/petak/backup/<YYYYMMDD-HHMMSS>-<op>`, collision resolution detik sama (`-2`, `-3`), checkbox backup default nyala di dialog rebase, panel Backups di sidebar Git dengan tombol "Restore" (Undo), visual unpushed marker. | `crates/core/tests/git_rebase.rs`, `docs/phase3/no-data-loss.md`, `preview-p37-git.png` |
| **6** | **Conflict 3-Kolom** | **JALAN** | Conflict marker parser (single/multi-blok, diff3 base, CRLF, trailing newline), ConflictView 3-kolom (Yours \| Result \| Theirs), aksi Accept Yours/Theirs/Both per blok, Result live editing, continue/abort banner pada rebase/merge/cherry-pick/revert. | `crates/core/tests/git_conflict.rs`, `preview-p37-conflict.png`, `docs/phase3/screens/design-conflict.png` |
| **7** | **Branch & Remote Sync** | **JALAN** | Checkout, create, delete, rename branch lokal; list remote, fetch (prune), pull (rebase/merge), push (+ force-with-lease dengan konfirmasi aman); status bar live branch + counter ahead/behind. | `crates/core/tests/git_remote.rs`, `preview-p37-git.png` |

---

## 3. Tabel Evaluasi Performance Budget Fase 3

Seluruh angka diukur secara riil dari hasil benchmarking server dan Apple Silicon Mac M2 (Darwin 25.5.0) dengan alat ukur berpresisi tinggi:

| Metrik Budget | Target / Batas | Hasil Server (Core / Preview) | App Mac M2 (P3.M) | Status | Log Mentah Bukti |
|---|---|---|---|---|---|
| **Ketik 10k baris (LSP aktif)** | $\le$ 17.00 ms (1 frame @ 60Hz) | **avg 1.85 ms, p50: 1.71 ms, p95: 2.58 ms** | **avg 0.91 ms, p50: 0.80 ms, p95: 1.20 ms** | **PASS (LOLOS)** | `docs/phase3/logs/mac-typing-10k.txt` |
| **Cold Start App** | $\le$ 646 ms (+10% dari baseline 587 ms) | *Server headless (tidak menjalankan window Tauri)* | **Median 571 ms** (runs: 519, 551, 571, 600, 618 ms) | **PASS (LOLOS)** | `docs/phase3/logs/mac-coldstart.txt` |
| **RAM App Idle** | < 150 MB | Baseline Fase 1: **134.8 MB** (App: 89.7 MB, WebContent: 45.2 MB) | **~93 MB** (App: 62 MB, WebContent: 31 MB) | **PASS (LOLOS)** | `docs/phase3/logs/mac-lsp-ram.txt`, `mac-inapp-p3.txt` |
| **CPU Idle** | ~0% (bebas polling timer) | **0 timer polling**, pembaruan status murni event-driven via FS watcher | **~0%** (event-driven FS watcher pada `.git/{HEAD,index,refs}`) | **PASS (LOLOS)** | `crates/core/tests/git_ops.rs` |
| **Git Status Refresh (Repo Sedang)** | < 200 ms (5.000 file, 250 perubahan) | **Min: 7.93 ms, Median: 8.66 ms, Avg: 8.65 ms, Max: 9.63 ms** | **Min: 20.42 ms, Median: 21.82 ms, Avg: 21.61 ms, Max: 22.75 ms** | **PASS (LOLOS)** | `docs/phase3/logs/mac-bench-git-status.txt` |
| **Buka Git Log (10k commit repo)** | < 500 ms (sampai baris pertama / page 1: 500 commit) | **Min: 47.32 ms, Median: 47.53 ms, Max: 47.80 ms** | **Min: 75.23 ms, Median: 75.45 ms, Max: 77.67 ms** (warmup: 88.78 ms) | **PASS (LOLOS)** | `docs/phase3/logs/mac-bench-git-log.txt` |
| **Virtual List DOM Nodes (10k commit)** | Dibatasi (< 60 baris DOM terpasang) | **30 – 41 elemen DOM aktif** (slice render: 0.0039 ms) | **30 – 41 elemen DOM aktif** | **PASS (LOLOS)** | `docs/phase3/logs/bench-virtual-list.txt` |

---

## 4. Garansi No-Data-Loss & Bukti Rekayasa

Pengujian destruktif otomatis dijalankan pada repositori Git nyata di folder temporary untuk membuktikan integritas riwayat:

1. **Verifikasi Hash Pohon Berkas (`HEAD^{tree}`):**
   Pada operasi yang secara semantik tidak mengubah isi berkas (`squash`, `reword`, `fixup`, `reorder`, `rebase --root`), hash pohon direktori terbukti 100% identik sebelum dan sesudah operasi.
2. **Snapshot Otomatis & Pemulihan Sempurna:**
   Setiap operasi rewrite menghasilkan referensi `refs/petak/backup/<YYYYMMDD-HHMMSS>-<op>`. Eksekusi `backup_restore` teruji mengembalikan `HEAD`, index, dan commit SHA ke kondisi sebelum operasi secara bit-for-bit tanpa ada commit yang tertinggal atau menjadi dangling.
3. **Pencegahan Kehilangan Data pada Worktree Kotor:**
   Jika pengguna memiliki perubahan belum ter-commit di working tree saat memulai rebase, operasi langsung ditolak dengan pesan kesalahan ramah pengguna, mencegah timpaan berkas.
4. **Laporan Pembuktian Lengkap:**
   Daftar commit hash dan tabel pembuktian formal terdokumentasi di [docs/phase3/no-data-loss.md](no-data-loss.md).

---

## 5. Kontrak API & Tipe Data Rust ↔ TypeScript

Seluruh komunikasi antara Tauri backend dan Svelte frontend terikat pada kontrak data ketat dengan serialisasi camelCase:
- **Total Command:** 48 command Tauri (`git_status`, `git_diff`, `git_stage_files`, `git_rebase_run`, `git_conflicts`, `git_push`, dll).
- **Model Data:** `RepoStatus`, `DiffFile`, `Hunk`, `LogPage`, `Commit`, `GraphRow`, `RebasePlan`, `BackupRef`, `ConflictFile`, `OpState`, `Remote`.
- **Dokumentasi Kontrak:** Terangkum lengkap pada [docs/phase3/contract.md](contract.md).

---

## 6. Daftar Placeholder Fase 5 (AI Agent ACP)

Sesuai dengan arsitektur bertahap Petak, fitur AI Agent yang membutuhkan agen interaktif dialokasikan pada Fase 5. Pada Fase 3, elemen UI placeholder telah disiapkan dalam status non-aktif (*disabled*) yang ramah pengguna:
1. **"Write message with agent"** pada panel Commit: Tombol disabled dengan aksen warna ungu khas agen (`#9d7cd8`), siap untuk integrasi generasi commit otomatis.
2. **"Suggested resolution (AI Agent)"** pada ConflictView: Kartu saran resolusi cerdas dalam status disabled, siap menampilkan proposal penggabungan dari LLM pada Fase 5.
3. **"Ask agent"** pada popup linting & CodeAction: Placeholder disabled bertema emas `#e8b45a`.

---

## 7. Keterbatasan Jujur & Rekomendasi

1. **Hasil Verifikasi Mac M2 (P3.M) & Bukti Screenshot Asli:**  
   Proses kompilasi binary `.app` release, eksekusi test suite core (129/129 cargo test PASS), dan benchmarking riil telah selesai di mesin Mac M2 (Apple Silicon, macOS Darwin 25.5.0). Seluruh target performa terbukti lolos (cold start 571 ms $\le$ 646 ms, ketik 0.91 ms $\le$ 17 ms, git status 21.82 ms < 200 ms, git log 75.45 ms < 500 ms).
   Tangkapan layar UI asli diambil oleh UQi secara manual langsung di macOS (`docs/phase3/screens/mac-commit-diff-uqi.png`, `mac-uqi-log-graph.png`, `mac-uqi-squash-dialog.png`, `mac-uqi-log-commit-detail.png`) karena macOS membatasi simulasi keyboard/mouse via koneksi remote SSH (Accessibility restriction). Skenario klik interaktif lanjutan diuji oleh UQi mengikuti panduan checklist di vault `Projects/Petak/tes-manual.md` bagian A. Instalasi ke `/Applications/Petak.app` dijadwalkan bersamaan dengan rilis gabungan fase 2–4.
2. **Keamanan Autentikasi Remote:**  
   Pengujian remote `git fetch/pull/push` pada Fase 3 diverifikasi menggunakan remote bare lokal (`file://`). Integrasi Keychain macOS untuk push ke repositori privat GitLab (`code.istar.id`) dialokasikan pada Fase 6 dengan izin eksplisit dari UQi demi menjaga keamanan kredensial.
3. **Penolakan Nama Cabang Diawali Dash (`-`):**  
   Untuk mencegah injeksi opsi CLI Git (`argument injection`), seluruh nama cabang diverifikasi di layer core (`validate_branch_name` menolak nama yang diawali `-` atau kosong sebelum git dipanggil), separator `--` eksplisit disematkan pada subperintah git yang mendukungnya (`branch`, `branch -d/-D`, `branch -m`), dan path file diverifikasi serta dilewatkan dengan separator `--` eksplisit.
4. **Repositori Tanpa Commit (Unborn HEAD):**  
   Status repositori baru tanpa commit (`git init`) ditangani secara elegan: tidak memicu crash, log menampilkan pesan informatif, dan Commit panel siap menerima initial commit pertama.

---

## 8. Panduan Pengujian & Skrip Siap Pakai

- **Skrip Pembuat Repo Demo:** `scripts/phase3-demo-repo.sh` (menciptakan repositori 18 commit, 2 cabang, 2 tag, 1 merge, cabang konflik, dan file staged/unstaged).
- **Skrip Pembuat Repo 10k:** `scripts/gen-git-10k.sh` (menciptakan repositori 10.100 commit via `git fast-import`).
- **Skrip Verifikasi Mac:** `scripts/phase3-mac-verify.sh` (build release, coldstart, git benchmark, in-app test, native capture, install `/Applications/Petak.app`).
- **Panduan Pengujian Manual UQi:** [docs/phase3/manual-test.md](manual-test.md) (12 langkah mudah tanpa istilah teknis infra yang rumit).
