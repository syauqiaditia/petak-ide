import type {
  PermissionMode,
  Proposal,
  UsageReport,
  FixWithAgentDraft,
  SlotStatus,
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



