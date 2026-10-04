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
 * Adds Ponytail and Caveman discipline directives to prompts.
 */
export function applyDisciplineDirectives(
  prompt: string,
  isPonytail: boolean,
  isCaveman: boolean
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

  if (directives.length === 0) return prompt;
  return `${directives.join('\n')}\n\n${prompt}`;
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

