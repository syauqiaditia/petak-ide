# Petak Batch 6 Core Notes

## Command Final & Payload (b6)
- `git_commit_paths(root, paths, message, amend)` -> SHA string (atomic, index rollback)
- `git_stash_{push(root,msg?,untracked?), list(root), apply(root,idx), pop(root,idx?), drop(root,idx)}`
- `git_compare_branch(root, base, target, path?)` -> `{files:[{path,oldPath?,status,added,removed,binary}], totalAdded, totalRemoved}`
- `git_diff_branch(root, path, branch, base?)` -> `DiffFile[]` (`base...branch` three-dot diff)
- `lsp_kotlin_log_path()` -> path; emit `lsp-status`: `{lang:'kotlin', state:'indexing', reason:'...'}`
- `mirror_camera_permission()` -> `{status, granted}`; `open_privacy_camera()` -> void
- `mirror_stop(serial)` -> idempotent ("all" / device); Device info field `transport`: `'usb'|'wifi'`

## Ukuran Bundle (.app 24MB -> target <20MB)
- Rincian: binary ~18MB (unstripped), scrcpy-server 717KB, Swift helper ~500KB, icons/resources ~2MB, web assets ~2.5MB.
- Solusi hemat: Cargo `[profile.release]` opt-level="z", lto=true, codegen-units=1, panic="abort", strip=true.
- Estimasi pangkas binary Rust: -6 s.d. 8 MB tanpa mengurangi fitur (mencapai target <20MB).

## Status Verifikasi (Terbukti vs Kode Saja)
- Terbukti di server: git atomic commit & rollback, stash lifecycle, compare branch multi-file/merge-base, KLS 180s timeout + killpg no-orphan, check-app-symbols (685 simbol).
- Kode saja (perlu Mac UQi): Swift AVCaptureDevice muxed discovery, permission TCC camera, devicectl dedupe live.
