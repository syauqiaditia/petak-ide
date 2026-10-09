# Petak — TASK Fase 2: Role-Based Tool Scoping (Least Privilege Gateway)

## Ringkasan & Tujuan
Mengimplementasikan Fase 2 dari roadmap orkestrasi multi-agen (`vault/Projects/Petak/multi-agent-roadmap.md`):
Menerapkan pembatasan akses tool secara fisik pada layer RPC / ACP handshake berdasarkan peran (`role`) bot slot. Tujuannya memangkas >=60% bloat skema tool pada context window, menghemat kuota token prompt secara drastis, dan mencegah bot melangkah di luar wewenangnya (zero phantom/illegal action).

## Matriks Wewenang & Tool Scoping per Peran

| Role | Whitelist Tool (Diizinkan) | Blacklist Tool (Dilarang Keras) |
| :--- | :--- | :--- |
| **Manager** | `read_file`, `list_directory`, `search_files`, `kanban_create`, `kanban_list`, `kanban_show` | `write_file`, `patch`, `terminal`, `kanban_complete` |
| **Senior (Rust/Core)** | `read_file`, `write_file`, `patch`, `search_files`, `terminal` (cargo/build/test saja), `git_worktree` | `kanban_complete`, arbitrary unchecked destructive shell |
| **Senior 2 (UI/Svelte)**| `read_file`, `write_file`, `patch`, `search_files`, `terminal` (npm/vite/build), `flutter_run` | `kanban_complete`, arbitrary unchecked destructive shell |
| **Techlead** | `git_merge`, `git_checkout`, `review_diff`, `device_control`, `terminal` (build/deploy/bench), `kanban_unblock` | Direct dirty unreviewed code editing |
| **Reviewer** | `read_file`, `search_files`, `git_diff`, `run_test` (cargo test / maestro), `kanban_complete`, `kanban_request_changes` | `write_file`, `patch`, arbitrary bash execution |

## Scope Pengerjaan

### 1. Rust Core Gateway (`crates/core/src/agent/`)
- Di `perm.rs` & `acp.rs`:
  - Tambahkan modul `ToolPolicy` / `RoleToolScope`:
    * Evaluasi role slot (`manager`, `senior`, `senior2`, `techlead`, `reviewer`, `custom`).
    * Filter daftar skema tool yang diiklankan saat handshake ACP session (`session/new`, `tools/list`).
    * Cegat pemanggilan tool (`session/request_permission` atau tool call dispatch): jika bot mencoba panggil tool yang masuk blacklist, tolak langsung di layer RPC dengan pesan error otoritas `ToolExecutionDenied: Role <role> does not have permission to execute <tool>`.
  - Pasang unit test di `crates/core/tests/` memvalidasi filter whitelist/blacklist per role dan penolakan RPC.

### 2. Frontend Svelte & UI Settings (`ui/features/settings/` & `ui/features/agents/`)
- Di `TeamEditor.svelte` & `SettingsModal.svelte`:
  - Tampilkan informasi ringkas wewenang per role (misal: badge `Tools: Scoped (Read/Plan only)` untuk Manager, `Tools: QA & Test runner only` untuk Reviewer).
  - Berikan opsi mode `Advanced`: toggle kustomisasi whitelist tool per bot jika pengguna ingin override wewenang.
- Di `AgentsPanel.svelte`:
  - Tampilkan indikator status proteksi scoped tools aktif (`🛡️ Tool Scoping: Active`).

### 3. Safety & Budget Rules
- RAM idle app tetap < 150 MB, biner < 20 MB.
- Nol latensi tambahan pada eksekusi tool legal (< 1 ms overhead Rust policy check).
- Pengurangan token skema tool terbukti >= 60% pada benchmark prompt slot.
- Unit test suite Rust & Frontend 100% PASS.

## Deliverables
1. Implementasi filter skema tool dan guard RPC di Rust core.
2. UI indikator & konfigurasi scoping di Svelte frontend.
3. Test suite unit test memvalidasi pemblokiran tool terlarang dan kelolosan tool legal.
4. Laporan verifikasi QA independen dan merge bersih ke branch `main`.
