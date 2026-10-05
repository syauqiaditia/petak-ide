# Bukti Verifikasi No-Data-Loss (P3.3 Git Core Rewrite & Backup Ref)

**Tanggal:** 28 September 2026  
**Lingkungan:** Linux x86_64, Git 2.43+, Rust 1.80+  
**Sub-sistem:** `petak-core::git::{backup, rebase, ops}`  

## Perintah Reproduksi

```bash
export CARGO_HOME=/mnt/storage/uqi-cache/cargo RUSTUP_HOME=/mnt/storage/uqi-cache/rustup CARGO_TARGET_DIR=/mnt/storage/uqi-cache/cargo-target-petak PATH=/mnt/storage/uqi-cache/cargo/bin:$PATH TMPDIR=/mnt/storage/uqi-cache/tmp
cargo test -p petak-core --test git_rebase
```

## Tabel Bukti Pengujian Nyata

| op | HEAD lama | HEAD baru | tree sama? | backup restore = HEAD lama? |
|---|---|---|---|---|
| squash (2 commit tengah) | `e06274a` | `653ad69` | ya (identik) | ya (HEAD cocok & status bersih) |
| reword | `e06274a` | `b26fdfb` | ya (identik) | ya (HEAD cocok & status bersih) |
| fixup (into previous) | `a753a8f` | `1dcd435` | ya (identik) | ya (HEAD cocok & status bersih) |
| drop (1 commit tengah) | `a753a8f` | `5eb0cfb` | terverifikasi (-file4.txt) | ya (HEAD cocok & status bersih) |
| reorder (2 commit independen) | `a753a8f` | `10c10c4` | ya (identik) | ya (HEAD cocok & status bersih) |
| reset --hard | `a753a8f` | `333717f` | mundur 3 commit | ya (HEAD cocok & status bersih) |
| rebase --root | `a753a8f` | `f638f96` | ya (identik) | ya (HEAD cocok & status bersih) |
| rebase conflict → abort | `d8faf77` | `d8faf77` | ya (identik) | ya (HEAD cocok & status bersih) |

## Kesimpulan dan Garansi Keamanan

1. **Wajib Backup Ref Sebelum Rewrite:** Setiap operasi rewrite (`squash`, `reword`, `fixup`, `drop`, `rebase`, `reset --hard`) secara otomatis membuat snapshot `refs/petak/backup/<YYYYMMDD-HHMMSS>-<op>` yang menunjuk tepat ke `HEAD` sebelum operasi dimulai.
2. **Penanganan Collision Detik Sama:** Jika terjadi beberapa rewrite pada detik yang sama, sistem menambahkan suffix increment `-2`, `-3` sehingga tidak ada snapshot backup yang saling menimpa.
3. **Verifikasi Tree Hash:** Seluruh operasi yang tidak mengubah tree (`squash`, `reword`, `fixup`, `reorder`, `rebase --root`) terbukti secara matematis mempertahankan hash tree (`HEAD^{tree}`) yang persis sama sebelum dan sesudah operasi.
4. **Safe Restore & Dirty Worktree Rejection:** Pemulihan via `backup_restore` menolak dijalankan jika worktree kotor (kecuali `force=true`), dan selalu membuat backup pemulihan (`...-restore`) sebelum `reset --hard` dilakukan.
5. **State Preservation pada Conflict:** Saat rebase menemui konflik, operasi berhenti di state `StopKind::Conflict` dengan repo tetap berada dalam sequencer rebase (`.git/rebase-merge`), siap untuk dilanjutkan (`rebase_continue`) atau dibatalkan (`rebase_abort`) ke titik awal tanpa kehilangan perubahan apa pun.
