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
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= cursorPos) {
      return i;
    }
  }
  return 0; // wrap around to first
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
