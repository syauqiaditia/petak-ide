import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function test() {
  await Parser.init({
    locateFile: () => path.resolve('ui/public/ts/tree-sitter.wasm')
  });

  for (const langName of ['dart', 'kotlin', 'swift']) {
    const bytes = new Uint8Array(fs.readFileSync(`ui/public/ts/tree-sitter-${langName}.wasm`));
    const lang = await Language.load(bytes);
    const parser = new Parser();
    parser.setLanguage(lang);

    const scm = fs.readFileSync(`ui/features/editor/ts/queries/${langName}.scm`, 'utf-8');
    const query = new Query(lang, scm);

    const ext = langName === 'dart' ? 'dart' : langName === 'kotlin' ? 'kt' : 'swift';
    const filePath = `/home/uqi/petak-bench/Big10k.${ext}`;
    const text = fs.readFileSync(filePath, 'utf-8');

    const t0 = performance.now();
    const tree = parser.parse(text);
    const tParse = performance.now() - t0;

    console.log(`\n=== ${langName.toUpperCase()} 10k lines (${text.length} chars) ===`);
    console.log(`Initial parse full: ${tParse.toFixed(2)} ms`);

    // Viewport: say 50 lines in the middle (approx 1200 chars)
    const mid = Math.floor(text.length / 2);
    const from = mid;
    const to = mid + 1200;

    // Test A: captures without options (full file)
    const tA0 = performance.now();
    const capsA = query.captures(tree.rootNode);
    const tA = performance.now() - tA0;
    console.log(`Full tree captures: ${capsA.length} caps, time: ${tA.toFixed(2)} ms`);

    // Test B: captures with startIndex / endIndex
    // Let's see what web-tree-sitter captures does when matchLimit or options are used:
    const tB0 = performance.now();
    const capsB = query.captures(tree.rootNode, { startIndex: from, endIndex: to });
    const tB = performance.now() - tB0;
    console.log(`Query with { startIndex, endIndex }: ${capsB.length} caps, time: ${tB.toFixed(2)} ms`);

    // What are the ranges of capsB?
    const inRange = capsB.filter(c => c.node.startIndex >= from && c.node.endIndex <= to);
    console.log(`  capsB inside [${from}..${to}]: ${inRange.length}`);
    if (capsB.length > 0) {
      console.log(`  capsB min start: ${Math.min(...capsB.map(c => c.node.startIndex))}, max end: ${Math.max(...capsB.map(c => c.node.endIndex))}`);
    }
  }
}

test().catch(console.error);
