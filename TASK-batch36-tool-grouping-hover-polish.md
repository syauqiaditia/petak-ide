# Petak — TASK Batch 36: Collapsible Tool Call Grouping & Flicker-Free Adaptive Hover Tooltip

## Ringkasan Instruksi Pengguna (UQi)
1. **Aturan Eksekusi**:
   - Dikerjakan di server repo `/mnt/storage/uqi-projects/petak-p4m`.
   - JANGAN LANGSUNG BUILD/RESTART KE MAC UQI karena Petak.app sedang aktif dipakai kerja oleh UQi.
   - Selesaikan seluruh implementasi dan test suite 100% hijau di server, lalu laporkan hasilnya.

2. **2 Fokus Fitur & Perbaikan Visual**:
   - **Fitur 1: Collapsible Tool Call Grouping (Accordion 1-Baris)**:
     - Masalah: Eksekusi puluhan tool (`read_file`, `terminal`, `search_files`) menumpuk memenuhi layar dan mengubur percakapan serta respon AI.
     - Solusi:
       - Kelompokkan daftar tool calls dalam kartu grup accordion ringkas: `⚙️ {N} tindakan alat ({summary tool}) [▶ / ▼]`.
       - Default: **OTOMATIS KETUTUP (COLLAPSED)**.
       - Saat sedang live streaming: yang tampil di luar hanya 1 baris tindakan aktif terakhir (`⚡ Sedang membaca file...`), sedangkan tool-tool yang sudah selesai otomatis terlipat ke dalam grup accordion di atasnya.
       - Pengguna dapat membuka manual accordion untuk melihat detail masing-masing tool jika diperlukan.
     - Di `AgentChat.svelte`:
       - Buat state `collapsedToolGroups: Record<string, boolean>` dengan default `true` (tertutup).
       - Buat ringkasan ringkas (misal: "read_file (4), terminal (2)").
       - Jika accordion tertutup, hanya tampil 1 baris header ringkas. Jika terbuka, tampilkan daftar tool cards di dalamnya.

   - **Fitur 2: LSP Hover Flicker-Free & Adaptive Multi-Directional Positioning**:
     - Masalah: Hover tooltip di editor berkedip-kedip (flicker) sebelum stabil, signature kode panjang tidak bisa di-scroll ke kanan, dan penempatan posisi menabrak panel/batas.
     - Solusi:
       - Eliminasi Flicker: Hapus delay `requestAnimationFrame` pada `mount()` di `hover.ts`. Lakukan kalkulasi `maxWidth` dan penyesuaian posisi secara sinkron di `create()` dan `positioned()`.
       - Scroll Horizontal: Ubah `overflow-x: hidden !important` menjadi `overflow-x: auto !important` pada `.cm-tooltip.cm-lsp-hover-tooltip` dan `.cm-tooltip-hover`. Tambahkan `scrollbar-width: thin`.
       - Penempatan Adaptif Ruang Kosong (Adaptive Quad-Direction Bounding):
         - Periksa 4 kuadran (kiri, kanan, atas, bawah) terhadap batas viewport editor, right dock panel, dan bottom dock.
         - Jika kursor di dekat batas kanan editor, geser tooltip ke kiri atau posisikan di ruang kosong sebelah kiri; jika kursor di dekat batas bawah, tempatkan di atas kursor (`above: true`); jika di dekat batas atas, tempatkan di bawah. Tooltip dinamis mengisi ruang kosong tanpa terpotong atau memaksakan diri di satu titik tetap.
         - Perbarui `hoverLogic.ts` dengan fungsi kalkulasi adaptif `computeAdaptiveHoverCoords()` dan perbarui test suite.

3. **Verifikasi**:
   - Buat test suite baru `tests/batch36_tool_grouping_hover.test.mjs`.
   - Jalankan `npm test` dan `cargo test -p petak-core` untuk memastikan 100% lolos tanpa regresi.
