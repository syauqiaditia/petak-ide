import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function test() {
  await Parser.init({
    locateFile: () => path.resolve('ui/public/ts/tree-sitter.wasm')
  });

  const bytes = new Uint8Array(fs.readFileSync('ui/public/ts/tree-sitter-swift.wasm'));
  const lang = await Language.load(bytes);
  const parser = new Parser();
  parser.setLanguage(lang);

  const scm = fs.readFileSync('ui/features/editor/ts/queries/swift.scm', 'utf-8');
  const query = new Query(lang, scm);

  const text = fs.readFileSync('sample/Sample.swift', 'utf-8');
  const tree = parser.parse(text);

  console.log('--- Test 1: no options ---');
  const c1 = query.captures(tree.rootNode);
  console.log('Count:', c1.length);

  console.log('--- Test 2: { startIndex: 1000, endIndex: 1565 } ---');
  const c2 = query.captures(tree.rootNode, { startIndex: 1000, endIndex: 1565 });
  console.log('Count:', c2.length);
  if (c2.length > 0) {
    console.log('c2[0]:', c2[0].name, c2[0].node.startIndex, c2[0].node.endIndex, c2[0].node.text);
    console.log('c2[last]:', c2[c2.length - 1].name, c2[c2.length - 1].node.startIndex, c2[c2.length - 1].node.endIndex, c2[c2.length - 1].node.text);
  }

  console.log('--- Test 3: rootNode.descendantForIndex(1000, 1565) ---');
  const node = tree.rootNode.descendantForIndex(1000, 1565);
  console.log('node type:', node.type, 'range:', node.startIndex, node.endIndex);
  const c3 = query.captures(node);
  console.log('Count:', c3.length);
  if (c3.length > 0) {
    console.log('c3[0]:', c3[0].name, c3[0].node.startIndex, c3[0].node.endIndex, c3[0].node.text);
    console.log('c3[last]:', c3[c3.length - 1].name, c3[c3.length - 1].node.startIndex, c3[c3.length - 1].node.endIndex, c3[c3.length - 1].node.text);
  }

  console.log('--- Test 4: query.captures with startPosition and endPosition ---');
  // text lines: find row/col for 1000 and 1565
  const lines = text.split('\n');
  let charCount = 0;
  let pStart = { row: 0, column: 0 };
  let pEnd = { row: 0, column: 0 };
  for (let r = 0; r < lines.length; r++) {
    const nextCount = charCount + lines[r].length + 1;
    if (charCount <= 1000 && 1000 < nextCount) {
      pStart = { row: r, column: 1000 - charCount };
    }
    if (charCount <= 1565 && 1565 <= nextCount) {
      pEnd = { row: r, column: 1565 - charCount };
    }
    charCount = nextCount;
  }
  console.log('pStart:', pStart, 'pEnd:', pEnd);
  const c4 = query.captures(tree.rootNode, { startPosition: pStart, endPosition: pEnd });
  console.log('Count:', c4.length);
  if (c4.length > 0) {
    console.log('c4[0]:', c4[0].name, c4[0].node.startIndex, c4[0].node.endIndex, c4[0].node.text);
    console.log('c4[last]:', c4[c4.length - 1].name, c4[c4.length - 1].node.startIndex, c4[c4.length - 1].node.endIndex, c4[c4.length - 1].node.text);
  }
}

test().catch(console.error);
