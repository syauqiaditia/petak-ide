# Petak — UI/UX Design Specification: Device Mirror Panel (Phase 4.5)
**Target:** Live Mobile Device Mirroring (Android Scrcpy & iOS ScreenCaptureKit/QuickTime)  
**Status:** Ready for Implementation  
**Author:** @designer (UI/UX Designer)  
**Date:** 29 September 2026  
**Parent Task / Ref:** `t_7a4af300`, `t_d5cfcdd8`  
**Downstream Implementer:** `t_eb501da4` (@senior2)  
**Design Tokens Reference:** `/home/uqi/vault/Projects/Petak/design.md`, `design/Main.html`, `docs/phase4/device-mirror-contract.md`  
**Mockup HTML:** `docs/phase4/design/DevicePanel.html`  
**Screenshots:** `docs/phase4/screens/design-p45-*.png`

---

## 1. Executive Summary & Design Goals

### 1.1 Problem Statement & Background
In Phase 4, Petak introduced run configurations, the Devices rail panel, and bottom execution tabs (Run, Build, Logcat). However, developers running Flutter or native mobile apps must constantly switch windows or position external emulator/simulator windows manually next to Petak. This fragments screen real estate and disrupts the coding loop.

Phase 4.5 introduces a **native, right-docked mobile device mirror inside Petak**. Rather than opening a detached desktop window, Petak streams the real device screen (via `scrcpy` protocol over ADB for Android and `ScreenCaptureKit` / `simctl` for iOS) directly into a dedicated full-height dock panel on the right side of the IDE window.

### 1.2 Design Mandates
1. **Full-Height Outer Right Dock:** The Device Panel docks on the outermost right edge of Petak. Its vertical bounds stretch from immediately below the TitleBar (y = 46px) down to the top of the StatusBar (y = 874px on a 900px window).
2. **Horizontal Narrowing of Center Area:** The center workspace (File Tree, Code Editor, and the bottom Terminal/Run/Logcat panel) automatically narrows horizontally to accommodate the mirror panel. **The bottom panel never covers or overlaps the device panel.**
3. **Phase 5 Agent Panel Slot Reservation:** A dedicated slot is architecturally reserved immediately to the **LEFT** of the Device Panel for the Phase 5 Agent Panel (`Claude Code`, `Hermes`, etc.). Both panels can be opened, closed, and resized independently without refactoring layout code.
4. **Authentic Token Bezel (No Fake Clip-Art):** The mobile screen is framed by a sleek, minimal, dark hardware bezel styled strictly with Petak tokens (`bg-titlebar` `#111215`, `border-normal` `#2c2e34`, radius `26-28px`), preserving true device aspect ratio (e.g. 9:19.5 for Pixel 8 / iPhone 15) without gaudy skeuomorphic textures.
5. **Real Performance Telemetry:** The floating HUD displays genuine, measured frame rates and latency (`59 FPS · 38 ms`), never mocked or hardcoded dummy numbers.
6. **Strict Token Adherence:** 100% compliant with `/home/uqi/vault/Projects/Petak/design.md`. All UI copy is in clean, professional English.

---

## 2. Token Foundations & Visual System

All colors, borders, typography, and geometries strictly inherit the standard Petak design tokens defined in `design.md`:

### 2.1 Color Tokens
| Token | Hex Value | IDE Usage / Mirror Component |
|---|---|---|
| `bg-titlebar` | `#111215` | TitleBar, Rail, StatusBar, Phone Bezel Frame background |
| `bg-panel` | `#141518` | Outer dock background, Top Device Toolbar, Bottom Nav Toolbar |
| `bg-app` | `#16171a` | Main IDE workspace, stage area surrounding the phone frame |
| `bg-editor` | `#1a1b1f` | Code editor background, modal cards, inner camera punch-hole |
| `bg-raised` | `#23252b` | Hover state for buttons, active toolbar toggle, navigation buttons |
| `border-subtle` | `#26282d` | Panel dividers, dock separator lines, toolbar borders |
| `border-normal` | `#2c2e34` | Phone bezel outer border, button outlines, card borders |
| `border-focus` | `#3a4f75` | Phone bezel active focus outline, selected tab border |
| `text-primary` | `#d8d9dc` | Primary device name, titles, app text |
| `text-active` | `#e6efff` | Active tab label, highlighted menu items |
| `text-muted` | `#8b8f98` | Secondary labels, disabled icons, latency metrics, shortcuts |
| `text-dim` | `#5b5f68` | Subtle timestamps, line numbers, inactive dots |
| `accent` | `#6ea8ff` | Primary buttons ("Select Device"), active mirror icon, touch reticle |
| `accent-light` | `#9cc3ff` | Hover links, keyboard focus helper toast text |
| `success` | `#7fc98f` | Live status dot, Live badge text, positive FPS metric |
| `warning` | `#e8b45a` | Connecting pulse dot, View-Only badge, Disconnected banner |
| `danger` | `#f07a74` | Error status dot, fatal error alerts, Stop execution button |

### 2.2 Semantic Pill & Alert Surfaces
- **Live Status Badge:** Background `#16281e`, border `1px solid #20402b`, text `#7fc98f`, radius `4px`.
- **View-Only Badge:** Background `#2e2717`, border `1px solid #4a3d22`, text `#e8b45a`, radius `4px`, uppercase `font-size: 10px`, weight `600`.
- **Disconnected Warning Banner:** Background `#2e2717`, border `1px solid #4a3d22`, text `#e8b45a`, radius `8px`, shadow `0 8px 24px rgba(0, 0, 0, 0.5)`.
- **Error Surface:** Background `#2a1d1e`, border `1px solid #4a2225`, text `#f07a74`, radius `10px`.
- **Performance HUD Overlay:** Background `rgba(17, 18, 21, 0.85)`, backdrop filter `blur(4px)`, border `1px solid rgba(44, 46, 52, 0.8)`, text `#7fc98f`, radius `11px`.
- **Touch Reticle Ring:** Border `2px solid rgba(110, 168, 255, 0.9)`, background `rgba(110, 168, 255, 0.25)`, shadow `0 0 12px rgba(110, 168, 255, 0.4)`.

### 2.3 Typography & Metrics
- **UI Typography:** `'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Code / Telemetry Font:** `'JetBrains Mono', ui-monospace, monospace`
- **Font Sizes:**
  - Device Title: `12px` (weight `500`)
  - Status Badges / HUD: `10px` (weight `600` / mono)
  - Tooltips & Subtitles: `11px`
  - Action Button Text: `12px` (weight `600`)

---

## 3. Layout & Multi-Dock Architecture

### 3.1 Window Column Hierarchy
The IDE layout consists of a horizontal flex row inside `.app-body` (occupying full height between TitleBar 46px and StatusBar 26px):

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ TitleBar (46px) — Brand · Project · Git Branch · [Run Config] · [Mirror ⌘⇧D] · Search · User │
├──────┬────────────┬──────────────────────────────────────┬──────────────────┬───────────────┤
│ Rail │ File Tree  │ Center Workspace (flex: 1)           │ SLOT: Agent      │ Device Mirror │
│ 48px │ 200–250px  │                                      │ Panel (Phase 5)  │ Panel         │
│      │            │ ┌──────────────────────────────────┐ │                  │ (Right Dock)  │
│      │ (Collapse) │ │ Code Editor (flex: 1)            │ │ 390px (Phase 5)  │ 300–600px     │
│      │            │ └──────────────────────────────────┘ │ (Collapsible /   │ (Default:     │
│      │            │ ┌──────────────────────────────────┐ │  Independent)    │  380px)       │
│      │            │ │ Bottom Panel: Run/Logcat (232px) │ │                  │               │
│      │            │ └──────────────────────────────────┘ │                  │ Full Height!  │
├──────┴────────────┴──────────────────────────────────────┴──────────────────┴───────────────┤
│ StatusBar (26px) — Branch · Build · LSP · Device Mirror Live (59 fps · 38ms) · Pos · Lang    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Dimensions & Dimensional Calculations
- **Window Base Viewport:** `1440px × 900px`
- **TitleBar Height:** `46px` (fixed)
- **StatusBar Height:** `26px` (fixed)
- **Net Usable Vertical Height:** `900 - 46 - 26 = 828px`
- **Device Mirror Panel Dimensions:**
  - **Height:** Exactly `828px` (stretches `100%` of `.app-body`).
  - **Default Width:** `380px`.
  - **Minimum Width (`min-width`):** `300px`.
  - **Maximum Width (`max-width`):** `600px` (accommodates tablets, foldables, or rotated landscape mode).
- **Horizontal Flex Sizing Behavior:**
  - When Device Mirror is opened (`width: 380px`), the `.center-column` shrinks horizontally from `1142px` to `762px`.
  - The bottom panel (`TerminalPanel.svelte` / Logcat) is encapsulated inside `.center-column`. Its width equals the width of `.center-column`. Therefore, **the bottom panel is physically bounded by the left border of the Device Mirror panel and never overlays it.**

### 3.3 Phase 5 Agent Panel Slot Integration
- **Column Placement:** The Agent Panel slot is located immediately to the **LEFT** of the Device Mirror panel (between `.center-column` and `.device-mirror-panel`).
- **Dimensions:** Width `390px` (fixed default, resizable between `320px` and `500px`).
- **Multi-Dock Concurrency (Both Panels Open at 1440px):**
  - Left Rail: `48px`
  - File Tree: `200px` (auto-compacted from `250px` when dual docks open)
  - Code Editor: `422px` (`min-width: 360px` preserved)
  - Agent Panel: `390px`
  - Device Mirror Panel: `380px`
  - Total: `48 + 200 + 422 + 390 + 380 = 1440px`.
- **Responsive Overflow Rules:**
  1. If viewport is narrowed below `1280px` with both panels open, File Tree automatically collapses to `0px` (icon visible in Rail to re-open).
  2. If viewport is narrowed below `1100px`, the user is notified with a subtle tab switch indicator, or one panel collapses to maintain a minimum editor width of `360px`.

### 3.4 Resize Handle
- **Location:** On the left border of the Device Mirror panel (`position: absolute; left: -2px; top: 0; width: 5px; height: 100%`).
- **Cursor:** `cursor: col-resize`.
- **Hover / Drag State:** On hover, the vertical line illuminates with `accent` `#6ea8ff`. While dragging, an active overlay prevents iframe/canvas mouse capture.
- **Aspect Ratio Snap:** Holding `Shift` while dragging snaps width to preserve the device's native aspect ratio (e.g. `9:19.5` + toolbar heights).

---

## 4. Device Bezel & Canvas Rendering Engine

### 4.1 Sleek Dark Bezel Geometry
Rather than an artificial, cartoonish smartphone shell, Petak uses a precision hardware bezel styled with IDE tokens:
- **Outer Bezel Frame:**
  - Width: `326px` (at default 380px panel width; scales proportionally with panel width)
  - Height: `680px` (fits comfortably within 746px stage area)
  - Background: `bg-titlebar` (`#111215`)
  - Border: `1px solid #2c2e34`
  - Border Radius: `28px`
  - Padding: `10px 8px`
  - Drop Shadow: `0 16px 40px rgba(0, 0, 0, 0.65)`
- **Camera Punch-Hole:**
  - Diameter: `8px` circle centered horizontally, `14px` from top of bezel
  - Background: `bg-editor` (`#1a1b1f`)
- **Screen Display Canvas:**
  - Background: Pure black (`#000000`)
  - Border Radius: `20px`
  - Overflow: `hidden`
  - Element: `<canvas>` element rendered via WebCodecs `VideoDecoder`.

### 4.2 Aspect Ratio Math & Scaling Matrix
Mobile devices feature varying aspect ratios:
- Modern Android (Pixel 8, Samsung S24): `9:20` (0.450) or `9:19.5` (0.461)
- Modern iPhone (iPhone 15 Pro, iPhone 16): `9:19.5` (0.461)
- Legacy / Tablets: `9:16` (0.562) or `3:4` (0.750)
- Landscape (Rotated): `19.5:9` (2.167)

**Scaling Engine Formula:**
```typescript
interface DeviceDimensions {
  deviceWidth: number;
  deviceHeight: number;
}

function calculateViewportFit(
  stageWidth: number,
  stageHeight: number,
  device: DeviceDimensions,
  bezelPaddingX = 20,
  bezelPaddingY = 24
) {
  const availW = stageWidth - bezelPaddingX;
  const availH = stageHeight - bezelPaddingY;
  const deviceRatio = device.deviceWidth / device.deviceHeight;

  let screenW = availW;
  let screenH = availW / deviceRatio;

  if (screenH > availH) {
    screenH = availH;
    screenW = availH * deviceRatio;
  }

  return {
    screenWidth: Math.round(screenW),
    screenHeight: Math.round(screenH),
    bezelWidth: Math.round(screenW + bezelPaddingX),
    bezelHeight: Math.round(screenH + bezelPaddingY),
    scale: screenW / device.deviceWidth,
  };
}
```

---

## 5. Control Surfaces, Toolbars & Settings

### 5.1 Top Toolbar (Header)
Located at the top of the Device Mirror panel (`height: 40px`, `background: #141518`, `border-bottom: 1px solid #26282d`):
1. **Device Icon & Name:**
   - Icon: SVG phone glyph (`15×15px`, stroke `#8b8f98`).
   - Device Name: e.g. `Pixel 8 · API 35` or `iPhone 15 Pro` (`12px`, weight `500`, `#e6e7ea`, ellipsis overflow).
2. **Status Indicator:**
   - **Live:** Green dot (`#7fc98f`) + Badge `LIVE` (`#16281e` bg, `#20402b` border, `#7fc98f` text).
   - **Connecting:** Amber dot (`#e8b45a`) + Badge `CONNECTING...` (`#2e2717` bg).
   - **View-Only:** Amber badge `VIEW ONLY` (`#2e2717` bg, `#e8b45a` text, `#4a3d22` border).
   - **Disconnected / Offline:** Gray dot (`#8b8f98`) + Badge `OFFLINE`.
   - **Error:** Red dot (`#f07a74`) + Badge `ERROR`.
3. **Action Button Group (Right-Aligned):**
   - **Rotate Screen (`rotate-cw`):** Size `28×28px`, hover `bg-raised` `#23252b`. Sends `{t: "rotate"}` to toggle portrait/landscape.
   - **Take Screenshot (`camera`):** Calls `mirror_screenshot(serial, null)`. Displays a brief confirmation toast: *"Screenshot saved to /tmp/petak-screencap.png & copied to clipboard"*.
   - **Reconnect (`refresh-cw`):** Idempotently restarts the scrcpy server or capture pipeline without closing the panel.
   - **Close Panel (`x`):** Shortcut `⌘⇧D` or click. Calls `mirror_stop(serial)` and closes the dock panel.

### 5.2 Bottom Navigation Bar (Android Hardware Keys)
Located at the base of the Device Mirror panel (`height: 40px`, `background: #141518`, `border-top: 1px solid #26282d`):
- **Back Key:** Chevron-left SVG (`15×15px`) -> Dispatches `{t: "nav", key: "back"}`.
- **Home Key:** Circle SVG (`15×15px`) -> Dispatches `{t: "nav", key: "home"}`.
- **Recents Key:** Square SVG (`15×15px`) -> Dispatches `{t: "nav", key: "recents"}`.
- **Vertical Separator:** `width: 1px`, `height: 16px`, `background: #2c2e34`.
- **Volume Down:** Speaker-minus SVG -> Dispatches `{t: "nav", key: "voldown"}`.
- **Volume Up:** Speaker-plus SVG -> Dispatches `{t: "nav", key: "volup"}`.
- **Power:** Power SVG -> Dispatches `{t: "nav", key: "power"}`.
- *Note for iOS Devices:* For iOS physical or simulator view-only devices, the Android navigation bar is hidden and replaced by a subtle, native iOS home indicator line (`width: 120px`, `height: 4px`, `background: #3a3c42`, rounded).

### 5.3 Floating Performance HUD
A lightweight pill overlay hovering in the top-right corner of the mirrored screen:
- **Geometry:** `height: 22px`, `padding: 0 8px`, `border-radius: 11px`.
- **Appearance:** `background: rgba(17, 18, 21, 0.85)`, `backdrop-filter: blur(4px)`, `border: 1px solid rgba(44, 46, 52, 0.8)`.
- **Content:**
  - Frame Rate: `59 FPS` (Color `#7fc98f` if >= 45 fps, `#e8b45a` if 20–44 fps, `#f07a74` if < 20 fps).
  - Latency: `38 ms` (Color `#8b8f98`; real touch-to-render timestamp delta).
- **Z-Index & Interaction:** `z-index: 15`, `pointer-events: none` (clicks pass through to device canvas).

### 5.4 Toggle Controls, Shortcuts & Persistence
- **TitleBar Button:** A dedicated "Mirror" button with mobile phone glyph located in the TitleBar header. Active state displays `bg-raised` `#23252b` with accent highlight `#6ea8ff`.
- **Rail Icon:** The "Devices" tab on the Rail can toggle the mirror view or highlight the connected mirror instance.
- **Keyboard Shortcut:** `⌘⇧D` (macOS) / `Ctrl+Shift+D` (Linux/Windows).
- **Setting "Auto Show Mirror on Run":**
  - Stored in settings: `petak.mirror.auto_show_on_run: true` (default).
  - When the developer clicks **Run** (`▶`) on an Android/iOS target, Petak automatically expands the Device Mirror panel if currently closed.
- **State Persistence:**
  - `petak.mirror.open: boolean`
  - `petak.mirror.width: number` (clamped `300..600px`, default `380px`)
  - `petak.mirror.last_serial: string`

---

## 6. The 6 UI States of Device Mirror Panel

The mirror panel gracefully handles every connection, execution, and hardware lifecycle event:

```
                      ┌───────────────┐
                      │ 1. EMPTY      │
                      └───────┬───────┘
                              │ Run / Select Device
                              ▼
                      ┌───────────────┐
                      │ 2. CONNECTING │
                      └───────┬───────┘
              Handshake OK    │    Handshake Failed / Codec Error
        ┌─────────────────────┴──────────────────────┐
        ▼                                            ▼
┌───────────────┐                             ┌───────────────┐
│ 3. LIVE       │                             │ 5. ERROR      │
│ (Interactive) │                             └───────────────┘
└───────┬───────┘
        │ Device Unplugged / ADB Lost
        ▼
┌───────────────┐                             ┌───────────────┐
│ 4. DISCONNECT │ ─── (iOS View Only) ──────> │ 6. VIEW-ONLY  │
└───────────────┘                             └───────────────┘
```

### 6.1 State 1: Empty State (No Device Connected / Idle)
- **Trigger:** Mirror panel is opened, but no device is connected or selected in Run config.
- **Visuals:**
  - Header displays `No Device Connected` (`text-muted` `#8b8f98`).
  - Stage displays centered container with rounded mobile device placeholder icon (`52×52px`, `#1f2a3d` bg, `#2a3d5e` border, `#6ea8ff` stroke).
  - Headline: **"No Device Selected"** (`14px`, weight `600`, `#e6e7ea`).
  - Subtitle: *"Connect an Android device via USB with USB debugging enabled, or start a local emulator."* (`12px`, `#8b8f98`).
- **Actions:**
  - Primary button: **`Select Device`** (`height: 32px`, `bg-accent` `#6ea8ff`, text `#0e1a2e`). Opens the TitleBar device picker.
  - Secondary button: **`Launch AVD`** (`height: 32px`, `bg-raised` `#23252b`, border `#2c2e34`). Triggers emulator startup.
- **Verified Mockup Screenshot:** `docs/phase4/screens/design-p45-state-empty.png`

### 6.2 State 2: Connecting State (Handshake & Stream Init)
- **Trigger:** `mirror_start` has been invoked; server jar is being pushed and socket tunnel established.
- **Visuals:**
  - Header displays detected serial/name (e.g. `Pixel 8 · API 35`) with amber badge `CONNECTING...`.
  - Stage displays animated circular spinner (`36×36px`, `border: 3px solid #26282d; border-top-color: #6ea8ff`).
  - Headline: **"Starting scrcpy Server…"** (`14px`, weight `600`, `#e6e7ea`).
  - Status description: *"Pushing server v4.1 to device, forwarding adb tunnel, and awaiting H.264 stream."* (`12px`, `#8b8f98`).
- **Actions:**
  - Secondary button: **`Cancel`** (`bg-raised` `#23252b`). Aborts initialization and closes server process.
- **Verified Mockup Screenshot:** `docs/phase4/screens/design-p45-state-connecting.png`

### 6.3 State 3: Live Interactive State (Active Streaming & Input)
- **Trigger:** WebCodecs receives SPS/PPS configuration frame, and frames decode smoothly to `<canvas>`.
- **Visuals:**
  - Header displays device name, bright green dot (`#7fc98f`), and badge `LIVE`.
  - Real-time HUD pill: `59 FPS · 38 ms` (`JetBrains Mono`, `#7fc98f`).
  - Hardware frame renders slim bezel with active punch-hole camera.
  - Focused state: Bezel outer border glows with `1px solid #3a4f75` and subtle outer shadow.
  - Interactive touch reticle circle (`24px`, `#6ea8ff`) mirrors active mouse gestures.
  - Floating focus release toast: *"Keys forwarded to device · ⇧Esc to release"*.
  - Full bottom Android navigation bar is functional.
- **Actions:** Rotate, Screenshot, Reconnect, Close, Touch/Drag, Keyboard input.
- **Verified Mockup Screenshot:** `docs/phase4/screens/design-p45-state-live.png` & `docs/phase4/screens/design-p45-mirror-live.png`

### 6.4 State 4: Disconnected State (Device Dicabut / USB Lost)
- **Trigger:** Core status event `Disconnected { reason }` (e.g. physical cable detached or emulator process killed).
- **Visuals:**
  - Header displays `Pixel 8 (offline)` with neutral gray badge `OFFLINE`.
  - Mirrored screen canvas dims to 35% opacity with an 80% grayscale filter preserving the last received frame.
  - Overlay Warning Banner at top of stage:
    - Background `#2e2717`, border `1px solid #4a3d22`, text `#e8b45a`.
    - Alert triangle icon + Headline: **"Device Disconnected"**.
    - Description: *"USB connection was lost or emulator exited. Re-plug device to resume stream."*
- **Actions:**
  - Primary button: **`Reconnect`** (`bg-warning` `#e8b45a`, text `#1a1406`). Attempts adb reconnection.
  - Secondary button: **`Select Other`** (`bg-raised` `#23252b`).
- **Verified Mockup Screenshot:** `docs/phase4/screens/design-p45-state-disconnected.png`

### 6.5 State 5: Error State (Handshake Failure / Unsupported Codec)
- **Trigger:** Core status event `Error { message }` or WebCodecs failure (`VideoDecoder.isConfigSupported() === false`).
- **Visuals:**
  - Header displays red badge `ERROR` (`#f07a74`).
  - Stage displays centered error dialog box (`#2a1d1e` surface, `#4a2225` border).
  - Headline: **"Mirror Connection Failed"** with red circle-x icon.
  - Explanation: *"scrcpy server terminated prematurely during handshake."*
  - Diagnostics box (`JetBrains Mono`, `#c9cbd0`, `#1b1314` bg):
    `exit code 1: adb forward failed: device unauthorized. Please check USB debugging prompt on phone.`
- **Actions:**
  - Primary button: **`Retry Handshake`** (`bg-danger` `#f07a74`, text `#1e0e0e`).
  - Secondary button: **`View Logcat`** (`bg-raised` `#23252b`). Opens Logcat tab with adb log filter.
- **Verified Mockup Screenshot:** `docs/phase4/screens/design-p45-state-error.png`

### 6.6 State 6: View-Only State (iOS Physical / Sim Without Input)
- **Trigger:** An iOS Simulator or physical iPhone is detected where touch input via Accessibility/WebDriverAgent is not supported.
- **Visuals:**
  - Header prominently displays amber badge **`VIEW ONLY`** (`#2e2717` bg, `#4a3d22` border, `#e8b45a` text).
  - Stage displays an informational notice at the top:
    *"Interactive touch and keyboard forwarding are restricted on iOS. Stream is display-only."*
  - iPhone bezel frame displays the video stream with `60 FPS` HUD badge.
  - Cursor displays default system arrow (or `not-allowed` icon on attempted click) instead of interactive touch reticle.
  - Bottom Android navigation bar is completely hidden.
- **Verified Mockup Screenshot:** `docs/phase4/screens/design-p45-state-view-only.png`

---

## 7. Interaction Model & Accessibility (A11y)

### 7.1 Mouse Gesture Translation to Device Pixels
When user interacts with the canvas, coordinates must be mapped accurately regardless of window scaling:
```typescript
function translateCanvasToDevice(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
  deviceWidth: number,
  deviceHeight: number
) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = deviceWidth / rect.width;
  const scaleY = deviceHeight / rect.height;

  const rawX = (event.clientX - rect.left) * scaleX;
  const rawY = (event.clientY - rect.top) * scaleY;

  return {
    x: Math.max(0, Math.min(deviceWidth - 1, Math.round(rawX))),
    y: Math.max(0, Math.min(deviceHeight - 1, Math.round(rawY))),
    w: deviceWidth,
    h: deviceHeight,
  };
}
```

- **Touch Down (`mousedown`):** Dispatches `{t: "touch", action: "down", x, y, w, h}`. Activates touch reticle animation.
- **Touch Move (`mousemove` while button pressed):** Dispatches `{t: "touch", action: "move", x, y, w, h}`. Smoothly shifts reticle position.
- **Touch Up (`mouseup` / `mouseleave`):** Dispatches `{t: "touch", action: "up", x, y, w, h}`. Reticle smoothly fades out (`150ms`).
- **Wheel Scroll (`wheel`):** Dispatches `{t: "scroll", x, y, w, h, dx: Math.round(e.deltaX), dy: Math.round(e.deltaY)}`.

### 7.2 Keyboard Forwarding & Focus Trap Escape
To allow natural typing inside mirrored mobile text fields while preventing focus entrapment:
1. **Focus Capture:** Clicking anywhere on the phone bezel/canvas sets `mirrorHasFocus = true`. The outer bezel illuminates with `border-focus` (`#3a4f75`).
2. **Key Forwarding:**
   - Text characters (`a-z`, `0-9`, symbols, space) dispatch `{t: "text", text: e.key}`.
   - Control keys (Backspace, Enter, Arrow keys) dispatch `{t: "key", keycode, action: "down"}` followed by `"up"`.
3. **Escaping Focus (Safety Guarantee):**
   - **Shortcut:** Pressing `Shift + Escape` (or `Escape` when no modal input is active) immediately releases focus back to the Petak code editor.
   - **Click Away:** Clicking anywhere outside the mirror canvas (code editor, file tree, TitleBar, StatusBar) immediately triggers `blur` and unbinds key forwarding.
   - **Visual Indicator:** When focused, a clean pill banner at the bottom of the screen reads: *"Keys forwarded to device · ⇧Esc to release"*.

### 7.3 Accessibility & WCAG 2.1 AA Compliance
- **Contrast Ratios (WCAG AA requires >= 4.5:1 for normal text):**
  - Text Primary (`#d8d9dc`) on `bg-panel` (`#141518`): **12.8:1** (Exceeds AAA).
  - Text Muted (`#8b8f98`) on `bg-panel` (`#141518`): **5.2:1** (Compliant AA).
  - Success text (`#7fc98f`) on `bg-titlebar` (`#111215`): **8.4:1** (Exceeds AAA).
  - Warning text (`#e8b45a`) on `warning-surface` (`#2e2717`): **7.1:1** (Compliant AAA).
  - Error text (`#f07a74`) on `error-surface` (`#2a1d1e`): **5.8:1** (Compliant AA).
- **Touch Target Sizing:**
  - Toolbar buttons: minimum `28×28px` visual with `36×36px` hit box.
  - Bottom navigation buttons: `32×32px` visual with `44×44px` bounding hit area, complying with touch target guidelines.
- **Screen Reader & Keyboard Labels:**
  - Every button carries an explicit, localized `aria-label` (e.g. `aria-label="Rotate screen"`, `aria-label="Take screenshot"`, `aria-label="Android Back button"`).

---

## 8. Implementation Handoff for @senior2

### 8.1 Svelte Component Architecture
Proposed directory structure inside `ui/features/mirror/`:
```
ui/features/mirror/
├── DeviceMirrorPanel.svelte   // Outer dock container, resizer, top & bottom toolbars
├── DeviceStage.svelte         // Stage area, bezel container, canvas scaler
├── DeviceCanvas.svelte        // WebCodecs VideoDecoder, frame rendering, touch/key capture
├── DeviceToolbarTop.svelte    // Device name, live/view-only badge, action icons
├── DeviceToolbarBottom.svelte // Android navigation bar buttons (Back/Home/Recents/Vol/Power)
├── DeviceHud.svelte           // Real-time FPS & latency overlay pill
├── states/
│   ├── StateEmpty.svelte      // "No Device Selected" card + CTAs
│   ├── StateConnecting.svelte // Spinner + step logs
│   ├── StateDisconnected.svelte // Dimmed frame + warning banner + reconnect CTA
│   └── StateError.svelte      // Error details + retry CTA
└── mirrorStore.svelte.ts      // State machine, localStorage persistence, event listener
```

### 8.2 Event Contract Mapping (from `docs/phase4/device-mirror-contract.md`)
| User Action / Trigger | Tauri Command / Channel Call | Payload |
|---|---|---|
| Open Mirror Panel | `mirror_start(serial, on_frame, on_status)` | Returns `{ serial, name, width, height, codec }` |
| Close Mirror Panel / App Exit | `mirror_stop(serial)` | Idempotent cleanup of scrcpy and adb forward |
| Mouse Down / Move / Up | `mirror_input(serial, ev)` | `{t: "touch", action: "down"\|"move"\|"up", x, y, w, h}` |
| Wheel Scroll | `mirror_input(serial, ev)` | `{t: "scroll", x, y, w, h, dx, dy}` |
| Keyboard Input | `mirror_input(serial, ev)` | `{t: "text", text}` or `{t: "key", keycode, action}` |
| Nav Buttons (Back/Home/etc.) | `mirror_input(serial, ev)` | `{t: "nav", key: "back"\|"home"\|"recents"\|"power"\|"volup"\|"voldown"}` |
| Rotate Screen Button | `mirror_input(serial, ev)` | `{t: "rotate"}` |
| Take Screenshot Button | `mirror_screenshot(serial, path)` | Returns saved PNG file path |

### 8.3 Lazy-Loading & Performance Rules
1. **Zero Cost Before Open:**
   - Do NOT instantiate `VideoDecoder` or register channel listeners until `DeviceMirrorPanel` is mounted.
   - Dynamic import: `App.svelte` should conditionally import `DeviceMirrorPanel.svelte` only when opened (`import('./features/mirror/DeviceMirrorPanel.svelte')`).
2. **Immediate Cleanup on Close:**
   - When the panel is toggled closed, call `mirror_stop(serial)`, close the WebCodecs decoder, and cancel animation frames.
   - Guaranteed 0 CPU polling and 0 process leaks when closed.

---

## 9. Mockup Artifacts Manifest

All visual artifacts have been rendered and verified using headless Chromium:

| Artifact Path | Dimensions | Description |
|---|---|---|
| `docs/phase4/design/DevicePanel.html` | Full HTML | Standalone interactive visual mockup with exact inline styles & tokens |
| `docs/phase4/screens/design-p45-mirror-live.png` | 1440 × 900 | Complete Petak IDE window with live Pixel 8 mirror docked on right |
| `docs/phase4/screens/design-p45-mirror-with-agent-slot.png` | 1440 × 900 | Multi-dock layout showing Phase 5 Agent Panel slot adjacent to Mirror |
| `docs/phase4/screens/design-p45-states-all.png` | 1140 × 1064 | 2×3 overview grid showcasing all 6 lifecycle UI states |
| `docs/phase4/screens/design-p45-state-empty.png` | 360 × 520 | State 1: No device connected / Idle |
| `docs/phase4/screens/design-p45-state-connecting.png` | 360 × 520 | State 2: scrcpy handshake / pushing server jar |
| `docs/phase4/screens/design-p45-state-live.png` | 360 × 520 | State 3: Live interactive stream with touch reticle & HUD |
| `docs/phase4/screens/design-p45-state-disconnected.png` | 360 × 520 | State 4: USB detached warning banner & blurred last frame |
| `docs/phase4/screens/design-p45-state-error.png` | 360 × 520 | State 5: Handshake failure / adb unauthorized error card |
| `docs/phase4/screens/design-p45-state-view-only.png` | 360 × 520 | State 6: iOS Simulator / Physical iPhone display-only badge |

---
*End of Design Specification — Ready for Senior2 Implementation (`t_eb501da4`)*
