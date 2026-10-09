# Petak — TASK Batch 34: Zero-Bug Abnormal UI Testing, Logcat Search Fix & Clean Responsive AI Header

## Ringkasan Instruksi Pengguna (UQi)
1. **Aturan Eksekusi**:
   - Dikerjakan di worktree/branch baru yang bersih (misal `qa/zerobug-polish`), jangan campur branch utama sebelum tuntas.
   - Tim mandiri menemukan bug lewat pengujian abnormal (chaos testing), memperbaikinya, dan memvalidasi sampai ZERO BUG.
2. **Bug Spesifik & Polish Visual Temuan UQi**:
   - **Logcat Search Input Freeze**: Saat mengetik di kolom pencarian/filter Logcat, input tidak bisa diketik atau terhalang key listener. Perbaiki two-way binding (`bind:value`), pastikan global keydown di editor tidak membajak input saat elemen input sedang fokus (`e.target instanceof HTMLInputElement`).
   - **AI Chat Header Cluttered & Not Responsive**: Bagian atas panel AI Agent (`AgentsPanel.svelte`) terlalu padat (banyak badge numpuk: bot selector, engine badge, model select, tool scoping badge, tab Chat/Lanes/Diff, + New, History, Close). Saat panel sempit (<500px), elemen bertabrakan, teks tumpang tindih (`+ ClaChat` timpa nama bot). Buat clean, rapi, responsif ala Linear/Raycast (gunakan baris kedua yang rapi atau dropdown terpadu).
   - **Mandat Polish UI Global (Solid, Clean & Responsive)**: `designer` dan tim wajib menyisir seluruh panel (Editor, Terminal, Logcat, Run, Mirror, Git, AI Panel). Hilangkan elemen berdesakan, pastikan styling solid, border rapi, typography konsisten, dan transisi responsif di semua ukuran panel. Tidak boleh ada layout broken saat di-resize.

3. **Abnormal / Chaos UI Testing**:
   - Jalankan stress test pada komponen frontend (chat spam, session switching, unhandled exceptions, long input, edge case formatting).
   - Pastikan seluruh 350+ test frontend dan Rust core tetap 100% PASS.
   - Techlead mereview dan menggabungkan perbaikan.
