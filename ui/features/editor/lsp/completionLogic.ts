import type { Completion } from '@codemirror/autocomplete';

/**
 * Detect if cursor/word position is immediately preceded by a dot '.'
 */
export function detectIsAfterDot(
  sliceDoc: (from: number, to: number) => string,
  pos: number,
  wordFrom?: number | null
): boolean {
  const charBeforePos = typeof wordFrom === 'number' ? wordFrom - 1 : pos - 1;
  return charBeforePos >= 0 ? sliceDoc(charBeforePos, charBeforePos + 1) === '.' : false;
}

/**
 * Build keyword completion options, suppressing them when immediately after a dot.
 */
export function getKeywordOptions(
  keywords: string[],
  prefix: string,
  isAfterDot: boolean
): (Completion & { _kindLetter?: string })[] {
  if (isAfterDot) return [];
  return (prefix ? keywords.filter((k) => k.toLowerCase().startsWith(prefix)) : keywords).map((kw) => ({
    label: kw,
    type: 'keyword',
    detail: 'keyword',
    _kindLetter: 'k',
    boost: 0,
  }));
}

/**
 * Build snippet completion options, suppressing them when immediately after a dot.
 */
export function getSnippetOptions(
  snippets: any[],
  prefix: string,
  isAfterDot: boolean
): (Completion & { _kindLetter?: string })[] {
  if (isAfterDot) return [];
  return (prefix ? snippets.filter((s) => s.label.toLowerCase().startsWith(prefix)) : snippets).map((opt) => ({
    ...opt,
    boost: -99,
  }));
}
