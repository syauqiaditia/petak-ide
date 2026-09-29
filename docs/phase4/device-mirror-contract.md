# Device mirror — contract core <-> UI (decided by manager; do not change without asking)

Core: crates/core/src/mirror/ (scrcpy client). App adapter: crates/app/src/commands.rs (thin).
Cache: scrcpy-server jar + SHA256 in /mnt/storage/uqi-cache/scrcpy/ (dev); embedded via include_bytes! in release (~100 KB), client version == server version.

## Tauri commands
- mirror_start(serial: String, on_frame: Channel<InvokeResponseBody>, on_status: Channel<MirrorStatus>) -> MirrorInfo { serial, name, width, height, codec: "h264" }
- mirror_stop(serial)          // kills scrcpy server + adb forward; idempotent
- mirror_input(serial, ev: InputEvent)
- mirror_screenshot(serial, path: Option<String>) -> String   // PNG path (via adb screencap), None => temp file
- Lazy: no thread/process/poll exists until mirror_start. Closing panel => mirror_stop. App exit / device gone => server killed, status Disconnected.

## Binary frame packet (Channel, big-endian)
[u8 kind: 0=config(SPS+PPS Annex-B) 1=key 2=delta][u64 pts_us][payload Annex-B bytes]
Also core stamps nothing else; UI measures fps/latency itself (latency = input sent -> next frame decoded/rendered, measured for real).

## MirrorStatus (serde tag "state")
Connecting | Live { width, height } | Rotated { width, height } | Disconnected { reason } | Error { message }

## InputEvent (serde tag "t", coords in device pixels of the current width/height)
{t:"touch", action:"down|move|up", x, y, w, h} | {t:"scroll", x, y, w, h, dx, dy} |
{t:"key", keycode, action:"down|up"} | {t:"text", text} |
{t:"nav", key:"back|home|recents|power|volup|voldown"} | {t:"rotate"}

## Dev tooling (not shipped)
- example crates/core/examples/mirror_stream.rs: `mirror_stream <serial>`: stdout = [u32 len][packet] stream, stdin = one InputEvent JSON per line. Used by tests and by the UI preview bridge.
