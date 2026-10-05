/**
 * TypeScript types for Petak AI Agents Panel (Phase 5 Track A).
 * Conforms to docs/phase5/contract-agent.md and crates/core/src/agent/*
 */

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

export interface CodeReference {
  path: string;
  line?: number;
  endLine?: number;
  symbol?: string;
  codeSnippet?: string;
}

export interface ToolCallData {
  name: string;
  arguments?: any;
  output?: string;
  status?: 'running' | 'completed' | 'failed' | 'requires_permission';
}

export interface ChatMessage {
  id: string;
  timestamp: number;
  role: 'user' | 'agent' | 'system' | string;
  content: string;
  stop_reason?: string | null;
  metadata?: any;
  toolCalls?: ToolCallData[];
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
  obsidianVaultPath?: string | null;
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

export type SlotEvent =
  | { StatusChanged: { slot_id: string; status: SlotStatus } }
  | { Update: { slot_id: string; session_id: string; update: any } }
  | { Reaped: { slot_id: string } }
  | { PermissionRequested: { slot_id: string; request_id: string; tool_call: any } }
  | { ProposalCreated: { slot_id: string; proposal_id: string; path: string } };

// ── 9Router Quota & Project Memory Types (Phase 5) ─────────────────────────

export interface ProviderQuotaInfo {
  id: string;
  provider: string;
  name?: string;
  isActive: boolean;
  lastError?: string;
  rateLimitedUntil?: string;
}

export interface LlmQuotaReport {
  proxyOnline: boolean;
  dbFound: boolean;
  todayDate: string;
  todayRequests: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  todayCost: number;
  providers: ProviderQuotaInfo[];
  statusMessage: string;
}

export interface MemoryItem {
  filename: string;
  title: string;
  size: number;
  updatedAt: number;
}

// ── Petak Skills Management Types ──────────────────────────────────────────

export interface SkillSummary {
  name: string;
  description: string;
  isCore: boolean;
  scope: 'system' | 'project';
  path: string;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  isCore: boolean;
  scope: 'system' | 'project';
  path: string;
}

// ── Petak Chat Session Types ──────────────────────────────────────────────

export interface ChatSessionMeta {
  id: string;
  slotId: string;
  title: string;
  createdAt: number;
  updatedAt?: number;
  messageCount: number;
  messages: ChatMessage[];
  modelId?: string | null;
}

