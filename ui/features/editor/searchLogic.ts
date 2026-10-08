import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  isRegex: boolean;
}

export interface MatchRange {
  from: number;
  to: number;
}

export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null;
  try {
    let pattern = options.isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (options.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    const flags = options.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function findMatches(docText: string, query: string, options: SearchOptions): MatchRange[] {
  if (!query || !docText) return [];
  const regex = buildSearchRegex(query, options);
  if (!regex) return [];

  const matches: MatchRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(docText)) !== null) {
    if (m[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    matches.push({
      from: m.index,
      to: m.index + m[0].length,
    });
  }
  return matches;
}

export function getActiveMatchIndex(matches: MatchRange[], cursorPos: number): number {
  if (matches.length === 0) return -1;
  // Check if cursor is directly inside or on the boundary of a match
  for (let i = 0; i < matches.length; i++) {
    if (cursorPos >= matches[i].from && cursorPos <= matches[i].to) {
      return i;
    }
  }
  // Otherwise find the first match starting after cursor
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= cursorPos) {
      return i;
    }
  }
  return 0; // wrap around to first
}

export function getNextMatchIndex(currentIndex: number, totalMatches: number): number {
  if (totalMatches <= 0) return -1;
  if (currentIndex < 0) return 0;
  return (currentIndex + 1) % totalMatches;
}

export function getPrevMatchIndex(currentIndex: number, totalMatches: number): number {
  if (totalMatches <= 0) return -1;
  if (currentIndex < 0) return totalMatches - 1;
  return (currentIndex - 1 + totalMatches) % totalMatches;
}

export function formatMatchCount(currentIndex: number, totalMatches: number, query: string): string {
  if (!query) return '';
  if (totalMatches === 0) return '0 results';
  const displayIndex = currentIndex >= 0 ? currentIndex + 1 : 1;
  return `${displayIndex}/${totalMatches}`;
}

export function replaceOne(
  docText: string,
  match: MatchRange,
  replacement: string
): { newDocText: string; newRange: MatchRange } {
  const before = docText.slice(0, match.from);
  const after = docText.slice(match.to);
  const newDocText = before + replacement + after;
  return {
    newDocText,
    newRange: {
      from: match.from,
      to: match.from + replacement.length,
    },
  };
}

export function replaceAll(
  docText: string,
  query: string,
  replacement: string,
  options: SearchOptions
): { newDocText: string; count: number } {
  const regex = buildSearchRegex(query, options);
  if (!regex) return { newDocText: docText, count: 0 };

  let count = 0;
  const newDocText = docText.replace(regex, () => {
    count++;
    return replacement;
  });
  return { newDocText, count };
}

/**
 * Automatically populates search query from editor active selection.
 * Single-line only (extracts the first line if multiline text is selected).
 */
export function getSearchQueryFromSelection(selectedText?: string | null): string {
  if (!selectedText) return '';
  const firstLine = selectedText.split(/\r?\n/)[0] ?? '';
  return firstLine;
}

export const setSearchHighlights = StateEffect.define<{
  matches: MatchRange[];
  activeIndex: number;
}>();

export const searchHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchHighlights)) {
        const { matches, activeIndex } = effect.value;
        if (!matches || matches.length === 0) {
          return Decoration.none;
        }
        const docLen = tr.newDoc.length;
        const decos: any[] = [];
        matches.forEach((m, idx) => {
          if (m.from >= 0 && m.to <= docLen && m.from < m.to) {
            const isActive = idx === activeIndex;
            decos.push(
              Decoration.mark({
                class: isActive
                  ? 'cm-search-match cm-search-match-active'
                  : 'cm-search-match',
              }).range(m.from, m.to)
            );
          }
        });
        return Decoration.set(decos, true);
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
