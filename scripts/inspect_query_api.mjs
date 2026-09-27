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

  console.log('Query.prototype.captures:', Query.prototype.captures.toString());
  console.log('Query.prototype.matches:', Query.prototype.matches.toString());
}

test().catch(console.error);
