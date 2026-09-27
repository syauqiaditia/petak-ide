import { Parser, Language } from 'web-tree-sitter';
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

  const text = fs.readFileSync('/home/uqi/petak-bench/Big10k.swift', 'utf-8');
  console.log('Total length:', text.length, 'lines:', text.split('\n').length);

  // Test 1000 lines
  const lines1k = text.split('\n').slice(0, 1000).join('\n');
  const t0 = performance.now();
  parser.parse(lines1k);
  console.log('1000 lines parse time:', (performance.now() - t0).toFixed(2), 'ms');

  // Test 2000 lines
  const lines2k = text.split('\n').slice(0, 2000).join('\n');
  const t1 = performance.now();
  parser.parse(lines2k);
  console.log('2000 lines parse time:', (performance.now() - t1).toFixed(2), 'ms');

  // Test 5000 lines
  const lines5k = text.split('\n').slice(0, 5000).join('\n');
  const t2 = performance.now();
  parser.parse(lines5k);
  console.log('5000 lines parse time:', (performance.now() - t2).toFixed(2), 'ms');
}

test().catch(console.error);
