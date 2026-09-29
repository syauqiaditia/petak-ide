# Device Mirror Implementation Report (Phase 4.5)

**Task**: `t_bc34c961` — Mirror Core Implementation (Android scrcpy backend)  
**Branch**: `wt/t_bc34c961` (base: `feat/phase4-run`)  
**Date**: September 29, 2026  
**Author**: Muhammad Syauqi (`muhammad.syauqi@ist.id`)  

---

## 1. Overview & Architecture

Modul `mirror` diimplementasikan di `petak-core` (`crates/core/src/mirror/`) untuk menyediakan mirror live device Android via **scrcpy v4.1** server jar tanpa dependensi eksternal berat (ponytail discipline: pure Rust standard library — `TcpStream`, `mpsc`, threads).

### Architecture Diagram

```
Frontend (Tauri WebView)
   │  ▲
   │  │  Channel (binary [kind 1B][pts 8B][H.264 data])
   ▼  │
crates/app (Thin Adapter)
   │  - mirror_start(serial, max_size, channel)
   │  - mirror_stop()
   │  - mirror_input(event)
   │  - mirror_screenshot(serial, path?)
   ▼
crates/core::mirror
   ├── session.rs    ── MirrorSession lifecycle, frame reader thread, control writer
   ├── protocol.rs   ── scrcpy v4.1 binary protocol parser (codec meta, session meta, frame packets)
   ├── control.rs    ── InputEvent serialization (Touch, Scroll, Key, Nav, Rotate)
   └── server.rs     ── scrcpy-server push, adb forward tcp:0, process spawn & cleanup
         │
         ▼
      adb daemon ──► Android Device (emulator-5554 / real device)
                     └── scrcpy-server-v4.1.jar (app_process)
```

---

## 2. Protocol Details (scrcpy v4.1 Verified)

Melalui inspeksi bytecode DEX `scrcpy-server-v4.1` dan verifikasi live terhadap emulator, protokol v4.1 bekerja sbb:

### Video Stream (`send_stream_meta=true`, `send_frame_meta=true`, `send_device_meta=false`)

1. **Codec Header (4 bytes)**:
   - `0x68323634` = `"h264"` (ASCII)
2. **Initial Session Meta (12 bytes)**:
   - `flags` (4B BE): `0x80000000` (initial session)
   - `width` (4B BE): e.g. `864` (downscaled from 1080)
   - `height` (4B BE): e.g. `1920` (downscaled from 2400)
3. **Frame Packets (12-byte header + payload)**:
   - `pts_raw` (8B BE):
     - **Bit 63**: `PACKET_FLAG_SESSION` (orientation change: payload berisi `[width 4B][height 4B]`)
     - **Bit 62**: `PACKET_FLAG_CONFIG` (SPS/PPS Annex-B NAL unit, e.g. `00 00 00 01 67`)
     - **Bit 61**: `PACKET_FLAG_KEY_FRAME` (IDR Slice, e.g. `00 00 00 01 65`)
     - **Bits 0..60**: PTS (presentation timestamp) dalam microsecond
   - `packet_size` (4B BE): ukuran payload bytes
   - `payload`: H.264 Annex-B NAL stream (`00 00 00 01 ...`)

### Contract Binary Output (dikirim ke Channel UI / stdout)

```
[u8 kind: 0=config, 1=key, 2=delta] [u64be pts_us] [payload H.264 bytes]
```

### Control Socket (Input Serialization)

- **Touch**: `type=2` (28 bytes) — action (DOWN/MOVE/UP), pointer_id, x, y, width, height, pressure
- **Scroll**: `type=3` (21 bytes) — x, y, width, height, h_scroll, v_scroll, buttons
- **Keycode**: `type=0` (14 bytes) — action (DOWN/UP), keycode, repeat, metastate
- **Nav**: `type=0` (AKEYCODE_BACK=4, HOME=3, APP_SWITCH=187, POWER=26, VOLUME_UP=24, VOLUME_DOWN=25)
- **Rotate**: `type=11` (1 byte) — `TYPE_ROTATE_DEVICE`

---

## 3. Real Evidence & Verification

Semua pengujian dijalankan terhadap **real emulator Android** (`emulator-5554`, AVD `jatim_dev`, Android 15, x86_64, resolution 1080x2400 downscaled to 864x1920).

### A. Unit Tests (RED ➔ GREEN)

```
$ cargo test -p petak-core -- mirror
running 19 tests
test mirror::control::tests::test_input_event_json_roundtrip ... ok
test mirror::control::tests::test_input_event_json_parse ... ok
test mirror::control::tests::test_serialize_keycode ... ok
test mirror::control::tests::test_serialize_nav_home ... ok
test mirror::control::tests::test_serialize_rotate ... ok
test mirror::control::tests::test_serialize_scroll ... ok
test mirror::control::tests::test_serialize_touch_down ... ok
test mirror::control::tests::test_serialize_touch_up_zero_pressure ... ok
test mirror::control::tests::test_serialize_text ... ok
test mirror::protocol::tests::test_encode_frame_packet ... ok
test mirror::protocol::tests::test_read_codec_meta ... ok
test mirror::control::tests::test_serialize_nav_back ... ok
test mirror::protocol::tests::test_read_multiple_packets ... ok
test mirror::protocol::tests::test_read_video_packet_config ... ok
test mirror::protocol::tests::test_read_video_packet_delta ... ok
test mirror::protocol::tests::test_read_video_packet_eof ... ok
test mirror::protocol::tests::test_read_video_packet_key ... ok
test mirror::server::tests::test_resolve_server_jar ... ok
test mirror::server::tests::test_scid_format ... ok

test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 131 filtered out
```

### B. Integration Tests (`crates/core/tests/mirror_e2e.rs`)

```
$ cargo test -p petak-core --test mirror_e2e -- --ignored --test-threads=1
running 4 tests
test test_mirror_screenshot ... ok
test test_mirror_session_inject_input ... ok
test test_mirror_session_lifecycle ... ok
test test_mirror_session_video_frames ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 7.46s
```

### C. Live Video Frame Packet Capture (Emulator)

```
Codec: h264
Session meta: flags=0x80000000, 864x1920
Packet 0: session=0 config=1 key=0 pts=0 size=32 payload_head=000000016742c02a (SPS)
Packet 1: session=0 config=0 key=1 pts=912027321 size=35360 payload_head=0000000165b80004 (IDR Keyframe)
Packet 2: session=0 config=0 key=0 pts=912057610 size=423 payload_head=0000000161e00020 (Delta frame)
Packet 3: session=0 config=0 key=0 pts=912157610 size=311 payload_head=0000000161e00040 (Delta frame)
Packet 4: session=0 config=0 key=0 pts=912257610 size=482 payload_head=0000000161e00060 (Delta frame)
```

### D. Screenshot Proof

- `take_screenshot` via `adb exec-out screencap -p` menghasilkan file PNG valid (~1.2 MB untuk 1080x2400) dengan header magic `\x89PNG`.

---

## 4. Binary Size Delta Measurement

Diukur pada `release` profile (`cargo build -p petak-core --release`):

| Target | Ukuran rlib | Delta |
|---|---|---|
| Base (`feat/phase4-run`) | `7,842,596` bytes (~7.84 MB) | — |
| With Mirror Module (`wt/t_bc34c961`) | `8,560,598` bytes (~8.56 MB) | **+718,002 bytes (+701 KB / +9.1%)** |

Module ini sangat hemat (ponytail): tidak menambahkan crate dependency baru di `Cargo.toml`. Hanya menggunakan std types (`TcpStream`, `mpsc`, `Arc`, `Mutex`, `thread`).

---

## 5. Deliverables & Changed Files

- `crates/core/src/mirror/mod.rs` — module root & re-exports
- `crates/core/src/mirror/protocol.rs` — scrcpy v4.1 binary video stream parser
- `crates/core/src/mirror/control.rs` — InputEvent serializer & unit tests
- `crates/core/src/mirror/server.rs` — scrcpy-server push, forward, app_process spawn, lifecycle
- `crates/core/src/mirror/session.rs` — MirrorSession orchestrator (video reader thread, control stream, channels)
- `crates/core/examples/mirror_stream.rs` — CLI tool/example untuk pipe video frames ke stdout & stdin control
- `crates/core/tests/mirror_e2e.rs` — 4 comprehensive integration tests against real emulator
- `crates/app/src/commands.rs` — Tauri commands (`mirror_start`, `mirror_stop`, `mirror_input`, `mirror_screenshot`) + `MirrorState`
- `crates/app/src/lib.rs` — registration of mirror state & commands in invoke_handler

---

## 6. Downstream Handoff

### For iOS Worker (`t_63556735`):
- Kontrak binary packet sama: `[u8 kind][u64be pts][payload]`.
- iOS backend dapat mengimplementasikan streaming via WDA / `go-ios` / idb stream dengan format yang sama sehingga frontend tidak perlu branching format data.

### For QA Worker (`t_c226bc64`):
- Test suite `crates/core/tests/mirror_e2e.rs` sudah mencakup:
  1. `test_mirror_screenshot`: screencap PNG validity
  2. `test_mirror_session_inject_input`: touch down/up, key, scroll, nav back/home, rotate
  3. `test_mirror_session_lifecycle`: connect, Live status, clean drop & cleanup
  4. `test_mirror_session_video_frames`: verify ≥1 valid frame, H.264 SPS/IDR packet sequence

### For Techlead (Mac Verification):
- Backend `crates/core` sudah terverifikasi 100% di server Linux dengan real emulator Android.
- Di Mac: verify build `cargo check -p petak-app` dan UI WebCodecs decoder rendering di canvas WebView.
