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

  const cAll = query.captures(tree.rootNode);
  console.log('Total captures in whole tree:', cAll.length);
  const after1000 = cAll.filter(c => c.node.startIndex >= 1000);
  console.log('Captures with startIndex >= 1000:', after1000.length);
  for (const c of after1000.slice(0, 10)) {
    console.log(` - Capture: ${c.name}, text: "${c.node.text}", range: ${c.node.startIndex}..${c.node.endIndex}`);
  }
}

test().catch(console.error);
