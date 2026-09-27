import { RangeSetBuilder } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { Parser, Language, Query } from 'web-tree-sitter';
import fs from 'node:fs';
import path from 'node:path';

async function testDart() {
  await Parser.init({
    locateFile: () => path.resolve('ui/public/ts/tree-sitter.wasm')
  });

  const bytes = new Uint8Array(fs.readFileSync('ui/public/ts/tree-sitter-dart.wasm'));
  const lang = await Language.load(bytes);
  const parser = new Parser();
  parser.setLanguage(lang);

  const scm = fs.readFileSync('ui/features/editor/ts/queries/dart.scm', 'utf-8');
  const query = new Query(lang, scm);

  const text = fs.readFileSync('sample/Sample.dart', 'utf-8');
  const tree = parser.parse(text);

  const captures = query.captures(tree.rootNode, { startIndex: 0, endIndex: text.length });
  console.log(`Total captures: ${captures.length}`);

  const items = [];
  for (const c of captures) {
    items.push({
      from: c.node.startIndex,
      to: c.node.endIndex,
      name: c.name,
      deco: Decoration.mark({ class: `cm-ts-${c.name.replace(/\./g, '-')}` })
    });
  }

  // Sort by from ascending, then to ascending
  items.sort((a, b) => a.from - b.from || a.to - b.to);

  console.log('Testing RangeSetBuilder with items...');
  try {
    const builder = new RangeSetBuilder();
    let lastFrom = -1;
    let lastTo = -1;
    let added = 0;
    for (const item of items) {
      if (item.from > lastFrom || (item.from === lastFrom && item.to >= lastTo)) {
        builder.add(item.from, item.to, item.deco);
        lastFrom = item.from;
        lastTo = item.to;
        added++;
      }
    }
    const set = builder.finish();
    console.log(`SUCCESS! Added ${added} decorations. Set size: ${set.size}`);
  } catch (err) {
    console.error('FAILED RangeSetBuilder:', err);
  }
}

testDart().catch(console.error);