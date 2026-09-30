import type { EditorView } from '@codemirror/view';
import type { FormatRange, FormatResult } from '../../lib/api';

export interface MinimalDiff {
  from: number;
  to: number;
  insert: string;
}

/**
 * Detect language identifier from file path.
 */
export function detectLanguage(path: string): string {
  const parts = path.split('.');
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';
  switch (ext) {
    case 'dart':
      return 'dart';
    case 'kt':
    case 'kts':
      return 'kotlin';
    case 'swift':
      return 'swift';
    case 'json':
      return 'json';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'js':
    case 'jsx':
    case 'mjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
    case 'mts':
      return 'typescript';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'md':
    case 'markdown':
      return 'markdown';
    default:
      return ext || 'plaintext';
  }
}

/**
 * Compute the minimal single-range text edit between original and formatted text.
 * Trims common prefix and common suffix so the replacement is minimal,
 * keeping cursor and folding intact without jumping.
 * Returns null if strings are identical.
 */
export function computeMinimalDiff(
  originalText: string,
  formattedText: string
): MinimalDiff | null {
  if (originalText === formattedText) return null;

  const origLen = originalText.length;
  const fmtLen = formattedText.length;

  // 1. Find length of common prefix
  let prefix = 0;
  while (
    prefix < origLen &&
    prefix < fmtLen &&
    originalText.charCodeAt(prefix) === formattedText.charCodeAt(prefix)
  ) {
    prefix++;
  }

  // 2. Find length of common suffix
  let suffix = 0;
  while (
    suffix < origLen - prefix &&
    suffix < fmtLen - prefix &&
    originalText.charCodeAt(origLen - 1 - suffix) ===
      formattedText.charCodeAt(fmtLen - 1 - suffix)
  ) {
    suffix++;
  }

  const from = prefix;
  const to = origLen - suffix;
  const insert = formattedText.slice(prefix, fmtLen - suffix);

  return { from, to, insert };
}

// Format-on-save persistent configuration (per language, default OFF)
const STORAGE_KEY = 'petak_format_on_save';

export function getFormatOnSaveConfig(): Record<string, boolean> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function isFormatOnSaveEnabled(lang: string): boolean {
  const config = getFormatOnSaveConfig();
  return Boolean(config[lang]);
}

export function setFormatOnSave(lang: string, enabled: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const config = getFormatOnSaveConfig();
    config[lang] = enabled;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

/**
 * Formats document or selection:
 * - Kotlin via LSP formatting when available
 * - Core format_document command for Dart, Swift, JSON, YAML, JS, TS, HTML, CSS, Markdown
 * - Applies result as minimal diff in ONE CodeMirror transaction (single undo step, no cursor jumping)
 * - Returns clear message if formatter tool not found with installation hint
 */
export async function formatDocumentOrSelection(
  view: EditorView,
  path: string,
  range?: FormatRange,
  onStatusChange?: (msg: string) => void
): Promise<boolean> {
  const { api } = await import('../../lib/api');
  const { applyTextEditsToView } = await import('./lsp/applyEdit');
  const doc = view.state.doc.toString();
  const lang = detectLanguage(path);

  // 1. If Kotlin document (no range) and LSP is running, try LSP formatting first
  if (lang === 'kotlin' && !range) {
    try {
      const lspEdits = await api.lsp.format(path);
      if (lspEdits && lspEdits.length > 0) {
        const applied = applyTextEditsToView(view, lspEdits);
        if (applied) {
          onStatusChange?.(`Formatted via Kotlin LSP (${lspEdits.length} edits)`);
          return true;
        }
      }
    } catch {
      // Fallback to core format_document
    }
  }

  // 2. Call core format_document
  try {
    const res: FormatResult = await api.formatDocument({
      path,
      lang,
      text: doc,
      range,
    });

    if (!res || !res.formatted) {
      onStatusChange?.('Document already formatted');
      return true;
    }

    const diff = computeMinimalDiff(doc, res.formatted);
    if (!diff) {
      onStatusChange?.('Document already formatted');
      return true;
    }

    // Apply minimal change in a SINGLE CodeMirror transaction
    view.dispatch({
      changes: { from: diff.from, to: diff.to, insert: diff.insert },
      userEvent: 'format',
    });

    onStatusChange?.(`Formatted with ${res.tool || 'formatter'}`);
    return true;
  } catch (err: any) {
    const msg = typeof err === 'string' ? err : err?.message || String(err);
    onStatusChange?.(msg);
    return false;
  }
}
