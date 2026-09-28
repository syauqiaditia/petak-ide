import type { Text } from '@codemirror/state';
import type { LspPosition } from '../../../lib/api';

/**
 * Convert an LSP position (0-based line, UTF-16 character offset) to CM6 document offset.
 * CM6 string indexing is UTF-16 code units, matching LSP character offset.
 */
export function lspPosToOffset(doc: Text, pos: LspPosition): number {
  if (doc.lines === 0) return 0;
  const lineNum = Math.max(1, Math.min(pos.line + 1, doc.lines));
  const line = doc.line(lineNum);
  const offset = line.from + Math.max(0, Math.min(pos.character, line.length));
  return Math.min(offset, doc.length);
}

/**
 * Convert a CM6 document offset to an LSP position (0-based line, UTF-16 character offset).
 */
export function offsetToLspPos(doc: Text, offset: number): LspPosition {
  const clamped = Math.max(0, Math.min(offset, doc.length));
  const line = doc.lineAt(clamped);
  return {
    line: line.number - 1,
    character: clamped - line.from,
  };
}
