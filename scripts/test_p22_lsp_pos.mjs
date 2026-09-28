import { Text } from '@codemirror/state';

// Mirror pos.ts logic for testing
function lspPosToOffset(doc, pos) {
  if (doc.lines === 0) return 0;
  const lineNum = Math.max(1, Math.min(pos.line + 1, doc.lines));
  const line = doc.line(lineNum);
  const offset = line.from + Math.max(0, Math.min(pos.character, line.length));
  return Math.min(offset, doc.length);
}

function offsetToLspPos(doc, offset) {
  const clamped = Math.max(0, Math.min(offset, doc.length));
  const line = doc.lineAt(clamped);
  return {
    line: line.number - 1,
    character: clamped - line.from,
  };
}

const doc = Text.of([
  'void main() {',
  '  int x = "sengaja error";',
  '  print(x);',
  '}',
]);

// Test 1: line 0, character 5
const off1 = lspPosToOffset(doc, { line: 0, character: 5 });
const pos1 = offsetToLspPos(doc, off1);
console.log('Test 1 - line 0, char 5:', off1, pos1);
if (off1 !== 5 || pos1.line !== 0 || pos1.character !== 5) {
  throw new Error('Test 1 failed');
}

// Test 2: line 1, character 10 (start of "sengaja error")
const off2 = lspPosToOffset(doc, { line: 1, character: 10 });
const pos2 = offsetToLspPos(doc, off2);
console.log('Test 2 - line 1, char 10:', off2, pos2);
if (pos2.line !== 1 || pos2.character !== 10) {
  throw new Error('Test 2 failed');
}

// Test 3: boundary clamping (out of bounds)
const offOob = lspPosToOffset(doc, { line: 99, character: 99 });
const posOob = offsetToLspPos(doc, 9999);
console.log('Test 3 - out of bounds:', offOob, posOob);
if (offOob !== doc.length || posOob.line !== 3) {
  throw new Error('Test 3 failed');
}

console.log('ALL POS TESTS PASSED!');
