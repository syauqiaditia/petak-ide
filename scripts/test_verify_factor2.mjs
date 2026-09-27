import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function test() {
  await Parser.init({
    locateFile: () => path.resolve('ui/public/ts', 'tree-sitter.wasm')
  });

  for (const lang of ['dart', 'kotlin', 'swift']) {
    const bytes = new Uint8Array(fs.readFileSync(`ui/public/ts/tree-sitter-${lang}.wasm`));
    const language = await Language.load(bytes);
    const parser = new Parser();
    parser.setLanguage(language);

    const scm = fs.readFileSync(`ui/features/editor/ts/queries/${lang}.scm`, 'utf-8');
    const query = new Query(language, scm);

    const ext = lang === 'dart' ? 'dart' : lang === 'kotlin' ? 'kt' : 'swift';
    const text = fs.readFileSync(`/home/uqi/petak-bench/Big10k.${ext}`, 'utf-8');
    const tree = parser.parse(text);

    // Test middle of file: lines 5000-5050
    const lines = text.split('\n');
    let from = 0;
    for (let i = 0; i < 5000; i++) from += lines[i].length + 1;
    let to = from;
    for (let i = 5000; i < 5050; i++) to += lines[i].length + 1;

    console.log(`\n=== Testing ${lang} at chars ${from}..${to} (lines 5000..5050) ===`);
    const t0 = performance.now();
    const caps = query.captures(tree.rootNode, {
      startIndex: from * 2,
      endIndex: to * 2,
    });
    const tQuery = performance.now() - t0;

    const inRange = caps.filter(c => c.node.startIndex >= from && c.node.endIndex <= to);
    console.log(`Captures count: ${caps.length}, inRange: ${inRange.length}, query time: ${tQuery.toFixed(2)} ms`);
    for (const c of inRange.slice(0, 3)) {
      console.log(`  Capture: ${c.name} "${c.node.text}" at ${c.node.startIndex}..${c.node.endIndex}`);
    }
  }
}

test().catch(console.error);
