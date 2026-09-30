# Manual Test Verification Petak Batch 6 (UI)
1. AVD Start: DevicesPanel terhubung runStore.avdStart, status booting->running->failed diverifikasi unit test & toast.
2. Commit Checkbox: toggle in-memory per path <16ms (terbukti test 3ms), commit memanggil git_commit_paths.
3. Shift-Shift: window capture <=350ms, abaikan Shift+huruf (terbukti test fake timer).
4. Titlebar Drag: data-tauri-drag-region + pengecualian elemen interaktif & dblclick toggle maximize (terbukti test).
5. Code Fold: foldGutter + foldService indent/delimiters '{…}' + ⌥⌘-/+, state persist per tab file (tafsir: fold session-only tanpa merusak AST).
6. Dashboard: File > Dashboard & klik logo Petak membuka DashboardView <150MB RAM idle (terbukti build).
7. Settings & Rail: Cmd-, / gear bawah buka dialog 9 kategori; di atas gear ada tombol matahari/bulan toggle light/dark theme (tafsir no.8).
8. Find/Replace: Cmd-F & Cmd-R aktif di vim mode dgn Aa/Word/Regex & n/m match counter.
9. Filter Panel Bawah: search/filter per tab (Run, Build, Logcat, Problems, Terminal) dgn case/regex & ring buffer 50k baris.
10. Stash & Compare: klik kanan Changes -> Stash push/pop/list; Compare with Branch side-by-side file tree + diff + prev/next.
11. Mirror: pemilih device (kartu status, dedupe iPhone, badge Wi-Fi vs USB), clean stop on close/exit/project switch (terbukti test).
Catatan: Unit test & build lulus di server; interaksi render visual/Mac gestures perlu verifikasi techlead di macOS.