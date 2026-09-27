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

  // Let's test lines 30 to 58
  const lines = text.split('\n');
  console.log(`Total lines: ${lines.length}`);
  
  let lineOffsets = [0];
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
  }

  // Suppose visible range is line 30 to 58:
  const from = lineOffsets[30];
  const to = text.length;
  console.log(`Visible range: from offset ${from} (line 30) to ${to}`);

  const captures = query.captures(tree.rootNode, {
    startIndex: from,
    endIndex: to,
  });

  console.log(`Captures found in visible range: ${captures.length}`);
  for (const c of captures) {
    console.log(`Capture: ${c.name}, text: "${c.node.text}", range: ${c.node.startIndex}..${c.node.endIndex}`);
  }
}

test().catch(console.error);
