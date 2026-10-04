# Petak Batch 16: Fix iOS Simulator Black Screen on Boot, Double-Tap Click Lag & Smooth Swipe

## Latar Belakang & Keluhan UQi (Testing Lapangan)
1. **Layar Awal Booting Hitam (Black Screen) & Harus Unminimize Manual**:
   - Saat mirror iOS simulator dinyalakan di Petak, layar dock kanan hitam.
   - Baru setelah jendela Simulator di macOS di-unminimize / dibuka dari Dock, layarnya baru muncul.
2. **Klik Sangat Sulit / Sering Meleset (Unresponsive Clicks)**:
   - Klik di dalam mirror Petak terasa susah banget dan sering tidak merespons, padahal kalau diklik langsung di jendela Simulator macOS sangat lancar.
3. **Performa Kurang Mulus (Need Smooth 60 FPS & Drag/Swipe)**:
   - Butuh gerakan yang lebih responsif dan mulus.

## Root Cause Analysis
1. **Penyebab Black Screen Saat Awal Booting**:
   - Di `crates/core/src/mirror/ios/simulator.rs`, simulator diluncurkan dengan `open -g -j -a Simulator`. Flag `-j` memerintahkan macOS meluncurkan aplikasi dalam keadaan "Hidden" (`NSApplication.hide`).
   - Pada macOS (Sonoma/Sequoia), WindowServer menghentikan total render loop (compositor suspend) untuk aplikasi yang berstatus hidden/minimized demi hemat daya.
   - ScreenCaptureKit yang menangkap window hidden tersebut tidak menerima buffer gambar (layar hitam). Saat user mengklik icon Dock Simulator, status hidden dicabut, WindowServer merender ulang, dan stream baru muncul di Petak.
   - **Solusi**: Hapus flag `-j` (gunakan `open -g -a Simulator`), biarkan Simulator berjalan normal di latar, lalu panggil `open -a Petak` agar jendela Petak tetap berada di depan (Simulator berada di belakang Petak tanpa ter-suspend oleh WindowServer).
2. **Penyebab Klik Susah & Kadang Tidak Kena**:
   - Di `crates/core/src/mirror/ios/input.rs`, pada event `InputEvent::Touch`:
     ```rust
     if matches!(action, TouchAction::Down | TouchAction::Up) {
         exec.run(Path::new("."), &simtouch_bin, &["tap", ...])
     }
     ```
     Setiap 1 kali klik mouse user, frontend mengirim `action: Down` lalu `action: Up`. Kode Rust mengeksekusi `simtouch tap` **DUA KALI** (Down memicu 1 tap, Up memicu 1 tap lagi)! Setiap `simtouch tap` sendiri di C/ObjC sudah melakukan `Down -> 50ms hold -> Up`. Akibatnya, 1 klik biasa menjadi **double-tap bertubi-tubi** dalam selang milidetik yang membatalkan event klik di iOS (atau memicu zoom/discard)!
   - Lebih parah lagi, `TouchAction::Move` diabaikan sepenuhnya, sehingga aksi klik-dan-drag untuk swipe/geser halaman sama sekali tidak jalan.
   - Di `simtouch.m`, jika parameter `--udid` diberikan tetapi perangkat tersebut sedang Shutdown (misal user memilih iPhone 17 tapi parameter membawa UDID iPhone 17 Pro lama), Mach port connection gagal dengan error `machPortNotConnected`.
   - **Solusi**:
     - Di `input.rs`: Lacak gesture sentuh (Touch State Tracking).
       * Saat `TouchAction::Down`: catat posisi awal `(start_x, start_y, Instant::now())`.
       * Saat `TouchAction::Move`: catat posisi terkini `(last_x, last_y)`.
       * Saat `TouchAction::Up`:
         - Jika perpindahan jarak < 15 pixel dan durasi < 500ms: Eksekusi **hanya 1 kali** `simtouch tap x y w h --udid <udid>`!
         - Jika perpindahan jarak >= 15 pixel (drag/swipe): Eksekusi `simtouch swipe start_x start_y last_x last_y w h duration_ms 10 --udid <udid>`!
     - Di `simtouch.m`: Jika UDID yang diminta tidak ditemukan dalam keadaan Booted (`state == 3`), otomatis fallback ke simulator yang sedang Booted agar tidak gagal dengan `machPortNotConnected`.

## Deliverables & Tasks
- **Task A (Core/Rust & Native)**:
  - `crates/core/src/mirror/ios/simulator.rs`:
    * Hapus flag `-j` pada peluncuran Simulator (`open -g -a Simulator`).
    * Tambahkan re-activation Petak (`open -a Petak`) agar Petak tetap di foreground di atas Simulator.
  - `crates/core/src/mirror/ios/input.rs`:
    * Implementasikan `TouchTracker` (stateful tracking per UDID: start point, timestamp) untuk membedakan Tap tunggal vs Swipe mulus.
    * Hapus pemanggilan `tap` ganda pada Down & Up.
    * Forward drag/swipe ke `simtouch swipe`.
  - `crates/core/src/mirror/ios/simtouch.m`:
    * Fallback cerdas ke Booted device jika target UDID spesifik tidak dalam status booted (`state == 3`).
    * Kurangi tap hold time dari 50ms menjadi 30ms untuk responsivitas instan (<35ms click latency).
  - Update script `scripts/build-simtouch.sh` & rebuild native `simtouch`.
  - Unit tests Rust di `crates/core` wajib PASS 100%.

## Batasan & Safety
- Dilarang menyentuh repositori kantor UQi / PAT.
- RAM idle < 150 MB, bundle size < 20 MB.
- Seluruh 246 unit tests Rust core dan frontend tests wajib PASS.
