# Petak Batch 22: Smooth 60 FPS Physical iPhone Mirror & Automatic CoreMediaIO USB Handshake

## Latar Belakang & Keluhan UQi (Testing Lapangan)
- UQi: "loh sekarang bisa, kenapa gitu? terus ini patah patah si ga smooth bisa benerin?"
- Screen iPhone fisik sudah muncul di dock kanan Petak (tampil feed video), tetapi:
  1. UQi bingung kenapa sebelumnya error lalu tiba-tiba bisa jalan.
  2. Video terasa patah-patah / stuttering (tidak smooth 60 FPS).

## Akar Masalah & Audit Teknis
1. **Kenapa sebelumnya gagal lalu bisa jalan?**:
   - Di macOS, Apple mengunci endpoint USB screen capture iPhone fisik.
   - CoreMediaIO DAL membutuhkan handshake aktif untuk membuka muxing video USB. Tadi saat kita memanggil helper perekaman di latar belakang, handshake CoreMediaIO terbuka dan iPhone langsung terdeteksi.
   - Solusi: `petak_ios_capture.swift` harus otomatis melakukan handshake background ini jika perangkat belum terdeteksi di attempt 1, tanpa butuh intervensi manual.
2. **Kenapa video patah-patah (choppy/stuttering)?**:
   - **Penyebab Utama 1: Redundant `decoder.configure()` di `DeviceCanvas.svelte`**:
     Setiap ada keyframe (kind 1), backend `commands.rs` mengirimkan paket konfigurasi SPS/PPS (kind 0).
     Di `DeviceCanvas.svelte`, setiap paket kind 0 memicu pemanggilan `decoder.configure(config)`.
     Di WebCodecs API macOS WebKit, pemanggilan `.configure()` me-reset pipeline hardware decoder Metal GPU, membuang frame in-flight, dan menghentikan decoding sejenak. Karena keyframe dikirim tiap 1 detik, decoder mengalami re-inisialisasi setiap 1 detik sehingga video tersendat/patah-patah berkala.
     Solusi: Tambahkan guard cache config (`lastConfigSignature`). Jangan panggil `decoder.configure()` jika codec dan SPS/PPS description identik dengan yang sedang aktif!
   - **Penyebab Utama 2: Multiple Zombie `petak_ios_capture` Processes**:
     `physical.rs` tidak membunuh proses capture fisik lama sebelum spawn yang baru. Beberapa proses lama (PID 38598, 38482, 37170) berjalan bersamaan dan saling berebut paket USB frame, membagi bandwidth dan frame rate.
     Solusi: Tambahkan `pkill -f petak_ios_capture.*--mode.*physical` di `physical.rs` sebelum spawn.
   - **Penyebab Utama 3: Keyframe Interval & Bitrate Pacing**:
     Set keyframe interval ke 120 frame (2 detik) di `H264Encoder` untuk efisiensi kompresi dan stabilitas stream.

## Kriteria Selesai
1. `ui/features/mirror/DeviceCanvas.svelte`:
   - Tambahkan guard dedup config (`lastConfigHash` / signature check) agar `decoder.configure()` HANYA dipanggil saat pertama kali atau saat parameter SPS/PPS benar-benar berubah.
2. `crates/core/src/mirror/ios/physical.rs`:
   - Bersihkan proses zombie lama sebelum spawn physical mirror.
3. `crates/core/src/mirror/ios/petak_ios_capture.swift`:
   - Tambahkan automated CoreMediaIO handshake trigger jika device belum terdeteksi.
   - Set keyframe interval 120 (2 detik).
4. Verifikasi & Deploy:
   - Tes unit Rust `petak-core` & UI tests PASS 100%.
   - Build & deploy ke Mac `/Applications/Petak.app`, restart Petak.
   - Streaming iPhone fisik berjalan mulus 60 FPS tanpa stutter 1 detik.
