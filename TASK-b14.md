# Petak Batch 14: Headless iOS Simulator Auto-Hide & Device Classification Fix

## Latar Belakang & Keluhan UQi (Testing Lapangan)
1. **iOS Simulator Tidak Headless & Muncul Jendela di Desktop**:
   - Di macOS, jendela `Simulator.app` ("iPhone 17 Pro - iOS 26.4") muncul melayang di layar luar.
   - Di dalam Petak (dock kanan), muncul kotak kuning "Device Disconnected".
   - Screenshot bukti: `docs/phase4/screens/b14_ios_sim_window_bug.png`.
2. **List Device Terbalik (Misklasifikasi Kritis)**:
   - "iPhone 17 Pro" terdaftar dengan badge `USB` & `Siap` (dianggap iPhone fisik!).
   - "UQi" (iPhone fisik asli milik UQi, ID `00008110-00012CCE0C09401E`) terdaftar dengan badge `Emulator` & `Siap` (dianggap emulator!).
   - Screenshot bukti: `docs/phase4/screens/b14_device_list_inversion_bug.png`.

## Root Cause Analysis
1. **Penyebab Jendela Simulator Muncul**:
   - `crates/core/src/mirror/ios/simulator.rs` mengeksekusi `open -g -j -a Simulator`. Di macOS Sonoma/Sequoia, perintah ini tetap memunculkan jendela GUI Simulator ke desktop pengguna.
   - Solusi: Sembunyikan jendela Simulator segera setelah launch menggunakan AppleScript native:
     `osascript -e 'tell application "System Events" to set visible of (first process whose name is "Simulator") to false'`
     ScreenCaptureKit tetap menangkap video stream 60 FPS secara normal meskipun `visible` diset `false`.
2. **Penyebab "Device Disconnected" di Petak**:
   - Helper capture Swift tidak ditemukan!
   - Di `simulator.rs`, `resolve_swift_helper_path_internal` mencari `parent.join("../Resources/petak_ios_capture.swift")`.
   - Namun Tauri 2 mem-bundle file tersebut ke:
     `/Applications/Petak.app/Contents/Resources/_up_/core/src/mirror/ios/petak_ios_capture.swift`.
   - Solusi:
     - Compile `petak_ios_capture.swift` menjadi binary native mandiri `petak_ios_capture` (183 KB) via `swiftc -O` pada script build (`scripts/build-simtouch.sh`), simpan di `target/release/petak_ios_capture`.
     - Update `crates/core/src/mirror/ios/simulator.rs` (`resolve_swift_helper_path_internal`) agar memeriksa secara berurutan:
       1. `parent.join("../Resources/petak_ios_capture")` (binary native, startup <10ms)
       2. `parent.join("../Resources/petak_ios_capture.swift")`
       3. `parent.join("../Resources/_up_/core/src/mirror/ios/petak_ios_capture.swift")`
       4. `parent.join("../Resources/resources/petak_ios_capture")`
       5. Path development `crates/core/src/mirror/ios/petak_ios_capture.swift`.
3. **Penyebab Misklasifikasi List Device di `pickerLogic.ts`**:
   - Helper `isSim` di `pickerLogic.ts` hanya mengecek `d.kind === 'emulator'`, lupa memeriksa `'simulator'`, `'ios-simulator'`, atau format UUID v4 36-karakter.
   - Karena "iPhone 17 Pro" namanya mengandung kata "iPhone", kode menganggapnya sebagai iPhone fisik (`category: 'iphone-usb'`).
   - Sebaliknya, device "UQi" (iPhone fisik asli) namanya tidak mengandung kata "iPhone", sehingga dilewati pada deteksi physical dan jatuh ke blok fallback iOS yang membubuhkan badge `Emulator`!
   - Solusi: Buat fungsi klasifikasi komprehensif `isIosSimulatorDevice(d: Device): boolean`:
     - Cek `kind`: `'simulator'`, `'ios-simulator'`, `'ios-sim'`, `'emulator'`.
     - Cek `group`: `'simulator'`.
     - Cek `sdk`: mengandung `'coresimulator'` atau `'simruntime'`.
     - Cek `id`: format UUID 36 karakter dengan 4 tanda hubung (bukan diawali `00008`).
     - Real physical iPhone: `platform === 'ios'` dan `!isIosSimulatorDevice(d)` -> strictly `category: 'iphone-usb'` (atau Wi-Fi).
     - iOS Simulator: `platform === 'ios'` dan `isIosSimulatorDevice(d)` -> strictly `category: 'ios-simulator'`, transport badge `Emulator`.

## Deliverables & Tasks
- **Task A (Core/Rust & Native)**:
  - Update `crates/core/src/mirror/ios/simulator.rs`: sembunyikan jendela `Simulator.app` via `System Events` visible false, perbaiki path resolver `resolve_swift_helper_path_internal` (dukung binary compiled & path Tauri `_up_`).
  - Update `scripts/build-simtouch.sh` untuk meng-compile `petak_ios_capture.swift` menjadi binary native `petak_ios_capture` di `target/release/petak_ios_capture`.
  - Tambah unit test Rust untuk verifikasi path resolver.
- **Task B (UI & Logic)**:
  - Perbaiki `ui/features/mirror/pickerLogic.ts` (`dedupeAndCategorizeDevices` dan `isIosSimulatorDevice`).
  - Sinkronkan `ui/features/mirror/mirrorErrorLogic.ts`.
  - Buat unit test vitest/node:test di `tests/batch14_picker_ios.test.mjs` yang memverifikasi kasus nyata UQi:
    - "iPhone 17 Pro" -> Simulator (badge: Emulator)
    - "UQi" (ID `00008110-00012CCE0C09401E`) -> Physical (badge: USB)
    - "SM A155F" -> Physical Android (badge: USB / Wi-Fi).

## Batasan & Safety
- Dilarang menyentuh repo kantor UQi atau PAT.
- RAM idle < 150 MB, bundle size < 20 MB.
- Seluruh unit test Rust (`cargo test -p petak-core --lib`) dan frontend (`npm test`) wajib PASS.
