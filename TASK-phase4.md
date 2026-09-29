# Petak — Fase 4: Run & device

Fase 3 (git) udah selesai di server, tinggal P3.M di Mac (blocked, Mac offline — biarin). UQi minta lanjut fase 4 sekarang sementara Mac-nya belum bisa dibuka. Setelah fase ini Petak harus bisa dipakai kerja harian Flutter: coding → run ke device → lihat log → hot reload.

Baca dulu:
- Vault `/home/uqi/vault/Projects/Petak/`: `plan.md` §4 Run & device (+ Toolchain Mac), `architecture.md` (folder `crates/core/src/run/`: android.rs, flutter.rs, ios.rs, device.rs, logs.rs; semua proses lewat trait `Exec`; event streaming lewat channel core → event Tauri), `design.md` + `design/Main.html` (title bar run config: target + device + Sync/Run/Debug/Stop; panel bawah Run/Logcat/Build; rail Devices; warna level Logcat).
- Repo `/mnt/storage/uqi-projects/petak`, `NOTE-server-mode.md`, report fase 1–3. Tombol Run/Debug sekarang sengaja disabled + status palsu udah dihapus (fase 1) — fase ini yang ngidupin beneran.

## Scope fase 4 (Flutter + Android dulu — itu kerjaan harian UQi)
1. **Deteksi toolchain & device**: Flutter (fvm `.fvmrc` → PATH), Android SDK (`ANDROID_HOME`), JDK, `adb devices -l`, `emulator -list-avds`, `flutter devices --machine`. Rail **Devices**: daftar device fisik/emulator/simulator + tombol start emulator. Watch device connect/disconnect (`adb track-devices`, bukan polling).
2. **Run config** per project di `.petak/run.json` (auto-detect: Flutter app / Android Gradle app; flavor + target file `-t lib/main_dev.dart` + `--dart-define`), dropdown di title bar sesuai `Main.html`. Device picker di title bar.
3. **Flutter run**: `flutter run -d <id> --machine` (protokol JSON daemon) → tombol Run, Stop, **Hot reload** (Cmd-S opsional/setting, dan tombol), **Hot restart**, status app di status bar. Output ke tab **Run**. Error build → tab **Build** + link klik ke file:baris.
4. **Android native (Gradle)**: `./gradlew :app:installDebug` + `adb shell am start`, tombol **Sync** (gradle sync ringan / `./gradlew tasks` atau reload LSP Kotlin), status daemon Gradle + tombol `./gradlew --stop` (plan: aturan lazy RAM).
5. **Logcat**: `adb logcat -v threadtime` filter by `--pid` app yang lagi jalan (package:mine), filter level/tag/teks, warna level sesuai design (D/I/W/E), pause/clear, stack trace Kotlin/Java/Dart bisa diklik → buka file:baris. Virtual list — harus tahan ribuan baris/detik tanpa bikin ketik lag. Tombol "Fix with agent" = placeholder disabled (fase 5).
6. **iOS**: tulis kodenya (`xcrun simctl list/boot`, `xcrun devicectl`, `flutter run -d <sim>`, `log stream`) tapi verifikasi cuma di Mac (P4.M).
7. **Debug**: minimal attach Dart DevTools URL (buka di browser) — breakpoint debugger penuh BUKAN scope (catat buat nanti).

## Verifikasi di SERVER (Mac offline — ini bukti utama)
Server punya toolchain Android + Flutter + KVM:
```
export ANDROID_HOME=/mnt/storage/caches/android-sdk-uqi
$ANDROID_HOME/emulator/emulator -list-avds   # -> jatim_dev
flutter --version                             # 3.35.7
```
- Pakai skill `android-emulator-headless-testing` (emulator headless `-no-window -no-audio -gpu swiftshader_indirect`). AVD `jatim_dev` punya UQi dipakai buat JConnect: BOLEH dipakai, JANGAN di-wipe/hapus/ubah config; matiin lagi emulatornya abis tes. Kalau perlu AVD sendiri, bikin `petak_test` di HDD.
- Bikin project Flutter sample kecil sendiri di `/mnt/storage/uqi-cache/petak-samples/` (`flutter create`), JANGAN pakai repo JConnect.
- Test core (Rust) end-to-end pakai emulator asli: deteksi device, `flutter run --machine` → app nyala di emulator (cek `adb shell dumpsys activity` / screenshot `adb exec-out screencap`), hot reload ganti teks → screenshot emulator nunjukin teks baru, logcat by pid nangkep `print()` dari app, stop. Android native: sample Gradle kecil install + start.
- RAM server 11 GB: emulator + Gradle berat — jalanin satu-satu, matiin abis dipakai. Cek `df -h /mnt/storage`.
- UI: test logic murni (parser JSON daemon, parser logcat threadtime, link stack trace, filter). Preview browser boleh buat cek tampilan, tandai "preview, bukan app".
- `crates/app` ga bisa dibuild di server (webkit2gtk) — jangan buang waktu.

## Budget
Ketik ≤ 17 ms walau logcat lagi banjir, cold start ≤ 646 ms (587 +10%), RAM idle < 150 MB (tanpa run), CPU idle ~0% (tanpa polling — device watch pakai track-devices). Baru: klik Run → perintah `flutter run` mulai < 200 ms; hot reload dari tombol sampai event `app.progress` selesai dicatat; logcat 2000 baris/detik tanpa drop frame UI (ukur di Mac P4.M).

## P4.M (Mac, di akhir — boleh blocked nunggu Mac)
Script siap jalan kayak fase 2/3: build .app, bench, screenshot app asli (run config + device picker, tab Run, Logcat berwarna, Devices), iOS simulator run, HP fisik kalau UQi colok, install `/Applications` (jangan timpa kalau Petak lagi jalan), langkah tes manual buat UQi (bahasa simpel). P3.M juga masih nunggu Mac — kalau Mac nyala, jalanin P3.M dulu baru P4.M.

## Aturan
- Ponytail/minimal, ikut architecture.md. Jangan fabrikasi angka/screenshot, jangan hardcode device/status palsu di UI (pelajaran fase 1).
- Jangan install app ke HP/emulator UQi selain sample sendiri; jangan nyentuh repo JConnect.
- Senior & designer pakai Antigravity Gemini 3.8 Flash, fallback OFF — pecah task kecil, commit sering.
- Reviewer: re-run test sendiri di emulator server, cek screenshot emulator + preview pakai vision.
- Deliverable: kode + commit, `docs/phase4/report.md` (fitur, tabel budget, bukti emulator), screenshot `docs/phase4/screens/`, append ringkasan ke vault `journal.md`.
