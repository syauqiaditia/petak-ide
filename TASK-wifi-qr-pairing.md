# Petak Batch 12: Pair Android Device via QR Code (Dual-Mode Wi-Fi Pairing)

## Latar Belakang & Kebutuhan
- UQi meminta: *"yang pair via qr juga dong, biar gampang jadi ada 2 mau lewat manual atau qr langsung"*.
- Di Android 11+, opsi Wireless Debugging memiliki 2 metode:
  1. "Pasangkan perangkat dengan kode pemasangan" (Pair with pairing code - sudah selesai di Batch 11).
  2. "Pasangkan perangkat dengan kode QR" (Pair with QR code - seperti di Android Studio).
- Di sistem Android, ketika menu "Pair with QR code" dipilih di HP, kamera aktif dan memindai payload berformat WPA3/ADB:
  `WIFI:T:ADB;S:<service_name>;P:<password>;;`
  Contoh: `WIFI:T:ADB;S:studio-a1b2c3d4e5;P:XyZ987wVuTsRqPoN;;`
- Begitu kamera HP membaca string tersebut:
  1. HP secara otomatis menjalankan internal Pairing Server dengan nama instance mDNS `<service_name>` pada service `_adb-tls-pairing._tcp`.
  2. Host IDE (Petak) mendeteksi service mDNS tersebut (melalui `adb mdns services` atau background poll), mengekstrak IP dan Port pairing.
  3. Petak mengeksekusi `adb pair <ip>:<port> <password>`.
  4. Begitu pairing sukses, Petak mencari port koneksi di `_adb-tls-connect._tcp`, mengeksekusi `adb connect <ip>:<connect_port>`, menutup modal, me-refresh device list, dan menampilkan toast sukses.

## Sasaran
Memperkaya modal `PairDeviceModal.svelte` dengan tab **"Pindai Kode QR"** (Scan QR Code):
1. **QR Code Generator Ringan (Zero-Dependency)**:
   - Generator SVG QR code mandiri di `ui/features/run/qrcode.ts` (menghasilkan SVG vector tajam tanpa dependensi npm eksternal yang membengkakkan bundle).
2. **Dual-Tab UI di PairDeviceModal**:
   - Tab 1: "Pindai Kode QR" (Default) — menampilkan QR code besar di tengah, status listener ("Menunggu pemindaian dari HP..."), tombol "Refresh QR Code", dan instruksi singkat.
   - Tab 2: "Kode Pemasangan (Manual)" — form input IP, Port, dan 6-digit Code (dari Batch 11).
   - Tab 3: "Petunjuk Langkah".
3. **Rust Core / Tauri Discovery & Auto-Pair**:
   - Command / helper `adb_discover_and_pair(service_name, password)` atau polling `adb_find_pairing_service(service_name)` di `crates/core/src/run/pairing.rs` dan `crates/app/src/commands.rs`.
   - Memindai `adb mdns services` untuk baris yang memuat `_adb-tls-pairing._tcp` dan `service_name`.
   - Mengekstrak `<ip>:<pair_port>`, lalu menjalankan `adb pair` dan auto-connect.
4. **Alur UX Mulus**:
   - Buka modal -> QR langsung ter-render otomatis dengan password acak aman.
   - User tinggal buka HP -> Wireless Debugging -> Pair with QR Code -> scan layar Mac.
   - Layar Petak langsung mendeteksi -> "Memasangkan perangkat..." -> "Sukses! Tersambung ke SM-A155F" -> modal tertutup otomatis -> HP muncul di list.
