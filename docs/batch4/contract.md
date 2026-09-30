# Batch 4 Contract (Core <-> UI)

Kontrak final API antara `petak-core` / `petak-app` (Rust) dan UI (Svelte / TypeScript) untuk Batch 4.
Semua command terdaftar di Tauri `invoke_handler` dan siap dipanggil via `invoke('<command_name>', args)`.

---

## 1. Device State & Emulator Control (Bug 1, Bug 2, Fitur B)

### Model: `Device`
Ekstensi field pada `Device` (kompatibel dengan snapshot sebelumnya):
```ts
export type DeviceConnection = "connected" | "paired" | "offline" | "unavailable";
export type DeviceTransport = "usb" | "wifi" | "unknown";
export type DeviceGroup = "emulator" | "simulator" | "physical" | "desktop" | "web";
export type DeviceState = "online" | "offline" | "booting";

export interface Device {
  id: string;
  name: string;
  kind: "android" | "ios" | "macos" | "web";
  state: DeviceState;
  connection: DeviceConnection; // "connected" | "paired" | "offline" | "unavailable"
  transport: DeviceTransport;   // "usb" | "wifi" | "unknown"
  group: DeviceGroup;
  flutterId: string | null;
  platform: string;
  runnable: boolean;
}

export interface DeviceSnapshot {
  devices: Device[];
  avds: AvdInfo[];
  simulators: SimulatorInfo[];
  timestamp: number;
}
```

#### Aturan Tampilan & Run:
- `connection === "connected"`: Status online (hijau), runnable.
- `connection === "paired"`: Status abu-abu "Paired • tidak terhubung", `runnable = false`. Jika user mencoba run, `run_start` menolak dengan error: `"Device belum terhubung (status: Paired). Hubungkan via kabel USB atau aktifkan koneksi jaringan."`
- `connection === "unavailable" | "offline"`: Tidak dimunculkan di dropdown atas runner. Tetap ada di `DeviceSnapshot` untuk ditampilkan di panel Manage Devices dengan badge 'Offline'.

### Commands
```ts
// Re-scan semua adb, flutter, devicectl, simctl, AVD (tombol Refresh)
invoke<DeviceSnapshot>("devices_snapshot"): Promise<DeviceSnapshot>;

// Start Android AVD
// cold = true (-no-snapshot-load), wipeData = true (-wipe-data)
invoke<void>("avd_start", { name: string, cold?: boolean, wipeData?: boolean }): Promise<void>;

// Stop Android AVD
invoke<void>("avd_stop", { name: string }): Promise<void>;

// Wipe data Android AVD
invoke<void>("avd_wipe", { name: string }): Promise<void>;

// Delete Android AVD (hapus direktori AVD + file .ini)
invoke<void>("avd_delete", { name: string }): Promise<void>;

// Boot iOS Simulator via xcrun simctl
invoke<void>("sim_boot", { udid: string }): Promise<void>;

// Shutdown iOS Simulator via xcrun simctl
invoke<void>("sim_shutdown", { udid: string }): Promise<void>;

// Buka aplikasi macOS Simulator (open -a Simulator)
invoke<void>("sim_open_app"): Promise<void>;
```

### Events
Event ditangkap via `listen("emulator-status", (event) => ...)`:
```ts
export interface EmulatorStatusEvent {
  id: string;          // AVD name atau Simulator UDID
  state: "stopped" | "booting" | "running" | "failed";
  error?: string;      // 20 baris terakhir stderr jika failed / exit < 10 detik
}
```

---

## 2. Kotlin Language Server Installer (Bug 9)

### Model & Commands
```ts
export interface KotlinLsStatus {
  installed: boolean;
  version: string | null;
  javaOk: boolean;
  javaVersion: string | null;
  message: string;
}

// Cek status kls & java (JDK >= 11)
invoke<KotlinLsStatus>("kotlin_ls_status"): Promise<KotlinLsStatus>;

// Install / download server.zip, unzip ke <app_data>/Petak/lsp, chmod +x
// Alias: 'kls_install' dan 'kotlin_ls_install' (keduanya aktif)
invoke<void>("kls_install"): Promise<void>;
invoke<void>("kotlin_ls_install"): Promise<void>;
```

### Events
Event ditangkap via `listen("kls-install-progress", (event) => ...)`:
```ts
export interface KlsInstallProgressEvent {
  stage: "checking" | "downloading" | "extracting" | "verifying" | "done" | "error";
  pct?: number;        // 0..100
  error?: string;      // Pesan error jika gagal (offline, JDK tidak memenuhi syarat, dll)
  message: string;
}
```
*(Event `kotlin-ls-progress` juga di-emit sebagai alias backward-compatibility).*

---

## 3. Git Log Filter (Bug 10)

Semua argumen filter bersifat **opsional**. UI dapat mengirim objek kosong `{}` atau hanya field tertentu:
```ts
export interface LogFilter {
  branches?: string[]; // default []
  author?: string;
  since?: string;
  until?: string;
  path?: string;
  text?: string;
}

invoke<LogPage>("git_log", {
  root: string,
  filter?: LogFilter,
  cursor?: number,
  limit?: number,
}): Promise<LogPage>;
```

---

## 4. Code Formatter Core (Fitur A)

Mendukung Dart (`dart format`), Swift (`swift-format` / `swiftformat`), Kotlin (deteksi ktlint/ktfmt atau info via LSP), JSON (`serde_json` indent 2), YAML/HTML/CSS/JS/TS/Markdown (via `prettier` / `npx --no-install prettier`).

```ts
export interface FormatRange {
  startLine: number;
  endLine: number;
}

export interface FormatResult {
  formatted: string;
  tool: string; // contoh: "dart format", "swift-format", "serde_json", "prettier"
}

// Format dokumen atau range text
invoke<FormatResult>("format_document", {
  path?: string,
  lang: string,
  text: string,
  range?: FormatRange,
}): Promise<FormatResult>;
```
*Jika tool formatter tidak ditemukan di sistem, command mengembalikan `Err`: `"Formatter untuk '<lang>' (<tool>) tidak ditemukan. <install_hint>"`.*

---

## 5. Mirror iPhone & Screen Recording Permission (Bug 8 sisi Rust)

```ts
export interface MirrorPermissionStatus {
  granted: boolean;
  restartNeeded: boolean;
  kind: "simulator" | "physical";
  notes?: string;
}

// Cek izin Screen Recording (CGPreflightScreenCaptureAccess di macOS; stub granted=true di non-macOS)
invoke<MirrorPermissionStatus>("mirror_permission_status", {
  deviceId?: string,
}): Promise<MirrorPermissionStatus>;

// Buka jendela System Settings macOS ke Screen Recording
invoke<void>("open_screen_recording_settings"): Promise<void>;
```

#### Catatan Jalur iOS Mirror:
- **iOS Simulator**: Mirror via ScreenCaptureKit / window stream, fallback polling screenshot `simctl io screenshot`. Jika izin ditolak, infokan butuh Screen Recording permission di macOS.
- **iPhone Fisik**: Memerlukan kabel USB, device ter-unlock, dan "Trust This Computer". Mode tampilan view-only via AVFoundation/QuickTime capture pipeline.
