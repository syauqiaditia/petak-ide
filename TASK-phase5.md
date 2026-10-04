# Petak Fase 5: Integrasi Multi-Agent AI (ACP/Hermes) & GitLab MR Live

## 1. Scope & Tujuan
Menyelesaikan dan mengaktifkan fitur Fase 5 secara menyeluruh (Multi-Agent ACP + GitLab MR + Quota/Usage + Project Memory):
1. **Live Agent & ACP Integration (Rust Core + UI)**:
   - Spawning & komunikasi proses ACP nyata via stdio (`crates/core/src/agent/acp.rs`, `slot.rs`).
   - Deteksi otomatis profil Hermes lokal (`~/.hermes/profiles/`) dan team custom (`team.json`).
   - ProposedEdits: intercept edit agen ke buffer review diff (`DiffView.svelte`), aksi Terima / Tolak per hunk atau file.
   - "Fix with Agent": draft prompt transparan & editable dari error Problems/Logcat ke panel agent.
   - Mode disiplin: toggle PONYTAIL (coder) & CAVEMAN (chat/manager) per slot di `AgentTabs.svelte`.
2. **Live LLM Quota & Usage Panel (Rust Core + UI)**:
   - Endpoint probe nyata ke 9Router SQLite (`~/.9router/db/data.sqlite`) dan proxy `http://127.0.0.1:20128`: token harian, provider status, rate limit errors (`lastError`, `rateLimitedUntil`).
   - Tampilkan di tab Quota/Usage di panel Agents / Settings. DILARANG membuat angka palsu; jika data tidak ada, beri status "Tidak tersedia".
3. **Project Memory & Self-Improvement**:
   - Penyimpanan memory/lessons per project dalam format markdown (`.petak/memory/` atau folder vault Obsidian kompatibel).
   - Sinkronisasi tanpa dependensi wajib ke aplikasi Obsidian.
4. **GitLab MR Live Viewer**:
   - Integrasi REST v4 dengan token Keychain / secure token (`crates/core/src/gitlab/client.rs`).
   - Filter MR (Open, Mine, Assigned, Review requested), detail MR, thread diskusi, side-by-side diff, tombol Approve & Merge dengan sha validation.
5. **Verifikasi & Deliverables**:
   - Unit tests Rust (`cargo test -p petak-core`) & UI tests (`npm test`).
   - Manual test guide & checklist untuk UQi.
   - Kartu Mac verification (P5.M) ditandai menunggu Mac online.

## 2. Batasan Keras & Performance Budget
- **Budget RAM Idle**: < 150 MB (app idle tanpa agent aktif). Proses agent di-spawn secara LAZY hanya saat tab dibuka, dan di-reap jika idle > 10 menit.
- **Ukuran Biner**: < 20 MB (saat ini 6.61 MB, dilarang menambah dependensi HTTP berat; tetap gunakan `ureq`).
- **Keamanan Data**: DILARANG menyentuh repository kantor (`jatim-ist-mb-flutter`) atau PAT kantor untuk automated testing. Semua pengujian otomatis hanya memakai mock server lokal (`tiny_http`) dan dummy fixture.
- **Tanpa Data Palsu**: Status toolchain, kuota, token, dan devices dilarang keras di-hardcode.

## 3. Environment & Paths
- Server Rust:
  `export CARGO_HOME=/mnt/storage/uqi-cache/cargo RUSTUP_HOME=/mnt/storage/uqi-cache/rustup CARGO_TARGET_DIR=/mnt/storage/uqi-cache/cargo-target-petak PATH=/mnt/storage/uqi-cache/cargo/bin:$PATH`
- Workspace: `/mnt/storage/uqi-projects/petak-p4m`
- Branch: `feat/phase5-agent`

## 4. Pembagian Tugas
- `manager`: Pecah task menjadi subtask independen (Senior untuk Rust Core Quota & Live ACP, Senior2 untuk UI Agents/Quota/Memory, Reviewer untuk QA).
- `senior` (Rust Core): Implementasi live 9Router SQLite probe untuk quota, real ACP process stream I/O, project memory markdown writer.
- `senior2` (UI): Panel Quota/Usage, koneksi store live agent ACP, memory settings & viewer.
- `reviewer`: QA komprehensif, vitest, cargo test, verifikasi contract Rust <-> TS.
- `techlead`: Verifikasi akhir server, siapkan skrip build Mac (P5.M).
