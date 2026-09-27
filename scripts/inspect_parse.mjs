import { Parser, Language } from 'web-tree-sitter';
import fs from 'fs';

async function main() {
  await Parser.init({ locateFile: () => "ui/public/ts/tree-sitter.wasm" });
  console.log(Parser.prototype.parse.toString());
}

main().catch(console.error);
