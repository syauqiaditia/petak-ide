# Petak Batch 20: Fix Physical iPhone Mirror Capture (CoreMediaIO AllowScreenCapture Retry Loop & AVCapture Discovery)

## Latar Belakang & Keluhan UQi (Testing Lapangan)
- UQi: "oke deh udah lumayan, sekarang kita benerin mirroring iphone ya karena masih error"
- Di tangkapan layar `img_d511cc494659.png`:
  `[ios-capture] Found 1 total devices, 0 iOS candidate devices. [ios-capture] Error: No suitable iOS device found for udid='00008110-00012CCE0C09401E', name=''. Available: FaceTime HD Camera`

## Akar Masalah
1. **Race Condition Inisialisasi DAL CoreMediaIO**:
   - `petak_ios_capture.swift` mengaktifkan `kCMIOHardwarePropertyAllowScreenCaptureDevices` lalu hanya menunggu `Thread.sleep(forTimeInterval: 0.5)`.
   - Di macOS Sequoia / Sonoma, daemon `CoreMediaIO` membutuhkan waktu 1–2 detik setelah property di-set untuk mempublikasikan instance AVCaptureDevice iOS virtual ke daftar devices.
   - Karena hanya dicek 1 kali tanpa retry loop, saat pertama kali Petak membuka sesi physical mirror, list devices hanya mengembalikan webcam internal Mac (`FaceTime HD Camera`), sedangkan iPhone belum selesai ter-register di layer AVFoundation.
2. **Device Discovery Types & Fallback Matching**:
   - Tambahkan discovery types `.continuityCamera` di `AVCaptureDevice.DiscoverySession`.
   - Tambahkan retry loop hingga 10 kali (jeda 500ms antar percobaan) pada `PhysicalDeviceCapture.start()` sampai perangkat iOS (`modelID == "iOS Device"` atau `hasMediaType(.muxed)`) terdeteksi oleh CoreMediaIO DAL.
   - Tambahkan parameter `--device-name` saat memanggil binary capture dari Rust (`physical.rs`) agar device matching bisa mencocokkan nama perangkat (misal "UQi") selain UDID.

## Kriteria Selesai
1. `crates/core/src/mirror/ios/petak_ios_capture.swift`:
   - Implementasikan retry loop 10x (500ms sleep) saat mencari AVCaptureDevice iOS setelah `CMIOObjectSetPropertyData`.
   - Tambahkan `.continuityCamera` pada DiscoverySession deviceTypes.
2. `crates/core/src/mirror/ios/physical.rs`:
   - Teruskan parameter `--device-name` jika nama perangkat diketahui, atau pastikan device matching di Swift fallback ke perangkat iOS pertama yang terdeteksi jika hanya ada 1 iPhone tercolok.
3. Build biner & deploy ke macOS `/Applications/Petak.app`, restart Petak.app.
4. Verifikasi live di Mac M2 dengan iPhone fisik "UQi" tercolok via USB.
