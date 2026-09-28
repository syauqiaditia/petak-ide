import { Text } from '@codemirror/state';

// 1. Test URI to path conversion
function uriToPath(uri) {
  if (!uri.startsWith('file://')) return uri;
  let path = uri.slice(7);
  try {
    path = decodeURIComponent(path);
  } catch (_) {}
  return path;
}

console.log('Testing uriToPath...');
if (uriToPath('file:///Users/uqi/project/main.dart') !== '/Users/uqi/project/main.dart') {
  throw new Error('uriToPath failed for simple unix path');
}
if (uriToPath('file:///Users/uqi/my%20project/main.dart') !== '/Users/uqi/my project/main.dart') {
  throw new Error('uriToPath failed for encoded spaces');
}
if (uriToPath('/raw/path/file.dart') !== '/raw/path/file.dart') {
  throw new Error('uriToPath failed for raw path');
}
console.log('uriToPath OK');

// 2. Test Hover Markdown rendering logic
function renderHoverMarkdownTokens(raw) {
  const blocks = raw.split(/(```[\s\S]*?```)/g);
  const elements = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    if (block.startsWith('```') && block.endsWith('```')) {
      const lines = block.slice(3, -3).trim().split('\n');
      const firstLine = lines[0] || '';
      const codeLines = /^[a-zA-Z0-9_-]+$/.test(firstLine) ? lines.slice(1) : lines;
      elements.push({ type: 'code', text: codeLines.join('\n') });
    } else {
      elements.push({ type: 'text', text: block.trim() });
    }
  }
  return elements;
}

console.log('Testing hover markdown parsing...');
const sampleHover = '```dart\nString name = "petak";\n```\nA simple string variable.';
const tokens = renderHoverMarkdownTokens(sampleHover);
if (tokens.length !== 2 || tokens[0].type !== 'code' || tokens[1].type !== 'text') {
  throw new Error('Hover parsing failed: ' + JSON.stringify(tokens));
}
if (tokens[0].text !== 'String name = "petak";') {
  throw new Error('Hover code block content mismatch: ' + tokens[0].text);
}
console.log('Hover markdown parsing OK');

// 3. Test apply edits sorting and non-overlapping calculation
function prepareChanges(doc, edits) {
  function lspPosToOffset(doc, pos) {
    if (doc.lines === 0) return 0;
    const lineNum = Math.max(1, Math.min(pos.line + 1, doc.lines));
    const line = doc.line(lineNum);
    const offset = line.from + Math.max(0, Math.min(pos.character, line.length));
    return Math.min(offset, doc.length);
  }

  const changes = edits.map((e) => ({
    from: lspPosToOffset(doc, e.range.start),
    to: lspPosToOffset(doc, e.range.end),
    insert: e.newText,
  }));
  changes.sort((a, b) => a.from - b.from || a.to - b.to);
  return changes;
}

console.log('Testing apply edits change calculation...');
const doc = Text.of(['int a = 1;', 'int b = 2;', 'int c = 3;']);
const edits = [
  { range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } }, newText: 'z' },
  { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } }, newText: 'x' },
];
const changes = prepareChanges(doc, edits);
if (changes[0].insert !== 'x' || changes[1].insert !== 'z') {
  throw new Error('Edits should be sorted ascending: ' + JSON.stringify(changes));
}
console.log('Apply edits change calculation OK');

console.log('All P2.3 JS logic checks passed!');
