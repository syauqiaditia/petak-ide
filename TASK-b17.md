# Petak Batch 17: iOS Simulator Persistent Daemon (Zero-Delay Touch/Drag) & Full Hardware Keyboard Typing

## Latar Belakang & Keluhan UQi (Testing Lapangan)
1. **Input Terasa Delay & Kurang Smooth**:
   - Touch/drag di iOS simulator terasa ada jeda dan kurang mulus, layar tidak langsung mengikuti gerakan jari/mouse secara real-time.
2. **Keyboard Tidak Bisa Mengetik**:
   - Di kolom pencarian Safari atau text field lainnya di iOS Simulator, ketikan dari keyboard Mac sama sekali tidak masuk ke simulator.

## Root Cause Analysis
1. **Penyebab Delay & Kurang Smooth**:
   - Pada implementasi saat ini, setiap event sentuh mengeksekusi child process `simtouch` baru (`exec.run`).
   - Setiap fork/exec memakan waktu 50–80 ms untuk startup, me-load library dinamis (CoreSimulator + SimulatorKit), menginisialisasi HID client, dan menyambungkan Mach port.
   - Lebih parah lagi, saat mouse digeser (*drag*), event `Move` ditunda dan baru dieksekusi saat mouse dilepas (`Up`), sehingga layar tidak bergerak selama proses drag.
   - **Solusi**: Jadikan `simtouch` sebagai **persistent daemon** (`simtouch daemon --udid <udid>`).
     * `simtouch daemon` berjalan terus di background selama sesi mirror aktif.
     * Framework dan HID client hanya diinisialisasi 1 kali di awal.
     * Event `Down` (`d x y w h`), `Move` (`m x y w h`), dan `Up` (`u x y w h`) dialirkan langsung melalui stream `stdin` pipa IPC.
     * Latensi turun drastis dari 80 ms menjadi **< 1 ms (instan)**. Gerakan mouse langsung diikuti layar secara real-time 60 FPS.
2. **Penyebab Keyboard Tidak Berfungsi**:
   - Di `crates/core/src/mirror/ios/input.rs`, event `InputEvent::Text` diabaikan sepenuhnya (`Ok(())`) karena hanya memiliki fallback ke `idb` yang tidak terpasang.
   - Event tombol kontrol (Backspace, Enter, Tab, dsb) mengirim Android keycode (Enter=66, Backspace=67), bukan USB HID Keyboard Page 0x07 keycode (Enter=40/0x28, Backspace=42/0x2A).
   - **Solusi**:
     * Tambahkan command `text <string>` di `simtouch daemon` yang memetakan karakter ASCII ke USB HID Keyboard Page 0x07 usages (termasuk penanganan Shift modifier untuk huruf besar dan simbol).
     * Tambahkan pemetaan tombol kontrol di `input.rs` dari Android/web keycode ke USB HID Page 0x07 (Backspace=42, Enter=40, Tab=43, Left=80, Right=79, Up=82, Down=81, Space=44).
     * Salurkan `InputEvent::Text` ke `simtouch daemon` via command `text <string>`.

## Deliverables & Tasks
- **Task A (simtouch daemon & HID Keyboard Engine di ObjC)**:
  - Update `crates/core/src/mirror/ios/simtouch.m`:
    * Implementasikan mode `simtouch daemon [--udid <udid>]` yang membaca perintah per baris dari `stdin`:
      - `d <x> <y> <w> <h>` -> kirim event DOWN (type 1, direction 1)
      - `m <x> <y> <w> <h>` -> kirim event MOVE/DRAG (type 6, direction 0)
      - `u <x> <y> <w> <h>` -> kirim event UP (type 2, direction 2)
      - `t <x> <y> <w> <h>` -> kirim tap cepat (DOWN, wait 15ms, UP)
      - `k <hid_keycode>` -> kirim key DOWN + UP
      - `text <string>` -> ketik teks string karakter per karakter via USB HID Keyboard Page 0x07
      - `b <home|lock|volume_up|volume_down>` -> kirim tombol navigasi
    * Tetap pertahankan mode CLI one-shot (tap, swipe, button, key) untuk backwards compatibility.
- **Task B (Rust Core Input Bridge & Session Lifecycle)**:
  - Update `crates/core/src/mirror/ios/simulator.rs`:
    * `IosSimulatorSession` me-manage lifecycle proses `simtouch daemon` (spawn dengan `stdin(Stdio::piped())` saat mirror start, simpan `daemon_stdin: Arc<Mutex<Option<ChildStdin>>>`, dan kill saat drop).
  - Update `crates/core/src/mirror/ios/input.rs`:
    * Alirkan event `Touch`, `Key`, dan `Text` langsung ke `daemon_stdin` (dengan fallback one-shot jika daemon belum aktif).
    * Petakan Android keycodes ke USB HID keycodes untuk tombol kontrol.
    * Handle `InputEvent::Text` dengan mengirim `text <escaped_text>\n`.
  - Rebuild native helper via `scripts/build-simtouch.sh` dan perbarui unit tests Rust di `crates/core`.

## Batasan & Safety
- Dilarang menyentuh repo kantor UQi / PAT.
- RAM idle < 150 MB, bundle size < 20 MB.
- Seluruh unit tests Rust core (`cargo test -p petak-core --lib`) dan frontend wajib PASS 100%.
