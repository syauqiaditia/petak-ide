# Batch 2 Core Command Contract

All commands are Tauri `invoke()` calls from UI → Rust.
Events are Tauri `listen()` from Rust → UI.

## A. Scrcpy

No new commands — `mirror_start` already exists, jar resolution is internal.
Android mirror is INTERACTIVE (touch/drag/scroll/keyboard/nav buttons via scrcpy control socket — already implemented in mirror/control.rs).
iOS Simulator mirror is VIEW-ONLY (screen capture only).
UI should label panels accordingly: "Android — Interactive" vs "iOS — View only".

## B. Kotlin LS

### `kotlin_ls_status` → `KotlinLsStatus`
```json
{ "installed": bool, "version": string|null, "javaOk": bool, "javaVersion": string|null, "message": string }
```

### `kotlin_ls_install` → `void`
Downloads latest fwcd/kotlin-language-server server.zip from GitHub releases.
Emits event `kotlin-ls-progress` with payload:
```json
{ "stage": "downloading"|"extracting"|"verifying"|"done"|"error", "percent": number|null, "message": string }
```

## C. Devices

### `devices_snapshot` → `DevicesSnapshot`
```json
{
  "emulators": [{ "id": string, "name": string, "kind": "android-avd"|"ios-sim", "state": "running"|"stopped"|"booting", "deviceId": string|null }],
  "physical": [{ "id": string, "name": string, "platform": "android"|"ios", "transport": "usb"|"wifi" }]
}
```
Sources: `emulator -list-avds` + `adb devices`, `xcrun simctl list devices available --json`, `xcrun devicectl list devices --json-output`.

### `avd_start(name: string, cold: bool)` → `void`
Starts Android AVD. After boot, emits event `device-ready`:
```json
{ "id": string, "kind": "android-avd" }
```

### `avd_stop(name: string)` → `void`
Kills running emulator for named AVD via `adb emu kill`.

### `sim_boot(udid: string)` → `void`
Boots iOS Simulator. After boot, emits event `device-ready`:
```json
{ "id": string, "kind": "ios-sim" }
```

### `sim_shutdown(udid: string)` → `void`
Shuts down iOS Simulator via `xcrun simctl shutdown`.

### Event: `devices-changed` → `DevicesSnapshot`
Emitted when device list changes (poll ~3s or adb track-devices). Offline devices removed.

### Event: `device-ready` → `{ id: string, kind: string }`
Emitted after successful start/boot.

## D. Git

### `git_branches_tree` → `BranchList`
Same shape as existing `git_branches`:
```json
{
  "local": [{ "name": string, "upstream": string|null, "ahead": number, "behind": number, "isCurrent": bool, "sha": string }],
  "remote": [{ "name": string, "sha": string }],
  "tags": [{ "name": string, "sha": string }]
}
```
Uses single `for-each-ref` call — fast for hundreds of refs.

### `git_checkout(root, branch, autoStash: bool)` → `CheckoutResult`
```json
{ "stashed": bool, "stashPopped": bool, "message": string }
```
If `autoStash=true` and worktree is dirty: `git stash push -u` before checkout, `git stash pop` after. Returns status.

### `git_branch_create(root, name, from)` → `void`
Already exists.

### `git_branch_delete(root, name, force)` → `void`
Already exists.

### `git_branch_rename(root, old, new)` → `void`
Already exists.

### `git_log_path(root, path, limit)` → `Commit[]`
Alias for existing `git_path_history`. Returns commit list for a path.

### `git_blame(root, path)` → `BlameLine[]`
Already exists:
```json
[{ "line": number, "sha": string, "author": string, "timeUnix": number, "summary": string }]
```

### `git_diff_branch(root, path, branch)` → `DiffFile[]`
Alias for existing `git_diff_path` with mode=branch.

### `git_diff_revision(root, path, rev)` → `DiffFile[]`
Alias for existing `git_diff_path` with mode=rev.

### `git_add_gitignore(root, path)` → `void`
Already exists as `git_gitignore_add`.

### `git_stage(root, path)` → `void`
Wraps existing `git_stage_files` with single path.

### `git_unstage(root, path)` → `void`
Wraps existing `git_unstage_files` with single path.

### `git_rollback(root, path)` → `void`
Already exists (with Local History snapshot).
