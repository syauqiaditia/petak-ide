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
  console.log('Sample.swift text length:', text.length);
  const tree = parser.parse(text);

  console.log('Testing query.captures without options:');
  const cAll = query.captures(tree.rootNode);
  console.log('cAll count:', cAll.length);
  if (cAll.length > 0) {
    console.log('Last capture:', cAll[cAll.length - 1].name, cAll[cAll.length - 1].node.text, cAll[cAll.length - 1].node.startIndex, cAll[cAll.length - 1].node.endIndex);
  }

  console.log('Testing query.captures with startIndex 500, endIndex 1000:');
  const cSub = query.captures(tree.rootNode, { startIndex: 500, endIndex: 1000 });
  console.log('cSub count:', cSub.length);
  for (const c of cSub.slice(0, 5)) {
    console.log(' - capture:', c.name, c.node.text, c.node.startIndex, c.node.endIndex);
  }
}

test().catch(console.error);
