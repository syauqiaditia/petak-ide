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
    fontFamily: "'Geist', system-ui, sans-serif !important",
    zIndex: '200 !important',
  },
  '.cm-lsp-signature-wrap': {
    borderBottom: '1px solid #282a32',
    paddingBottom: '4px',
    marginBottom: '8px',
  },
  '.cm-lsp-hover-tooltip pre.cm-lsp-code-block': {
    backgroundColor: '#141518',
    border: '1px solid #26282d',
    borderRadius: '4px',
    padding: '6px 10px',
    margin: '4px 0',
    overflowX: 'auto',
    fontSize: '11.5px',
    lineHeight: '1.45',
    fontFamily: "'JetBrains Mono', monospace !important",
  },
  '.cm-lsp-hover-tooltip code': {
    fontFamily: "'JetBrains Mono', monospace !important",
    fontSize: '11.5px',
    color: '#6ea8ff',
  },
  '.cm-lsp-hover-tooltip p.cm-lsp-para': {
    margin: '6px 0',
    lineHeight: '1.5',
    color: '#b0b4bc',
    fontFamily: "'Geist', system-ui, sans-serif !important",
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
