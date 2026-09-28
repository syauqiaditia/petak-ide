import { Text } from '@codemirror/state';
import { processSnippet } from './test_snippet.mjs';

console.log('=== Running P2.4 Feature Unit & Integration Tests ===\n');

// 1. Test processSnippet
console.log('1. Testing processSnippet...');

// Case A: Dart wrap widget snippet
const snippetA = '${1:widget}(child: Text("hello"))';
const resA = processSnippet(snippetA);
if (resA.cleanText !== 'widget(child: Text("hello"))') {
  throw new Error(`Snippet A cleanText mismatch: ${resA.cleanText}`);
}
if (resA.placeholderOffset !== 0 || resA.placeholderLen !== 6) {
  throw new Error(`Snippet A placeholder mismatch: ${JSON.stringify(resA)}`);
}
if (resA.cleanText.includes('${') || resA.cleanText.includes('$1')) {
  throw new Error(`Snippet A left literal placeholders in cleanText: ${resA.cleanText}`);
}
console.log('  ✓ Snippet ${1:widget}(child: ...) cleaned and selection tracked correctly');

// Case B: Multiple placeholders with $0
const snippetB = 'Padding(\n  padding: EdgeInsets.all(8.0),\n  child: ${1:Center}(\n    child: $0\n  ),\n)';
const resB = processSnippet(snippetB);
if (resB.cleanText.includes('$')) {
  throw new Error(`Snippet B left $ in cleanText: ${resB.cleanText}`);
}
if (!resB.cleanText.includes('child: Center(')) {
  throw new Error(`Snippet B placeholder content mismatch: ${resB.cleanText}`);
}
console.log('  ✓ Multi-placeholder snippet with $0 processed cleanly');

// Case C: Plain text without snippet syntax
const plainText = 'Center(child: Text("hi"))';
const resC = processSnippet(plainText);
if (resC.cleanText !== plainText || resC.placeholderOffset !== null) {
  throw new Error(`Plain text unexpectedly modified: ${JSON.stringify(resC)}`);
}
console.log('  ✓ Plain text without snippets preserved exactly');

// 2. Test Code Action Categorization & Ordering logic
console.log('\n2. Testing Code Action Categorization and Sorting...');

function categorizeAction(action) {
  const kind = action.kind || '';
  if (kind.startsWith('quickfix') || (action.diagnostics && action.diagnostics.length > 0)) {
    return 'quickfix';
  }
  if (kind.startsWith('refactor')) {
    return 'refactor';
  }
  if (kind.startsWith('source')) {
    return 'source';
  }
  return 'other';
}

function sortCodeActions(actions) {
  const order = { quickfix: 0, refactor: 1, source: 2, other: 3 };
  return [...actions].sort((a, b) => {
    const catA = categorizeAction(a);
    const catB = categorizeAction(b);
    const catDiff = order[catA] - order[catB];
    if (catDiff !== 0) return catDiff;
    if (a.isPreferred && !b.isPreferred) return -1;
    if (!a.isPreferred && b.isPreferred) return 1;
    return a.title.localeCompare(b.title);
  });
}

const rawActions = [
  { title: 'Organize Imports', kind: 'source.organizeImports' },
  { title: 'Wrap with Padding', kind: 'refactor.flutter.wrap.padding' },
  { title: 'Remove unused import', kind: 'quickfix.remove.unusedImport' },
  { title: 'Wrap with Center', kind: 'refactor.flutter.wrap.center' },
  { title: 'Fix typo', kind: 'quickfix.fix.typo' },
];

const sorted = sortCodeActions(rawActions);
const sortedTitles = sorted.map((a) => a.title);
console.log('  Sorted order:', sortedTitles);

if (sortedTitles[0] !== 'Fix typo' && sortedTitles[1] !== 'Remove unused import') {
  if (!sorted[0].kind.startsWith('quickfix') || !sorted[1].kind.startsWith('quickfix')) {
    throw new Error(`Quickfix actions must appear first: ${JSON.stringify(sortedTitles)}`);
  }
}
if (!sorted[2].kind.startsWith('refactor') || !sorted[3].kind.startsWith('refactor')) {
  throw new Error(`Refactor actions must follow quickfixes: ${JSON.stringify(sortedTitles)}`);
}
if (sorted[4].kind !== 'source.organizeImports') {
  throw new Error(`Source actions must follow refactor: ${JSON.stringify(sortedTitles)}`);
}
console.log('  ✓ Quickfix precedes refactor, refactor precedes source');

console.log('\n=== All P2.4 JS tests passed successfully! ===');
