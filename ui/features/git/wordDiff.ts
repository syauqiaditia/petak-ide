export interface WordToken {
  text: string;
  changed: boolean;
}

/**
 * Tokenize string into identifiers/words, whitespace, and punctuation.
 * Unicode and emoji aware.
 */
export function tokenize(str: string): string[] {
  if (!str) return [];
  const regex = /([\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_])/gu;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(str)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Compute word-level diff between two lines using Longest Common Subsequence (LCS).
 * Returns token lists for old and new line with changed=true on modified words.
 */
export function computeWordDiff(
  oldText: string,
  newText: string
): { oldTokens: WordToken[]; newTokens: WordToken[] } {
  if (oldText === newText) {
    return {
      oldTokens: [{ text: oldText, changed: false }],
      newTokens: [{ text: newText, changed: false }],
    };
  }

  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const n = oldTokens.length;
  const m = newTokens.length;

  if (n === 0) {
    return {
      oldTokens: [],
      newTokens: newTokens.map((t) => ({ text: t, changed: true })),
    };
  }
  if (m === 0) {
    return {
      oldTokens: oldTokens.map((t) => ({ text: t, changed: true })),
      newTokens: [],
    };
  }

  // DP table for LCS
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (oldTokens[i] === newTokens[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to find aligned tokens
  let i = n;
  let j = m;
  const oldRes: WordToken[] = [];
  const newRes: WordToken[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      oldRes.unshift({ text: oldTokens[i - 1], changed: false });
      newRes.unshift({ text: newTokens[j - 1], changed: false });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newRes.unshift({ text: newTokens[j - 1], changed: true });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      oldRes.unshift({ text: oldTokens[i - 1], changed: true });
      i--;
    }
  }

  return { oldTokens: oldRes, newTokens: newRes };
}
