import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function testLang(name, wasmFile, scmFile) {
  const wasmPath = path.resolve('ui/public/ts', wasmFile);
  const scmPath = path.resolve('ui/features/editor/ts/queries', scmFile);

  const bytes = new Uint8Array(fs.readFileSync(wasmPath));
  const lang = await Language.load(bytes);
  console.log(`\n=== Testing ${name} ===`);

  const rawScm = fs.readFileSync(scmPath, 'utf-8');

  // Let's test whole query first
  try {
    const q = new Query(lang, rawScm);
    console.log(`SUCCESS: Full query compiled! Patterns: ${q.patternCount()}`);
    return;
  } catch (err) {
    console.error(`FAILED full query: ${err.message}`);
  }

  // Split into chunks or patterns
  // Pattern usually separated by blank lines or top-level parentheses
  const lines = rawScm.split('\n');
  let currentBlock = [];
  let lineStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentBlock.push(line);

    // Simple heuristic: if line starts without whitespace and ends a pattern
    const text = currentBlock.join('\n').trim();
    if (!text || text.startsWith(';')) {
      if (text.startsWith(';')) currentBlock = [];
      continue;
    }

    // Try compiling currentBlock
    // Check balanced parentheses
    let openCount = 0;
    let inString = false;
    for (let c of text) {
      if (c === '"') inString = !inString;
      else if (!inString && (c === '(' || c === '[')) openCount++;
      else if (!inString && (c === ')' || c === ']')) openCount--;
    }

    if (openCount === 0 && text.length > 0) {
      try {
        new Query(lang, text);
      } catch (err) {
        console.log(`Error near lines ${lineStart}-${i + 1}: ${err.message}`);
        console.log(`--- Block text: ---\n${text}\n-------------------`);
      }
      currentBlock = [];
      lineStart = i + 2;
    }
  }
}

async function main() {
  await Parser.init({
    locateFile: (scriptName) => path.resolve('ui/public/ts', scriptName),
  });

  await testLang('dart', 'tree-sitter-dart.wasm', 'dart.scm');
  await testLang('kotlin', 'tree-sitter-kotlin.wasm', 'kotlin.scm');
  await testLang('swift', 'tree-sitter-swift.wasm', 'swift.scm');
}

main().catch(console.error);
