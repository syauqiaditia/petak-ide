# Petak Batch 13: Headless iOS Simulator Mirror & Native Touch Injection

## Latar Belakang & Kebutuhan
- UQi meminta: *"bisa ga emulator ios itu jalan headless kaya android emulator dan bisa di gerakin lewat petak langsung? ... yang paling ringan dan rekomended"*.
- Saat ini mirror Android sudah berjalan mulus di Petak (scrcpy 60 FPS, low latency, full touch/scroll/key input, Wi-Fi pairing code & QR code).
- Untuk iOS Simulator:
  - Apple secara resmi tidak menyediakan perintah `simctl io tap` atau `simctl io swipe` di CLI publik.
  - Opsi Facebook `idb` ditolak karena berat (butuh Python runtime, gRPC daemon, makan RAM 200+ MB).
  - Opsi AppleScript / Accessibility ditolak karena membajak kursor mouse macOS dan butuh izin Accessibility.
- **Solusi Paling Ringan & Terbaik**:
  - **Video Streaming 60 FPS**: Native `ScreenCaptureKit` + VideoToolbox H.264 (sudah ada di `crates/core/src/mirror/ios/petak_ios_capture.swift`), GPU Metal, ultra-rendah latency (<15 ms).
  - **Jendela Simulator.app di Background/Hidden**: Simulator dibuka via `open -g -j -a Simulator --args -CurrentDeviceUDID <udid>` dan jendela disembunyikan/ditempatkan off-screen sehingga tidak mengganggu layar Mac user.
  - **Input Touch/Swipe Native via `simtouch` (SimulatorKit IndigoHID)**:
    - Modul C/Objective-C mandiri (`simtouch.m`) seukuran ~52 KB yang menginjeksi event sentuh langsung ke `SimulatorKit.SimDeviceLegacyHIDClient` (IndigoHID).
    - Sub-pixel touch & swipe, tanpa gerakan mouse fisik, tanpa perlu izin Accessibility macOS.
    - Telah teruji sukses mengeksekusi `simtouch tap` dan `simtouch swipe` di Mac M2.

## Sasaran Pekerjaan
1. **Toolchain & Native Binary Helper (`simtouch`)**:
   - Sertakan source `crates/core/src/mirror/ios/simtouch.m` di repo Petak.
   - Script build / packaging helper di macOS yang meng-compile `simtouch` menggunakan `clang -framework Foundation -framework CoreGraphics -F/Library/Developer/PrivateFrameworks -framework CoreSimulator -rpath /Library/Developer/PrivateFrameworks -rpath /Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks -fno-objc-arc -O2` ke target release bundle resources (`Petak.app/Contents/Resources/simtouch`) atau build cache.
2. **Bridge Input Rust (`crates/core/src/mirror/ios/input.rs`)**:
   - Integrasikan pemanggilan `simtouch` untuk semua `InputEvent`:
     * `InputEvent::Touch { action, x, y, w, h }` -> `simtouch tap <x> <y> <w> <h> --udid <udid>` (atau move/drag).
     * `InputEvent::Scroll { x, y, w, h, dx, dy }` -> `simtouch swipe <x> <y> <x+dx> <y+dy> <w> <h> 200 10 --udid <udid>`.
     * `InputEvent::Nav { key: NavKey::Home }` -> `xcrun simctl spawn <udid> launchservicesd ...` atau shortcut home Simulator.
   - Hapus badge / status `view-only` untuk iOS Simulator (ubah jadi `live` interaktif seperti Android).
3. **Lifecycle & Window Hiding (`crates/core/src/mirror/ios/simulator.rs`)**:
   - Otomatis boot simulator jika belum booted (`xcrun simctl boot <udid>`).
   - Launch `Simulator.app` di background tanpa mencuri fokus (`open -g -j -a Simulator`).
   - Saat mirror ditutup di Petak: jangan kill simulator kecuali user klik tombol Stop/Ganti Device.
4. **Verifikasi & DoD**:
   - `cargo test -p petak-core` lulus 100%.
   - `npm test` dan `npm run check` lulus 100%.
   - Build Petak.app di Mac, uji interaksi tap dan swipe pada iOS Simulator (iPhone 17 Pro) langsung dari canvas dock kanan Petak.
