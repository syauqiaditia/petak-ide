# Petak Fase 4.5 — Device Mirror: Laporan Implementasi & Verifikasi UI

**Task:** `t_eb501da4` (Senior2 — UI panel Device: dock, toolbar, WebCodecs decoder, preview+bridge)  
**Parent Task:** `t_7a4af300` (Manager) & `t_d5cfcdd8` (Designer spec)  
**Branch:** `wt/t_eb501da4` (berbasis `feat/phase4-run`)  
**Worktree:** `/mnt/storage/uqi-projects/petak-wt/t_eb501da4`  
**Reviewer:** `techlead`  

---

## 1. Ringkasan Eksekutif

Implementasi komponen UI untuk panel **Device Mirror** (Fase 4.5) telah selesai secara penuh dan diverifikasi di server Linux (`uqiflutter1`). Seluruh spesifikasi desain dari designer (`docs/phase4/design-device-panel.md`), visual mockup (`docs/phase4/design/DevicePanel.html`), dan kontrak core <-> UI (`docs/phase4/device-mirror-contract.md`) telah dipenuhi tanpa ada hardcode dummy angka telemetri palsu.

### Poin Utama Hasil Pekerjaan:
1. **Full-Height Outer Right Dock:** Panel Device Mirror menempati dock paling kanan dengan tinggi penuh (828px di antara TitleBar 46px dan StatusBar 26px).
2. **Penyempitan Area Tengah:** Area tengah (Code Editor + panel bawah Terminal/Run/Logcat) otomatis menyempit secara horizontal saat panel dibuka. **Panel bawah tidak pernah menutupi atau memotong panel HP.**
3. **Slot Panel Agent Fase 5:** Slot terdedikasi telah disiapkan tepat di **sebelah kiri** panel Device Mirror (`.agent-panel-slot`, lebar 390px, collapsible) sehingga fase 5 dapat langsung dipakai tanpa refactor layout.
4. **Hardware Bezel Token Otentik:** Frame HP dirender dengan bezel gelap minimalis (`bg-titlebar` `#111215`, border `#2c2e34`, radius 28px, kamera punch-hole 8px) dan rasio aspek responsif (`calculateViewportFit`).
5. **Telemetri Nyata:** HUD mengukur FPS riil dari buffer frame yang diterima dan latensi riil (`input sent -> frame rendered delta`).
6. **Zero Cost / Lazy Total:** 
   - Komponen dimuat via **dynamic import** (`DeviceMirrorPanel.svelte` terpisah di chunk tersendiri berukuran 19.61 kB raw / 6.61 kB gzip).
   - Nol thread, nol listener, nol polling saat panel tertutup.
   - Menutup panel memanggil `api.mirrorStop(serial)` dan membersihkan decoder.
7. **Interaksi Input Lengkap:**
   - Mouse: down, move, up (diterjemahkan ke koordinat piksel device riil via `translateCanvasToDevice`) + touch reticle feedback circle.
   - Wheel: scroll event `{ t: "scroll", dx, dy }`.
   - Keyboard: teks dan tombol navigasi diteruskan ke device saat fokus, dengan pengaman escape `Shift+Escape` atau `Escape` kembali ke editor.
   - Toolbar atas: rotate, screenshot (dengan toast konfirmasi), reconnect, close (`Cmd+Shift+D`).
   - Toolbar bawah: tombol navigasi Android (`Back`, `Home`, `Recents`, `Vol-`, `Vol+`, `Power`), disembunyikan otomatis pada device iOS (digantikan indikator garis home iOS).
8. **6 State Lifecycle:** Seluruh 6 status (`empty`, `connecting`, `live`, `disconnected`, `error`, `view-only`) diimplementasikan secara visual dan terverifikasi.

---

## 2. Struktur Komponen UI (`ui/features/mirror/`)

```
ui/features/mirror/
├── types.ts                    // Kontrak tipe data: MirrorStatus, InputEvent, MirrorInfo, ParsedPacket
├── logic.ts                    // Fungsi murni: parseFramePacket, translateCanvasToDevice, calculateViewportFit, clampPanelWidth, calcFps, calcLatency, mirrorStateMachine
├── mirrorStore.svelte.ts       // Svelte 5 reactive store: state machine, local persistence, telemetri, lifecycle
├── DeviceMirrorPanel.svelte    // Kontainer dock kanan, resizer kiri (300..600px), toolbars, toast
├── DeviceStage.svelte          // Stage area, bezel container responsif, punch-hole kamera, state routing
├── DeviceCanvas.svelte         // WebCodecs VideoDecoder, render frame canvas, gesture & keyboard forwarding, reticle
├── DeviceToolbarTop.svelte     // Header: nama device, status badge, tombol Rotate, Screenshot, Reconnect, Close
├── DeviceToolbarBottom.svelte  // Hardware navigation bar (Back/Home/Recents/Vol/Power), disembunyikan di iOS
├── DeviceHud.svelte            // Real-time HUD pill: FPS + Latency
├── canvasMock.ts               // Canvas preview renderer untuk verifikasi visual browser headless
└── states/
    ├── StateEmpty.svelte       // "No Device Selected" card + Select Device / Launch AVD
    ├── StateConnecting.svelte  // Spinner + log progres scrcpy handshake + Cancel CTA
    ├── StateDisconnected.svelte// Overlay warning banner + dimming canvas + Reconnect CTA
    └── StateError.svelte       // Kartu error + kode diagnostik + Retry Handshake / View Logcat
```

---

## 3. Hasil Pengujian & Verifikasi

### 3.1 Unit Test Logika (`tests/mirror_logic.test.mjs`)
Dijalankan menggunakan Node.js test runner bawaan (`node --experimental-strip-types tests/mirror_logic.test.mjs`):
```
✔ parseFramePacket: parses valid binary packet with kind, pts_us, and payload (1.55ms)
✔ parseFramePacket: throws on packet with less than 9 bytes (0.41ms)
✔ translateCanvasToDevice: scales and clamps coordinates within device resolution (0.24ms)
✔ calculateViewportFit: preserves aspect ratio and calculates bezel dimensions (0.28ms)
✔ clampPanelWidth: clamps to specified min and max bounds (0.17ms)
✔ calcFps: counts frames in sliding time window (0.21ms)
✔ calcLatency: calculates delta between pending input and rendered frame (0.15ms)
✔ mirrorStateMachine: handles 6 lifecycle UI states and transitions (0.23ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
```
Status: **100% HIJAU (PASS)**

### 3.2 Type Checking & Build Produksi
- `./node_modules/.bin/tsc --noEmit`: **Exit code 0 (bersih tanpa error)**
- `npm run build`: **Berhasil (vite build selesai dalam ~5 detik)**
- Warning a11y: Semua komponen mirror bersih dari a11y warning (aria-label, keyboard handling, dan interactive semantics terpenuhi).

### 3.3 Ukuran Bundle & Cold Path Impact
- Chunk `DeviceMirrorPanel-*.js`: **19.61 kB** (gzip: **6.61 kB**)
- Chunk `DeviceMirrorPanel-*.css`: **10.80 kB** (gzip: **2.49 kB**)
- Karena menggunakan dynamic import (`$effect` saat `mirrorStore.isOpen`), chunk ini **tidak dieksekusi sama sekali pada saat cold start aplikasi**. Dampak terhadap startup time: **0 ms**.

### 3.4 Pengecekan Dukungan Codec Chromium (`VideoDecoder.isConfigSupported`)
Sesuai mandat task, pengecekan WebCodecs dilakukan secara nyata pada binary Chromium Playwright di server Linux:
```json
{
  "avc1.42001f": true,
  "avc1.4d001f": true,
  "avc1.64002a": true,
  "vp8": true,
  "vp09.00.10.08": true,
  "av01.0.04M.08": true,
  "hvc1.1.6.L93.B0": false
}
```
**Fakta:** Chromium Playwright di server ini **MENDUKUNG** decode H.264 Baseline, Main, dan High profile (`avc1.* = true`), VP8, VP9, dan AV1. Namun H.265/HEVC (`hvc1.*`) bernilai `false`.
*Catatan: Pembuktian decode H.264 di WKWebView (macOS) tetap akan divalidasi final pada task Mac oleh techlead.*

---

## 4. Manifest Bukti Visual (Screenshots)

Seluruh tangkapan layar preview telah disimpan di `docs/phase4/screens/` dan ditandai badge jelas `PREVIEW BROWSER — BUKAN APP`:

| File Screenshot | Resolusi | Deskripsi Verifikasi |
|---|---|---|
| `docs/phase4/screens/preview-p45-mirror-live.png` | 1440 × 900 | Jendela penuh IDE Petak dengan panel Device Mirror live di dock kanan, editor kosong di tengah, file tree di kiri, dan status bar |
| `docs/phase4/screens/preview-p45-mirror-with-agent-slot.png` | 1440 × 900 | Jendela penuh IDE Petak dengan layout multi-dock: Rail + File Tree + Editor + Slot Agent Fase 5 ("Claude Code") + Device Mirror |
| `docs/phase4/screens/preview-p45-mirror-view-only.png` | 1440 × 900 | Jendela penuh IDE Petak dalam mode View-Only (iOS) dengan banner pembatasan input dan navigasi bar tersembunyi |
| `docs/phase4/screens/preview-p45-state-empty.png` | 496 × 520 | State 1: Belum ada device ("No Device Selected" + CTA Select Device / Launch AVD) |
| `docs/phase4/screens/preview-p45-state-connecting.png` | 496 × 520 | State 2: Handshake scrcpy ("Starting scrcpy Server…" + spinner + CTA Cancel) |
| `docs/phase4/screens/preview-p45-state-live.png` | 496 × 520 | State 3: Live interactive stream + bezel + HUD FPS/latensi + punch-hole + nav bar |
| `docs/phase4/screens/preview-p45-state-disconnected.png` | 496 × 520 | State 4: Device dicabut (frame dimmed/grayscale + warning banner + Reconnect) |
| `docs/phase4/screens/preview-p45-state-error.png` | 496 × 520 | State 5: Handshake gagal / unauthorized (kotak error merah + diagnostik + Retry) |
| `docs/phase4/screens/preview-p45-state-view-only.png` | 496 × 520 | State 6: iOS View-Only (badge amber + notice touch disabled + iOS home line) |
| `docs/phase4/screens/preview-p45-states-all.png` | 1536 × 1064 | Komposit grid 2×3 merangkum seluruh 6 state lifecycle secara berdampingan |

---

## 5. Yang Perlu Diverifikasi Techlead di Mac
1. **WKWebView WebCodecs:** Verifikasi bahwa WKWebView di macOS Tahoe/Sequoia mendukung `VideoDecoder` untuk H.264 stream scrcpy secara native.
2. **Shortcut `Cmd+Shift+D`:** Konfirmasi shortcut keyboard macOS `⌘⇧D` membuka dan menutup panel mirror secara mulus.
3. **Penyempitan Editor:** Pastikan saat mirror dibuka bersama tab Logcat/Run, resize horizontal CodeMirror dan bottom panel terasa responsif (≤16ms).
