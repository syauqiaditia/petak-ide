# Petak Batch 15: iOS Simulator 60 FPS Metal ScreenCaptureKit Fix & Simctl Fallback Removal

## Latar Belakang & Keluhan UQi (Testing Lapangan)
- Mirroring iOS Simulator di dock Petak berhasil tampil, tetapi frame rate sangat rendah (**hanya 6 FPS**, screenshot `img_37d834beb3de.png`), terasa lag parah dan tidak *playable*.

## Root Cause Analysis
1. **Kegagalan Inisialisasi ScreenCaptureKit (`CGS_REQUIRE_INIT`)**:
   - Sebagai CLI helper, `petak_ios_capture.swift` tidak menginisialisasi `NSApplication.shared`.
   - Di macOS Sonoma & Sequoia, memanggil `SCContentFilter(desktopIndependentWindow:)` tanpa runtime AppKit memicu `Assertion failed: (did_initialize), function CGS_REQUIRE_INIT` di framework SkyLight/CoreGraphics.
2. **Mis-matching Jendela Simulator**:
   - `content.windows.first { ... }` mengambil jendela pertama Simulator.app.
   - Di macOS, jendela pertama Simulator adalah widget status bar mini berukuran `66x20` piksel (`title: "Window"`), BUKAN jendela layar iPhone (`iPhone 17 Pro`, ukuran `456x972`).
   - Akibatnya stream H.264 gagal dikonfigurasi dan SCStream langsung disconnect.
3. **`onScreenWindowsOnly: true` Menyebabkan Miss Saat Auto-Hide**:
   - Parameter `onScreenWindowsOnly: true` membuang jendela Simulator yang sedang di-hide/offscreen oleh AppleScript.
4. **Jatuh ke Slow Fallback Polling (6 FPS)**:
   - Karena SCStream gagal di langkah 1 & 2, proses langsung beralih ke `startSimctlScreenshotFallback`.
   - Fallback ini memanggil `xcrun simctl io screenshot /tmp/...` dalam loop timer, menulis file PNG ke disk SSD lalu membacanya kembali setiap frame. Disk I/O overhead inilah yang mengunci performa di **6 FPS**.

## Solusi & Implementasi
1. Di `crates/core/src/mirror/ios/petak_ios_capture.swift`:
   - Tambahkan `_ = NSApplication.shared` di awal program sebelum memanggil ScreenCaptureKit.
   - Ubah `SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false)` (set `onScreenWindowsOnly: false`).
   - Perbaiki pencarian jendela Simulator agar secara ketat memilih jendela perangkat:
     ```swift
     let simWindow = content.windows.first { w in
         let owner = w.owningApplication?.applicationName ?? ""
         let isSim = owner == "Simulator" || owner.contains("Simulator")
         let title = w.title ?? ""
         let isPhone = title.contains("iPhone") || title.contains("iPad")
         let hasSize = w.frame.width >= 200 && w.frame.height >= 400
         return (isSim || isPhone) && hasSize
     }
     ```
   - Tambahkan retry loop (misal polling setiap 300ms hingga 10 kali / 3 detik) untuk menunggu jendela Simulator benar-benar siap dan terdaftar di WindowServer setelah diluncurkan.
   - Simpan stream configuration yang tepat (minimumFrameInterval 60 FPS, Metal zero-copy).
2. Di `scripts/build-simtouch.sh`:
   - Compile ulang `petak_ios_capture.swift` menjadi binary native `target/release/petak_ios_capture`.
3. Verifikasi performa:
   - Tes streaming ScreenCaptureKit di Mac harus menghasilkan **50–60 FPS konstan** tanpa jatuh ke screenshot fallback.
   - Semua unit tests Rust dan frontend harus PASS.
