# Batch 3 contract (core <-> UI). Nama command final, jangan diubah.

Basis: branch feat/phase4-run SETELAH batch2 (t_e7bde0e4 CORE, t_a9a42549 UI) merge. Extend `devices_snapshot` & git batch2, jangan duplikasi.

## Rust commands (senior)

Devices (B2) — extend `devices_snapshot` (batch2):
- Sumber digabung: `flutter devices --machine` + adb + `xcrun simctl` + `xcrun devicectl`. Dedupe per id.
- Tambah field per device: `state: 'online'|'offline'|'booting'`, `flutterId: string|null` (id yg valid utk `flutter run -d`), `group: 'emulator'|'simulator'|'physical'|'desktop'|'web'`, `transport?: 'usb'|'wifi'`.
- `flutterId == null` atau state != online => tidak boleh dipakai Run. iPhone fisik "UQi" (wireless) harus muncul, group=physical, transport=wifi.
- `run_start` menolak (error jelas) kalau deviceId bukan online.

Recent projects (F1), disimpan di app data `recent_projects.json`:
- `recent_projects_list() -> [{name, path, lastOpened:number, exists:boolean}]` (max 10, terbaru dulu)
- `recent_projects_add(path)`, `recent_projects_remove(path)`

Git commit per-file (F3), model = checkbox = stage sungguhan (git add / restore --staged), commit = staged saja:
- `git_stage_paths(paths:[string])`, `git_unstage_paths(paths:[string])` (batch, satu proses git)
- `git_commit_selected(message, paths:[string]) -> {sha}` : `git commit -m msg -- <paths>` (pathspec, yg tak terpilih tetap uncommitted)
- `git_delete_untracked(path)` (hanya untracked, pakai trash/backup)
- `git_rollback` (batch2) dipakai utk Rollback; wajib backup ref.

Ghost-text index (F4), per project di `<app_data>/Petak/index/<hash(root)>.bin`:
- `suggest_index_build(root)` background thread, cap 20k entri, target <15MB
- `suggest_index_update(path)` dipanggil saat save (file watcher)
- `suggest_query(prefix, lang:'dart', limit:3) -> [{text, freq, argsTemplate?}]` : `ieldPin(` + `controller: , focusNode: ,` dari call-site paling sering. Hanya kembalikan bila freq>=2.
- Setting `editor.ghostText` (bool, default true).

## UI (senior2)
- B1: satu panel kanan aktif (mirror ATAU panel lain); sidebar kiri satu aktif. Store tunggal `activeRightPanel`.
- B2: seleksi device offline otomatis dilepas; Run disabled + tooltip; dropdown group Emulator/Simulator vs Physical.
- B3: run state machine `idle|starting|running|error`; warna: idle hijau, starting kuning+spinner disabled, running hijau solid + hot reload/restart, error merah; Stop aktif hanya saat proses jalan; debug ikut.
- B4/F1: switch project => tutup semua tab (prompt simpan bila dirty), reset Problems/Run log/Git/Log filter, restart LSP root baru, ganti file tree. Dropdown nama project = recent list (hover hapus, path hilang ditandai), Open Folder….
- F3: checkbox per file/grup/select-all, label `Commit (N)`, context menu file (Rollback, Go to File, Show Diff, Stage/Unstage, Add to .gitignore, Show History, Copy Path, Reveal in Finder, Delete untracked), perbaiki tombol Reload/tooltip yg menutupi baris.
- F4: CM6 ghost-text decoration, delay 120ms, Tab terima, Esc buang, ikut item terpilih bila popup completion terbuka, toggle di Settings.

## Uji
Dummy repo /tmp saja; jatim-ist-mb-flutter & voinzy READ-ONLY. Bukti: screenshot nyata dari /Applications/Petak.app via `open`.
