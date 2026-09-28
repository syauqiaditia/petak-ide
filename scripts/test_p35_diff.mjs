import assert from 'node:assert';
import { tokenize, computeWordDiff } from '../ui/features/git/wordDiff.ts';
import { hunkToSbs } from '../ui/features/git/sbs.ts';

console.log('Running test_p35_diff.mjs...');

// 1. Tokenizer tests
{
  const tokens = tokenize('const greeting = "Halo Dunia! 🌍";');
  assert.ok(tokens.includes('const'));
  assert.ok(tokens.includes('greeting'));
  assert.ok(tokens.includes('Halo'));
  assert.ok(tokens.includes('Dunia'));
  assert.ok(tokens.includes('🌍'));
}

// 2. Word diff with unicode & emoji
{
  const oldText = 'let status = "Sedang bekerja ⏳";';
  const newText = 'let status = "Selesai dikerjakan! 🎉";';
  const { oldTokens, newTokens } = computeWordDiff(oldText, newText);

  // Common tokens: let, ' ', status, ' ', =, ' '
  const oldUnchanged = oldTokens.filter((t) => !t.changed).map((t) => t.text).join('');
  const newUnchanged = newTokens.filter((t) => !t.changed).map((t) => t.text).join('');
  assert.strictEqual(oldUnchanged, newUnchanged);
  assert.ok(oldUnchanged.startsWith('let status = '));

  // Changed tokens
  const oldChanged = oldTokens.filter((t) => t.changed).map((t) => t.text);
  const newChanged = newTokens.filter((t) => t.changed).map((t) => t.text);
  assert.ok(oldChanged.includes('Sedang'));
  assert.ok(oldChanged.includes('bekerja'));
  assert.ok(oldChanged.includes('⏳'));
  assert.ok(newChanged.includes('Selesai'));
  assert.ok(newChanged.includes('dikerjakan'));
  assert.ok(newChanged.includes('🎉'));
}

// 3. Side-by-side pairing, filler, and line numbers
{
  const mockHunk = {
    oldStart: 10,
    oldLines: 4,
    newStart: 10,
    newLines: 5,
    header: '@@ -10,4 +10,5 @@',
    lines: [
      { kind: 'context', text: 'function init() {', oldNo: 10, newNo: 10 },
      { kind: 'del', text: '  const a = 1;', oldNo: 11, newNo: null },
      { kind: 'del', text: '  const b = 2;', oldNo: 12, newNo: null },
      { kind: 'add', text: '  const a = 10;', oldNo: null, newNo: 11 },
      { kind: 'add', text: '  const b = 20;', oldNo: null, newNo: 12 },
      { kind: 'add', text: '  const c = 30;', oldNo: null, newNo: 13 },
      { kind: 'context', text: '}', oldNo: 13, newNo: 14 },
    ],
  };

  const sbs = hunkToSbs(mockHunk);
  assert.strictEqual(sbs.rows.length, 5); // 1 context + 3 changed (2 del + 3 add -> 3 rows) + 1 context

  // Row 0: context
  assert.strictEqual(sbs.rows[0].left.kind, 'context');
  assert.strictEqual(sbs.rows[0].left.lineNo, 10);
  assert.strictEqual(sbs.rows[0].right.kind, 'context');
  assert.strictEqual(sbs.rows[0].right.lineNo, 10);

  // Row 1: paired (a=1 vs a=10)
  assert.strictEqual(sbs.rows[1].left.kind, 'del');
  assert.strictEqual(sbs.rows[1].left.lineNo, 11);
  assert.strictEqual(sbs.rows[1].right.kind, 'add');
  assert.strictEqual(sbs.rows[1].right.lineNo, 11);
  assert.ok(sbs.rows[1].left.tokens.some((t) => t.text === '1' && t.changed));
  assert.ok(sbs.rows[1].right.tokens.some((t) => t.text === '10' && t.changed));

  // Row 2: paired (b=2 vs b=20)
  assert.strictEqual(sbs.rows[2].left.kind, 'del');
  assert.strictEqual(sbs.rows[2].left.lineNo, 12);
  assert.strictEqual(sbs.rows[2].right.kind, 'add');
  assert.strictEqual(sbs.rows[2].right.lineNo, 12);

  // Row 3: filler on left, add on right (c=30)
  assert.strictEqual(sbs.rows[3].left.kind, 'filler');
  assert.strictEqual(sbs.rows[3].right.kind, 'add');
  assert.strictEqual(sbs.rows[3].right.lineNo, 13);
  assert.strictEqual(sbs.rows[3].right.text, '  const c = 30;');

  // Row 4: context
  assert.strictEqual(sbs.rows[4].left.kind, 'context');
  assert.strictEqual(sbs.rows[4].left.lineNo, 13);
  assert.strictEqual(sbs.rows[4].right.kind, 'context');
  assert.strictEqual(sbs.rows[4].right.lineNo, 14);
}

// 4. Standalone additions (filler on left) and deletions (filler on right)
{
  const addOnlyHunk = {
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 2,
    header: '@@ -1,0 +1,2 @@',
    lines: [
      { kind: 'add', text: 'line 1', oldNo: null, newNo: 1 },
      { kind: 'add', text: 'line 2', oldNo: null, newNo: 2 },
    ],
  };
  const sbs = hunkToSbs(addOnlyHunk);
  assert.strictEqual(sbs.rows.length, 2);
  assert.strictEqual(sbs.rows[0].left.kind, 'filler');
  assert.strictEqual(sbs.rows[0].right.kind, 'add');
  assert.strictEqual(sbs.rows[0].right.lineNo, 1);
  assert.strictEqual(sbs.rows[1].left.kind, 'filler');
  assert.strictEqual(sbs.rows[1].right.kind, 'add');
  assert.strictEqual(sbs.rows[1].right.lineNo, 2);
}

console.log('ALL P3.5 DIFF & SBS TESTS PASSED!');
