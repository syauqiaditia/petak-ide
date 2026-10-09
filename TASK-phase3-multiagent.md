# Petak — TASK Fase 3: Smart Context & Memory Engine (LSP Pruning & Semantic Memory)

## Ringkasan & Tujuan
Mengimplementasikan Fase 3 dari roadmap orkestrasi multi-agen (`vault/Projects/Petak/multi-agent-roadmap.md`):
Membangun mesin pemotongan konteks cerdas (Smart Context) berbasis LSP/symbol outline dan pembacaan memori Obsidian selektif berbasis domain (Semantic Memory Indexing). Tujuannya memangkas 60–80% konsumsi token prompt pada operasi konteks, mempercepat respon inferensi model, dan memastikan aturan proyek diinjeksi tepat sasaran tanpa menyumpal seluruh file markdown ke context window.

## Scope Pengerjaan

### 1. Rust Core (`crates/core/src/agent/`)
- **LSP / Symbol Outline Context Pruner (`context.rs`)**:
  - Buat modul `crates/core/src/agent/context.rs`:
    * Ekstraksi signature simbol, daftar fungsi, class outline, dan diagnostics aktif pada berkas target tanpa membaca file mentah 2000+ baris.
    * Pemformatan ringkas `PrunedContext`: ringkasan tipe, parameter, dan error aktif (LSP diagnostics) yang siap diinjeksi ke prompt.
    * Tauri command IPC: `agent_prune_context(file_path: String, line: Option<u32>, symbol: Option<String>) -> Result<PrunedContextResult, String>`.
- **Selective / Domain-Aware Obsidian Memory (`memory.rs`)**:
  - Perluas `crates/core/src/agent/memory.rs`:
    * Fungsi `get_domain_relevant_memory(project_root: Option<&Path>, active_file: Option<&str>) -> Vec<MemorySnippet>`:
      - Membaca file memory di `.petak/memory/` atau Obsidian vault (`conventions.md`, `gotchas.md`, `lessons.md`, `rules.md`).
      - Menyaring aturan berdasarkan domain berkas aktif (contoh: berkas `.dart` hanya mengambil aturan Flutter/Dart; `.rs` hanya mengambil Rust; `.svelte` hanya mengambil UI/Svelte).
    * Tauri command IPC: `agent_get_relevant_memory(active_file: Option<String>) -> Result<Vec<MemorySnippet>, String>`.

### 2. Frontend Svelte (`ui/features/agents/`)
- Di `agentsLogic.ts` & `AgentChat.svelte`:
  - Sambungkan context builder ke IPC `agent_prune_context` dan `agent_get_relevant_memory`:
    * Saat user menyertakan konteks berkas aktif (atau tombol `@`), panggil pruner untuk mendapatkan intisari simbol.
    * Tampilkan pill / badge penghematan token di composer bar: `⚡ Pruned (~70% token saved)`.
    * Injeksi potongan memory relevan secara otomatis ke header prompt `[PROJECT CONVENTIONS: <DOMAIN>]`.
  - Dukungan toggle setting di `SettingsModal.svelte` / `MemoryView.svelte` untuk mengaktifkan/menonaktifkan LSP Context Pruning & Domain Filtering.

### 3. Safety & Budget Rules
- RAM idle app tetap < 150 MB, biner < 20 MB.
- Latensi pemotongan konteks < 20 ms.
- Zero network polling saat panel tidak aktif.
- Unit test Rust core (`cargo test -p petak-core`) & Frontend (`npm test`) 100% PASS.

## Deliverables
1. Modul Rust `crates/core/src/agent/context.rs` & peningkatan `memory.rs`.
2. Integrasi prompt context builder & pill indikator di Svelte frontend.
3. Test suite unit test untuk context pruning & domain memory filtering.
4. Laporan verifikasi QA independen dan merge bersih ke branch `main`.
