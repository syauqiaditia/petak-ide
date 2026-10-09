# Petak — TASK Batch 35: File Reference Chips, Smart Auto-Scroll Lock, Responsive Stop/Footer & Chat Bubble Layout

## Ringkasan Instruksi Pengguna (UQi)
1. **Aturan Eksekusi**:
   - Dikerjakan di server repo `/mnt/storage/uqi-projects/petak-p4m` pada worktree/branch baru (`wt/chat-polish-references`).
   - JANGAN LANGSUNG BUILD/RESTART KE MAC UQI karena Petak.app sedang aktif dipakai kerja oleh UQi.
   - Selesaikan seluruh implementasi dan test suite 100% hijau di server, lalu laporkan hasilnya.

2. **4 Fokus Fitur & Perbaikan Visual**:
   - **Fitur 1: Responsive Footer & Stop Button Spacing**:
     - Di `AgentsPanel.svelte` (`.usage-meter-footer`):
       - Cegah teks model dan badge (`Hermes ag/gemini-3.8-flash-high`) tertekuk 2 baris atau keluar kotak.
       - Berikan `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap` pada `.footer-agent-badges`, `.footer-model-badge`, dan `.usage-text`.
     - Di `AgentChat.svelte` (`.pills-right`, `.cancel-prompt-btn`):
       - Berikan margin/padding yang proporsional (`padding-right: 4px`), agar tombol Stop tidak menempel mepet garis border kanan.
   - **Fitur 2: Perbaikan Layout Bubble Chat & Tool Execution Overflow**:
     - Pada `.tool-call-header`:
       - Berikan `min-width: 0`, `width: 100%`, `display: flex`, `gap: 6px`, `align-items: center`.
       - `.tool-arg`: harus memiliki `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`, `flex: 1`, `min-width: 0` agar path panjang tidak mendorong badge status keluar kotak.
       - `.tool-badge-completed`, `.tool-badge-failed`, `.tool-badge-running`: `flex-shrink: 0`, `margin-left: auto`.
       - `.tool-call-card`: `box-sizing: border-box`, `max-width: 100%`, `overflow: hidden`.
     - Pada `.message-bubble`:
       - `max-width: 95%`, `box-sizing: border-box`, `overflow-wrap: break-word`, `word-break: break-word`, `overflow: hidden`.
       - `<pre>`, `<code>`: `max-width: 100%`, `overflow-x: auto`, `box-sizing: border-box`.
   - **Fitur 3: Smart Auto-Scroll Lock (Stick to Bottom)**:
     - Deteksi posisi scroll pengguna pada `messagesContainerEl`:
       - Jika pengguna berada di dasar chat (`distanceToBottom <= 60px`), set `userPinnedToBottom = true`.
       - Jika pengguna melakukan scroll ke atas untuk membaca pesan sebelumnya, set `userPinnedToBottom = false`.
     - `$effect` streaming/message change: HANYA panggil `scrollToBottom()` jika `userPinnedToBottom === true`. Tidak boleh memaksa scroll turun jika pengguna sedang membaca pesan di atas.
     - Saat pengguna menekan Send / submit pesan baru: paksa `userPinnedToBottom = true` dan `scrollToBottom(true)`.
   - **Fitur 4: Rich File Reference Chips (Di Dalam Input Chat & Di Dalam Bubble Chat)**:
     - Struktur Data: `FileReference { path: string; name: string; line?: number; endLine?: number; isDir?: boolean }`.
     - Di Dalam Input Composer (`.chat-input-box`):
       - Saat tag file/folder lewat `@mention`, context picker, atau active tab / hover:
         File tidak lagi disumpalkan sebagai teks kasar `@path/to/file` di dalam textarea, melainkan dirender rapi sebagai chip referensi berkas di baris atas textarea (di DALAM kotak composer input).
       - Setiap chip memiliki ikon (`📄` / `📁`), nama berkas, nomor baris (jika ada), dan tombol silang `✕` untuk menghapus.
       - Tombol Backspace saat textarea kosong (cursor di awal) menghapus chip terakhir.
     - Di Dalam Bubble Chat (User & Agent):
       - Referensi berkas dirender sebagai pill interaktif (`.bubble-file-pill`).
       - Saat pill diklik: memanggil navigasi editor `openReferencedFile(path, line)` yang membuka tab via `tabsManager.openTab` dan melompat ke baris yang dituju via `(window).__PETAK_GOTO_LINE__`.
     - Di `Editor.svelte`:
       - Daftarkan `(window as any).__PETAK_GOTO_LINE__ = gotoLine;` agar fungsi navigasi baris dapat diakses secara global oleh komponen chat.

   - **Fitur 5: Collapsible Tool Call Grouping (Accordion 1-Baris)**:
     - Masalah: Eksekusi puluhan tool (`read_file`, `terminal`, `search_files`) menumpuk memenuhi layar dan mendorong percakapan.
     - Solusi:
       - Bungkus daftar tool calls dalam kartu grup accordion ringkas: `⚙️ {N} tindakan alat ({summary tool}) [▶ / ▼]`.
       - Default: **OTOMATIS KETUTUP (COLLAPSED)**.
       - Saat sedang live streaming: yang tampil hanya 1 baris tindakan aktif terakhir (`⚡ Sedang membaca file...`), sedangkan tool-tool yang sudah selesai otomatis terlipat ke dalam grup accordion di atasnya.
       - Jika user mengklik expand (buka), accordion terbuka rapi dan masing-masing output tool bisa dibuka per item tanpa merusak layout.

   - **Fitur 6: LSP Hover Flicker-Free & Adaptive Multi-Directional Positioning**:
     - Masalah: Hover tooltip berkedip-kedip sebelum stabil, tidak bisa scroll ke kanan untuk method/signature panjang, dan posisinya kaku menabrak batas.
     - Solusi:
       - Eliminasi Flicker: Hapus penyesuaian posisi via `requestAnimationFrame` yang menyebabkan render lompat (flicker). Lakukan kalkulasi clamping secara sinkron di `create()` dan `positioned()`.
       - Dukungan Scroll Horizontal: Ubah `overflow-x: hidden !important` menjadi `overflow-x: auto !important` pada `.cm-tooltip.cm-lsp-hover-tooltip` dan `.cm-tooltip-hover`. Tambahkan scrollbar halus (`scrollbar-width: thin`) agar signature kode panjang dapat di-scroll ke kanan.
       - Penempatan Adaptif Ruang Kosong:
         - Periksa 4 kuadran (kiri, kanan, atas, bawah) terhadap batas viewport editor, right dock panel, dan bottom dock.
         - Jika kursor di dekat batas kanan editor, geser tooltip ke kiri atau posisikan di ruang kosong sebelah kiri; jika kursor di dekat batas bawah, tempatkan di atas kursor (`above: true`); jika di dekat batas atas, tempatkan di bawah. Tooltip dinamis mengisi ruang kosong tanpa terpotong atau memaksakan diri di satu titik tetap.


3. **Verifikasi**:
   - Buat test suite baru `tests/batch35_chat_polish.test.mjs` yang mencakup:
     - Layout & truncation tool call header dan bubble chat.
     - Logika smart auto-scroll pin/unpin.
     - File reference lifecycle (add, remove, backspace, envelope build).
     - Navigasi file reference handler.
   - Jalankan `npm test` dan `cargo test -p petak-core` untuk memastikan 100% lolos tanpa regresi.
