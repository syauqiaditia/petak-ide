# H1: Fix hang pas ganti folder (pick_folder async)

## Akar masalah
`pick_folder` di `crates/app/src/commands.rs` adalah Tauri command **sync**
(`pub fn`). Tauri 2 menjalankan command sync di main thread. Di dalamnya
dipanggil `app.dialog().file().blocking_pick_folder()`, yang di macOS juga
butuh main thread buat nampilin NSOpenPanel. Command block nunggu dialog,
dialog nunggu main thread yang lagi diblok command → deadlock → beachball.

`watch_root` (yang dipanggil abis folder baru dipilih) juga berpotensi
nge-stack 2 watcher rekursif sekaligus kalau watcher lama ga di-drop dulu
sebelum bikin yang baru.

## Perubahan
- `pick_folder` → `pub async fn`. Command async jalan di tokio runtime,
  bukan main thread, jadi `blocking_pick_folder()` aman dipanggil (pola
  yang disarankan docs `tauri-plugin-dialog`).
- `watch_root` → `pub async fn`. Watcher lama di-drop dulu (`*lock = None`)
  sebelum watcher baru dibikin, watcher baru dibuat di dalam
  `tauri::async_runtime::spawn_blocking` (sama seperti pola `index_build`).
  Ga ada `MutexGuard` yang dipegang lewat `.await`.
- `grep -rn "blocking_" crates/` → cuma 1 hit tersisa (`pick_folder`, di
  dalam async command → aman).
- `ui/App.svelte` dan `ui/lib/api.ts` (pickFolder/watchRoot) tidak perlu
  diubah — invoke-nya sudah async dari sisi frontend.

Catatan: perubahan `commands.rs` (pick_folder + watch_root jadi async)
ternyata sudah kebawa di commit `2b844d6` (nyampur sama task p1.9 lain,
`git branch` feature) sebelum card ini dikerjain ulang. Yang di-commit di
card ini cuma test baru (lihat di bawah) — kodenya sendiri sudah live dan
sudah lolos build/test sebelumnya.

## Test
`test_watch_ignores_git_and_temp_files` (crates/core/src/watch.rs):
watcher dibuat di folder temp, nulis ke `.git/config` dan
`.foo.petak-tmp`, lalu nulis `main.rs` valid. Assert path `.git`/
`.petak-tmp` ga pernah nongol di event, dan event `main.rs` beneran
diterima. Ini nge-cek filter watcher, bukan test formalitas.

`cargo test -p petak-core` di Mac → **25 passed, 0 failed**.
`npm run build` di Mac → sukses, 8 chunk, no error.

## Verifikasi manual (di Mac, app asli)
Saya coba otomasi klik "Open" → pilih folder via `osascript` System
Events (sesuai tips di task), tapi kena `osascript is not allowed
assistive access` — proses SSH belum diizinin Accessibility di macOS
TCC, dan saya ga punya akses interaktif ke layar Mac buat grant izin
itu sendiri (blocker sama seperti attempt sebelumnya).

UQi yang tes manual langsung di Mac (`/Applications/Petak.app`, build
13:10, hasil rsync dari commit yang sama):
> "ganti folder lewat Open ga hang lagi, ga force close"

Ini konfirmasi kualitatif dari UQi bahwa acceptance criteria utama
(app tetap responsif, ga beachball, ga force-close saat ganti folder)
lolos. Saya **tidak** punya tabel waktu klik→tree-muncul per percobaan
karena UQi testing manual free-form, bukan diukur dengan stopwatch/log
— dan saya ga mau fabrikasi angka yang ga pernah diukur. Kalau UQi mau
angka presisi (3x bolak-balik + ~/Documents dengan timing), perlu tes
manual lagi dengan stopwatch, atau grant Accessibility permission ke
proses SSH di Mac System Settings biar saya bisa otomasi & ukur sendiri.

## Screenshot
- `docs/phase1/screens/h1-before.png` — Petak.app jalan normal, project
  `petak-sample` kebuka, tree + editor `main.dart` responsif, branch
  `master` kelihatan di title bar.

(Screenshot "sesudah ganti folder" dan "sesudah buka ~/Documents" belum
ada karena saya ga bisa trigger dialog Open tanpa Accessibility access —
sama seperti keterbatasan di atas. UQi yang punya screenshot dari
sesi manualnya kalau perlu dilampirkan.)

## Status
Fix sudah di commit `ca83700` ("fix (h1): pick_folder async, ganti folder
ga hang"). Code fix + unit test + build hijau, verifikasi manual UQi
lolos (kualitatif). Timing table & screenshot "sesudah" tidak tersedia
karena limitasi Accessibility (bukan gagal — hanya belum diukur presisi).
