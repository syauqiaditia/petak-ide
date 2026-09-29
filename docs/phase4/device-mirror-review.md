# Petak Fase 4.5 — Device Mirror: Independent QA Review

**Reviewer task:** `t_c226bc64`
**Reviewed commits:** `a6e28c8` (merge of `wt/t_bc34c961`, core), `a2a08c5` (merge of `wt/t_eb501da4`, UI) on `feat/phase4-run`
**Environment:** server `uqiflutter1`, headless AVD `jatim_dev` (Android 15, x86_64), sample app `/mnt/storage/uqi-cache/petak-samples/petak_flutter_sample`
**Verdict: PERLU REVISI** (1 blocker found — real orphan scrcpy process on app quit)

---

## 1. What was checked

| Area | Method | Result |
|---|---|---|
| `cargo test -p petak-core --lib` | full lib suite incl. 19 mirror unit tests | ✅ 150/150 green |
| `cargo test -p petak-core --test mirror_e2e -- --ignored` | real `jatim_dev` emulator, 3 clean reruns | ✅ 4/4 green (first attempt right after boot flaked once — emulator not fully settled, not a code bug; reproducibly green afterward) |
| `npm test` | mirror_logic.test.mjs | ✅ 8/8 green |
| `npm run build` | vite build | ✅ succeeds, DeviceMirrorPanel chunk 19.61 kB / 6.61 kB gzip as reported |
| No new crate deps | `git diff` on `*/Cargo.toml`, `Cargo.lock` | ✅ 0 additions confirmed |
| Binary size delta | `cargo build --release`, `libpetak_core.rlib` | ✅ 8,559,798 bytes, matches reported ~8.56 MB / +701 KB delta |
| Decode proof (stream vs screencap) | `mirror_stream` example → raw H.264 → `ffmpeg` static build → PNG, compared against `adb exec-out screencap` at same moment | ✅ **Confirmed real** — decoded frame and screencap show identical home screen (same wallpaper, same app icons/layout). Not fabricated. |
| Real tap through control socket | PTY session running `mirror_stream`, sent `{"t":"touch","action":"down/up",...}` JSON at FAB coords (scaled 1080x2400 → 864x1920), verified via `uiautomator dump` before/after | ✅ Counter content-desc went `0` → `1` after control-socket tap. Real input proven, not mocked. |
| Lifecycle: panel close / drop | `test_mirror_session_lifecycle`, 5x open/close loop | ✅ Clean every time — `adb shell ps | grep app_process` and `adb forward --list` both empty after each run/drop, no orphaned process, no leak across 5 iterations |
| **Lifecycle: whole-app quit** | Code read of `crates/app/src/lib.rs` `on_window_event` vs `MirrorState` | ❌ **BUG — see §2** |
| Contract compliance (`device-mirror-contract.md`) | protocol.rs, control.rs, commands.rs vs contract doc | ✅ Binary frame format, InputEvent tags, command signatures all match |
| ponytail / architecture | diff review | ✅ core stays pure std (TcpStream/mpsc/thread), `crates/app/src/commands.rs` mirror commands are thin pass-throughs, no raw HTTP/Dio anywhere (protocol is scrcpy TCP, correctly out of network-layer scope) |

## 2. Blocker: scrcpy server not killed on app exit (orphan process)

**File:** `crates/app/src/lib.rs:18-33` (window event handler) vs `crates/app/src/commands.rs:2395-2406` (`MirrorState`)

The task mandate and the contract (`docs/phase4/device-mirror-contract.md:11`) both require:
> App exit / device gone => server killed, status Disconnected. ... (ga boleh ada proses yatim)

`on_window_event` in `lib.rs` explicitly shuts down `TermSessions`, `AppRegistry`, and `RunState` (`run_state.shutdown_all()`) on `Destroyed`/`CloseRequested`, but **never touches `MirrorState`**. `MirrorState.sessions` is a `HashMap<String, MirrorSession>` managed via `.manage(commands::MirrorState::default())` (lib.rs:16) — nothing ever drains it on window close.

`MirrorSession`'s `Drop` (which kills the scrcpy server + removes the adb forward) only fires when the `HashMap` entry is removed, which currently only happens through the explicit `mirror_stop` command (`commands.rs:2466-2478`, panel close button). If the user quits Petak (Cmd+Q / window close) while a mirror session is live, the `MirrorSession` is never dropped, `scrcpy-server` (`app_process`) and the `adb forward` stay alive on the device indefinitely — exactly the orphan-process scenario the task explicitly forbids.

I verified the *panel-close* and *drop* paths are clean (5x loop, zero leaks, see table above) — those are genuinely fine. The gap is narrowly the app-quit path, which nobody wrote a test for and the implementation report doesn't mention either way (silent, not fabricated, but the claim "Menutup panel memanggil `api.mirrorStop`... Zero cost" in `device-mirror-report.md` §Poin 6 implies full lifecycle safety it doesn't have).

**Fix needed (senior):** in `crates/app/src/lib.rs` `on_window_event`, add a `MirrorState` drain alongside the existing `RunState`/`TermSessions` cleanup — same pattern as `RunState::shutdown_all()`:
```rust
if let Some(mirror_state) = window.try_state::<commands::MirrorState>() {
    if let Ok(mut sessions) = mirror_state.sessions.lock() {
        sessions.clear(); // drops each MirrorSession -> kills server + removes forward
    }
}
```
Add a regression test (can't run `crates/app` on this Linux server — webkit2gtk missing per task notes — but at minimum: a `crates/core` test or explicit note in the follow-up PR that this was manually verified on Mac by quitting Petak with a live mirror session and checking `adb shell ps` for orphan `app_process`).

## 3. Other findings (non-blocking)

- `crates/core/src/mirror/session.rs:241-247` `rand_scid()` uses a `DefaultHasher` seeded by `Instant::now()` + `ThreadId` — fine for scid uniqueness (not security-sensitive, scid just needs to not collide with a concurrently-running session on the same device), no action needed.
- First e2e test run right after fresh emulator boot flaked with `UnexpectedEof` on 3/4 tests (screenshot alone passed). Root cause: emulator/ADB wasn't fully settled ~immediately after `sys.boot_completed=1`; reran clean 3x in a row afterward including a 5x lifecycle loop. Not a code bug, but worth a short `adb wait-for-device` + extra settle delay note in `manual-test.md` for whoever runs this next, since techlead's Mac task will hit the same class of flake on cold boot.

## 4. What's NOT verified here (by design, per task scope)

- iOS path (`t_63556735`) — server can't build `crates/app` (webkit2gtk) or run WKWebView; out of scope for this task, techlead verifies on Mac.
- Typing latency ≤17ms / cold start ≤646ms / RAM budgets — need the Mac build; not measurable meaningfully on this headless Linux box per task's own routing (Mac task `t_b08e611b`).
- 2 simultaneous devices — only one AVD available on this server, not attempted.

## Verdict

**PERLU REVISI.** Core protocol/decode/input work is solid and genuinely verified (not faked) — screenshots, tests, and byte-level protocol checks all check out. But the mandatory "server scrcpy MATI ... app keluar" requirement is not met: `MirrorState` is missing from the app-exit cleanup path that every other stateful resource (`RunState`, `TermSessions`, `AppRegistry`) already has. This is a one-line fix in `lib.rs` plus (ideally) a note in the Mac verification checklist to manually confirm it. Sending back to senior for the fix; not touching UQi's `jatim_dev` state beyond the intentional test app install/uninstall (cleaned up) and emulator boot/shutdown (fully torn down, verified via `adb devices` + `pgrep qemu-system` both empty at the end of this session).
