# Petak Batch 11: Pair Android Device via Wi-Fi (Pairing Code & Auto-Connect)

## Latar Belakang & Masalah
- Di Android 11+, Google memperkenalkan fitur Wireless Debugging berbasis TLS (`_adb-tls-connect._tcp` dan `_adb-tls-pairing._tcp`).
- Ketika perangkat fisik Android (seperti Samsung Galaxy A15 / SM-A155F) terhubung ke jaringan Wi-Fi lokal yang sama dengan Mac/laptop, perangkat memancarkan sinyal mDNS tetapi koneksi `adb connect` ditolak (`No route to host` / connection refused) sebelum dilakukan pairing satu kali menggunakan pairing code 6-digit.
- Android Studio memiliki fitur resmi "Pair devices over Wi-Fi" (dialog input kode 6-digit + port, atau QR code).
- Saat ini Petak belum memiliki dialog pairing Wi-Fi di UI, sehingga jika perangkat belum pernah di-pair atau token pairing ter-reset, pengguna tidak bisa menghubungkan HP tanpa membuka terminal eksternal.

## Tujuan
Membangun fitur "Pair Device via Wi-Fi" langsung di dalam Petak IDE:
1. Tombol `+ Pasangkan via Wi-Fi` (`+ Pair via Wi-Fi`) di `DevicePickerView.svelte` (mirror panel) dan `DevicesPanel.svelte`.
2. Modal dialog `PairDeviceModal.svelte` dengan input IP address, Port pairing (5 digit), dan Pairing code (6 digit).
3. Backend Rust core command `adb_pair(host, port, code)` yang mengeksekusi `adb pair <host>:<port> <code>`, menangani respon sukses/gagal, lalu otomatis melanjutkan dengan `adb connect <host>:<port_connect>`.
4. Auto-refresh device list (`runStore.refreshDevices()`) setelah pairing berhasil sehingga kartu device fisik langsung muncul dengan status `Siap` / online.
5. Panduan langkah visual singkat dalam modal: Pilihan Pengembang -> Debugging Nirkabel -> Pasangkan perangkat dengan kode pemasangan.

## Spesifikasi & Komponen yang Dikerjakan

### 1. Core Rust (`crates/core/src/run/` atau `crates/core/src/mirror/`)
- Fungsi `pair_device(exec: &dyn Exec, host: &str, port: u16, code: &str) -> io::Result<PairResult>`
  - Menjalankan `adb pair <host>:<port> <code>`
  - Parsing output: sukses `Successfully paired to ...` vs gagal `Failed: ...` / timeout.
- Fungsi `connect_device_ip(exec: &dyn Exec, host: &str, port: u16) -> io::Result<String>`
  - Menjalankan `adb connect <host>:<port>`
- Unit test parser di `crates/core/src/run/device.rs` atau modul baru `pairing.rs`.

### 2. Tauri IPC & App Commands (`crates/app/src/commands.rs` & `ui/lib/api.ts`)
- Tauri command:
  ```rust
  #[tauri::command]
  pub async fn adb_pair(host: String, port: u16, code: String) -> Result<String, String>;

  #[tauri::command]
  pub async fn adb_connect(host: String, port: u16) -> Result<String, String>;
  ```
- Binding di `ui/lib/api.ts`:
  - `api.adbPair(host: string, port: number, code: string): Promise<string>`
  - `api.adbConnect(host: string, port: number): Promise<string>`

### 3. UI Frontend (`ui/features/mirror/` & `ui/features/run/`)
- Komponen `PairDeviceModal.svelte`:
  - Backdrop modal gelap sesuai tema Petak.
  - Input field: IP Address (default mendeteksi subnet lokal atau kosong), Port (5 digit), Pairing Code (6 digit).
  - Validasi form (IP valid, port 1024-65535, code 6 digit).
  - Status indicator (Idle, Pairing..., Sukses, Gagal dengan pesan error jelas).
  - Tombol aksi: "Batal" dan "Pasangkan".
  - Tab / instruksi petunjuk langkah pairing di Android.
- Integrasi di `DevicePickerView.svelte`:
  - Tambah card atau tombol `+ Pasangkan via Wi-Fi` di section "Perangkat Fisik (Wi-Fi / USB)".
  - On pairing success: tutup modal, tampilkan notifikasi toast sukses, panggil `runStore.refreshDevices()`, dan siap di-mirror seketika.

### 4. Pengujian & Verifikasi
- Unit test Rust (220+ test tetap pass).
- Unit test UI JavaScript (`tests/batch11_ui_logic.test.mjs`, 155+ test tetap pass).
- Verifikasi build di Mac M2 dan uji koneksi langsung dengan Samsung Galaxy A15.
