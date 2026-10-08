import type { Extension } from '@codemirror/state';
import {
  autocompletion,
  snippet,
  startCompletion,
  closeCompletion,
  acceptCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { EditorView, keymap } from '@codemirror/view';
import { api, type LspCompletionItem } from '../../../lib/api';
import { isLspSupported, flushPending } from './sync';
import { offsetToLspPos } from './pos';
import { createSnippetCompletionSource } from '../snippets';
import { applyTextEditsToView } from './applyEdit';
import { renderMarkdownToDom } from './markdown';

/**
 * Map LSP CompletionItemKind to human-readable type string and single-letter badge.
 */
function getKindInfo(kind?: number): { typeName: string; letter: string } {
  switch (kind) {
    case 1:
      return { typeName: 'text', letter: 't' };
    case 2:
      return { typeName: 'method', letter: 'm' };
    case 3:
      return { typeName: 'function', letter: 'f' };
    case 4:
      return { typeName: 'constructor', letter: 'c' };
    case 5:
      return { typeName: 'field', letter: 'f' };
    case 6:
      return { typeName: 'variable', letter: 'v' };
    case 7:
      return { typeName: 'class', letter: 'c' };
    case 8:
      return { typeName: 'interface', letter: 'i' };
    case 9:
      return { typeName: 'module', letter: 'm' };
    case 10:
      return { typeName: 'property', letter: 'p' };
    case 11:
      return { typeName: 'unit', letter: 'u' };
    case 12:
      return { typeName: 'value', letter: 'v' };
    case 13:
      return { typeName: 'enum', letter: 'e' };
    case 14:
      return { typeName: 'keyword', letter: 'k' };
    case 15:
      return { typeName: 'snippet', letter: 's' };
    case 16:
      return { typeName: 'color', letter: 'c' };
    case 17:
      return { typeName: 'file', letter: 'f' };
    case 18:
      return { typeName: 'reference', letter: 'r' };
    case 21:
      return { typeName: 'constant', letter: 'c' };
    case 22:
      return { typeName: 'struct', letter: 's' };
    case 25:
      return { typeName: 'type-parameter', letter: 't' };
    default:
      return { typeName: 'text', letter: 'm' };
  }
}

/**
 * Format markdown documentation for CodeMirror completion info popover.
 */
function renderDocContent(doc: string | { kind?: string; value: string } | any): HTMLElement {
  const rawText =
    typeof doc === 'string'
      ? doc
      : doc && typeof doc.value === 'string'
      ? doc.value
      : String(doc || '');

  const dom = renderMarkdownToDom(rawText);
  dom.className = 'cm-completion-doc-content';
  return dom;
}

/**
 * CompletionSource calling the LSP server with debouncing / stale check.
 */
export function createLspCompletionSource(getPath: () => string | null): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const path = getPath();
    if (!path || !isLspSupported(path)) return null;

    // Match identifier characters before cursor
    const word = context.matchBefore(/[\w$]+/);
    if (!word && !context.explicit) {
      // Check if previous char is a trigger character like '.', ':', etc.
      const charBefore = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos);
      if (!['.', ':', '/', '"', "'"].includes(charBefore)) {
        return null;
      }
    }

    const from = word ? word.from : context.pos;
    const lspPos = offsetToLspPos(context.state.doc, context.pos);

    // Ensure LSP server has the freshest document content before requesting completion
    flushPending(path);

    let docAborted = false;
    context.addEventListener('abort', () => {
      docAborted = true;
    });

    try {
      const response = await api.lsp.completion(path, lspPos.line, lspPos.character);
      if (context.aborted || docAborted) return null;

      const rawItems: LspCompletionItem[] = Array.isArray(response)
        ? response
        : response && Array.isArray((response as any).items)
        ? (response as any).items
        : [];

      if (rawItems.length === 0) return null;

      const options: Completion[] = rawItems.map((item) => {
        const { typeName, letter } = getKindInfo(item.kind);

        const completion: Completion & { _kindLetter?: string } = {
          label: item.filterText || item.label,
          detail: item.detail || '',
          type: typeName,
          _kindLetter: letter,
          sortText: item.sortText || item.label,
        };
        if (item.filterText && item.filterText !== item.label) {
          completion.displayLabel = item.label;
        }

        // Snippet support (insertTextFormat === 2) and additionalTextEdits (e.g. auto import)
        const mainInsert =
          (item.textEdit && (item.textEdit as any).newText) || item.insertText || item.label;

        if (item.additionalTextEdits && item.additionalTextEdits.length > 0) {
          const isSnippet = item.insertTextFormat === 2;
          completion.apply = (view: EditorView, comp: Completion, from: number, to: number) => {
            if (isSnippet) {
              snippet(mainInsert)(view, comp, from, to);
            } else {
              view.dispatch({
                changes: { from, to, insert: mainInsert },
              });
            }
            applyTextEditsToView(view, item.additionalTextEdits!);
          };
        } else if (item.insertTextFormat === 2 && (item.insertText || (item.textEdit && (item.textEdit as any).newText))) {
          const template = item.insertText || (item.textEdit as any).newText || item.label;
          completion.apply = snippet(template);
        } else if (item.textEdit && (item.textEdit as any).newText) {
          completion.apply = (item.textEdit as any).newText;
        } else if (item.insertText) {
          completion.apply = item.insertText;
        }

        // Lazy docs resolve
        completion.info = async () => {
          if (item.documentation) {
            return renderDocContent(item.documentation);
          }
          try {
            const resolved = await api.lsp.completionResolve(path, item);
            if (resolved && resolved.documentation) {
              return renderDocContent(resolved.documentation);
            }
          } catch (_) {}
          return null;
        };

        return completion;
      });

      return {
        from,
        options,
        validFor: /^[\w$]*$/,
      };
    } catch (e) {
      console.error('LSP completion error:', e);
      return null;
    }
  };
}

/**
 * Styling theme matching Petak IDE Design System.
 */
export const completionTheme = EditorView.theme({
  '.cm-tooltip-autocomplete': {
    backgroundColor: '#22242a !important',
    border: '1px solid #34363d !important',
    borderRadius: '8px !important',
    boxShadow: '0 10px 26px rgba(0,0,0,0.45) !important',
    padding: '4px !important',
    minWidth: '340px !important',
    maxWidth: '520px !important',
    fontFamily: "'JetBrains Mono', monospace !important",
  },
  '.cm-tooltip-autocomplete::after': {
    content: '"⏎ insert · ⇥ replace · ⌃Space docs"',
    display: 'block',
    padding: '6px 10px 2px',
    fontSize: '11px',
    color: '#8b8f98',
    borderTop: '1px solid #34363d',
    marginTop: '4px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  '.cm-tooltip-autocomplete > ul': {
    maxHeight: '260px',
    padding: '0',
    margin: '0',
    listStyle: 'none',
    fontFamily: "'JetBrains Mono', monospace",
  },
  '.cm-tooltip-autocomplete > ul > li': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '26px',
    padding: '0 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#bcbec4',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: '#2a3a55 !important',
    color: '#e6efff !important',
  },
  '.cm-completionLabel': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    color: 'inherit',
  },
  '.cm-completionDetail': {
    marginLeft: 'auto !important',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px !important',
    color: '#8b8f98 !important',
    fontStyle: 'normal !important',
  },
  '.cm-completionMatchedText': {
    color: '#6ea8ff !important',
    fontWeight: '600',
    textDecoration: 'none !important',
  },
  '.cm-completion-badge': {
    width: '16px',
    height: '16px',
    borderRadius: '4px',
    fontSize: '10px',
    display: 'grid',
    placeItems: 'center',
    fontWeight: '500',
    fontFamily: "'JetBrains Mono', monospace",
    flexShrink: '0',
  },
  '.cm-completion-badge.method, .cm-completion-badge.function': {
    backgroundColor: '#2b2f45',
    color: '#56a8f5',
  },
  '.cm-completion-badge.field, .cm-completion-badge.variable, .cm-completion-badge.property': {
    backgroundColor: '#2e2440',
    color: '#c77dbb',
  },
  '.cm-completion-badge.class, .cm-completion-badge.constructor, .cm-completion-badge.interface, .cm-completion-badge.struct': {
    backgroundColor: '#3a3224',
    color: '#e8b45a',
  },
  '.cm-completion-badge.keyword': {
    backgroundColor: '#382c24',
    color: '#cf8e6d',
  },
  '.cm-completion-badge.snippet': {
    backgroundColor: '#243528',
    color: '#6aab73',
  },
  '.cm-completion-badge.text': {
    backgroundColor: '#26282d',
    color: '#8b8f98',
  },
  '.cm-tooltip.cm-completionInfo': {
    backgroundColor: '#1e2025 !important',
    border: '1px solid #34363d !important',
    borderRadius: '6px !important',
    padding: '8px 12px !important',
    color: '#d8d9dc !important',
    fontSize: '12px !important',
    maxWidth: '520px !important',
    maxHeight: '260px !important',
    overflowY: 'auto !important',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4) !important',
    fontFamily: "'JetBrains Mono', monospace !important",
  },
  '.cm-completion-doc-content pre.cm-lsp-code-block': {
    backgroundColor: '#141518',
    border: '1px solid #26282d',
    borderRadius: '4px',
    padding: '4px 8px',
    margin: '4px 0',
    overflowX: 'auto',
    fontSize: '11px',
    lineHeight: '1.4',
  },
  '.cm-completion-doc-content code': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11.5px',
    color: '#56a8f5',
  },
  '.cm-completion-doc-content p.cm-lsp-para': {
    margin: '3px 0',
    lineHeight: '1.4',
  },
  '.cm-completion-doc-content a.cm-lsp-link': {
    color: '#6ea8ff',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
});

/**
 * Create complete autocompletion extension for CodeMirror 6.
 */
export function createLspAutocompleteExtension(getPath: () => string | null): Extension {
  return [
    autocompletion({
      override: [
        createSnippetCompletionSource(getPath),
        createLspCompletionSource(getPath),
      ],
      activateOnTyping: true,
      maxRenderedOptions: 50,
      defaultKeymap: true,
      addToOptions: [
        {
          render: (completion: Completion) => {
            const badge = document.createElement('span');
            badge.className = 'cm-completion-badge ' + (completion.type || 'text');
            badge.textContent = (completion as any)._kindLetter || (completion.type === 'snippet' ? 's' : 'm');
            return badge;
          },
          position: 20,
        },
      ],
    }),
    completionTheme,
  ];
}
