# Petak Batch 19: Maximum Fluidity iOS Simulator (120Hz/8ms Input Pipeline, Hardware Low-Latency Encoder, Instant Keystrokes)

## Latar Belakang & Keluhan UQi (Testing Lapangan)
- UQi: "oke sudah lumayan lancar, buat lebih lancar lagi bisa?"
- Target: Menjadikan pergerakan sentuhan dan respons pengetikan 100% identik seperti mengontrol simulator jendela asli secara langsung (*native-grade buttery smoothness*).

## Audit Bottleneck Latensi Saat Ini
1. **Frontend IPC Throttle di DeviceCanvas.svelte**:
   - `now - lastMoveTime < 16` membatasi pengiriman mouse move ke 60Hz (16.6ms).
   - Mengubah throttle ke 8ms (120Hz polling) memangkas latensi pelacakan kursor menjadi separuhnya (~8ms), membuat gestur drag/scroll sangat responsif di trackpad Mac 120Hz ProMotion.
2. **VideoToolbox Low-Latency Flag di petak_ios_capture.swift**:
   - Tambahkan `VTSessionSetProperty(session, key: kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality, value: kCFBooleanTrue)`.
   - Ini menginstruksikan hardware encoder Apple Silicon M2 untuk memprioritaskan latensi siklus silikon terendah (< 2ms per frame kompresi).
3. **Optimasi KeyStroke & Tap Hold di simtouch.m**:
   - Delay hold `tap`: kurangi dari 15ms ke 5ms.
   - Delay hold `key` (Enter/Backspace): kurangi dari 15ms ke 5ms.
   - Delay antar karakter `sendKeyStroke`: pangkas hold shift dari 5ms ke 1ms, hold key dari 15ms ke 5ms, pause antar tombol dari 10ms ke 2ms.
   - Mengubah `sendIndigoMessage` di `sendKeyStroke` menjadi `sendIndigoMessageAsync` sehingga pengetikan kalimat cepat tidak terblokir antrean XPC.
4. **Scroll Gesture Duration**:
   - `input.rs` mengirim durasi swipe scroll `200 10` (200ms). Pangkas ke `120 8` agar transisi gulir halaman terasa instan dan tidak ada efek rubber-banding lambat.

## Kriteria Selesai
1. `DeviceCanvas.svelte` throttle mouse move turun ke 8ms (120Hz).
2. `petak_ios_capture.swift` aktifkan `kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality`.
3. `simtouch.m` pangkas sleep durasi tap/key/keystroke dan gunakan async message.
4. `input.rs` set scroll durasi 120ms.
5. Build biner & deploy ke macOS `/Applications/Petak.app`, restart Petak.app.
