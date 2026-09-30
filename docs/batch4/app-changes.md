# Daftar Perubahan `crates/app/src` (Batch 4)

Dokumentasi audit perubahan pada crate `petak-app` (karena server Linux tidak memiliki GTK headers untuk `cargo check -p petak-app`, seluruh perubahan direviu 2x secara manual).

---

## 1. File: `crates/app/src/commands.rs`

### Import & Traits yang Digunakan:
- `tauri::{Emitter, Manager}` — sudah di-import di baris 3 untuk event emission (`app.emit(...)`).
- `petak_core::run::*` — `spawn_emulator_detached`, `avd_wipe`, `avd_delete`, `open_simulator_app`, `simctl_boot`, `simctl_shutdown`, `resolve_adb_binary`.
- `petak_core::toolchain::*` — `kotlin_ls_status`, `kotlin_ls_install`.
- `petak_core::format::*` — `format_text`, `FormatRange`, `FormatResult`.
- `petak_core::mirror::*` — `check_screen_capture_permission`, `open_screen_recording_settings`, `MirrorPermissionStatus`.

### Perubahan Commands:
1. **`avd_start` (Dimodifikasi)**:
   - Signature: `pub async fn avd_start(app: tauri::AppHandle, state: tauri::State<'_, RunState>, name: String, cold: Option<bool>, wipe_data: Option<bool>) -> Result<(), String>`
   - Detached process spawn via `petak_core::run::spawn_emulator_detached`.
   - Meng-emit event `emulator-status`:
     - `{ "id": name, "state": "booting" }` saat mulai.
     - `{ "id": name, "state": "failed", "error": string }` jika proses exit < 10 detik dengan stderr ring buffer (20 baris terakhir).
     - `{ "id": name, "state": "running" }` dan `device-ready` saat `adb shell getprop sys.boot_completed` bernilai `"1"`.
2. **`avd_wipe` (Baru)**:
   - Signature: `pub async fn avd_wipe(name: String) -> Result<(), String>`
   - Menjalankan `petak_core::run::avd_wipe(&name)`.
3. **`avd_delete` (Baru)**:
   - Signature: `pub async fn avd_delete(name: String) -> Result<(), String>`
   - Menjalankan `petak_core::run::avd_delete(&name)` (menghapus `<avd>.avd` dan `<avd>.ini`).
4. **`sim_boot` (Dimodifikasi)**:
   - Signature: `pub async fn sim_boot(app: tauri::AppHandle, udid: String) -> Result<(), String>`
   - Meng-emit `emulator-status` (`booting` -> `running`) dan `device-ready`.
5. **`sim_shutdown` (Dimodifikasi)**:
   - Signature: `pub async fn sim_shutdown(app: tauri::AppHandle, udid: String) -> Result<(), String>`
   - Menjalankan `simctl_shutdown` dan meng-emit `emulator-status` (`stopped`).
6. **`sim_open_app` (Baru)**:
   - Signature: `pub async fn sim_open_app() -> Result<(), String>`
   - Menjalankan `petak_core::run::open_simulator_app()`.
7. **`kotlin_ls_install` (Dimodifikasi)**:
   - Meng-emit event `kotlin-ls-progress` dan `kls-install-progress` `{ stage, pct, message, error }`.
8. **`kls_install` (Baru, alias)**:
   - Signature: `pub async fn kls_install(app: tauri::AppHandle) -> Result<(), String>`
   - Meneruskan pemanggilan ke `kotlin_ls_install(app)`.
9. **`format_document` (Baru)**:
   - Signature: `pub async fn format_document(path: Option<String>, lang: String, text: String, range: Option<petak_core::format::FormatRange>) -> Result<petak_core::format::FormatResult, String>`
   - Memanggil `petak_core::format::format_text(&eff_lang, &text, range)`.
10. **`mirror_permission_status` (Baru)**:
    - Signature: `pub async fn mirror_permission_status(device_id: Option<String>) -> Result<petak_core::mirror::MirrorPermissionStatus, String>`
    - Mengembalikan status izin capture macOS & restart flag.
11. **`open_screen_recording_settings` (Baru)**:
    - Signature: `pub async fn open_screen_recording_settings() -> Result<(), String>`
    - Membuka macOS System Settings ke Privacy & Security > Screen Recording.

---

## 2. File: `crates/app/src/lib.rs`

### Pendaftaran di `tauri::generate_handler![...]`:
Semua 7 command baru didaftarkan di blok Batch 4:
```rust
    // Batch 4
    commands::avd_wipe,
    commands::avd_delete,
    commands::sim_open_app,
    commands::kls_install,
    commands::format_document,
    commands::mirror_permission_status,
    commands::open_screen_recording_settings,
```
Commands lama yang diperbarui (`avd_start`, `avd_stop`, `sim_boot`, `sim_shutdown`, `kotlin_ls_status`, `kotlin_ls_install`) tetap terdaftar pada posisi yang sama.

---

## 3. Checklist Hasil Reviu (2x Manual Audit)
- [x] Semua fungsi menggunakan pattern `#[tauri::command] pub async fn ... -> Result<T, String>` yang valid di Tauri v2.
- [x] Background tasks menggunakan `tauri::async_runtime::spawn_blocking`.
- [x] Emitter trait tersedia untuk semua pemanggilan `app.emit(...)`.
- [x] Parameter deserializable serde untuk input camelCase / snake_case.
- [x] Tidak ada trait atau type yang unreferenced.
