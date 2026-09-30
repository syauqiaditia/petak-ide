# Kontrak Teknis Core <-> UI: AI Agents & Orkestrator (Phase 5 Track A)

Dokumen ini mendefinisikan kontrak TypeScript, payload Tauri command, event, dan aturan status untuk integrasi AI Agents (ACP, Hermes, Claude Code) di Petak IDE.

Referensi:
- Backend Tauri commands: `crates/app/src/agent_commands.rs`
- Rust agent models: `crates/core/src/agent/{acp.rs, hermes.rs, perm.rs, proposal.rs, slot.rs, team.rs, usage.rs}`
- UI/UX spec: `docs/phase5/ui-spec.md` §3, §5.1
- Core spec: `docs/phase5/spec.md` §1.1–§1.7
- Batch 3 panel exclusivity: `docs/batch3/contract.md` (B1)

---

## 1. Definisi Tipe Data TypeScript (`ui/features/agents/types.ts`)

```typescript
export type PermissionMode = 'read' | 'ask' | 'auto' | 'full';

export type AgentKind = 'claude-code' | 'hermes' | 'acp-custom' | 'openai';

export interface SlotConfig {
  id: string;
  label: string;
  kind: AgentKind | string;
  command?: string | null;
  hermesProfile?: string | null;
  model?: string | null;
  fallbackModel?: string | null;
  permission: PermissionMode | string;
  cwd: string;
}

export type SlotStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'busy'
  | 'stopped'
  | 'crashed'
  | { failed: { reason: string } };

export interface ModelOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface SlotCapabilities {
  load_session?: boolean;
  supports_set_model?: boolean;
  current_model?: string | null;
  available_models?: ModelOption[];
  supports_usage?: boolean;
  last_usage?: any;
}

export interface ChatMessage {
  id: string;
  timestamp: number;
  role: 'user' | 'agent' | 'system' | string;
  content: string;
  stop_reason?: string | null;
  metadata?: any;
}

export interface SlotSummary {
  id: string;
  label: string;
  kind: string;
  status: SlotStatus;
  session_id?: string | null;
  active_pid?: number | null;
  capabilities: SlotCapabilities;
  history_len: number;
  last_activity_secs_ago?: number | null;
  config: SlotConfig;
}

export interface TeamConfig {
  version: number;
  slots: SlotConfig[];
}

export interface KanbanBadge {
  running: number;
  ready: number;
  blocked: number;
}

export interface HermesProfileInfo {
  name: string;
  model?: string | null;
  is_active: boolean;
  kanban?: KanbanBadge | null;
}

export interface HermesDetectionResult {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  check_ok: boolean;
  profiles: HermesProfileInfo[];
}

export interface PendingPermissionRequest {
  requestId: string;
  slotId: string;
  sessionId: string;
  toolCall: any;
  createdAt: number;
}

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  text: string;
  old_lineno?: number | null;
  new_lineno?: number | null;
}

export interface Hunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

export interface Proposal {
  id: string;
  slotId: string;
  sessionId: string;
  path: string;
  oldContent: string;
  newContent: string;
  status: ProposalStatus;
  timestamp: number;
  hunks: Hunk[];
}

export interface UsageReport {
  reported: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cost?: number | null;
  contextPercentage?: number | null;
  displayText: string;
  raw?: any;
}

export interface PromptResponse {
  sessionId: string;
  stopReason?: string | null;
  message: string;
  usage?: any;
}

export interface FixWithAgentDraft {
  slotId: string;
  errorMessage: string;
  filePath?: string;
  line?: number;
  col?: number;
  codeContext?: string;
  toolchainSummary?: string;
  gitSummary?: string;
  userPrompt: string;
}
```

---

## 2. Event Streaming Core -> UI (`agent-event`)

Backend memancarkan event Tauri `"agent-event"` ketika status slot berubah, ACP memancarkan streaming chunk, permission diminta, atau usulan diff dibuat.

### Struktur Event (Tagged Enum Rust `SlotEvent`):
```typescript
export type SlotEvent =
  | { StatusChanged: { slot_id: string; status: SlotStatus } }
  | { Update: { slot_id: string; session_id: string; update: any } }
  | { Reaped: { slot_id: string } }
  | { PermissionRequested: { slot_id: string; request_id: string; tool_call: any } }
  | { ProposalCreated: { slot_id: string; proposal_id: string; path: string } };
```

---

## 3. Daftar Tauri Command Backend (`agent_*`)

Semua command dipanggil melalui `invoke()` di `ui/lib/api.ts`:

| Tauri Command | Parameter | Kembalian | Deskripsi |
|---|---|---|---|
| `agent_list_slots` | - | `SlotSummary[]` | Mendapatkan ringkasan seluruh slot |
| `agent_start` | `{ slotId: string }` | `SlotSummary` | Memulai/spawn proses ACP slot |
| `agent_prompt` | `{ slotId: string, prompt: string }` | `PromptResponse` | Mengirim prompt ke slot aktif |
| `agent_cancel` | `{ slotId: string }` | `void` | Membatalkan eksekusi prompt aktif |
| `agent_stop` | `{ slotId: string }` | `void` | Menghentikan proses ACP slot |
| `agent_detect_hermes` | - | `HermesDetectionResult` | Deteksi binary Hermes & profil |
| `agent_load_team` | - | `TeamConfig` | Memuat konfigurasi `.petak/team.json` |
| `agent_save_team` | `{ team: TeamConfig }` | `string` (path tersimpan) | Menyimpan konfigurasi `.petak/team.json` |
| `agent_add_slot` | `{ config: SlotConfig }` | `SlotSummary` | Menambah slot baru ke manager |
| `agent_update_slot` | `{ config: SlotConfig }` | `SlotSummary` | Memperbarui konfigurasi slot |
| `agent_remove_slot` | `{ slotId: string }` | `void` | Menghapus slot dari manager |
| `agent_get_allowlist` | - | `string[]` | Daftar perintah allowlist safe-mode |
| `agent_set_allowlist` | `{ allowlist: string[] }` | `void` | Memperbarui daftar allowlist |
| `agent_list_pending_permissions` | - | `PendingPermissionRequest[]` | Daftar permintaan izin tertunda |
| `agent_respond_permission` | `{ requestId: string, allow: boolean }` | `void` | Menyetujui atau menolak izin |
| `agent_list_proposals` | `{ slotId?: string }` | `Proposal[]` | Daftar usulan perubahan berkas |
| `agent_accept_proposal` | `{ proposalId: string }` | `void` | Menerima proposal & tulis ke disk |
| `agent_reject_proposal` | `{ proposalId: string }` | `void` | Menolak proposal & hapus buffer |
| `agent_accept_hunk` | `{ proposalId: string, hunkIdx: number }` | `void` | Menerima satu hunk dari proposal |
| `agent_get_usage` | `{ slotId: string }` | `UsageReport` | Mendapatkan laporan penggunaan kuota/token |

---

## 4. Aturan Arsitektur & Prinsip Ponytail

1. **Lazy Import & Nol Startup Cost:** Komponen `AgentsPanel.svelte` dan store terkait hanya di-load secara dinamis saat tab `agents` dibuka di Rail atau parameter URL `agent=true` aktif.
2. **Reuse DiffView:** Review perubahan pada `ProposedEdits.svelte` menggunakan komponen `DiffView.svelte` yang sudah ada, tanpa membuat diff viewer baru.
3. **Guardrails & Keamanan:**
   - Mode `full` wajib menampilkan modal konfirmasi bahaya dengan tombol merah sebelum diaktifkan.
   - Mode `ask` menampilkan permission card di percakapan dengan detail tool call.
   - Peringatan banner jujur ditampilkan untuk tool internal agen yang tidak melewati ACP fs.
4. **Usage Meter Jujur:** Jika agen tidak mengembalikan token/biaya, tampilkan teks abu-abu *"agen tidak melapor"*. Tidak ada angka buatan.
5. **Fix with Agent Transparan:** Pemicu dari Logcat atau Problems menyusun draf prompt lengkap yang dapat diedit pengguna sebelum dikirim.
6. **Badge Ponytail / Caveman:** Slot Hermes mendukung badge status & toggle mode ringkas / minimal sesuai standar bot.
