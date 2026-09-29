# P4.9 — Review + QA independen Fase 4 (Run & Device)

Reviewer: reviewer bot. Diff direview: `feat/phase3-git..feat/phase4-run`. Semua re-run dilakukan sendiri di server (emulator `jatim_dev`, headless, KVM), bukan re-pakai angka dari report.md penulis.

## Verdict: LOLOS DENGAN CATATAN (1 bug — non-blocker tapi harus difix)

Fitur run/device/logcat fase 4 bekerja nyata di emulator sungguhan: flutter run --machine, hot reload/restart, gradle native install+launch, logcat by-pid, device watch kill-mid-run — semua diverifikasi ulang independen dan lolos. Ada 1 bug repo-hygiene (fixture test kebentur oleh e2e test) yang harus difix sebelum merge supaya `cargo test -p petak-core --lib` tidak kena regresi diam-diam abis orang jalanin e2e.

## 1. Review kode — kontrak `crates/core/src/run/`

- **Device watch non-polling**: `device.rs:366-404 watch_devices()` pakai `adb track-devices` streaming (bukan interval poll). Diverifikasi lewat log real: event Offline → Online → (setelah `adb emu kill`) hilang, tanpa polling loop kelihatan di kode. SESUAI.
- **Gradle status on-demand**: `android.rs:279-285 gradle_daemon_running()` cuma dipanggil manual lewat `./gradlew --status`, tidak ada background timer. SESUAI.
- **Logcat batching ≤50ms/500 baris**: `logs.rs:394-444` — worker thread flush kalau `batch.len() >= 500` ATAU `last_flush.elapsed() >= 50ms`. Benchmark sendiri: 10k baris sintetis di-parse < 20ms (`test_benchmark_10k_synthetic_log_lines`, angka aktual 19.17ms saat re-run). SESUAI spec.
- **Tidak ada device/status palsu di UI**: grep `ui/features/run/*.svelte` — semua state datang dari event Tauri (`run.state`, `device.list`), tidak ada hardcoded array device atau status "running" default. (Catatan: `dist/assets/index-*.js` yang di-build vite MEMANG berisi angka contoh device/logcat, tapi itu **mock harness khusus preview browser** dipicu query-string `?tab=logcat` dsb — bukan kode yang jalan di app asli, sudah ditandai dokumentasi sebagai "preview, bukan app". Bukan status palsu di produk.)
- **Tidak ada argument injection**: semua path yang menerima input eksternal (run.json) divalidasi SEBELUM dipakai sebagai argumen proses terpisah (bukan string shell):
  - Device ID: `device.rs:54-59 is_valid_device_id` — whitelist char, dipakai di `flutter.rs:306`, `android.rs:46,156`, `logs.rs:370`.
  - Flavor: `config.rs:71-76 is_valid_flavor` — alnum+underscore saja, ditolak `dev;rm -rf /` (test `config.rs:388`).
  - Target path: `config.rs:79-106 validate_target` — tolak absolute path & `..` traversal.
  - AVD name: `device.rs:62-67 is_valid_avd_name` — dipakai di `build_emulator_args` (`device.rs:286-304`), ditolak `bad;injection` (test `device.rs:558`).
  - App ID (Gradle): `android.rs:14-18 is_valid_app_id` regex `^[A-Za-z0-9_.]+$`, ditolak `id; rm -rf /`.
  - Gradle module/variant: `android.rs:21-32`, format `:app`/alnum ketat.
  - Semua arg dilewatkan sebagai `Vec<String>`/`&[&str]` ke `Spawn::spawn`/`Exec::run` — bukan format string shell. Pelajaran fase 3 (bug injeksi nama branch) sudah diterapkan konsisten di fase 4. SESUAI, tidak ada regresi.
- **Proses anak di-kill saat stop/app exit**: `flutter.rs:709-714 impl Drop for FlutterRun` panggil `stop()` kalau masih running; `stop()` (`flutter.rs:652-690`) kirim `app.stop` daemon command, timeout 5s lalu `proc.kill()` paksa. `logs.rs:457-460 impl Drop for Logcat` juga kill proc-nya. Diverifikasi nyata: e2e test kill emulator mid-run (`device_integration.rs`) — core dapat event `Stopped`/device hilang, tidak hang (selesai 29s, bukan timeout).
- **open_url whitelist http(s) saja**: `crates/app/src/commands.rs:1864-1867` — tolak apa pun selain prefix `http://`/`https://` sebelum diteruskan ke opener sistem. SESUAI.

## 2. Re-run test independen (server, env sesuai task)

| Suite | Hasil |
|---|---|
| `cargo test -p petak-core` (semua, termasuk lsp_real_dart/kotlin/swift) | **212 test lolos**, 0 gagal (git_ops 3 lolos, lsp_integration 9, lsp_real_dart 3, lsp_real_kotlin 1, lsp_real_swift 1, lib 130 setelah fixture direstore — lihat temuan #1) |
| `npm run build` | sukses, 4.01s, tanpa error (cuma warning bundle size & eval tree-sitter, sudah ada sebelumnya) |
| `node scripts/test_p45_run_logic.mjs` | semua 7 assertion lolos |
| `node scripts/test_p46_logcat.mjs` | semua lolos, benchmark throughput 2000 baris/detik: avg 1.045ms/batch, p95 1.619ms, max 2.985ms — jauh di bawah budget |
| `cargo test --test device_integration -- --ignored` (real emulator) | **PASS**, 29.26s. Emulator online 28.63s, `adb emu kill` → event Offline diterima, tidak hang |
| `cargo test --test flutter_e2e -- --ignored` (real emulator) | **PASS**, 310.75s. spawn_duration 461µs (budget <200ms ✓), hot reload 1776ms, hot restart 1486ms, appId+vmServiceUri real, 2 screenshot diverifikasi |
| `cargo test --test android_e2e -- --ignored` (real emulator) | **PASS**, 321.10s. Native gradle install+launch+pidof+logcat PETAK_NATIVE_HELLO captured; Flutter sample pidof+logcat PETAK_HELLO captured; screenshot native diverifikasi |

Semua e2e dijalanin `--test-threads=1`, emulator `jatim_dev` dipakai TANPA di-wipe, mati bersih tiap tes selesai (cleanup guard `adb emu kill` + drop). Verifikasi akhir: `adb devices` kosong, tidak ada proses emulator/qemu nyisa, `./gradlew --stop` di kedua sample project = "No Gradle daemons are running", RAM & disk kembali normal (free -g: 8GB available, df /: 3.8GB avail — sama seperti sebelum test).

## 3. Screenshot — vision check

- `docs/phase4/screens/e2e-01-started.png` (existing di repo, hasil run genuine sebelumnya): judul **"Petak Sample"** — cocok initial state.
- `docs/phase4/screens/e2e-02-hot-reload.png`: judul **"Petak Reloaded"** — TERBUKTI teks berubah beneran lewat hot reload, bukan screenshot dipalsuin. (Dialog "System UI isn't responding" yang muncul di kedua screenshot itu gejala tekanan RAM emulator headless di server, bukan bug app — sudah terjadi di run sebelumnya juga, dicatat sebagai known env noise.)
- `docs/phase4/screens/e2e-03-native.png`: judul **"Petak Native Sample"** — sesuai.
- Preview screenshot `docs/phase4/screens/preview-p4*.png` & `design-p4-*.png`: sudah direview & ditandai "preview, bukan app" di `design-review.md` (P4.8, verdict LOLOS DENGAN CATATAN 0 blocker) — tidak diulang di sini karena sudah scope reviewer lain.

Catatan: screenshot fresh hasil re-run reviewer (byte-identik secara konten/judul dengan yang di atas) sengaja di-`git checkout --` lagi setelah diverifikasi via vision supaya tidak menimbulkan diff kosmetik tanpa nilai tambah (isinya sama, cuma metadata PNG beda). Tidak ada temuan baru dari re-capture ini.

## 4. Skenario nakal

| Skenario | Hasil |
|---|---|
| Emulator di-kill paksa saat run (`adb emu kill` di tengah `flutter run --machine` / saat `watch_devices` aktif) | **PASS** — `device_integration.rs` real test: event `Stopped`/device hilang diterima, tidak hang, selesai dalam detik (bukan timeout blocking) |
| run.json rusak (invalid JSON) | **PASS** — unit test `config.rs:319-338 test_load_invalid_json_returns_clear_error`: error jelas `RunConfigError::InvalidJson` berisi path & pesan serde, bukan panic/silent fallback |
| Device ID aneh (`device; rm -rf /`) | **PASS** — ditolak `FlutterRunError::InvalidDeviceId` sebelum spawn proses (`flutter.rs:836-843` test + `device.rs:416` validasi unit) |
| Flavor aneh (`dev;rm`) | **PASS** — ditolak `FlutterRunError::InvalidFlavor` (`flutter.rs:845-857`) |
| Target path traversal (`../secret.dart`) | **PASS** — ditolak `FlutterRunError::InvalidTarget` (`flutter.rs:859-871`, `config.rs:377-379`) |
| AVD name aneh (`bad;injection`, `--foo`) | **PASS** — `build_emulator_args` menolak lewat `is_valid_avd_name` (`device.rs:558-559`); karakter `-` di awal string juga otomatis gagal validasi whitelist karena bukan alnum/`.`/`_`/`:`/`-` di posisi manapun yang bikin makna beda — walau perlu dicatat regex `is_valid_avd_name` MENGIZINKAN `-` di posisi mana pun termasuk awal (`--foo` akan lolos char-whitelist karena `-` diizinkan). Tidak dites eksplisit di unit test untuk kasus leading-dash yang bisa disalahartikan sbg flag oleh `emulator` binary. Lihat temuan #2 (minor, tidak blocker karena `-avd` selalu didahulukan sbg arg terpisah oleh `build_emulator_args`, bukan concatenated string, jadi `--foo` tetap cuma jadi value argumen `-avd`, bukan flag baru — aman secara subprocess API, hanya kosmetik).
| Logcat banjir sintetis | **PASS** — re-run benchmark `test_benchmark_10k_synthetic_log_lines`: 10.000 baris di bawah 20ms, batching worker tetap flush ≤50ms/500 baris (`test_p46_logcat.mjs` throughput test: p95 1.619ms/batch untuk 2000 line/detik) |
| appId/app_id Gradle aneh | **PASS** — `is_valid_app_id` regex ketat, ditolak `id; rm -rf /` (unit test `android.rs:431`) |

## Temuan

1. **BUG (harus fix sebelum merge) — e2e test menimpa fixture checked-in yang dipakai unit test lain**
   `crates/core/tests/flutter_e2e.rs:99-103` set env `PETAK_RECORD_DAEMON_FILE` ke path **`crates/core/tests/fixtures/flutter_machine.txt`** — file fixture yang SAMA dipakai `crates/core/src/run/flutter.rs:1044 test_parse_real_daemon_fixture` untuk assert appId spesifik (`"dea87405-e74b-4fc4-b809-f37b75d2ff49"`). Begitu `flutter_e2e` (ignored test, tapi jalan di CI/manual run manapun yang include `--ignored`) dieksekusi, dia menimpa fixture itu dengan rekaman daemon run barusan (appId beda tiap run), bikin `cargo test -p petak-core --lib` GAGAL untuk siapa pun yang run sesudahnya tanpa `git checkout` manual. Reproduksi nyata saat review ini: jalanin `flutter_e2e` → lib test `test_parse_real_daemon_fixture` FAILED assertion appId. Fix: rekam ke path terpisah di luar `tests/fixtures/` (misal `target/` atau `/tmp`), jangan overwrite file yang di-`include_str!` oleh test lain. File: `crates/core/tests/flutter_e2e.rs:99`.

2. **Minor/catatan — `is_valid_avd_name` mengizinkan leading dash**
   `crates/core/src/run/device.rs:62-67` regex whitelist AVD name mengizinkan karakter `-` di posisi manapun termasuk awal string, jadi nama seperti `--foo` lolos validasi. Tidak eksploitable saat ini karena `build_emulator_args` (`device.rs:286-304`) selalu mengirim `["-avd", avd, ...]` sebagai array argumen terpisah ke `Spawn::spawn` (bukan string shell), jadi `--foo` cuma jadi VALUE dari `-avd`, bukan flag baru yang di-parse ulang oleh binary emulator. Tidak blocker, tapi kalau mau lebih ketat, tambah pengecualian "tidak boleh diawali `-`" biar konsisten sama semantik "nama", bukan menyandarkan keamanan sepenuhnya pada perilaku argv-passing subprocess.

## Kesimpulan

Fase 4 (Run & Device) LOLOS DENGAN CATATAN: fitur nyata jalan di emulator sungguhan (flutter run, hot reload/restart, gradle native install, logcat by-pid, device watch), semua kontrak keamanan (no injection, no fake status) dipenuhi dan diverifikasi ulang independen, budget performa terpenuhi (spawn <200ms, logcat batching, throughput 2000 line/detik). 1 bug repo-hygiene (fixture collision) harus difix sebelum merge — dibuatkan card fix ke `senior`. iOS tetap code-only nunggu Mac sesuai rencana (P4.M), tidak dievaluasi di sini.
