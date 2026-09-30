# Petak Batch 5 - Kontrak Command & Interface (Rust Backend <-> UI)

Dokumen ini adalah kontrak resmi implementasi Rust backend Batch 5 untuk sinkronisasi dengan sisi UI (senior2).

## 1. LSP Control
- **`lsp_restart(language: String) -> Result<(), String>`**
  - Parameter: `language` ("dart", "kotlin" / "kt", "swift").
  - Menghidupkan ulang server LSP yang sedang berjalan untuk bahasa tersebut, mempertahankan open documents, dan re-emit `textDocument/didOpen`.

## 2. Device Classification & DeviceInfo
Format JSON `DeviceInfo` (alias dari `SnapshotDevice` dengan `serde(rename_all = "camelCase")`):
```json
{
  "id": "00008110-00012CCE0C09401E",
  "name": "UQi (wireless)",
  "platform": "ios",
  "state": "online",
  "kind": "ios-physical",
  "connState": "connected_wifi",
  "transport": "wifi",
  "tunnelState": "available (paired)",
  "pairingState": "paired",
  "flutterId": "00008110-00012CCE0C09401E",
  "group": "physical",
  "connection": "connected"
}
```
- **`kind`**: `"android"` | `"ios-simulator"` | `"ios-physical"`.
  - Diklasifikasikan secara tunggal oleh `classify_device_kind()` di `crates/core/src/run/device.rs`.
  - ID berawalan `00008` atau CoreDevice UUID yang tidak ada di simctl = `"ios-physical"`.
  - UDID simulator dari simctl = `"ios-simulator"`.
  - `emulator-*` atau IP:port = `"android"`.
- **`connState`**: `"connected_usb"` | `"connected_wifi"` | `"locked"` | `"disconnected"`.
- **`transport`**: `"wired"` | `"wifi"` | `null` (tidak menampilkan "USB" kecuali transportType memang wired).
- **`tunnelState` & `pairingState`**: string raw dari `devicectl`.
- **Penggabungan `flutter devices --machine`**: jika flutter melihat device tersedia (`online`), device ditandai connected (`connState`: `connected_usb` / `connected_wifi`).

## 3. Device Discovery & Watcher
- **`devices_refresh() -> Result<Vec<DeviceInfo>, String>`**
  - Melakukan re-scan device secara aktif dan mengembalikan snapshot terbaru.
  - Memancarkan event Tauri `"devices-changed"` dengan payload `Vec<DeviceInfo>`.
- **Device Watcher**:
  - Watcher memantau `adb track-devices` serta periodic polling 3 detik (`devices_snapshot`) dan otomatis memancarkan event `"devices-changed"` bila ada perubahan status/daftar.

## 4. Run & Daemon Lifecycle
- **`run_restart_daemon(run_id: Option<u32>) -> Result<(), String>`**
  - Menghentikan proses `flutter run --machine` dan daemon target, mereset state machine proses, dan menjalankan ulang `run_restart_connection()`.
- **`run_restart_connection() -> Result<(), String>`**
  - Merestart watcher koneksi device dan memicu `devices_refresh()`.
- **`run_hot_restart(run_id: u32) -> Result<ReloadResult, String>`**
  - Memicu full restart aplikasi flutter via daemon `app.restart` dengan `fullRestart: true`.
- **`run_stop(run_id: u32) -> Result<(), String>`**
  - Menghentikan proses run aktif (Flutter / Gradle).

## 5. Konfigurasi
- **Key `bottom_panel_height`**:
  - Disimpan di `config.json` melalui API konfigurasi toolchain yang sudah ada (`toolchain_get_config` & `toolchain_save_config`).
  - Tipe: integer `u32` (px).

## 6. Accounts (GitLab Token Store)
Token disimpan aman di macOS Keychain via CLI `security` (fallback file berizin `0600` di Linux) dan **tidak pernah dikirim ke webview atau log**.
- **`accounts_get() -> Result<AccountInfo, String>`**
  - Return: `{ "url": string, "hasToken": boolean }`
- **`accounts_save(url: String, token: String) -> Result<(), String>`**
  - Menyimpan URL ke `config.json` dan PAT ke Keychain.
- **`accounts_test() -> Result<AccountTestResult, String>`**
  - Menguji koneksi ke endpoint `{url}/api/v4/user` menggunakan token tersimpan.
  - Return: `{ "ok": boolean, "user": string }`
- **`accounts_clear() -> Result<(), String>`**
  - Menghapus token dari Keychain dan membersihkan URL di konfigurasi.

## 7. Mirror Control
- **`mirror_open(device_id: String, max_size: Option<u16>) -> Result<MirrorInfo, String>`**
  - Menggunakan klasifikasi device `is_ios_simulator()` vs `IosPhysicalSession`: device iOS fisik **tidak pernah** memanggil `simctl boot`.
  - Error terstruktur berformat JSON:
    ```json
    {
      "platform": "ios-physical",
      "code": "physical_capture_failed",
      "message": "Mirror iPhone fisik membutuhkan kabel USB tertancap, iPhone dalam keadaan tidak terkunci (unlocked) & Trust komputer ini, serta izin Screen Recording di macOS."
    }
    ```
    Bebas dari kata `scrcpy` atau `simctl`.

## 8. Android Emulator / AVD
- **`avd_start(name: String, cold: Option<bool>, wipe_data: Option<bool>, headless: Option<bool>) -> Result<(), String>`**
  - `emulator_start(avd: String, headless: Option<bool>)` mendelegasikan langsung ke `avd_start`.
  - Default headless: `false` di macOS; `true` di Linux jika tanpa display server.
  - Menulis log eksekusi dan error ke file:
    - macOS: `~/Library/Application Support/Petak/logs/emulator.log`
    - Linux: `~/.local/share/Petak/logs/emulator.log`
  - Memancarkan event `"emulator-status"` (`booting` -> `running` / `failed`) dan `"device-ready"`.
