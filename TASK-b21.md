# Petak Batch 21: Ultra-Low Latency Physical iPhone Mirroring (Zero-Queue AVFoundation, Adaptive Resolution & VideoToolbox Tuning)

## Latar Belakang & Keluhan UQi (Testing Lapangan)
- UQi: "oke sudah bisa, tapi ada delay ya, bisa kurangin delaynya ga?"
- Layar iPhone fisik (UQi, iPhone 14) sudah berhasil tampil live, tetapi terasa ada delay/lag visual.

## Audit Bottleneck Latensi Physical iPhone Mirror
1. **Antrean Internal AVFoundation (`alwaysDiscardsLateVideoFrames = false` by default di macOS)**:
   - Di macOS AVFoundation, `AVCaptureVideoDataOutput.alwaysDiscardsLateVideoFrames` bernilai `false` secara default.
   - Akibatnya, AVFoundation menahan buffer hingga 30 frame di antrean memori. Setiap kali ada jeda mikro saat encoding atau render GPU, frame menumpuk dan menimbulkan lag kumulatif 250ms–500ms.
   - Solusi: Set `output.alwaysDiscardsLateVideoFrames = true`. Frame yang terlambat langsung dibuang agar hanya frame paling baru (real-time) yang diproses.
2. **Beban Kompresi 2.5K Native (1179 x 2556 = 180 Megapixels/sec)**:
   - Sebelumnya resolusi di-hardcode ke `1179 x 2556` mengabaikan `self.config.width` / `self.config.height`.
   - Mengompresi dan mendekode tekstur 2.5K 60fps di WebKit WebCodecs memakan waktu komputasi besar (~25–35ms).
   - Solusi: Gunakan resolusi adaptive `self.config.width` x `self.config.height` (1080p / 960p) yang proporsional dengan layar dock mirror Petak.
3. **Optimasi VideoToolbox Hardware Encoder**:
   - `kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality = true`
   - `kVTCompressionPropertyKey_RealTime = true`
   - `kVTCompressionPropertyKey_AllowFrameReordering = false` (tanpa B-frames)
   - `kVTCompressionPropertyKey_MaxKeyFrameInterval = NSNumber(value: fps)` (1 detik interval keyframe)
4. **Frame Rate Synchronization di AVCaptureConnection**:
   - Set `connection.videoMinFrameDuration = CMTime(value: 1, timescale: Int32(self.config.fps))` jika didukung.

## Kriteria Selesai
1. `crates/core/src/mirror/ios/petak_ios_capture.swift`:
   - Set `output.alwaysDiscardsLateVideoFrames = true`.
   - Gunakan `config.width` dan `config.height` proporsional untuk encoder fisik.
   - Set VideoToolbox `MaxKeyFrameInterval` ke `fps` (60), `PrioritizeEncodingSpeedOverQuality = true`, `AllowFrameReordering = false`.
   - Set `connection.videoMinFrameDuration` jika didukung.
2. `crates/core/src/mirror/ios/physical.rs`:
   - Teruskan `max_size` yang optimal (1080p / 960p) ke CLI arguments.
   - Pastikan unit tests 256/256 PASS 100%.
3. Build biner di Mac M2 (`scripts/build-simtouch.sh`), bundle `Petak.app`, dan pasang ke `/Applications/Petak.app`.
4. Restart Petak dan verifikasi streaming physical iPhone terasa responsif tanpa delay antrean.
