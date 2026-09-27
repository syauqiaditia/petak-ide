import fs from 'fs';
import { Parser, Language } from 'web-tree-sitter';

async function main() {
  await Parser.init({ locateFile: () => "ui/public/ts/tree-sitter.wasm" });
  const lang = await Language.load(new Uint8Array(fs.readFileSync("ui/public/ts/tree-sitter-kotlin.wasm")));
  const parser = new Parser();
  parser.setLanguage(lang);
  const text = fs.readFileSync("/home/uqi/petak-bench/Big50k.kt", "utf-8");
  console.log("Parsing Big50k.kt (" + text.length + " chars)...");
  const t0 = performance.now();
  const tree = parser.parse(text);
  console.log("Done in " + (performance.now() - t0).toFixed(2) + " ms");
}

main().catch(console.error);
