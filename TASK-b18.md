# Petak Batch 18: Ultra-Low Latency iOS Simulator Pipeline (Zero-Queue SCK, No-B-Frames VideoToolbox, Async Non-Blocking Touch Daemon)

## Latar Belakang & Keluhan UQi (Testing Lapangan)
- Mirror iOS simulator sudah berjalan dan tampil 58 FPS, namun saat dibandingkan langsung dengan simulator aslinya terasa delay (latency lag), interaksi kurang smooth/responsif. UQi meminta latensi diminimalkan agar se-smooth dan se-responsif mungkin.

## Root Cause Analysis
1. **ScreenCaptureKit Default Frame Buffering (3–8 Frames)**:
   - `SCStreamConfiguration.queueDepth` tidak diatur secara eksplisit, sehingga macOS menggunakan nilai default (3 hingga 8 frame).
   - Akibatnya ScreenCaptureKit menyimpan antrean frame lama di memori sebelum dialirkan, menghasilkan lag visual 50–120 ms.
   - **Solusi**: Set `streamConfig.queueDepth = 1`. Frame buffer antrean lama dibuang; ScreenCaptureKit langsung mengirim frame paling baru tanpa antrean.
2. **VideoToolbox Hardware Encoder Pipeline Delay (B-Frames / Frame Reordering)**:
   - Di `petak_ios_capture.swift`, `kVTCompressionPropertyKey_AllowFrameReordering` tidak diset ke `kCFBooleanFalse`.
   - Tanpa ini, hardware encoder VideoToolbox mengaktifkan reordering (B-frames) yang menahan 2–3 frame untuk melihat frame berikutnya sebelum mengompresi, menambahkan 33–50 ms latency encode.
   - **Solusi**: Set `VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)` dan `kVTCompressionPropertyKey_ExpectedFrameRate = fps`.
3. **Synchronous Semaphore Blocking di Touch Daemon (`simtouch`)**:
   - Di `simtouch.m`, setiap perintah `m` (move/drag) memanggil `sendIndigoMessage` yang melakukan `dispatch_semaphore_wait(sema, 5 * NSEC_PER_SEC)`.
   - Setiap kali mouse digeser (60 event/detik), loop membaca `stdin` terblokir menunggu balasan XPC Mach port round-trip (5–15 ms per event). Antrean event menumpuk (*backlog*), membuat drag terasa sangat lambat dan tertunda.
   - **Solusi**: Buat `sendIndigoMessageAsync` yang mengirim pesan secara fire-and-forget (`[client sendWithMessage:message freeWhenDone:YES completionQueue:queue completion:^(NSError *err){}]`) tanpa `dispatch_semaphore_wait`. Event drag mouse diproses secara instan (<0.1 ms) tanpa pernah memblokir loop `stdin`.

## Deliverables & Tasks
- **Task A (petak_ios_capture.swift & Encoder Tuning)**:
  - Update `crates/core/src/mirror/ios/petak_ios_capture.swift`:
    * Set `streamConfig.queueDepth = 1`.
    * Set `kVTCompressionPropertyKey_AllowFrameReordering` = `kCFBooleanFalse`.
    * Set `kVTCompressionPropertyKey_ExpectedFrameRate` = `fps`.
- **Task B (simtouch.m Async Non-Blocking Daemon)**:
  - Update `crates/core/src/mirror/ios/simtouch.m`:
    * Implementasikan `sendIndigoMessageAsync` (fire-and-forget tanpa semaphore wait).
    * Gunakan `sendIndigoMessageAsync` pada perintah `m` (move/drag), `d` (down), `u` (up), `k` (key), dan `s` (scroll) di dalam `runDaemon`.
- **Task C (Build & Deploy)**:
  - Jalankan `./scripts/build-simtouch.sh` untuk recompile native `petak_ios_capture` dan `simtouch`.
  - Pastikan unit tests `cargo test -p petak-core --lib` PASS 100%.

## Batasan & Safety
- Dilarang menyentuh repo kantor UQi / PAT.
- RAM idle < 150 MB, bundle size < 20 MB.
- Seluruh 255 unit tests Rust core PASS 100%.
