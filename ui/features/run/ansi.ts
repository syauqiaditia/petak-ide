/**
 * ANSI Color & Style parser for Run Console logs.
 * Converts ANSI SGR escape sequences into styled HTML spans
 * and supports search highlight and line matching.
 */

export interface AnsiToken {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

const ANSI_COLOR_MAP: Record<number, string> = {
  30: '#2e3440', // Black
  31: '#f07a74', // Red (error/stderr)
  32: '#5cdb95', // Green (success/reload)
  33: '#e8b45a', // Yellow (warning)
  34: '#64a0f4', // Blue (info)
  35: '#c084fc', // Magenta
  36: '#4ec9b0', // Cyan (tags/info)
  37: '#d4d6dc', // White

  90: '#858994', // Bright Black / Gray
  91: '#ff8585', // Bright Red
  92: '#73e5a7', // Bright Green
  93: '#fad064', // Bright Yellow
  94: '#80b6ff', // Bright Blue
  95: '#d8a8ff', // Bright Magenta
  96: '#6ce0cb', // Bright Cyan
  97: '#ffffff', // Bright White
};

/**
 * Strips all ANSI escape sequences from text.
 */
export function stripAnsi(text: string): string {
  if (!text) return '';
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Escapes raw HTML entities.
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parses raw text containing ANSI SGR escape sequences into structured tokens.
 */
export function parseAnsiToTokens(raw: string): AnsiToken[] {
  if (!raw) return [];

  const tokens: AnsiToken[] = [];
  const regex = /\x1b\[([0-9;]*)m/g;

  let lastIndex = 0;
  let currentColor: string | undefined = undefined;
  let isBold = false;
  let isDim = false;
  let isUnderline = false;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    const textSegment = raw.slice(lastIndex, match.index);
    if (textSegment.length > 0) {
      tokens.push({
        text: textSegment,
        color: currentColor,
        bold: isBold || undefined,
        dim: isDim || undefined,
        underline: isUnderline || undefined,
      });
    }

    const codeStr = match[1] || '0';
    const codes = codeStr.split(';').map((s) => (s ? parseInt(s, 10) : 0));

    for (const code of codes) {
      if (code === 0) {
        currentColor = undefined;
        isBold = false;
        isDim = false;
        isUnderline = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isDim = true;
      } else if (code === 4) {
        isUnderline = true;
      } else if (code === 22) {
        isBold = false;
        isDim = false;
      } else if (code === 24) {
        isUnderline = false;
      } else if (code === 39) {
        currentColor = undefined;
      } else if (ANSI_COLOR_MAP[code]) {
        currentColor = ANSI_COLOR_MAP[code];
      }
    }

    lastIndex = regex.lastIndex;
  }

  const remaining = raw.slice(lastIndex);
  if (remaining.length > 0) {
    tokens.push({
      text: remaining,
      color: currentColor,
      bold: isBold || undefined,
      dim: isDim || undefined,
      underline: isUnderline || undefined,
    });
  }

  return tokens;
}

/**
 * Converts text with ANSI escape codes into styled HTML spans.
 */
export function parseAnsiToHtml(raw: string, defaultStream?: 'stdout' | 'stderr'): string {
  if (!raw) return '';
  const tokens = parseAnsiToTokens(raw);
  if (tokens.length === 0) return '';

  return tokens
    .map((token) => {
      const escaped = escapeHtml(token.text);
      const color = token.color || (defaultStream === 'stderr' ? '#f07a74' : undefined);

      const styles: string[] = [];
      if (color) styles.push(`color: ${color};`);
      if (token.bold) styles.push('font-weight: bold;');
      if (token.dim) styles.push('opacity: 0.7;');
      if (token.underline) styles.push('text-decoration: underline;');

      if (styles.length > 0) {
        return `<span style="${styles.join(' ')}">${escaped}</span>`;
      }
      return escaped;
    })
    .join('');
}

/**
 * Searches plain text lines and returns indices of all matching lines.
 * Retains all lines and does not filter anything out.
 */
export function findMatchingLineIndices(
  lines: Array<{ line: string } | string>,
  query: string,
  options: { caseSensitive?: boolean; isRegex?: boolean } = {}
): number[] {
  if (!query || !query.trim() || !lines || lines.length === 0) return [];

  const q = query.trim();
  let regex: RegExp | null = null;
  try {
    const pattern = options.isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
  } catch {
    regex = null;
  }

  const indices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const rawLine = typeof lines[i] === 'string' ? (lines[i] as string) : (lines[i] as { line: string }).line;
    const cleanLine = stripAnsi(rawLine);
    if (regex) {
      regex.lastIndex = 0;
      if (regex.test(cleanLine)) {
        indices.push(i);
      }
    } else {
      const match = options.caseSensitive
        ? cleanLine.includes(q)
        : cleanLine.toLowerCase().includes(q.toLowerCase());
      if (match) {
        indices.push(i);
      }
    }
  }
  return indices;
}

/**
 * Renders a full run log line with ANSI styles and search keyword highlight.
 */
export function formatRunLogLineHtml(
  rawText: string,
  stream?: 'stdout' | 'stderr',
  searchQuery?: string,
  isActiveLineMatch?: boolean,
  options: { caseSensitive?: boolean; isRegex?: boolean } = {}
): string {
  if (!rawText) return '';

  const q = (searchQuery || '').trim();
  if (!q) {
    return parseAnsiToHtml(rawText, stream);
  }

  let searchRegex: RegExp | null = null;
  try {
    const pattern = options.isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchRegex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
  } catch {
    searchRegex = null;
  }

  const tokens = parseAnsiToTokens(rawText);

  return tokens
    .map((token) => {
      let content = escapeHtml(token.text);

      if (searchRegex) {
        searchRegex.lastIndex = 0;
        content = content.replace(searchRegex, (matched) => {
          const activeClass = isActiveLineMatch ? ' is-active' : '';
          return `<mark class="run-search-highlight${activeClass}">${matched}</mark>`;
        });
      } else {
        const lowerText = content.toLowerCase();
        const lowerQ = q.toLowerCase();
        if (lowerText.includes(lowerQ)) {
          const idx = lowerText.indexOf(lowerQ);
          const before = content.slice(0, idx);
          const matched = content.slice(idx, idx + q.length);
          const after = content.slice(idx + q.length);
          const activeClass = isActiveLineMatch ? ' is-active' : '';
          content = `${before}<mark class="run-search-highlight${activeClass}">${matched}</mark>${after}`;
        }
      }

      const color = token.color || (stream === 'stderr' ? '#f07a74' : undefined);
      const styles: string[] = [];
      if (color) styles.push(`color: ${color};`);
      if (token.bold) styles.push('font-weight: bold;');
      if (token.dim) styles.push('opacity: 0.7;');
      if (token.underline) styles.push('text-decoration: underline;');

      if (styles.length > 0) {
        return `<span style="${styles.join(' ')}">${content}</span>`;
      }
      return content;
    })
    .join('');
}
