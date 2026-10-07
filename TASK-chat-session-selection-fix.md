# Petak — TASK Batch 32: Chat Multi-Session Isolation, Text Selection/Copy & Clean Prompt Envelope

## Ringkasan Masalah & Temuan UQi
1. **Teks Bubble Chat Tidak Bisa Di-copy / Diseleksi**:
   - Di `App.svelte` (`.agent-panel-slot`), terdapat aturan CSS `user-select: none; -webkit-user-select: none;`. Aturan ini diwariskan ke seluruh isi panel chat, menyebabkan pengguna tidak bisa memblok/hover/copy teks di dalam balon pesan (`.message-body`, `.message-bubble`, code blocks).
2. **Konteks Memori Bocor ke Bubble Chat User**:
   - Saat pengguna mengetik mention file (misal `@lib/main.dart`), `triggerSmartContextPruning` memanggil `agentGetRelevantMemory`.
   - Di `AgentChat.svelte` (`handleSubmit`), teks blok konvensi (`[PROJECT CONVENTIONS: ...]`) digabungkan langsung ke dalam `text` pesan pengguna dan disimpan ke `userMsg.content`. Akibatnya saat pengguna tekan Enter, balon pesan pengguna sendiri meledak menjadi ratusan baris teks dokumentasi (seperti `voip.md` Omnix Flashphoner).
   - Pengambilan memori domain juga over-fetching: mengambil seluruh file `.md` di folder proyek (termasuk dokumen fitur seperti `voip.md`), bukan hanya file konvensi inti.
3. **New Chat Nyangkut & Balapan Respons Antar Sesi (Cross-Session Leak)**:
   - Tombol `+ New Chat` (`newSession()`) hanya mengosongkan array tampilan `chatHistory[slotId]`, tetapi tidak membatalkan atau mengisolasi proses prompt yang sedang berjalan di background.
   - Begitu respons dari prompt lama selesai dari backend LLM, jawabannya di-append ke `chatHistory[slotId]` yang baru dibuat, sehingga jawaban obrolan lama tiba-tiba muncul di obrolan baru dan slot agen mengalami deadlock/stuck.

## Scope Pengerjaan

### 1. Frontend Text Selection & Bubble UX (`ui/features/agents/AgentChat.svelte`, `ui/App.svelte`)
- Pada `ui/App.svelte` dan `ui/features/agents/AgentChat.svelte`:
  - Hapus atau override `user-select: none` pada area pesan:
    * `.chat-messages`, `.message-bubble`, `.message-body`, `.user-bubble`, `.agent-bubble`: set `user-select: text !important; -webkit-user-select: text !important; cursor: text;`.
  - Berikan tombol aksi hover "📋 Salin" pada balon chat dan blok kode markdown agar pengguna dapat menyalin teks/kode dengan 1 klik.

### 2. Pembersihan Amplop Konteks (Prompt Envelope Separation)
- Di `ui/features/agents/AgentChat.svelte` & `agents.svelte.ts`:
  - Pisahkan strictly antara **User Display Message** dan **Backend LLM Prompt Payload**:
    * `userMsg.content` HANYA menyimpan apa yang benar-benar diketik pengguna (misal `"pada @lib/main.dart ada context.read..."`).
    * Injeksi konvensi `[PROJECT CONVENTIONS: ...]`, `[DISCIPLINE: ...]`, dan LSP outline HANYA disematkan pada parameter `formattedPrompt` yang dikirim ke `api.agentPrompt(...)`. Balon chat pengguna tetap bersih dan rapi.
- Di `crates/core/src/agent/memory.rs`:
  - Batasi pemindaian file memori: HANYA membaca file aturan/konvensi inti: `conventions.md`, `rules.md`, `gotchas.md`, `lessons.md`.
  - Jangan membaca file dokumentasi fitur proyek lain (seperti `voip.md`, `architecture.md`, `overview.md`, `api.md`).
  - Pasang batas maksimal panjang konten memori (budget cap maks 1.500 karakter) agar prompt tidak disumpal dokumen masif.

### 3. Arsitektur Multi-Sesi Terisolasi (True Multi-Session Isolation)
- Di `ui/features/agents/agents.svelte.ts` & `AgentChat.svelte`:
  - Hubungkan pengiriman pesan dengan `sessionId` spesifik pada saat prompt dikirim (`dispatchSessionId = this.activeSessionId`).
  - Saat respons tiba dari backend LLM:
    * Jika `dispatchSessionId === this.activeSessionId`: tampilkan respons di sesi aktif saat ini.
    * Jika pengguna telah menekan `+ New Chat` (`dispatchSessionId !== this.activeSessionId`): simpan respons ke riwayat sesi asal di `savedSessions`, JANGAN tampilkan atau suntikkan ke sesi aktif yang baru.
  - Saat `newSession()` ditekan:
    * Buat sesi baru yang bersih dengan ID unik `sess-${Date.now()}`.
    * Jika prompt lama masih berjalan, biarkan ia menyelesaikan tugasnya di sesi lamanya tanpa menghalangi sesi baru (atau beri opsi tombol `Stop`).
    * Sesi baru langsung bersih, status slot siap menerima prompt baru tanpa nyangkut.

### 4. Safety & Testing
- Unit tests Svelte & Rust 100% PASS (`npm test`, `cargo test -p petak-core`).
- Verifikasi seleksi teks dengan mouse/cursor di bubble chat berfungsi normal.

## Deliverables
1. Bubble chat dapat diseleksi dan di-copy secara normal.
2. Balon chat user bersih dari dump dokumen sistem/memori.
3. Tombol `+ New Chat` mengisolasi sesi secara independen tanpa crosstalk respons antar sesi.
4. Filter pembacaan memori domain yang ketat dan ringkas.
