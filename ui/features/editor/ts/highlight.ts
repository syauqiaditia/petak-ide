import {
  ViewPlugin,
  type ViewUpdate,
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view';
import { Facet, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { Parser, Language, Query, type Tree, type Edit } from 'web-tree-sitter';

import dartQuerySource from './queries/dart.scm?raw';
import kotlinQuerySource from './queries/kotlin.scm?raw';
import swiftQuerySource from './queries/swift.scm?raw';

export const filenameFacet = Facet.define<string, string>({
  combine: (values) => values[0] || '',
});

export const highlightUpdateEffect = StateEffect.define<null>();

let initPromise: Promise<void> | null = null;
export function initTreeSitter(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile(scriptName: string) {
        return '/ts/' + scriptName;
      },
    });
  }
  return initPromise;
}

export type SupportedLanguage = 'dart' | 'kotlin' | 'swift';

export function getLangForFilename(filename: string): SupportedLanguage | null {
  if (filename.endsWith('.dart')) return 'dart';
  if (filename.endsWith('.kt') || filename.endsWith('.kts')) return 'kotlin';
  if (filename.endsWith('.swift')) return 'swift';
  return null;
}

interface LanguageEntry {
  language: Language;
  query: Query;
}

const languageCache = new Map<SupportedLanguage, LanguageEntry>();
const loadingPromises = new Map<SupportedLanguage, Promise<LanguageEntry>>();

export async function loadLanguage(lang: SupportedLanguage): Promise<LanguageEntry> {
  const cached = languageCache.get(lang);
  if (cached) return cached;

  let existing = loadingPromises.get(lang);
  if (existing) return existing;

  const promise = (async () => {
    await initTreeSitter();
    const wasmUrl = `/ts/tree-sitter-${lang}.wasm`;
    const res = await fetch(wasmUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch wasm from ${wasmUrl}: ${res.statusText}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const language = await Language.load(bytes);

    let querySource = '';
    if (lang === 'dart') querySource = dartQuerySource;
    else if (lang === 'kotlin') querySource = kotlinQuerySource;
    else if (lang === 'swift') querySource = swiftQuerySource;

    const query = new Query(language, querySource);
    const entry: LanguageEntry = { language, query };
    languageCache.set(lang, entry);
    loadingPromises.delete(lang);
    return entry;
  })();

  loadingPromises.set(lang, promise);
  return promise;
}

export async function preloadAllLanguages(): Promise<void> {
  await initTreeSitter();
  await Promise.all([
    loadLanguage('dart'),
    loadLanguage('kotlin'),
    loadLanguage('swift'),
  ]);
}

const decoCache = new Map<string, Decoration>();
function getDecorationForCapture(name: string): Decoration {
  let deco = decoCache.get(name);
  if (!deco) {
    const mainClass = name.split('.')[0];
    const fullClass = name.replace(/\./g, '-');
    deco = Decoration.mark({
      class: `cm-ts-${fullClass} cm-ts-${mainClass}`,
    });
    decoCache.set(name, deco);
  }
  return deco;
}

export class TreeSitterHighlighter {
  decorations: DecorationSet = Decoration.none;
  tree: Tree | null = null;
  parser: Parser | null = null;
  query: Query | null = null;
  currentLang: SupportedLanguage | null = null;
  currentFilename: string = '';

  // Performance metrics for benchmarking
  lastInitialParseMs: number = 0;
  lastIncrementalMs: number = 0;
  lastQueryDecoMs: number = 0;

  constructor(readonly view: EditorView) {
    const filename = view.state.facet(filenameFacet);
    this.setupLanguage(filename);
  }

  private setupLanguage(filename: string) {
    this.currentFilename = filename;
    const lang = getLangForFilename(filename);

    if (this.tree) {
      this.tree.delete();
      this.tree = null;
    }

    if (!lang) {
      this.currentLang = null;
      this.query = null;
      this.decorations = Decoration.none;
      return;
    }

    this.currentLang = lang;
    if (!this.parser) {
      this.parser = new Parser();
    }

    const cached = languageCache.get(lang);
    if (cached) {
      this.parser.setLanguage(cached.language);
      this.query = cached.query;
      this.parseFull(this.view.state.doc.toString());
      this.decorations = this.buildDecorations(this.view);
    } else {
      this.decorations = Decoration.none;
      loadLanguage(lang)
        .then(({ language, query }) => {
          if (!this.parser || this.currentLang !== lang) return;
          this.parser.setLanguage(language);
          this.query = query;
          this.parseFull(this.view.state.doc.toString());
          this.decorations = this.buildDecorations(this.view);
          this.view.dispatch({ effects: highlightUpdateEffect.of(null) });
        })
        .catch((err) => {
          console.error(`[TreeSitter] Failed to load ${lang}:`, err);
        });
    }
  }

  parseFull(text: string) {
    if (!this.parser) return;
    const t0 = performance.now();
    this.tree = this.parser.parse(text);
    this.lastInitialParseMs = performance.now() - t0;
  }

  update(update: ViewUpdate) {
    const filename = update.state.facet(filenameFacet);
    if (filename !== this.currentFilename) {
      this.setupLanguage(filename);
      return;
    }

    if (!this.parser || !this.query) {
      return;
    }

    const docChanged = update.docChanged;
    const viewportChanged = update.viewportChanged;
    const hasHighlightEffect = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(highlightUpdateEffect))
    );

    if (docChanged) {
      const docText = update.state.doc.toString();
      if (this.tree && !update.changes.empty) {
        update.changes.iterChanges((fromA, toA, fromB, toB) => {
          const startLine = update.startState.doc.lineAt(fromA);
          const oldEndLine = update.startState.doc.lineAt(toA);
          const newEndLine = update.state.doc.lineAt(toB);

          const edit: Edit = {
            startIndex: fromA,
            oldEndIndex: toA,
            newEndIndex: toB,
            startPosition: {
              row: startLine.number - 1,
              column: fromA - startLine.from,
            },
            oldEndPosition: {
              row: oldEndLine.number - 1,
              column: toA - oldEndLine.from,
            },
            newEndPosition: {
              row: newEndLine.number - 1,
              column: toB - newEndLine.from,
            },
          };
          this.tree!.edit(edit);
        });

        const tParse0 = performance.now();
        this.tree = this.parser.parse(docText, this.tree);
        this.lastIncrementalMs = performance.now() - tParse0;
      } else {
        const tParse0 = performance.now();
        this.tree = this.parser.parse(docText);
        this.lastIncrementalMs = performance.now() - tParse0;
      }

      const tDeco0 = performance.now();
      this.decorations = this.buildDecorations(update.view);
      this.lastQueryDecoMs = performance.now() - tDeco0;
    } else if (viewportChanged || hasHighlightEffect) {
      const tDeco0 = performance.now();
      this.decorations = this.buildDecorations(update.view);
      this.lastQueryDecoMs = performance.now() - tDeco0;
    }
  }

  buildDecorations(view: EditorView): DecorationSet {
    if (!this.tree || !this.query) {
      return Decoration.none;
    }

    const builder = new RangeSetBuilder<Decoration>();
    const docLength = view.state.doc.length;

    for (const { from, to } of view.visibleRanges) {
      if (from >= to) continue;

      const captures = this.query.captures(this.tree.rootNode, {
        startIndex: from,
        endIndex: to,
      });

      const items: { from: number; to: number; deco: Decoration }[] = [];

      for (const capture of captures) {
        const node = capture.node;
        const cStart = Math.max(from, node.startIndex);
        const cEnd = Math.min(to, node.endIndex);
        if (cStart >= cEnd || cStart >= docLength) continue;

        const deco = getDecorationForCapture(capture.name);
        if (deco) {
          items.push({ from: cStart, to: cEnd, deco });
        }
      }

      // Sort by from ascending, then to ascending
      items.sort((a, b) => a.from - b.from || a.to - b.to);

      let lastFrom = -1;
      let lastTo = -1;

      for (const item of items) {
        if (item.from > lastFrom || (item.from === lastFrom && item.to >= lastTo)) {
          builder.add(item.from, item.to, item.deco);
          lastFrom = item.from;
          lastTo = item.to;
        }
      }
    }

    return builder.finish();
  }

  destroy() {
    if (this.tree) {
      this.tree.delete();
      this.tree = null;
    }
    if (this.parser) {
      this.parser.delete();
      this.parser = null;
    }
  }
}

export const treeSitterPlugin = ViewPlugin.fromClass(TreeSitterHighlighter, {
  decorations: (v) => v.decorations,
});

export const highlightTheme = EditorView.baseTheme({
  '.cm-ts-keyword': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-keyword-function': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-keyword-return': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-keyword-coroutine': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-keyword-repeat': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-keyword-type': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-keyword-directive': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-conditional': { color: '#cf8e6d', fontWeight: '500' },
  '.cm-ts-string': { color: '#6aab73' },
  '.cm-ts-string-escape': { color: '#cf8e6d' },
  '.cm-ts-string-regex': { color: '#42b3c2' },
  '.cm-ts-number': { color: '#2aacb8' },
  '.cm-ts-float': { color: '#2aacb8' },
  '.cm-ts-boolean': { color: '#2aacb8', fontWeight: '500' },
  '.cm-ts-function': { color: '#56a8f5' },
  '.cm-ts-function-call': { color: '#56a8f5' },
  '.cm-ts-function-method': { color: '#56a8f5' },
  '.cm-ts-function-builtin': { color: '#56a8f5' },
  '.cm-ts-type': { color: '#bc8cff' },
  '.cm-ts-type-builtin': { color: '#bc8cff' },
  '.cm-ts-comment': { color: '#7a7e85', fontStyle: 'italic' },
  '.cm-ts-comment-documentation': { color: '#7a7e85', fontStyle: 'italic' },
  '.cm-ts-variable': { color: '#bcbec4' },
  '.cm-ts-variable-parameter': { color: '#bcbec4' },
  '.cm-ts-variable-member': { color: '#bcbec4' },
  '.cm-ts-variable-builtin': { color: '#cf8e6d' },
  '.cm-ts-property': { color: '#c792ea' },
  '.cm-ts-operator': { color: '#d8d9dc' },
  '.cm-ts-punctuation': { color: '#8b8f98' },
  '.cm-ts-constant': { color: '#e5c07b' },
  '.cm-ts-constant-builtin': { color: '#e5c07b' },
});
