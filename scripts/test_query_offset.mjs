import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function test() {
  await Parser.init({
    locateFile: () => path.resolve('ui/public/ts/tree-sitter.wasm')
  });

  const bytes = new Uint8Array(fs.readFileSync('ui/public/ts/tree-sitter-dart.wasm'));
  const lang = await Language.load(bytes);
  const parser = new Parser();
  parser.setLanguage(lang);

  const scm = fs.readFileSync('ui/features/editor/ts/queries/dart.scm', 'utf-8');
  const query = new Query(lang, scm);
  const text = fs.readFileSync('/home/uqi/petak-bench/Big10k.dart', 'utf-8');
  const tree = parser.parse(text);

  const mid = 100000;
  // What if we pass mid * 2?
  const capsDouble = query.captures(tree.rootNode, { startIndex: mid * 2, endIndex: (mid + 1200) * 2 });
  console.log(`With mid*2 (${mid*2}): ${capsDouble.length} caps`);
  if (capsDouble.length > 0) {
    console.log(`min start: ${Math.min(...capsDouble.map(c => c.node.startIndex))}, max end: ${Math.max(...capsDouble.map(c => c.node.endIndex))}`);
    const inRange = capsDouble.filter(c => c.node.startIndex >= mid && c.node.endIndex <= mid + 1200);
    console.log(`inRange count: ${inRange.length}`);
    for (const c of inRange.slice(0, 5)) {
      console.log(` - ${c.name} "${c.node.text}" at ${c.node.startIndex}..${c.node.endIndex}`);
    }
  }
}

test().catch(console.error);
