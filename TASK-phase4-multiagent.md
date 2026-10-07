# Petak — TASK Fase 4: Multi-Agent Worktree Lane Cockpit (Orca-Style)

## Ringkasan & Tujuan
Mengimplementasikan Fase 4 dari roadmap orkestrasi multi-agen (`vault/Projects/Petak/multi-agent-roadmap.md`):
Membangun antarmuka visual **Worktree Lane Cockpit** ala Orca dev environment dan manajemen siklus hidup Git worktree otomatis di backend Rust. Fitur ini memungkinkan pengguna melihat dan mengontrol beberapa agen yang bekerja secara paralel pada branch dan folder fisik terisolasi (`wt/<task>`), lengkap dengan live status timer, mini-log streaming, dan peninjauan diff instan tanpa konflik di branch utama.

## Scope Pengerjaan

### 1. Rust Core Worktree Manager (`crates/core/src/agent/worktree.rs`)
- Buat modul `crates/core/src/agent/worktree.rs`:
  - `WorktreeManager` & data models:
    * `WorktreeInfo`: `task_id`, `path`, `branch`, `base_branch`, `head_sha`, `is_dirty`, `created_at`.
    * Pembuatan worktree terisolasi: `git worktree add -b <branch> <path> <base_branch>`.
    * Pengecekan status & diff: `git diff <base_branch>...HEAD` dan `git status -s` di dalam worktree.
    * Pembersihan otomatis: `git worktree remove --force <path>` dan penghapusan branch sementara pasca-merge.
  - Tauri IPC Commands di `crates/app/src/commands/agent_commands.rs` (atau modul terkait):
    * `agent_worktree_list()`
    * `agent_worktree_create(task_id: String, branch: String, base_branch: Option<String>)`
    * `agent_worktree_diff(task_id: String)`
    * `agent_worktree_remove(task_id: String, delete_branch: bool)`
  - Unit tests di `crates/core/tests/` memvalidasi lifecycle worktree menggunakan repo git fixture temporer.

### 2. Frontend Svelte Worktree Lane Cockpit (`ui/features/agents/`)
- Komponen visual `WorktreeLanes.svelte` (dan integrasi di `AgentsPanel.svelte`):
  - Tampilan visual kolom/jalur sejajar (horizontal scrollable lanes) per bot yang aktif di worktree:
    * **Header Lane**: Avatar & Nama Bot (e.g. `Senior (Rust)`, `Senior2 (UI)`), status badge (`RUNNING`, `READY`, `BLOCKED`, `DONE`), dan live runtime counter (`mm:ss`).
    * **Branch Info**: Nama branch `wt/<nama-task>` dan indikator commit changes count.
    * **Mini Activity Feed / Log**: Cuplikan aksi tool atau terminal stream terkini dari agen.
    * **Aksi Cepat per Lane**:
      - 🔍 `Inspect Diff`: Langsung membuka preview diff perubahan worktree di editor tengah (`DiffView`).
      - 📂 `Open in Editor`: Membuka file yang sedang dikerjakan ke tab editor.
      - 🛑 `Cancel / Reclaim`: Tombol interupsi jika bot macet atau keluar jalur.
  - Tab Switcher di `AgentsPanel.svelte`: Toggle antara tampilan `Chat` biasa dan `Lanes Cockpit` (Orca style).

### 3. Safety & Budget Rules
- RAM idle app tetap < 150 MB, biner < 20 MB.
- Keamanan Git: Branch utama (`main`) tidak boleh dimodifikasi kotor secara langsung; isolasi ketat pada folder worktree.
- Unit test Rust core (`cargo test -p petak-core`) & Frontend (`npm test`) 100% PASS.

## Deliverables
1. Modul Rust `crates/core/src/agent/worktree.rs` dan Tauri IPC commands.
2. Komponen visual Svelte `WorktreeLanes.svelte` dan integrasi di `AgentsPanel.svelte`.
3. Test suite unit test untuk lifecycle worktree dan UI lane rendering.
4. Laporan verifikasi QA independen dan merge bersih ke branch `main`.
