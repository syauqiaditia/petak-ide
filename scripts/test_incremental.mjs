import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  await Parser.init({
    locateFile: (scriptName) => path.resolve('ui/public/ts', scriptName),
  });

  const wasmPath = path.resolve('ui/public/ts/tree-sitter-kotlin.wasm');
  const scmPath = path.resolve('ui/features/editor/ts/queries/kotlin.scm');

  const lang = await Language.load(new Uint8Array(fs.readFileSync(wasmPath)));
  const query = new Query(lang, fs.readFileSync(scmPath, 'utf-8'));

  const parser = new Parser();
  parser.setLanguage(lang);

  // Generate 10k lines of Kotlin
  const lines = [];
  lines.push('package id.petak.bench\n');
  for (let i = 0; i < 2000; i++) {
    lines.push(`data class Item${i}(val id: String, val count: Int)\n`);
    lines.push(`fun processItem${i}(item: Item${i}) {\n  val x = item.count + 1\n  println(x)\n}\n`);
  }
  let code = lines.join('\n');
  console.log(`Code length: ${code.length} chars, ~${code.split('\n').length} lines`);

  // Initial full parse
  console.time('initial_parse');
  const t0 = performance.now();
  let tree = parser.parse(code);
  const initialParseMs = performance.now() - t0;
  console.timeEnd('initial_parse');
  console.log(`Initial parse took: ${initialParseMs.toFixed(2)} ms`);

  // Insert 1 character in the middle
  const insertIndex = Math.floor(code.length / 2);
  const beforeInsert = code.slice(0, insertIndex);
  const afterInsert = code.slice(insertIndex);
  const newCode = beforeInsert + 'a' + afterInsert;

  // Compute row/col for edit
  const linesBefore = beforeInsert.split('\n');
  const row = linesBefore.length - 1;
  const col = linesBefore[linesBefore.length - 1].length;

  tree.edit({
    startIndex: insertIndex,
    oldEndIndex: insertIndex,
    newEndIndex: insertIndex + 1,
    startPosition: { row, column: col },
    oldEndPosition: { row, column: col },
    newEndPosition: { row, column: col + 1 },
  });

  const t1 = performance.now();
  const newTree = parser.parse(newCode, tree);
  const incrementalMs = performance.now() - t1;
  console.log(`Incremental parse took: ${incrementalMs.toFixed(3)} ms`);

  // Query captures in viewport (e.g. range around insertion: 1000 chars)
  const t2 = performance.now();
  const captures = query.captures(newTree.rootNode, {
    startIndex: Math.max(0, insertIndex - 1000),
    endIndex: Math.min(newCode.length, insertIndex + 1000),
  });
  const queryMs = performance.now() - t2;
  console.log(`Viewport query captures (${captures.length} captures) took: ${queryMs.toFixed(3)} ms`);
}

main().catch(console.error);
