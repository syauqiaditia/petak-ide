# Petak — TASK Fase 1: Multi-Engine ACP Gateway & Settings UI

## Ringkasan & Tujuan
Mengimplementasikan Fase 1 dari roadmap orkestrasi multi-agen (`vault/Projects/Petak/multi-agent-roadmap.md`):
Menjadikan Petak IDE sebagai multi-engine ACP host/client yang mendukung berbagai engine agent (Hermes Agent, Claude Code CLI, Antigravity via 9Router, OpenAI Codex) dengan cascading model dropdown di UI Settings, tombol preset tim 1-klik, dan persistensi terisolasi ke `.petak/team.json`.

## Scope Pengerjaan

### 1. Rust Core (`crates/core/src/agent/`)
- Perluas modul ACP (`crates/core/src/agent/acp.rs` & `slot.rs`):
  - Dukungan spawn multi-engine:
    * `hermes`: `hermes --profile <name> acp` (yang sudah ada).
    * `claude-code`: stdio adapter `npx @agentclientprotocol/claude-agent-acp` (atau binary claude).
    * `antigravity`: stdio bridge diarahkan ke 9Router proxy (`http://127.0.0.1:20128/v1`).
    * `openai`: stdio bridge dengan key dari OS Keychain.
    * `acp-custom`: custom command + args.
  - Auto-detection: probe ketersediaan CLI/endpoint di sistem (`hermes`, `claude`, 9Router port 20128).
  - Skema `SlotConfig` di `crates/core/src/agent/slot.rs`:
    * Field `engine` / `kind`: `hermes` | `claude-code` | `antigravity` | `openai` | `acp-custom`.
    * Validasi model yang dikunci ketat per engine.
- Tauri Commands & IPC (`crates/app/src/commands/` / `api.ts`):
  - Query daftar engine yang didukung beserta model yang valid untuk tiap engine.
  - Update & save konfigurasi team ke `.petak/team.json`.

### 2. Frontend Svelte (`ui/features/settings/` & `ui/features/agents/`)
- UI Settings Team / AI Agents (`SettingsModal.svelte` / `TeamEditor.svelte`):
  - Cascading dropdowns 2 tingkat:
    * Dropdown 1: Platform / Engine (`Hermes Agent`, `Claude Code CLI`, `Antigravity (via 9Router)`, `OpenAI Codex`).
    * Dropdown 2: Model terkunci sesuai pilihan engine:
      - Claude Code -> `claude-3-7-sonnet`, `claude-3-5-sonnet`, `claude-3-opus`.
      - Antigravity -> `ag/gemini-3.8-flash-high`, `ag/claude-opus-4.1`.
      - Codex -> `gpt-4o`, `o3-mini`, `o1`.
      - Hermes -> Model dari profil Hermes yang terdeteksi.
  - Tombol 1-Click Preset Tim: "Gunakan Susunan Tim Standar" (Manager: Antigravity Opus, Senior: Claude Code Sonnet, Reviewer: Gemini Flash).
  - Badge Engine + Model pada `AgentsPanel.svelte` & `AgentTabs.svelte`.

### 3. Safety & Budget Rules
- RAM idle app tetap < 150 MB, biner < 20 MB.
- Zero network polling saat panel agents tidak aktif.
- Unit tests Rust core (`cargo test -p petak-core`) & Frontend (`npm run test` / `npm run check`) 100% PASS.

## Deliverables
1. Kode backend Rust di `crates/core/src/agent/`.
2. Kode frontend Svelte di `ui/features/settings/` dan `ui/features/agents/`.
3. Unit test suite untuk engine & slot configuration.
4. Laporan verifikasi test & commit bersih di git worktree.
