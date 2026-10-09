# Petak — TASK Batch 31: Polish UI, Context Menu Portal, Adaptive Hover, Search UX & Run Console Logs

## Ringkasan Masalah & Ekspektasi UQi (Manual Test Feedback)
Dari hasil pengetesan manual UQi pada project Flutter `jatim-ist-mb-flutter`, ditemukan 5 bug dan 3 ekspektasi esensial yang perlu diperbaiki:

### 1. Bugs:
1. **Menu Logcat & Run tidak clean dan tidak responsive**:
   - Toolbar Logcat dan Run dijejalkan dalam baris kaku yang meluap/overflow jelek saat panel diperkecil. Perlu redesign toolbar responsif ala Android Studio/JetBrains (status kompak, tombol aksi berbobot, filter fleksibel).
2. **Klik kanan tertutup panel bawah**:
   - Context Menu (`ContextMenu.svelte`, FileTree, Editor, Git) tertutup atau terpotong oleh batas `.bottom-dock-container` karena stacking context / `overflow: hidden`. Wajib selalu di lapisan paling atas (`z-index: 99999` / portal ke root).
3. **LSP idle lama tidak bangun otomatis saat dibuka lagi**:
   - Setelah 10 menit idle, LSP berhenti. Namun saat tab berkas dibuka atau editor diketik kembali, LSP tidak otomatis me-restart/bangun, mengharuskan restart manual.
4. **Hover tooltip tertutup dan rusak jika tertutup panel bawah dan kanan**:
   - Di `hover.ts`, tooltip dokumentasi LSP memotong batas bawah editor atau tertabrak dock kanan. Harus adaptif membalik ke atas (`above: true`) jika ruang bawah sempit, dan lebar menyesuaikan batas aman editor.
5. **Menu Problems tidak clean dan kurang responsive**:
   - `ProblemsPanel.svelte` tabel/daftar masalahnya kurang rapi dan sempit. Perlu styling bersih: summary badges (Errors, Warnings), filter teks cepat, dan daftar masalah yang responsif.

### 2. Other Expected:
6. **Search / Replace otomatis mengisi teks seleksi & auto-fokus**:
   - Saat `Cmd+F` atau `Cmd+R` ditekan di editor, jika ada teks yang sedang diblok, otomatis masukkan teks tersebut ke input pencarian dan langsung fokuskan kursor ke input agar pengguna bisa langsung mengetik.
7. **Search di Run log tidak memfilter hingga hilang semua**:
   - Di `RunPanel.svelte`, pencarian saat ini membuang baris non-match (`outputLines.filter(...)`). Ubah perilakunya: tampilkan semua log utuh, beri highlight kata kunci yang cocok, dan gunakan tombol ▲ / ▼ untuk melompat/scroll ke baris hasil pencarian ala IDE sungguhan.
8. **Print log Dart & Native masuk ke Run lengkap dengan warna ANSI**:
   - Output `print(...)` dari Dart dan log platform native harus mengalir ke tab Run. Terapkan parser warna ANSI lengkap (merah untuk error/stderr, kuning untuk warning, biru/cyan untuk info/tag, hijau untuk reload/success).

## Scope Pengerjaan

### 1. Frontend Editor & Shell (`ui/shell/`, `ui/features/editor/`)
- **Portal & Z-Index Context Menu**:
  - Pasang root portal atau naikkan stacking context `ContextMenu.svelte` ke `z-index: 99999` di atas seluruh dock.
- **Adaptive Hover Tooltip (`hover.ts`)**:
  - Hitung sisa tinggi dari kursor ke bottom dock. Jika sisa tinggi < 260px, paksa `above: true`. Batasi `maxWidth` terhadap batas kanan editor agar tidak bertubrukan dengan Right Dock.
- **Find / Replace UX (`FindReplaceBar.svelte`, `Editor.svelte`)**:
  - Ambil seleksi aktif `view.state.sliceDoc(sel.from, sel.to)` saat dibuka, bind ke `query`, dan auto-focus input.

### 2. Frontend Bottom Dock (`ui/features/run/`, `ui/features/problems/`)
- **Run Panel & ANSI Color Output (`RunPanel.svelte`, `runStore.svelte.ts`)**:
  - Buat helper parser ANSI colors (`parseAnsiToHtml` / spans) untuk merender baris log berwarna.
  - Perbaiki search: jangan filter `outputLines`. Tampilkan semua log, highlight matching text, navigasi jump per match.
  - Redesign toolbar Run agar bersih, responsif, dan rapi saat viewport sempit.
- **Logcat Panel & Problems Panel**:
  - Rapikan layout toolbar Logcat: kontrol esensial di kiri, level selector & filter di kanan, wrap responsif.
  - Rapikan `ProblemsPanel.svelte`: visual list bersih dengan file badge, line:col, dan link jump to code.

### 3. Backend Rust Core (`crates/core/src/run/`, `crates/core/src/lsp/`)
- **Dart & Native Run Output Streaming (`flutter.rs`)**:
  - Pastikan output stdout non-daemon dari Flutter run dan event `app.log` serta device output diteruskan sebagai `RunEvent::Output`.
- **LSP Auto-Wake on Document Touch**:
  - Pastikan saat `lsp_did_open` atau `lsp_did_change` dipanggil untuk server yang berstatus idle/stopped, registry otomatis membangkitkan (*spawn/re-init*) server bahasa tersebut.

### 4. Safety & Budget Rules
- RAM idle app tetap < 150 MB, biner < 20 MB.
- Unit tests & typecheck 100% PASS (`cargo test -p petak-core`, `npm test`, `npm run check`).

## Deliverables
1. Context menu & Hover tooltip bebas dari clipping panel.
2. Search/Replace auto-populate & auto-focus.
3. Run console dengan ANSI colors, full log retention, dan search navigation.
4. Toolbar Logcat, Run, dan Problems yang clean dan responsif.
5. Auto-wake LSP saat berkas dibuka kembali.
6. Laporan verifikasi QA independen dan merge ke branch `main`.
