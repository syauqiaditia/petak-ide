import { Parser, Language, Tree } from 'web-tree-sitter';

async function main() {
  await Parser.init({ locateFile: () => "ui/public/ts/tree-sitter.wasm" });
  console.log(Tree.prototype.edit.toString());
}

main().catch(console.error);
