// F0.2 fallback: tree-sitter parse timings outside the webview (node), same wasm + queries as the app.
// Usage (from repo root): node scripts/f02_node_bench.mjs <benchDir> [lang...]
import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';

const dir = process.argv[2];
const langs = process.argv.slice(3).length ? process.argv.slice(3) : ['dart', 'kotlin', 'swift'];
const ext = { dart: 'dart', kotlin: 'kt', swift: 'swift' };
await Parser.init({ locateFile: () => 'ui/public/ts/tree-sitter.wasm' });

const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return { p50: s[Math.floor(s.length * 0.5)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
};

for (const lang of langs) {
  const language = await Language.load(new Uint8Array(fs.readFileSync(`ui/public/ts/tree-sitter-${lang}.wasm`)));
  const query = new Query(language, fs.readFileSync(`ui/features/editor/ts/queries/${lang}.scm`, 'utf-8'));
  const parser = new Parser();
  parser.setLanguage(language);
  let text = fs.readFileSync(`${dir}/Big10k.${ext[lang]}`, 'utf-8');

  let t = performance.now();
  let tree = parser.parse(text);
  const initial = performance.now() - t;

  let pos = Math.floor(text.length / 2);
  const inc = [], q = [];
  const n = 200; // f05: new swift grammar is fast enough for 200 samples
  for (let i = 0; i < n; i++) {
    const before = text.slice(0, pos).split('\n');
    const row = before.length - 1, column = before[row].length;
    tree.edit({ startIndex: pos, oldEndIndex: pos, newEndIndex: pos + 1,
      startPosition: { row, column }, oldEndPosition: { row, column }, newEndPosition: { row, column: column + 1 } });
    text = text.slice(0, pos) + String.fromCharCode(97 + (i % 26)) + text.slice(pos);
    pos++;
    t = performance.now();
    tree = parser.parse(text, tree);
    inc.push(performance.now() - t);
    t = performance.now();
    query.captures(tree.rootNode, { startIndex: (pos - 1200) * 2, endIndex: (pos + 1200) * 2 });
    q.push(performance.now() - t);
  }
  const r = { metric: 'f02_node_bench', runtime: `node ${process.version}`, language: lang, samples: n,
    initial_parse_ms: initial, first_incremental_ms: inc[0], incremental: stats(inc), incremental_excl_first: stats(inc.slice(1)), query_viewport: stats(q) };
  console.log(JSON.stringify(r));
}
