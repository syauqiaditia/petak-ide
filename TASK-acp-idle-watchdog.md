# Petak — TASK: ACP Activity-Based Idle Watchdog & Unstuck Self-Healing

## Ringkasan Masalah
Saat ini request prompt ACP di Rust core (`crates/core/src/agent/slot.rs` line 992) dipatok timeout kaku 120 detik (`Duration::from_secs(120)`). Masalah yang timbul:
1. Perintah berat di terminal bot (build, flutter run, test, install) sering memakan waktu > 2 menit tanpa selesai -> Rust memutus koneksi dengan error `ACP request timed out`.
2. Saat timeout terjadi, subproses terminal di background masih berjalan dan menahan pipa stdio/RPC -> saat user klik `Continue` atau kirim pesan baru, koneksi macet/hang dan tidak merespons langsung.

## Solusi & Scope Pengerjaan

### 1. Rust Core Gateway (`crates/core/src/agent/`)
- Di `crates/core/src/agent/acp.rs` & `slot.rs`:
  - **Activity-Based Watchdog (Idle Timeout)**:
    * Ganti timeout kaku total durasi menjadi idle timeout berbasis aktivitas: selama ada stream chunk token, tool update, atau log output, timer di-reset ke 0.
    * Hanya picu intervensi jika **0 aktivitas total selama 5 menit**.
  - **Pembersihan Pipa & Unstuck Subproses**:
    * Jika terjadi cancel manual (`session/cancel`) atau idle timeout: bunuh subproses terminal yang menggantung (SIGINT/SIGTERM), hapus pending response dari map `pending`, dan kosongkan antrean pipa stdio agar RPC langsung plong.
  - **Injeksi Self-Healing Recovery**:
    * Bila perintah terminal dihentikan otomatis karena macet, jangan bunuh slot agen.
    * Kirim sinyal failure/timeout yang jelas ke agen agar bot sadar perintahnya macet dan otomatis mencoba solusi alternatif tanpa membekukan IDE.

### 2. Frontend Svelte (`ui/features/agents/`)
- Di `AgentChat.svelte` & `agentsLogic.ts`:
  - Pastikan tombol `Continue` / input prompt langsung responsif dan tidak terblokir status `busy` palsu jika proses lama di-cancel atau dibersihkan.
  - Tampilkan status pemulihan interaktif saat perintah macet dibatalkan otomatis (`⚠️ Perintah terminal macet dibatalkan otomatis -> Melanjutkan...`).

### 3. Safety & Testing
- RAM idle tetap < 150 MB, biner < 20 MB.
- Unit test Rust core memvalidasi reset timer saat ada stream chunk dan pembersihan pipa saat cancel.
- Build dan test 100% PASS.
