import fs from 'fs';
import { Parser, Language } from 'web-tree-sitter';

async function main() {
  await Parser.init({ locateFile: () => "ui/public/ts/tree-sitter.wasm" });
  const lang = await Language.load(new Uint8Array(fs.readFileSync("ui/public/ts/tree-sitter-swift.wasm")));
  const parser = new Parser();
  parser.setLanguage(lang);

  const lines = ['// Swift benchmark file 10k lines', 'import Foundation\n'];
  let idx = 0;
  while (lines.length < 10000) {
    idx++;
    lines.push(`/// Item ${idx}`);
    lines.push(`public struct Item${idx} {`);
    lines.push(`    public let id: String`);
    lines.push(`    public let count: Int`);
    lines.push(`    public let active: Bool`);
    lines.push(`}`);
    lines.push(`public class Service${idx} {`);
    lines.push(`    public var name: String = "Service_${idx}"`);
    lines.push(`    public func run(val: Int) -> Int {`);
    lines.push(`        if val <= 0 { return 0 }`);
    lines.push(`        return val + ${idx}`);
    lines.push(`    }`);
    lines.push(`}`);
    lines.push('');
  }
  const text = lines.slice(0, 10000).join('\n');
  console.log(`Generated ${text.split('\n').length} lines, ${text.length} chars`);

  const t0 = performance.now();
  const tree = parser.parse(text);
  console.log(`Parsed in: ${(performance.now() - t0).toFixed(2)} ms`);
}

main().catch(console.error);
