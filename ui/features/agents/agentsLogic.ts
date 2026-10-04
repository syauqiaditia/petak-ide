import type {
  PermissionMode,
  Proposal,
  UsageReport,
  FixWithAgentDraft,
  SlotStatus,
} from './types';
import type { GitDiffFile, GitHunk, GitDiffLine } from '../git/types';

export const DEFAULT_ALLOWLIST = [
  'flutter',
  'dart',
  'gradlew',
  './gradlew',
  'npm test',
  'npm run',
  'cargo test',
  'cargo check',
  'pod install',
  'pytest',
];

/**
 * Checks whether an execution command is present in the safe allowlist.
 */
export function isCommandInAllowlist(command: string, allowlist: string[] = DEFAULT_ALLOWLIST): boolean {
  if (!command) return false;
  const normalized = command.trim().toLowerCase();
  return allowlist.some((allowed) => {
    const a = allowed.trim().toLowerCase();
    return normalized === a || normalized.startsWith(`${a} `) || normalized.includes(` ${a} `);
  });
}

/**
 * Pure evaluation of permission for a tool call or terminal execution.
 */
export function checkPermission(
  mode: PermissionMode,
  commandOrTool: string,
  allowlist: string[] = DEFAULT_ALLOWLIST
): 'approved' | 'denied' | 'ask' {
  switch (mode) {
    case 'read':
      return 'denied';
    case 'full':
      return 'approved';
    case 'auto':
      if (isCommandInAllowlist(commandOrTool, allowlist)) {
        return 'approved';
      }
      return 'ask';
    case 'ask':
    default:
      return 'ask';
  }
}

/**
 * Converts a core Proposal into a GitDiffFile usable directly by DiffView.svelte.
 */
export function proposalToDiffFile(proposal: Proposal): GitDiffFile {
  const gitHunks: GitHunk[] = proposal.hunks.map((hunk) => {
    const lines: GitDiffLine[] = hunk.lines.map((l) => ({
      kind: l.kind === 'add' ? 'add' : l.kind === 'del' ? 'del' : 'context',
      text: l.text,
      oldNo: l.old_lineno,
      newNo: l.new_lineno,
    }));

    return {
      oldStart: hunk.old_start,
      oldLines: hunk.old_lines,
      newStart: hunk.new_start,
      newLines: hunk.new_lines,
      header: `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@`,
      lines,
    };
  });

  return {
    oldPath: proposal.path,
    newPath: proposal.path,
    status: 'modified',
    binary: false,
    hunks: gitHunks,
  };
}

/**
 * Formats honest usage meter text without fabricating numbers.
 */
export function formatUsageText(usage?: UsageReport | null): { text: string; isReported: boolean } {
  if (!usage || !usage.reported) {
    return {
      text: 'Penggunaan kuota: agen tidak melapor',
      isReported: false,
    };
  }

  if (usage.displayText && usage.displayText !== 'tidak melapor') {
    return { text: usage.displayText, isReported: true };
  }

  const parts: string[] = [];
  if (usage.contextPercentage !== undefined && usage.contextPercentage !== null) {
    parts.push(`Context: ${Math.round(usage.contextPercentage)}%`);
  }
  if (usage.totalTokens !== undefined && usage.totalTokens !== null) {
    const tokensK = (usage.totalTokens / 1000).toFixed(1);
    parts.push(`Tokens: ${tokensK}k`);
  }
  if (usage.cost !== undefined && usage.cost !== null) {
    parts.push(`Biaya: ~$${usage.cost.toFixed(2)}`);
  }

  return {
    text: parts.length > 0 ? parts.join(' · ') : 'Penggunaan kuota: data terbatas',
    isReported: true,
  };
}

/**
 * Truncates lengthy tool output for readable chat bubbles.
 */
export function truncateToolOutput(text: string, maxLen = 300): { text: string; isTruncated: boolean } {
  if (!text) return { text: '', isTruncated: false };
  if (text.length <= maxLen) return { text, isTruncated: false };
  return {
    text: text.slice(0, maxLen) + '\n... [output dipotong, klik untuk memperluas]',
    isTruncated: true,
  };
}

/**
 * Composes a full, transparent prompt draft for "Fix with Agent" without stealth sending.
 */
export function buildFixWithAgentDraft(input: {
  errorMessage: string;
  filePath?: string;
  line?: number;
  col?: number;
  codeContext?: string;
  toolchainSummary?: string;
  gitSummary?: string;
  slotId: string;
}): FixWithAgentDraft {
  const sections: string[] = [];

  sections.push(`## Error Description\n${input.errorMessage.trim()}`);

  if (input.filePath) {
    const loc = input.line ? `${input.filePath}:${input.line}${input.col ? `:${input.col}` : ''}` : input.filePath;
    sections.push(`## Location\n\`${loc}\``);
  }

  if (input.codeContext) {
    sections.push(`## Code Context (±30 lines)\n\`\`\`\n${input.codeContext.trim()}\n\`\`\``);
  }

  if (input.toolchainSummary) {
    sections.push(`## Toolchain Version\n${input.toolchainSummary.trim()}`);
  }

  if (input.gitSummary) {
    sections.push(`## Git Status\n${input.gitSummary.trim()}`);
  }

  sections.push(`## Request\nTolong analisis error di atas dan usulkan solusi dengan diff minimal.`);

  return {
    slotId: input.slotId,
    errorMessage: input.errorMessage,
    filePath: input.filePath,
    line: input.line,
    col: input.col,
    codeContext: input.codeContext,
    toolchainSummary: input.toolchainSummary,
    gitSummary: input.gitSummary,
    userPrompt: sections.join('\n\n'),
  };
}

/**
 * Adds Ponytail, Caveman, and Self-Improve discipline directives to prompts,
 * optionally injecting relevant project memory context from Obsidian.
 */
export function applyDisciplineDirectives(
  prompt: string,
  isPonytail: boolean,
  isCaveman: boolean,
  isSelfImprove: boolean = false,
  memoryContext: string = ''
): string {
  const directives: string[] = [];

  if (isPonytail) {
    directives.push(
      '[DISCIPLINE: PONYTAIL — minimal diff, reuse existing helpers/components, no speculative abstractions, shortest path that works]'
    );
  }

  if (isCaveman) {
    directives.push('[DISCIPLINE: CAVEMAN — terse responses, direct answers, eliminate filler prose]');
  }

  if (isSelfImprove) {
    directives.push(
      '[DISCIPLINE: SELF-IMPROVE — Always consult project memory and conventions. When discovering a new bug fix pattern, user preference, or codebase quirk, formulate a concise lesson and propose saving it to project memory via lessons.md]'
    );
  }

  if (memoryContext && memoryContext.trim()) {
    directives.push(`[PROJECT MEMORY & OBSIDIAN CONVENTIONS]\n${memoryContext.trim()}`);
  }

  if (directives.length === 0) return prompt;
  return `${directives.join('\n\n')}\n\n${prompt}`;
}

/**
 * Extracts lesson / self-improvement insights from an agent's response text.
 */
export function extractLessonFromResponse(text: string): string | null {
  if (!text) return null;
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:pelajaran|lesson(?: learned)?|catatan|rule|kesimpulan):\s*(.+)/i);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Formats a lesson entry with ISO date stamp.
 */
export function formatLessonEntry(lesson: string, topic?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const prefix = topic ? `**[${date} — ${topic}]**` : `**[${date}]**`;
  return `- ${prefix} ${lesson.trim()}`;
}

/**
 * Validates slot status state-machine transitions.
 */
export function isValidSlotTransition(current: SlotStatus, next: SlotStatus): boolean {
  const c = typeof current === 'string' ? current : 'failed';
  const n = typeof next === 'string' ? next : 'failed';

  if (c === n) return true;

  switch (c) {
    case 'idle':
      return n === 'starting' || n === 'ready' || n === 'stopped';
    case 'starting':
      return n === 'ready' || n === 'failed' || n === 'stopped' || n === 'crashed';
    case 'ready':
      return n === 'busy' || n === 'stopped' || n === 'crashed' || n === 'idle';
    case 'busy':
      return n === 'ready' || n === 'failed' || n === 'stopped' || n === 'crashed';
    case 'stopped':
    case 'crashed':
    case 'failed':
      return n === 'starting' || n === 'idle';
    default:
      return true;
  }
}

/**
 * Formats token count with thousand separators (e.g. 12,738,477).
 */
export function formatTokens(count: number | null | undefined): string {
  if (count === null || count === undefined || isNaN(count)) return '0';
  return count.toLocaleString('en-US');
}

/**
 * Formats USD cost, e.g. $0.0000 or $12.3456.
 */
export function formatCostUsd(cost: number | null | undefined): string {
  if (cost === null || cost === undefined || isNaN(cost)) return '$0.0000';
  return `$${cost.toFixed(4)}`;
}

/**
 * Sanitizes markdown filename for project memory:
 * strips path traversal ('..', '/', '\'), ensures .md extension.
 */
export function sanitizeMemoryFilename(name: string): string {
  if (!name) return 'note.md';
  let clean = name.replace(/[/\\]/g, '').replace(/\.\.+/g, '').trim();
  if (!clean.endsWith('.md')) {
    clean += '.md';
  }
  return clean;
}

/**
 * Formats memory file size.
 */
export function formatMemorySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formats timestamp to human readable date string.
 */
export function formatMemoryTime(timestamp: number): string {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Model Presets & Provider Catalogs ────────────────────────────────────────

export interface ModelPreset {
  id: string;
  name: string;
  desc: string;
  recommended?: boolean;
}

export interface AgentPlatform {
  id: string;
  name: string;
  badge: string;
  desc: string;
}

export const AGENT_PLATFORMS: AgentPlatform[] = [
  { id: 'antigravity', name: 'Antigravity (via 9Router)', badge: '🚀 Antigravity', desc: 'Google Gemini & Claude Opus via 9Router proxy' },
  { id: 'claude-code', name: 'Claude Code CLI', badge: '🟣 Claude Code', desc: 'Anthropic Standalone CLI via ACP' },
  { id: 'codex', name: 'OpenAI Codex / GPT', badge: '🟢 Codex', desc: 'OpenAI Autonomous Agent via ACP' },
  { id: 'hermes', name: 'Hermes Agent', badge: '🤖 Hermes', desc: 'Daemon profil lokal Hermes' },
  { id: 'ollama', name: 'Local Ollama', badge: '🦙 Ollama', desc: 'Model offline tanpa internet' },
  { id: 'custom', name: 'Custom ACP Command', badge: '⚙️ Custom', desc: 'Perintah terminal bebas via stdio ACP' },
];

export const PROVIDER_MODELS: Record<string, ModelPreset[]> = {
  antigravity: [
    { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'via Antigravity — Cepat, Hemat & Cerdas', recommended: true },
    { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking', desc: 'via Antigravity — Deep Reasoning & Arsitektur', recommended: true },
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet v2', desc: 'Coding Standar Cepat & Akurat' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Reasoning Kuat & Multimodal' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Super Cepat & Hemat Kuota' },
  ],
  'claude-code': [
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship (Rekomendasi)', recommended: true },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet v2', desc: 'Coding Utama Cepat & Akurat' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', desc: 'Sangat Cepat & Hemat Token' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', desc: 'Analisis Mendalam' },
  ],
  codex: [
    { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal Omnimodel Flagship', recommended: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Hemat Token & Kencang' },
    { id: 'o3-mini', name: 'o3-mini', desc: 'STEM & Coding Reasoning' },
    { id: 'o1', name: 'o1', desc: 'Deep Math & Logic Reasoning' },
    { id: 'o1-mini', name: 'o1-mini', desc: 'Reasoning Ringan' },
  ],
  hermes: [
    { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'Hermes Profile Default', recommended: true },
    { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus Thinking', desc: 'Hermes Profile Fallback' },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', desc: 'Hermes Cloud' },
    { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', desc: 'Hermes Cloud' },
  ],
  ollama: [
    { id: 'qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', desc: 'Coding Lokal Terbaik (16GB)', recommended: true },
    { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', desc: 'Cepat & Akurat (Mac 16GB)' },
    { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', desc: 'Enteng untuk Mac 8GB' },
    { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', desc: 'Reasoning Lokal' },
    { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', desc: 'Reasoning Ringan 8GB' },
    { id: 'llama3.3:70b', name: 'Llama 3.3 70B', desc: 'Model Besar Serbaguna' },
    { id: 'llama3.1:8b', name: 'Llama 3.1 8B', desc: 'Lokal Cepat Standar' },
  ],
  custom: [
    { id: 'custom-model', name: 'Custom Model ID', desc: 'Model custom via ACP command' },
  ],
  // Compatibility aliases
  anthropic: [
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship', recommended: true },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet v2', desc: 'Coding Utama Cepat & Akurat' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', desc: 'Sangat Cepat & Hemat Token' },
  ],
  gemini: [
    { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'via Antigravity — Rekomendasi Hermes', recommended: true },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Reasoning Kuat & Multimodal' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Super Cepat & Hemat Kuota' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal Omnimodel Flagship', recommended: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Hemat Token & Kencang' },
    { id: 'o3-mini', name: 'o3-mini', desc: 'STEM & Coding Reasoning' },
  ],
};

export const ALL_PRESET_MODELS: ModelPreset[] = [
  ...PROVIDER_MODELS.antigravity,
  ...PROVIDER_MODELS['claude-code'],
  ...PROVIDER_MODELS.codex,
  ...PROVIDER_MODELS.hermes,
  ...PROVIDER_MODELS.ollama,
].filter((m, idx, self) => self.findIndex((x) => x.id === m.id) === idx);

export function getModelsForProvider(provider: string): ModelPreset[] {
  return PROVIDER_MODELS[provider] || PROVIDER_MODELS.antigravity;
}

export function detectProviderFromModel(modelId: string): string {
  if (!modelId) return 'antigravity';
  const m = modelId.toLowerCase();
  if (m.startsWith('ag/')) return 'antigravity';
  if (m.includes('claude')) return 'claude-code';
  if (m.includes('gemini')) return 'antigravity';
  if (m.includes('gpt') || m.startsWith('o1') || m.startsWith('o3')) return 'codex';
  if (m.includes('qwen') || m.includes('deepseek') || m.includes('llama') || m.includes('ollama')) return 'ollama';
  if (m.includes('hermes')) return 'hermes';
  return 'antigravity';
}

export function getModelDisplayName(modelId: string): string {
  if (!modelId) return 'Pilih Model...';
  for (const list of Object.values(PROVIDER_MODELS)) {
    const found = list.find((m) => m.id === modelId);
    if (found) return `${found.name} (${found.id})`;
  }
  return modelId;
}

export function getModelDescription(modelId: string): string {
  if (!modelId) return '';
  for (const list of Object.values(PROVIDER_MODELS)) {
    const found = list.find((m) => m.id === modelId);
    if (found?.desc) return found.desc;
  }
  return '';
}


