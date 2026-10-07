# Petak — TASK Fase 5: Inline Ghost Diff & Autonomous Self-Healing Loop

## Ringkasan & Tujuan
Mengimplementasikan Fase 5 dari roadmap orkestrasi multi-agen (`vault/Projects/Petak/multi-agent-roadmap.md`):
Membangun fitur **Inline Ghost Diff** di editor CodeMirror 6 (pratinjau visual multi-line usulan kode agen langsung di sela baris kode dengan shortcut terima `Tab` / tolak `Esc`) dan **Autonomous Self-Healing Loop** (rantai verifikasi otomatis: patch diaplikasikan -> trigger Flutter Hot Reload -> eksekusi Maestro test flow -> jika gagal, feed balik error stack trace ke prompt agen untuk self-fix mandiri tanpa interupsi pengguna).

## Scope Pengerjaan

### 1. Frontend CodeMirror 6 Inline Ghost Diff (`ui/features/editor/`)
- Di `ui/features/editor/ghostDiff.ts` (dan integrasi di `Editor.svelte`, `keymap.ts`):
  - StateField & Extension `ghostDiff`:
    * Menerima usulan perubahan hunk kode dari agen (dari `ProposedEdits` atau IPC).
    * Render dekorasi inline: baris yang dihapus diberi highlight merah pudar (`.cm-ghost-diff-deletion`), baris yang ditambah ditampilkan sebagai block widget hijau (`.cm-ghost-diff-addition`).
    * Floating action bar / inline pills pada hunk: `✓ Terima (Tab)` dan `✕ Tolak (Esc)`.
    * Keyboard shortcuts di `keymap.ts`:
      - `Tab`: Menerima & menerapkan hunk perubahan ke dokumen editor.
      - `Esc`: Menolak dan membersihkan ghost diff.
  - Export fungsi helper `showGhostDiff(view, original, replacement, fromLine)` dan `clearGhostDiff(view)`.

### 2. Rust Core & Backend Self-Healing Engine (`crates/core/src/agent/`)
- Di `crates/core/src/agent/heal.rs` (dan integrasi ke `crates/core/src/run/`):
  - Modul `SelfHealingLoop`:
    * Menerima event penyelesaian patch dari agen.
    * Memeriksa ketersediaan runner Flutter aktif (`crates/core/src/run/flutter.rs`) -> memicu `hot_reload()`.
    * Memeriksa file tes Maestro aktif (`.petak/flows/*.yaml` atau `.maestro/*.yaml` via `crates/core/src/run/flow.rs`) -> mengeksekusi test runner headless.
    * Jika tes GAGAL: menangkap error logcat / assertion failure, menyusun paket prompt diagnosis `[SELF-HEALING: VERIFICATION FAILED]`, dan menginstruksikan slot agen untuk melakukan self-fix.
    * Guard pembatas: batas putaran self-healing maksimal 3 iterasi (`max_heal_attempts = 3`) untuk mencegah loop tak berujung dan menghemat kuota token.
  - Tauri IPC Commands di `crates/app/src/commands/agent_commands.rs`:
    * `agent_trigger_self_heal(task_id: String, active_file: String)`
    * `agent_get_self_heal_status(task_id: String)`

### 3. Frontend Self-Healing UI & Status Pill (`ui/features/agents/`)
- Di `AgentChat.svelte` & `WorktreeLanes.svelte`:
  - Context Pill di composer bar: `🔄 Self-Heal: Auto (Hot Reload + Test)`.
  - Tampilan status verifikasi interaktif saat agen selesai patch:
    * `⚡ Hot Reloading Flutter...`
    * `🧪 Running Maestro flow...`
    * `✅ Verification PASS` atau `⚠️ Test Failed -> Triggering Self-Fix Loop (1/3)`.

### 4. Safety & Budget Rules
- RAM idle app tetap < 150 MB, biner < 20 MB.
- Loop self-heal dipatok keras maksimal 3x retry; jika 3x gagal, otomatis pause dan laporkan blocker ke user.
- Unit test Rust core (`cargo test -p petak-core`) & Frontend (`npm test`) 100% PASS.

## Deliverables
1. Modul extension Svelte/CodeMirror 6 `ghostDiff.ts` dan integrasi editor.
2. Modul Rust `crates/core/src/agent/heal.rs` dan IPC commands.
3. Integrasi status self-healing pada agent chat & worktree lane.
4. Test suite unit test untuk ghost diff dan self-healing state machine.
5. Laporan verifikasi QA independen dan merge bersih ke branch `main`.
