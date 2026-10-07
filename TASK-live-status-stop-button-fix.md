# Petak — TASK Batch 33: Fix Agent Live Status Visibility, Persistent Stop Button & Cancel on New Chat

## Ringkasan Masalah
Pengguna mengalami kendala fatal pada AI Agent chat:
1. **Ilusi Bot Mati / Hang**:
   - Di `AgentChat.svelte`, `isBusy` didefinisikan sebagai:
     `!agentsStore.isWatchdogAborted && (agentsStore.isStreaming || (activeSlot?.status === 'busy' && agentsStore.isStreaming))`
   - Karena ketergantungan ganda pada `isStreaming`, saat backend slot memulai eksekusi atau berganti status, `isStreaming` dapat ter-reset menjadi `false` meskipun slot backend sedang `busy` menjalankan puluhan tool calls (`read_file`, `search_files`).
   - Akibatnya: indikator berpikir dan kartu live tool calls HILANG dari layar. Tampilan chat tampak kosong / "mati", pengguna tidak tahu apa yang sedang terjadi.
2. **Tombol Stop Hilang & Tidak Bisa Dibatalkan**:
   - Karena `isBusy` salah mengevaluasi menjadi `false`, tombol `⏹ Stop` tidak muncul (berganti menjadi tombol Send panah atas). Pengguna tidak bisa menghentikan bot yang sedang berjalan lama.
3. **Jawaban Masuk ke Sesi Lain / Nyasar**:
   - Karena mengira bot mati, pengguna mengklik `+ New Chat`.
   - Mengklik `+ New` mengganti `activeSessionId`, tetapi TIDAK membatalkan prompt yang sedang berjalan di background.
   - Ketika proses lama akhirnya selesai 3 menit kemudian, jawabannya diarahkan ke `savedSessions` (History), sehingga layar obrolan baru tetap kosong dan pengguna mengira jawabannya tidak muncul.

## Scope Pengerjaan

### 1. Frontend State & Live Tool Progress (`ui/features/agents/AgentChat.svelte`, `ui/features/agents/agents.svelte.ts`)
- Di `AgentChat.svelte`:
  - Perbaiki definisi `isBusy`:
    * `let isBusy = $derived(!agentsStore.isWatchdogAborted && (agentsStore.isStreaming || activeSlot?.status === 'busy'));`
  - Tampilkan Live Streaming Bubble dan tool calls selama `isBusy`:
    * Jika `isBusy` aktif, TAMPILKAN balon `message-row agent-row live-generating`.
    * Tampilkan status nyata: jika ada tool yang sedang berjalan (`activeToolCalls`), tampilkan nama tool (`⚡ read_file: lib/main.dart`, dsb). Jika belum ada token teks, tampilkan `"Sedang menginvestigasi kode proyek..."` dengan spinner/animasi denyut yang jelas.
  - Tombol **⏹ Stop**:
    * Selama `isBusy === true`, tombol input di pojok kanan bawah WAJIB berupa tombol `⏹ Stop` (berwarna merah/aksen) yang memanggil `agentsStore.cancelActivePrompt()`.
- Di `agents.svelte.ts`:
  - `handleSlotEvent`:
    * Saat menerima event `StatusChanged { status: 'busy' }`, set `this.isStreaming = true` jika slotId adalah slot aktif.
    * Jangan matikan `this.isStreaming = false` saat menerima `StatusChanged { status: 'ready' }` jika `sendPrompt` masih dalam proses `await api.agentPrompt`. `isStreaming` hanya dimatikan di blok `finally` dari `sendPrompt` atau saat `cancelActivePrompt`.
  - `newSession`:
    * Jika slot aktif sedang sibuk (`activeSlot?.status === 'busy'` atau `this.isStreaming`), panggil `await this.cancelActivePrompt()` terlebih dahulu untuk membatalkan proses background sebelum membuat sesi baru. Dengan begitu tidak ada proses lama yang tertinggal atau menyusup ke sesi baru.

### 2. Backend Rust Core (`crates/core/src/agent/slot.rs`)
- Pastikan `cancel_slot(slot_id)`:
  * Memanggil `client.session_cancel(&session_id)`.
  * Membunuh subproses anak (`client.terminate_subprocesses()`).
  * Mereset `slot.status = SlotStatus::Ready`.
  * Meng-emit `SlotEvent::StatusChanged { slot_id, status: SlotStatus::Ready }` agar frontend segera ter-unblock seketika.

### 3. Safety & Testing
- Unit tests Svelte & Rust 100% PASS (`npm test`, `cargo test -p petak-core`).
- Verifikasi tombol Stop muncul selama slot busy dan proses berhenti seketika saat Stop diklik.

## Deliverables
1. Indikator live status & tool calls selalu tampil selama bot sedang berpikir/membaca berkas.
2. Tombol Stop selalu aktif dan berfungsi nyata menghentikan proses seketika.
3. Tombol `+ New Chat` otomatis menghentikan proses aktif agar tidak ada jawaban nyasar.
4. QA audit independen dan merge bersih ke branch `main`.
