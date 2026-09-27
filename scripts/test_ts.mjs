import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  await Parser.init({
    locateFile(scriptName) {
      return path.resolve('ui/public/ts', scriptName);
    }
  });

  const languages = [
    { name: 'dart', wasm: 'tree-sitter-dart.wasm', query: 'dart.scm', sample: 'sample/Sample.dart' },
    { name: 'kotlin', wasm: 'tree-sitter-kotlin.wasm', query: 'kotlin.scm', sample: 'sample/Sample.kt' },
    { name: 'swift', wasm: 'tree-sitter-swift.wasm', query: 'swift.scm', sample: 'sample/Sample.swift' },
  ];

  for (const lang of languages) {
    const wasmPath = path.resolve('ui/public/ts', lang.wasm);
    const queryPath = path.resolve('ui/features/editor/ts/queries', lang.query);
    const samplePath = path.resolve(lang.sample);

    const bytes = new Uint8Array(fs.readFileSync(wasmPath));
    const language = await Language.load(bytes);
    const parser = new Parser();
    parser.setLanguage(language);

    const scm = fs.readFileSync(queryPath, 'utf-8');
    const query = new Query(language, scm);

    const sampleText = fs.readFileSync(samplePath, 'utf-8');
    const tree = parser.parse(sampleText);

    const allCaps = query.captures(tree.rootNode);
    const names = new Set(allCaps.map(c => c.name));
    console.log(`\nUnique captures in ${lang.name} (${names.size}):`);
    console.log(Array.from(names).sort().join(', '));
  }
}

main().catch(console.error);