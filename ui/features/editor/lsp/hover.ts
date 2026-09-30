import { hoverTooltip, EditorView, closeHoverTooltips, keymap, type Tooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { api, type LspHover } from '../../../lib/api';
import { isLspSupported } from './sync';
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
  '.cm-tooltip.cm-lsp-hover-tooltip': {
    backgroundColor: '#16171b !important',
    border: '1px solid #2d3039 !important',
    borderRadius: '8px !important',
    padding: '0 !important',
    color: '#d4d6dc !important',
    fontSize: '12px !important',
    maxWidth: '540px !important',
    maxHeight: '280px !important',
    overflowY: 'auto !important',
    overflowX: 'hidden !important',
    boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3) !important',
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important",
    zIndex: '250 !important',
    scrollbarWidth: 'thin !important',
    scrollbarColor: '#3c3f4a transparent !important',
  },
  '.cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar': {
    width: '5px !important',
    height: '5px !important',
  },
  '.cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar-track': {
    background: 'transparent !important',
  },
  '.cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar-thumb': {
    backgroundColor: '#3c3f4a !important',
    borderRadius: '4px !important',
  },
  '.cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar-thumb:hover': {
    backgroundColor: '#565a68 !important',
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

export function createLspHoverExtension(getPath: () => string | null): Extension {
  return [
    hoverTooltip(
      async (view: EditorView, pos: number): Promise<Tooltip | null> => {
        const path = getPath();
        if (!path || !isLspSupported(path)) return null;

        const doc = view.state.doc;
        const lspPos = offsetToLspPos(doc, pos);

        try {
          const hoverRes = await api.lsp.hover(path, lspPos.line, lspPos.character);
          if (!hoverRes) return null;

          const text = extractHoverText(hoverRes.contents);
          if (!text.trim()) return null;

          let from = pos;
          let to = pos;

          if (hoverRes.range) {
            from = lspPosToOffset(doc, hoverRes.range.start);
            to = lspPosToOffset(doc, hoverRes.range.end);
          } else {
            const word = view.state.wordAt(pos);
            if (word) {
              from = word.from;
              to = word.to;
            }
          }

          return {
            pos: from,
            end: to,
            above: true,
            create() {
              const dom = document.createElement('div');
              dom.className = 'cm-lsp-hover-tooltip';
              dom.appendChild(renderMarkdownToDom(text));
              return { dom };
            },
          };
        } catch (e) {
          console.error('LSP hover error:', e);
          return null;
        }
      },
      {
        hideOnChange: true,
        hideOn: (tr) => tr.docChanged || tr.selection !== undefined,
      }
    ),
    hoverKeymap,
    hoverTheme,
  ];
}
