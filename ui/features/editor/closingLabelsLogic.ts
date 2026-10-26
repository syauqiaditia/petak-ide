/**
 * Pure closing labels logic for Flutter / Dart editor in Petak (Batch 54).
 * Scans Dart AST / tokens for multi-line widget constructors and converts Dart LSP labels.
 * Usable in browser UI and headless node tests.
 */

export interface ClosingLabelItem {
  line: number;
  label: string;
}

export interface LspClosingLabel {
  label: string;
  range: {
    start?: { line: number; character?: number };
    end: { line: number; character?: number };
  };
}

/**
 * Extracts closing labels from Dart source code by tracking nested multi-line
 * PascalCase constructor invocations.
 *
 * Rules:
 * - Detects PascalCase constructors or generics, e.g. Scaffold(, Padding(, Consumer<AuthViewModel>(, ITextField(.
 * - Ignores single-line invocations where open and close parens are on the same line (e.g. const SizedBox(width: 8),).
 * - Associates the closing paren ')' line with the caller widget name.
 * - Returns 1-based line numbers sorted in ascending order.
 */
export function extractClosingLabels(code: string): ClosingLabelItem[] {
  if (!code || typeof code !== 'string') return [];

  const results: ClosingLabelItem[] = [];

  interface ParenFrame {
    isWidget: boolean;
    label: string;
    startLine: number;
  }

  const stack: ParenFrame[] = [];
  const len = code.length;
  let currentLine = 1;
  let i = 0;

  // Pattern for widget constructor right before '('
  // Matches PascalCase identifier, optional generic <...>, optional named constructor .builder
  const widgetPattern = /(?:^|[^a-zA-Z0-9_$])([A-Z][a-zA-Z0-9_$]*(?:<[^>\n]+>)?(?:\.[a-zA-Z0-9_$]+)?)$/;

  while (i < len) {
    const ch = code[i];

    // Handle newlines
    if (ch === '\n') {
      currentLine++;
      i++;
      continue;
    }

    // Skip single-line comments: // ...
    if (ch === '/' && i + 1 < len && code[i + 1] === '/') {
      i += 2;
      while (i < len && code[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Skip multi-line comments (Dart supports nested block comments)
    if (ch === '/' && i + 1 < len && code[i + 1] === '*') {
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (code[i] === '\n') {
          currentLine++;
          i++;
        } else if (code[i] === '/' && i + 1 < len && code[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (code[i] === '*' && i + 1 < len && code[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // Skip strings (single, double, triple-quoted, raw)
    if (ch === "'" || ch === '"') {
      const quoteChar = ch;
      const isRaw = i > 0 && code[i - 1] === 'r';
      const isTriple = i + 2 < len && code[i + 1] === quoteChar && code[i + 2] === quoteChar;

      if (isTriple) {
        i += 3;
        while (i < len) {
          if (code[i] === '\n') {
            currentLine++;
            i++;
          } else if (
            code[i] === quoteChar &&
            i + 2 < len &&
            code[i + 1] === quoteChar &&
            code[i + 2] === quoteChar
          ) {
            i += 3;
            break;
          } else if (!isRaw && code[i] === '\\' && i + 1 < len) {
            if (code[i + 1] === '\n') currentLine++;
            i += 2;
          } else {
            i++;
          }
        }
      } else {
        i++;
        while (i < len) {
          if (code[i] === '\n') {
            currentLine++;
            i++;
            break; // Unterminated single-line string
          } else if (code[i] === quoteChar) {
            i++;
            break;
          } else if (!isRaw && code[i] === '\\' && i + 1 < len) {
            if (code[i + 1] === '\n') currentLine++;
            i += 2;
          } else {
            i++;
          }
        }
      }
      continue;
    }

    // Opening parenthesis
    if (ch === '(') {
      // Look back for preceding token (skipping whitespace/newlines)
      const lookbackChunk = code.slice(Math.max(0, i - 120), i).trimEnd();
      const match = widgetPattern.exec(lookbackChunk);

      if (match) {
        stack.push({
          isWidget: true,
          label: match[1],
          startLine: currentLine,
        });
      } else {
        stack.push({
          isWidget: false,
          label: '',
          startLine: currentLine,
        });
      }
      i++;
      continue;
    }

    // Closing parenthesis
    if (ch === ')') {
      const frame = stack.pop();
      if (frame && frame.isWidget) {
        // Only emit if closing paren is on a different line from start line
        if (currentLine !== frame.startLine) {
          results.push({
            line: currentLine,
            label: frame.label,
          });
        }
      }
      i++;
      continue;
    }

    i++;
  }

  // Sort by line ascending
  return results.sort((a, b) => a.line - b.line);
}

/**
 * Converts official Dart LSP publishClosingLabels notification params
 * to Editor ClosingLabelItem array.
 * Note: LSP lines are 0-based, converted here to 1-based editor line numbers.
 */
export function convertLspClosingLabels(
  labels: LspClosingLabel[] | any[]
): ClosingLabelItem[] {
  if (!Array.isArray(labels)) return [];

  const results: ClosingLabelItem[] = [];

  for (const item of labels) {
    if (!item || !item.range || !item.range.end) continue;
    const endLine = item.range.end.line;
    if (typeof endLine !== 'number') continue;

    // If start is provided and is on the same line, skip single-line
    if (
      item.range.start &&
      typeof item.range.start.line === 'number' &&
      item.range.start.line === endLine
    ) {
      continue;
    }

    const label = item.label ? String(item.label).trim() : '';
    if (!label) continue;

    results.push({
      line: endLine + 1, // 0-based LSP to 1-based editor line
      label,
    });
  }

  return results.sort((a, b) => a.line - b.line);
}
