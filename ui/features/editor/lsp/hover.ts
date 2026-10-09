import { hoverTooltip, EditorView, closeHoverTooltips, keymap, type Tooltip } from '@codemirror/view';
import { currentCompletions } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { api, type LspHover, type LspPosition } from '../../../lib/api';
import { isLspSupported, flushPending } from './sync';
import { offsetToLspPos, lspPosToOffset } from './pos';
import { renderMarkdownToDom } from './markdown';

/**
 * Extract clean string from various LSP hover content shapes.
 */
function extractHoverText(contents: LspHover['contents']): string {
  if (!contents) return '';
  if (typeof contents === 'string') {
    return contents;
  }
  if (Array.isArray(contents)) {
    return contents.map((c) => (typeof c === 'string' ? c : c.value || '')).join('\n\n');
  }
  if (typeof contents === 'object' && 'value' in contents) {
    return contents.value || '';
  }
  return '';
}

export const hoverTheme = EditorView.theme({
  '.cm-tooltip-hover, .cm-tooltip.cm-tooltip-hover': {
    backgroundColor: '#1e1f22 !important',
    border: '1px solid #383a42 !important',
    borderRadius: '8px !important',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65), 0 2px 6px rgba(0, 0, 0, 0.4) !important',
    maxWidth: 'min(560px, calc(100vw - 420px), calc(100% - 24px)) !important',
    maxHeight: '280px !important',
    overflowY: 'auto !important',
    overflowX: 'auto !important',
    color: '#d4d6dc !important',
    fontSize: '12px !important',
    zIndex: '9999 !important',
    scrollbarWidth: 'thin !important',
    scrollbarColor: '#3c3f4a transparent !important',
    boxSizing: 'border-box !important',
    pointerEvents: 'auto !important',
  },
  '.cm-tooltip-hover::-webkit-scrollbar, .cm-tooltip.cm-tooltip-hover::-webkit-scrollbar, .cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar': {
    width: '6px !important',
    height: '6px !important',
  },
  '.cm-tooltip-hover::-webkit-scrollbar-track, .cm-tooltip.cm-tooltip-hover::-webkit-scrollbar-track, .cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar-track': {
    background: 'transparent !important',
  },
  '.cm-tooltip-hover::-webkit-scrollbar-thumb, .cm-tooltip.cm-tooltip-hover::-webkit-scrollbar-thumb, .cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar-thumb': {
    backgroundColor: '#3c3f4a !important',
    borderRadius: '4px !important',
  },
  '.cm-tooltip-hover::-webkit-scrollbar-thumb:hover, .cm-tooltip.cm-tooltip-hover::-webkit-scrollbar-thumb:hover, .cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar-thumb:hover': {
    backgroundColor: '#565a68 !important',
  },
  '.cm-tooltip-hover .cm-lsp-hover-tooltip, .cm-lsp-hover-tooltip': {
    display: 'flex !important',
    flexDirection: 'column !important',
    width: '100% !important',
    backgroundColor: '#1e1f22 !important',
    padding: '0 !important',
    color: '#d4d6dc !important',
    fontSize: '12px !important',
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important",
    boxSizing: 'border-box !important',
  },
  '.cm-lsp-hover-action-bar': {
    display: 'flex !important',
    alignItems: 'center !important',
    justifyContent: 'space-between !important',
    padding: '4px 10px !important',
    backgroundColor: 'rgba(255, 255, 255, 0.04) !important',
    borderBottom: '1px solid #252730 !important',
    fontSize: '11px !important',
    gap: '8px !important',
  },
  '.cm-lsp-hover-loc-badge': {
    color: '#8b949e !important',
    fontFamily: "'JetBrains Mono', monospace !important",
    fontSize: '10.5px !important',
  },
  '.cm-lsp-hover-ask-btn': {
    background: 'rgba(59, 130, 246, 0.12) !important',
    border: '1px solid rgba(59, 130, 246, 0.35) !important',
    borderRadius: '4px !important',
    color: '#60a5fa !important',
    padding: '2px 8px !important',
    fontSize: '11px !important',
    fontWeight: '500 !important',
    cursor: 'pointer !important',
    display: 'inline-flex !important',
    alignItems: 'center !important',
    gap: '4px !important',
    transition: 'all 0.12s ease !important',
  },
  '.cm-lsp-hover-ask-btn:hover': {
    background: 'rgba(59, 130, 246, 0.25) !important',
    borderColor: '#3b82f6 !important',
    color: '#93c5fd !important',
  },
  '.cm-lsp-markdown-root': {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  '.cm-lsp-header-signature': {
    backgroundColor: '#0f1013 !important',
    borderBottom: '1px solid #252730 !important',
    padding: '8px 12px !important',
  },
  '.cm-lsp-signature-wrap': {
    margin: '0 !important',
    padding: '0 !important',
  },
  '.cm-lsp-hover-tooltip pre.cm-lsp-code-block': {
    backgroundColor: 'transparent !important',
    border: 'none !important',
    borderRadius: '0 !important',
    padding: '0 !important',
    margin: '0 !important',
    overflowX: 'auto',
    fontSize: '12px',
    lineHeight: '1.45',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace !important",
    color: '#7eb2ff !important',
  },
  '.cm-lsp-doc-body': {
    padding: '8px 12px !important',
    fontSize: '12px',
    lineHeight: '1.6',
    color: '#b0b4be',
  },
  '.cm-lsp-hover-tooltip code': {
    fontFamily: "'JetBrains Mono', monospace !important",
    fontSize: '11.5px',
    color: '#7eb2ff',
  },
  '.cm-lsp-inline-code': {
    backgroundColor: 'rgba(110, 168, 255, 0.1) !important',
    border: '1px solid rgba(110, 168, 255, 0.2) !important',
    padding: '1px 5px !important',
    borderRadius: '3px !important',
    color: '#96c2ff !important',
  },
  '.cm-lsp-hover-tooltip p.cm-lsp-para': {
    margin: '6px 0 !important',
    lineHeight: '1.55',
    color: '#b8bcc6',
  },
  '.cm-lsp-hover-tooltip p.cm-lsp-para:first-child': {
    marginTop: '0 !important',
  },
  '.cm-lsp-hover-tooltip p.cm-lsp-para:last-child': {
    marginBottom: '0 !important',
  },
  '.cm-lsp-hover-tooltip ul.cm-lsp-bullet-list': {
    margin: '6px 0 !important',
    paddingLeft: '18px !important',
    listStyleType: 'disc !important',
    color: '#b8bcc6',
  },
  '.cm-lsp-hover-tooltip ol.cm-lsp-numbered-list': {
    margin: '6px 0 !important',
    paddingLeft: '18px !important',
    listStyleType: 'decimal !important',
    color: '#b8bcc6',
  },
  '.cm-lsp-hover-tooltip li': {
    margin: '3px 0 !important',
    lineHeight: '1.5',
  },
  '.cm-lsp-doc-tag': {
    margin: '6px 0 !important',
    padding: '4px 8px !important',
    backgroundColor: 'rgba(255, 255, 255, 0.03) !important',
    borderLeft: '2px solid #6ea8ff !important',
    borderRadius: '0 4px 4px 0 !important',
    fontSize: '11.5px !important',
    lineHeight: '1.5',
  },
  '.cm-lsp-tag-name': {
    color: '#6ea8ff !important',
    fontWeight: '600 !important',
    marginRight: '6px !important',
    fontFamily: "'JetBrains Mono', monospace !important",
  },
  '.cm-lsp-tag-content': {
    color: '#d0d4de !important',
  },
  '.cm-lsp-hover-tooltip strong': {
    color: '#f0f1f4',
    fontWeight: '600',
  },
  '.cm-lsp-hover-tooltip a.cm-lsp-link': {
    color: '#6ea8ff',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.cm-lsp-hover-tooltip a.cm-lsp-link:hover': {
    color: '#90beff',
  },
});

const hoverKeymap = keymap.of([
  {
    key: 'Escape',
    run(view: EditorView) {
      view.dispatch({ effects: closeHoverTooltips });
      return false; // let Vim or editor handle if needed
    },
  },
]);

import {
  shouldPlaceHoverAbove,
  computeTooltipMaxWidth,
  computeAdaptiveHoverCoords,
} from './hoverLogic.ts';

export { shouldPlaceHoverAbove, computeTooltipMaxWidth, computeAdaptiveHoverCoords };

const DART_KEYWORD_DOCS: Record<string, string> = {
  await: '```dart\nawait expression\n```\nSuspends execution until the Future completes.',
  async: '```dart\nasync\n```\nMarks a function as asynchronous, enabling the `await` keyword and wrapping the return value in a Future.',
  yield: '```dart\nyield expression\n```\nEmits a value from a generator function (`sync*` or `async*`).',
  Future: '```dart\nabstract class Future<T>\n```\nAn object representing a delayed computation or asynchronous result.',
  Stream: '```dart\nabstract class Stream<T>\n```\nA source of asynchronous data events.',
  void: '```dart\nvoid\n```\nIndicates that a function returns no value.',
  late: '```dart\nlate\n```\nDeclares a non-nullable variable that is initialized after its declaration.',
  const: '```dart\nconst\n```\nDeclares a compile-time constant.',
  final: '```dart\nfinal\n```\nDeclares a variable that can be set only once.',
  var: '```dart\nvar\n```\nDeclares a variable with type inferred by the compiler.',
};

function getKeywordDoc(word: string): string | null {
  return DART_KEYWORD_DOCS[word] || null;
}

interface CachedHover {
  text: string;
  from: number;
  to: number;
  timestamp: number;
}
const hoverMemoryCache = new Map<string, CachedHover>();

export function createLspHoverExtension(getPath: () => string | null): Extension {
  return [
    hoverTooltip(
      async (view: EditorView, pos: number): Promise<Tooltip | null> => {
        // If autocomplete suggestions are currently open, hover must not appear (like Android Studio)
        if (currentCompletions(view.state).length > 0) {
          return null;
        }

        const path = getPath();
        if (!path || !isLspSupported(path)) return null;

        const doc = view.state.doc;
        const word = view.state.wordAt(pos);
        const wordText = word ? doc.sliceString(word.from, word.to) : '';

        // 1. Check built-in keyword documentation (instant sync)
        if (wordText) {
          const kwDoc = getKeywordDoc(wordText);
          if (kwDoc) {
            return buildHoverTooltip(view, path, word!.from, word!.to, wordText, offsetToLspPos(doc, pos).line + 1, kwDoc);
          }
        }

        // 2. Check memory cache for fresh response (< 30s)
        const cacheKey = `${path}:${wordText || pos}`;
        const cached = hoverMemoryCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 30000) {
          return buildHoverTooltip(view, path, cached.from, cached.to, wordText || 'symbol', offsetToLspPos(doc, pos).line + 1, cached.text);
        }

        const lspPos = offsetToLspPos(doc, pos);

        try {
          await flushPending(path);
          const hoverRes = await api.lsp.hover(path, lspPos.line, lspPos.character);
          let text = hoverRes ? extractHoverText(hoverRes.contents) : '';

          let from = pos;
          let to = pos;

          if (hoverRes && hoverRes.range) {
            from = lspPosToOffset(doc, hoverRes.range.start);
            to = lspPosToOffset(doc, hoverRes.range.end);
          } else if (word) {
            from = word.from;
            to = word.to;
          }

          if (!text.trim() && wordText) {
            const kwDoc = getKeywordDoc(wordText);
            if (kwDoc) text = kwDoc;
          }

          if (!text.trim()) return null;

          if (from === to) {
            if (word) {
              from = word.from;
              to = word.to;
            } else if (to < doc.length) {
              to = from + 1;
            }
          }
          if (from > to) {
            const tmp = from;
            from = to;
            to = tmp;
          }

          // Cache the resolved result
          hoverMemoryCache.set(cacheKey, { text, from, to, timestamp: Date.now() });

          const symbolText = doc.sliceString(from, to).trim() || wordText || 'symbol';
          const lineNum = lspPos.line + 1;

          return buildHoverTooltip(view, path, from, to, symbolText, lineNum, text);
        } catch (e) {
          console.error('LSP hover error:', e);
          return null;
        }
      },
      {
        hideOnChange: true,
        hoverTime: 180,
      }
    ),
    hoverKeymap,
    hoverTheme,
  ];
}

function buildHoverTooltip(
  view: EditorView,
  path: string,
  from: number,
  to: number,
  symbolText: string,
  lineNum: number,
  text: string
): Tooltip {
  const visualPos = view.coordsAtPos(from);
  const editorRect = view.dom.getBoundingClientRect();
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const bottomDockEl = typeof document !== 'undefined' ? document.querySelector('.bottom-dock-container') : null;
  const bottomDockTop = bottomDockEl ? bottomDockEl.getBoundingClientRect().top : null;
  const rightDockEl = typeof document !== 'undefined' ? document.querySelector('.right-panel-container') : null;
  const rightDockLeft = rightDockEl ? rightDockEl.getBoundingClientRect().left : null;

  const adaptive = computeAdaptiveHoverCoords(
    visualPos,
    editorRect,
    null,
    { viewportWidth, viewportHeight, rightDockLeft, bottomDockTop }
  );

  return {
    pos: from,
    end: to,
    above: adaptive.above,
    create(view: EditorView) {
      const dom = document.createElement('div');
      dom.className = 'cm-lsp-hover-tooltip';
      dom.style.maxWidth = `${adaptive.maxWidth}px`;

      // Header toolbar with location & "Tanya di Chat" action
      const toolbar = document.createElement('div');
      toolbar.className = 'cm-lsp-hover-action-bar';

      const locBadge = document.createElement('span');
      locBadge.className = 'cm-lsp-hover-loc-badge';
      const fileName = path.split('/').pop() || path;
      locBadge.textContent = `${fileName}:${lineNum}`;

      const askBtn = document.createElement('button');
      askBtn.type = 'button';
      askBtn.className = 'cm-lsp-hover-ask-btn';
      askBtn.innerHTML = `<span>💬 Tanya di Chat</span>`;
      askBtn.title = `Kirim ${symbolText} (${fileName}:${lineNum}) ke Petak Agent`;
      askBtn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        view.dispatch({ effects: closeHoverTooltips });

        const { agentsStore } = await import('../../agents/agents.svelte');
        const { panelStore } = await import('../../../shell/panelStore.svelte');

        agentsStore.attachCodeReference({
          path,
          line: lineNum,
          symbol: symbolText,
          codeSnippet: text,
        });
        panelStore.openRightPanel('agent');
      };

      toolbar.appendChild(locBadge);
      toolbar.appendChild(askBtn);
      dom.appendChild(toolbar);

      dom.appendChild(renderMarkdownToDom(text));

      function adjustPosition() {
        if (!view.dom.isConnected || !dom.isConnected) return;
        const editorRect = view.dom.getBoundingClientRect();
        const domRect = dom.getBoundingClientRect();
        const currentVisualPos = view.coordsAtPos(from) || visualPos;
        const vWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const vHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
        const bDockEl = typeof document !== 'undefined' ? document.querySelector('.bottom-dock-container') : null;
        const bDockTop = bDockEl ? bDockEl.getBoundingClientRect().top : null;
        const rDockEl = typeof document !== 'undefined' ? document.querySelector('.right-panel-container') : null;
        const rDockLeft = rDockEl ? rDockEl.getBoundingClientRect().left : null;

        const coords = computeAdaptiveHoverCoords(
          currentVisualPos,
          editorRect,
          domRect,
          { viewportWidth: vWidth, viewportHeight: vHeight, rightDockLeft: rDockLeft, bottomDockTop: bDockTop }
        );

        dom.style.maxWidth = `${coords.maxWidth}px`;
      }

      return {
        dom,
        mount() {
                  adjustPosition();
                },
        positioned() {
                  adjustPosition();
                },
      };
    },
  };
}
