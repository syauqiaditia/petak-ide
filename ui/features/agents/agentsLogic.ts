import type {
  PermissionMode,
  Proposal,
  UsageReport,
  FixWithAgentDraft,
  SlotStatus,
  SlotConfig,
  TeamConfig,
  HermesProfileInfo,
  EnginePlatformOption,
  RoleScopeInfo,
  AgentRole,
} from './types';
import type { GitDiffFile, GitHunk, GitDiffLine } from '../git/types';
import { escapeHtml, sanitizeUrl } from '../editor/lsp/markdown.ts';

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
  memoryContext: string = '',
  skillsInjection: string = ''
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

  if (skillsInjection && skillsInjection.trim()) {
    directives.push(skillsInjection.trim());
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
  { id: 'hermes', name: 'Hermes Agent', badge: '🤖 Hermes', desc: 'Daemon profil lokal Hermes CLI' },
  { id: 'claude-code', name: 'Claude Code CLI', badge: '🟣 Claude Code', desc: 'Anthropic Standalone CLI via ACP' },
  { id: 'antigravity', name: 'Antigravity (via 9Router)', badge: '🚀 Antigravity', desc: 'Google Gemini & Claude Opus via 9Router proxy' },
  { id: 'codex', name: 'OpenAI Codex', badge: '🟢 Codex', desc: 'OpenAI Autonomous Agent via ACP' },
  { id: 'acp-custom', name: 'Custom ACP Command', badge: '⚙️ Custom', desc: 'Perintah terminal bebas via stdio ACP' },
  { id: 'ollama', name: 'Local Ollama', badge: '🦙 Ollama', desc: 'Model offline tanpa internet' },
  { id: 'custom', name: 'Custom ACP Command', badge: '⚙️ Custom', desc: 'Perintah terminal bebas via stdio ACP' },
];

export const SUPPORTED_ENGINES: EnginePlatformOption[] = [
  {
    id: 'hermes',
    name: 'Hermes Agent',
    badge: '🤖 Hermes',
    desc: 'Daemon profil lokal Hermes CLI',
    defaultModel: 'ag/gemini-3.8-flash-high',
    models: [
      { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'Hermes Default', recommended: true },
      { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus Thinking', desc: 'Hermes Reasoning' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', desc: 'Hermes Cloud' },
      { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', desc: 'Hermes Cloud' },
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    badge: '🟣 Claude Code',
    desc: 'Anthropic Standalone CLI via ACP',
    defaultModel: 'claude-3-7-sonnet',
    models: [
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship', recommended: true },
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Coding Utama Cepat & Akurat' },
      { id: 'claude-3-opus', name: 'Claude 3 Opus', desc: 'Analisis Mendalam' },
    ],
  },
  {
    id: 'antigravity',
    name: 'Antigravity (via 9Router)',
    badge: '🚀 Antigravity',
    desc: 'Google Gemini & Claude Opus via 9Router proxy',
    defaultModel: 'ag/gemini-3.8-flash-high',
    models: [
      { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'Cepat & Hemat Kuota', recommended: true },
      { id: 'ag/claude-opus-4.1', name: 'Claude Opus 4.1', desc: 'Arsitektur & Reasoning Kuat', recommended: true },
      { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking', desc: 'Deep Reasoning Flagship' },
    ],
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    badge: '🟢 Codex',
    desc: 'OpenAI Autonomous Agent via ACP',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal Omnimodel Flagship', recommended: true },
      { id: 'o3-mini', name: 'o3-mini', desc: 'STEM & Coding Reasoning' },
      { id: 'o1', name: 'o1', desc: 'Deep Math & Logic Reasoning' },
    ],
  },
  {
    id: 'acp-custom',
    name: 'Custom ACP Command',
    badge: '⚙️ Custom',
    desc: 'Perintah terminal bebas via stdio ACP',
    defaultModel: 'custom-model',
    models: [
      { id: 'custom-model', name: 'Custom Model ID', desc: 'Model bebas via parameter CLI' },
    ],
  },
];

export const ENGINE_WHITELIST_MODELS: Record<string, ModelPreset[]> = {
  'claude-code': [
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship', recommended: true },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Coding Utama Cepat & Akurat' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus', desc: 'Analisis Mendalam' },
  ],
  antigravity: [
    { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'Cepat & Hemat Kuota', recommended: true },
    { id: 'ag/claude-opus-4.1', name: 'Claude Opus 4.1', desc: 'Arsitektur & Reasoning Kuat', recommended: true },
    { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking', desc: 'Deep Reasoning Flagship' },
  ],
  codex: [
    { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal Omnimodel Flagship', recommended: true },
    { id: 'o3-mini', name: 'o3-mini', desc: 'STEM & Coding Reasoning' },
    { id: 'o1', name: 'o1', desc: 'Deep Math & Logic Reasoning' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal Omnimodel Flagship', recommended: true },
    { id: 'o3-mini', name: 'o3-mini', desc: 'STEM & Coding Reasoning' },
    { id: 'o1', name: 'o1', desc: 'Deep Math & Logic Reasoning' },
  ],
  hermes: [
    { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'Hermes Profile Default', recommended: true },
    { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus Thinking', desc: 'Hermes Profile Fallback' },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', desc: 'Hermes Cloud' },
    { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o', desc: 'Hermes Cloud' },
  ],
  'acp-custom': [
    { id: 'custom-model', name: 'Custom Model ID', desc: 'Model custom via ACP command' },
  ],
  custom: [
    { id: 'custom-model', name: 'Custom Model ID', desc: 'Model custom via ACP command' },
  ],
  ollama: [
    { id: 'qwen2.5-coder:32b', name: 'Qwen 2.5 Coder 32B', desc: 'Coding Lokal Terbaik (16GB)', recommended: true },
    { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', desc: 'Cepat & Akurat (Mac 16GB)' },
    { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', desc: 'Enteng untuk Mac 8GB' },
    { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', desc: 'Reasoning Lokal' },
    { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', desc: 'Reasoning Ringan 8GB' },
  ],
};

export const PROVIDER_MODELS: Record<string, ModelPreset[]> = {
  antigravity: [
    { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'via Antigravity — Cepat, Hemat & Cerdas', recommended: true },
    { id: 'ag/claude-opus-4.1', name: 'Claude Opus 4.1', desc: 'via Antigravity — Arsitektur & Reasoning Kuat', recommended: true },
    { id: 'ag/claude-opus-4-6-thinking', name: 'Claude Opus 4.6 Thinking', desc: 'via Antigravity — Deep Reasoning & Arsitektur' },
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Reasoning Kuat & Multimodal' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Super Cepat & Hemat Kuota' },
  ],
  'claude-code': [
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship (Rekomendasi)', recommended: true },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Coding Utama Cepat & Akurat' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus', desc: 'Analisis Mendalam' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet v2', desc: 'Coding Standar Cepat & Akurat' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', desc: 'Sangat Cepat & Hemat Token' },
  ],
  codex: [
    { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal Omnimodel Flagship', recommended: true },
    { id: 'o3-mini', name: 'o3-mini', desc: 'STEM & Coding Reasoning' },
    { id: 'o1', name: 'o1', desc: 'Deep Math & Logic Reasoning' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Hemat Token & Kencang' },
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
  ],
  'acp-custom': [
    { id: 'custom-model', name: 'Custom Model ID', desc: 'Model custom via ACP command' },
  ],
  custom: [
    { id: 'custom-model', name: 'Custom Model ID', desc: 'Model custom via ACP command' },
  ],
  anthropic: [
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid Reasoning & Coding Flagship', recommended: true },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'Coding Utama Cepat & Akurat' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus', desc: 'Analisis Mendalam' },
  ],
  gemini: [
    { id: 'ag/gemini-3.8-flash-high', name: 'Gemini 3.8 Flash High', desc: 'via Antigravity — Rekomendasi Hermes', recommended: true },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Reasoning Kuat & Multimodal' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Super Cepat & Hemat Kuota' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal Omnimodel Flagship', recommended: true },
    { id: 'o3-mini', name: 'o3-mini', desc: 'STEM & Coding Reasoning' },
    { id: 'o1', name: 'o1', desc: 'Deep Math & Logic Reasoning' },
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

// ── Multi-Engine Cascading & Presets (Phase 1 ACP Gateway) ───────────────────

export function getEngineOptions(): EnginePlatformOption[] {
  return SUPPORTED_ENGINES;
}

export function normalizeEngineId(engine?: string | null): string {
  if (!engine) return 'hermes';
  const e = engine.trim().toLowerCase();
  if (e === 'openai') return 'codex';
  if (e === 'custom') return 'acp-custom';
  return e;
}

export function getModelsForEngine(
  engine?: string | null,
  hermesProfiles?: HermesProfileInfo[]
): ModelPreset[] {
  const norm = normalizeEngineId(engine);
  if (norm === 'hermes' && hermesProfiles && hermesProfiles.length > 0) {
    const list: ModelPreset[] = hermesProfiles.map((p) => ({
      id: p.model || p.name,
      name: `Hermes: ${p.name.charAt(0).toUpperCase() + p.name.slice(1)}`,
      desc: p.model ? `Model: ${p.model}` : 'Profil Hermes Lokal',
      recommended: p.is_active,
    }));
    for (const m of (ENGINE_WHITELIST_MODELS.hermes || [])) {
      if (!list.some((item) => item.id === m.id)) {
        list.push(m);
      }
    }
    return list;
  }

  return (
    ENGINE_WHITELIST_MODELS[norm] ||
    ENGINE_WHITELIST_MODELS[engine || ''] ||
    ENGINE_WHITELIST_MODELS.antigravity
  );
}

export function getDefaultModelForEngine(engine?: string | null): string {
  const norm = normalizeEngineId(engine);
  switch (norm) {
    case 'claude-code':
      return 'claude-3-7-sonnet';
    case 'antigravity':
      return 'ag/gemini-3.8-flash-high';
    case 'codex':
      return 'gpt-4o';
    case 'hermes':
      return 'ag/gemini-3.8-flash-high';
    case 'acp-custom':
      return 'custom-model';
    default:
      return 'ag/gemini-3.8-flash-high';
  }
}

export function isModelAllowedForEngine(
  engine: string,
  model: string,
  hermesProfiles?: HermesProfileInfo[]
): boolean {
  if (!engine || !model) return false;
  const models = getModelsForEngine(engine, hermesProfiles);
  return models.some((m) => m.id === model);
}

export function resetModelOnEngineChange(
  newEngine: string,
  _currentModel?: string | null,
  _hermesProfiles?: HermesProfileInfo[]
): string {
  return getDefaultModelForEngine(newEngine);
}

export function resolveModelForEngine(
  newEngine: string,
  currentModel?: string | null,
  hermesProfiles?: HermesProfileInfo[]
): string {
  if (currentModel && isModelAllowedForEngine(newEngine, currentModel, hermesProfiles)) {
    return currentModel;
  }
  return getDefaultModelForEngine(newEngine);
}

export function getStandardTeamPreset(cwd: string = 'project'): TeamConfig & SlotConfig[] {
  const slots: SlotConfig[] = [
    {
      id: 'manager',
      label: '👑 Manager',
      kind: 'antigravity',
      engine: 'antigravity',
      role: 'manager',
      model: 'ag/claude-opus-4.1',
      fallbackModel: 'ag/claude-opus-4-6-thinking',
      permission: 'ask',
      cwd,
    },
    {
      id: 'senior',
      label: '⚡ Senior',
      kind: 'claude-code',
      engine: 'claude-code',
      role: 'senior',
      model: 'claude-3-7-sonnet',
      fallbackModel: 'claude-3-5-sonnet',
      permission: 'ask',
      cwd,
    },
    {
      id: 'reviewer',
      label: '🔍 Reviewer',
      kind: 'antigravity',
      engine: 'antigravity',
      role: 'reviewer',
      model: 'ag/gemini-3.8-flash-high',
      fallbackModel: null,
      permission: 'ask',
      cwd,
    },
  ];

  const result = slots as any;
  result.version = 1;
  result.slots = slots;
  return result;
}

export function formatEngineName(engine?: string | null): string {
  if (!engine) return 'Hermes';
  const e = engine.toLowerCase();
  if (e.includes('antigravity')) return 'Antigravity';
  if (e.includes('claude')) return 'Claude Code';
  if (e.includes('codex') || e.includes('openai')) return 'Codex';
  if (e.includes('hermes')) return 'Hermes';
  if (e.includes('custom') || e.includes('acp')) return 'Custom ACP';
  if (e.includes('ollama')) return 'Ollama';
  return engine;
}

export function getEngineShortBadge(engine?: string | null): string {
  if (!engine) return 'H';
  const e = engine.toLowerCase();
  if (e.includes('antigravity')) return 'AG';
  if (e.includes('claude')) return 'C';
  if (e.includes('codex') || e.includes('openai')) return 'CX';
  if (e.includes('hermes')) return 'H';
  if (e.includes('custom') || e.includes('acp')) return 'ACP';
  if (e.includes('ollama')) return 'OL';
  return 'A';
}

export function formatShortModelName(model?: string | null): string {
  if (!model) return '';
  let m = model;
  if (m.startsWith('ag/')) m = m.slice(3);
  if (m.startsWith('anthropic/')) m = m.slice(10);
  if (m.startsWith('openai/')) m = m.slice(7);
  return m;
}

/**
 * Safely extracts text chunk from ACP session/update payloads.
 * Handles ACP agent_message_chunk objects ({ type: 'text', text: '...' }),
 * nested arrays, raw strings, deltas, and tool output updates without [object Object].
 */
export function extractChunkText(update: any): string {
  if (!update) return '';

  // Direct string
  if (typeof update === 'string') return update;

  // If update is an array of chunks
  if (Array.isArray(update)) {
    return update.map((item) => extractChunkText(item)).join('');
  }

  if (typeof update === 'object') {
    // If update contains a nested content field
    if (update.content !== undefined) {
      return extractChunkText(update.content);
    }
    // If update is an ACP content block { type: 'text', text: '...' }
    if (typeof update.text === 'string') {
      return update.text;
    }
    if (typeof update.delta === 'string') {
      return update.delta;
    }
    if (typeof update.message === 'string') {
      return update.message;
    }
    // If update has nested text object or array
    if (update.text && typeof update.text === 'object') {
      return extractChunkText(update.text);
    }
  }

  return '';
}

/**
 * Format inline markdown tokens: `code`, **bold**, *italic*, [label](url).
 * Input string must be pre-escaped against XSS.
 */
export function formatChatInline(escapedText: string): string {
  // Links: [label](url)
  let out = escapedText.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label, url) => {
      const safeHref = escapeHtml(sanitizeUrl(url));
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="chat-link">${label}</a>`;
    }
  );

  // Inline code: `code`
  out = out.replace(/`([^`]+)`/g, (_match, code) => {
    return `<code class="chat-inline-code">${code}</code>`;
  });

  // Bold: **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_match, bold) => {
    return `<strong>${bold}</strong>`;
  });

  // Italic: *text*
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, italic) => {
    return `<em>${italic}</em>`;
  });

  return out;
}

/**
 * Renders raw agent/user markdown text into safe, beautifully formatted HTML for chat bubbles.
 * Supports:
 * - Fenced code blocks with language tag and syntax container
 * - Headers (h1, h2, h3, h4)
 * - Bold (**text**) and Italic (*text*)
 * - Inline code (`code`)
 * - Bullet lists (- item, * item)
 * - Numbered lists (1. item)
 * - Safe hyperlinks ([label](url))
 * - Blockquotes (> quote)
 * - Paragraphs with line break preservation (<br/>)
 * All content is sanitized against XSS.
 */
export function renderChatMarkdown(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '';

  const normalized = raw.replace(/\r\n/g, '\n');

  // Split by fenced code blocks (```lang\n...```)
  const blocks = normalized.split(/(```[\s\S]*?```)/g);
  const htmlParts: string[] = [];

  for (const block of blocks) {
    if (!block) continue;

    if (block.startsWith('```') && block.endsWith('```')) {
      const inner = block.slice(3, -3);
      const firstNl = inner.indexOf('\n');
      let lang = '';
      let codeText = inner;
      if (firstNl !== -1) {
        const potentialLang = inner.slice(0, firstNl).trim();
        if (/^[a-zA-Z0-9_#-]+$/.test(potentialLang)) {
          lang = potentialLang;
          codeText = inner.slice(firstNl + 1);
        }
      }
      codeText = codeText.replace(/^\n+|\n+$/g, '');
      const escapedCode = escapeHtml(codeText);
      const langHeader = lang ? `<div class="chat-code-header"><span class="chat-code-lang">${escapeHtml(lang)}</span></div>` : '';
      const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      htmlParts.push(
        `<div class="chat-code-wrapper">${langHeader}<pre class="chat-code-block"><code${langClass}>${escapedCode}</code></pre></div>`
      );
    } else {
      // Process lines of markdown
      const lines = block.split('\n');
      let currentListType: 'ul' | 'ol' | null = null;
      let currentListItems: string[] = [];
      let currentParaLines: string[] = [];

      const flushList = () => {
        if (currentListType && currentListItems.length > 0) {
          const tag = currentListType;
          htmlParts.push(`<${tag} class="chat-list chat-${tag}">${currentListItems.map((li) => `<li>${li}</li>`).join('')}</${tag}>`);
          currentListType = null;
          currentListItems = [];
        }
      };

      const flushPara = () => {
        if (currentParaLines.length > 0) {
          const text = currentParaLines.join('<br/>').trim();
          if (text) {
            htmlParts.push(`<p class="chat-para">${text}</p>`);
          }
          currentParaLines = [];
        }
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
          flushList();
          flushPara();
          continue;
        }

        // Headers: # H1, ## H2, ### H3, #### H4
        const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headerMatch) {
          flushList();
          flushPara();
          const level = headerMatch[1].length;
          const text = formatChatInline(escapeHtml(headerMatch[2].trim()));
          htmlParts.push(`<h${level} class="chat-heading chat-h${level}">${text}</h${level}>`);
          continue;
        }

        // Bullet lists: - item, * item, + item
        const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
        if (bulletMatch) {
          flushPara();
          if (currentListType && currentListType !== 'ul') flushList();
          currentListType = 'ul';
          currentListItems.push(formatChatInline(escapeHtml((bulletMatch[1] || '').trim())));
          continue;
        }

        // Numbered lists: 1. item
        const numMatch = line.match(/^\s*\d+\.\s+(.*)$/);
        if (numMatch) {
          flushPara();
          if (currentListType && currentListType !== 'ol') flushList();
          currentListType = 'ol';
          currentListItems.push(formatChatInline(escapeHtml((numMatch[1] || '').trim())));
          continue;
        }

        // Blockquotes: > quote
        const quoteMatch = line.match(/^>\s*(.+)$/);
        if (quoteMatch) {
          flushList();
          flushPara();
          const text = formatChatInline(escapeHtml(quoteMatch[1].trim()));
          htmlParts.push(`<blockquote class="chat-quote">${text}</blockquote>`);
          continue;
        }

        // Normal paragraph line
        flushList();
        currentParaLines.push(formatChatInline(escapeHtml(line)));
      }

      flushList();
      flushPara();
    }
  }

  return htmlParts.join('');
}

// ── Role-Based Tool Scoping (Phase 2 Least Privilege Gateway) ────────────────

export const ROLE_SCOPE_BADGES: Record<string, string> = {
  manager: 'Tools: Scoped (Read/Plan only)',
  senior: 'Tools: Scoped (Implement & Build)',
  senior2: 'Tools: Scoped (UI & Toolchain)',
  techlead: 'Tools: Scoped (Architecture & Review)',
  reviewer: 'Tools: Scoped (QA & Test runner only)',
  custom: 'Tools: Scoped (Custom)',
};

export const DEFAULT_ROLE_WHITELISTS: Record<string, string[]> = {
  manager: ['read_file', 'list_directory', 'search_files', 'kanban_create', 'kanban_list', 'kanban_show'],
  senior: ['read_file', 'write_file', 'patch', 'search_files', 'terminal', 'git_worktree'],
  senior2: ['read_file', 'write_file', 'patch', 'search_files', 'terminal', 'flutter_run'],
  techlead: ['git_merge', 'git_checkout', 'review_diff', 'device_control', 'terminal', 'kanban_unblock'],
  reviewer: ['read_file', 'search_files', 'git_diff', 'run_test', 'kanban_complete', 'kanban_request_changes'],
  custom: [],
};

export const ROLE_BLACKLISTS: Record<string, string[]> = {
  manager: ['write_file', 'patch', 'terminal', 'kanban_complete'],
  senior: ['kanban_complete'],
  senior2: ['kanban_complete'],
  techlead: ['write_file', 'patch'],
  reviewer: ['write_file', 'patch', 'terminal'],
  custom: [],
};

export const ALL_AVAILABLE_TOOLS: string[] = [
  'read_file',
  'write_file',
  'patch',
  'search_files',
  'list_directory',
  'terminal',
  'git_diff',
  'git_checkout',
  'git_merge',
  'git_worktree',
  'review_diff',
  'device_control',
  'run_test',
  'flutter_run',
  'kanban_create',
  'kanban_list',
  'kanban_show',
  'kanban_complete',
  'kanban_unblock',
  'kanban_request_changes',
];

export const ROLE_SCOPE_DEFINITIONS: RoleScopeInfo[] = [
  {
    role: 'manager',
    badge: 'Tools: Scoped (Read/Plan only)',
    description: 'Least-privilege gateway aktif: peran Manager dibatasi ke operasi read, inspect & kanban plan.',
    defaultWhitelist: DEFAULT_ROLE_WHITELISTS.manager,
    blacklist: ROLE_BLACKLISTS.manager,
  },
  {
    role: 'senior',
    badge: 'Tools: Scoped (Implement & Build)',
    description: 'Least-privilege gateway aktif: peran Senior dibatasi ke read, code edit, cargo build & git worktree.',
    defaultWhitelist: DEFAULT_ROLE_WHITELISTS.senior,
    blacklist: ROLE_BLACKLISTS.senior,
  },
  {
    role: 'senior2',
    badge: 'Tools: Scoped (UI & Toolchain)',
    description: 'Least-privilege gateway aktif: peran Senior 2 dibatasi ke read, code edit, npm/vite build & flutter toolchain.',
    defaultWhitelist: DEFAULT_ROLE_WHITELISTS.senior2,
    blacklist: ROLE_BLACKLISTS.senior2,
  },
  {
    role: 'techlead',
    badge: 'Tools: Scoped (Architecture & Review)',
    description: 'Least-privilege gateway aktif: peran Techlead dibatasi ke git merge, review diff, device control & release build.',
    defaultWhitelist: DEFAULT_ROLE_WHITELISTS.techlead,
    blacklist: ROLE_BLACKLISTS.techlead,
  },
  {
    role: 'reviewer',
    badge: 'Tools: Scoped (QA & Test runner only)',
    description: 'Least-privilege gateway aktif: peran Reviewer dibatasi ke test runners, diff checks & review decisions.',
    defaultWhitelist: DEFAULT_ROLE_WHITELISTS.reviewer,
    blacklist: ROLE_BLACKLISTS.reviewer,
  },
  {
    role: 'custom',
    badge: 'Tools: Scoped (Custom)',
    description: 'Least-privilege gateway aktif: daftar tool ditentukan kustom oleh konfigurasi pengguna.',
    defaultWhitelist: [],
    blacklist: [],
  },
];

/**
 * Normalizes role string to standard identifier (manager, senior, senior2, techlead, reviewer, custom).
 */
export function normalizeRole(role?: string | null): string {
  if (!role) return 'custom';
  const r = role.trim().toLowerCase();
  if (r === 'manager') return 'manager';
  if (r === 'senior') return 'senior';
  if (r === 'senior2' || r === 'senior-2' || r === 'senior_2' || r === 'senior 2') return 'senior2';
  if (r === 'techlead' || r === 'tech-lead' || r === 'tech_lead' || r === 'tech lead') return 'techlead';
  if (r === 'reviewer') return 'reviewer';
  if (r === 'custom') return 'custom';
  return r;
}

/**
 * Infers role from slot properties (role field, hermesProfile, id, label).
 */
export function inferRoleFromSlot(slot?: Partial<SlotConfig> | null): string {
  if (!slot) return 'custom';
  if (slot.role) return normalizeRole(slot.role);
  const candidate = `${slot.hermesProfile || ''} ${slot.id || ''} ${slot.label || ''}`.toLowerCase();
  if (candidate.includes('senior2') || candidate.includes('senior 2') || candidate.includes('senior-2')) return 'senior2';
  if (candidate.includes('senior')) return 'senior';
  if (candidate.includes('manager')) return 'manager';
  if (candidate.includes('techlead') || candidate.includes('tech lead')) return 'techlead';
  if (candidate.includes('reviewer')) return 'reviewer';
  return 'custom';
}

/**
 * Returns role scoping label/badge for a given role or slot configuration.
 */
export function getRoleScopeBadge(roleOrSlot?: string | Partial<SlotConfig> | null): string {
  let role = 'custom';
  if (typeof roleOrSlot === 'string') {
    role = normalizeRole(roleOrSlot);
  } else if (roleOrSlot && typeof roleOrSlot === 'object') {
    role = inferRoleFromSlot(roleOrSlot);
  }
  return ROLE_SCOPE_BADGES[role] || ROLE_SCOPE_BADGES.custom;
}

/**
 * Returns default tool whitelist array for the specified role.
 */
export function getDefaultToolsForRole(role?: string | null): string[] {
  const norm = normalizeRole(role);
  return DEFAULT_ROLE_WHITELISTS[norm] ? [...DEFAULT_ROLE_WHITELISTS[norm]] : [];
}

/**
 * Returns the effective tools whitelist for a slot, respecting customWhitelist overrides.
 */
export function getEffectiveToolsForSlot(slot: Partial<SlotConfig>): string[] {
  if (Array.isArray(slot.customWhitelist) && slot.customWhitelist.length > 0) {
    return [...slot.customWhitelist];
  }
  const role = inferRoleFromSlot(slot);
  return getDefaultToolsForRole(role);
}

/**
 * Checks whether a tool is allowed for the given slot.
 */
export function isToolAllowedForSlot(slot: Partial<SlotConfig>, toolName: string): boolean {
  if (!toolName) return false;
  const allowed = getEffectiveToolsForSlot(slot);
  return allowed.includes(toolName.trim().toLowerCase());
}

/**
 * Validates, trims, and deduplicates an arbitrary list of tool names.
 */
export function validateCustomWhitelist(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  const set = new Set<string>();
  for (const item of tools) {
    if (typeof item === 'string' && item.trim()) {
      set.add(item.trim().toLowerCase());
    }
  }
  return Array.from(set);
}

/**
 * Returns descriptive human tooltip for the role scoping policy.
 */
export function getRoleScopeDescription(role?: string | null): string {
  const norm = normalizeRole(role);
  const def = ROLE_SCOPE_DEFINITIONS.find((d) => d.role === norm);
  return def ? def.description : 'Least-privilege gateway aktif untuk slot agen ini.';
}




