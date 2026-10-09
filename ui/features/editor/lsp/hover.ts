import { hoverTooltip, EditorView, type Tooltip } from '@codemirror/view';
import { currentCompletions } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { api, type LspHover } from '../../../lib/api';
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
    borderRadius: '6px !important',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5) !important',
    minWidth: '280px !important',
    maxWidth: '500px !important',
    maxHeight: '260px !important',
    overflow: 'auto !important',
    overflowX: 'auto !important',
    overflowY: 'auto !important',
    color: '#d4d6dc !important',
    fontSize: '12px !important',
    zIndex: '9999 !important',
    scrollbarWidth: 'thin !important',
    scrollbarColor: '#3c3f4a transparent !important',
    boxSizing: 'border-box !important',
    pointerEvents: 'auto !important',
    userSelect: 'text !important',
    webkitUserSelect: 'text !important',
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
    padding: '8px 12px !important',
    color: '#d4d6dc !important',
    fontSize: '12px !important',
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important",
    boxSizing: 'border-box !important',
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
    margin: '-8px -12px 8px -12px !important',
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
    padding: '0 !important',
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
    margin: '4px 0 !important',
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
    margin: '4px 0 !important',
    paddingLeft: '18px !important',
    listStyleType: 'disc !important',
    color: '#b8bcc6',
  },
  '.cm-lsp-hover-tooltip ol.cm-lsp-numbered-list': {
    margin: '4px 0 !important',
    paddingLeft: '18px !important',
    listStyleType: 'decimal !important',
    color: '#b8bcc6',
  },
  '.cm-lsp-hover-tooltip li': {
    margin: '2px 0 !important',
    lineHeight: '1.5',
  },
  '.cm-lsp-doc-tag': {
    margin: '4px 0 !important',
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
        const lspPos = offsetToLspPos(doc, pos);

        try {
          await flushPending(path);
          const hoverRes = await api.lsp.hover(path, lspPos.line, lspPos.character);
          const text = hoverRes ? extractHoverText(hoverRes.contents) : '';
          if (!text.trim()) return null;

          let from = pos;
          let to = pos;
          if (hoverRes?.range) {
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
          return null;
        }
      },
      { hoverTime: 200 }
    ),
    hoverTheme,
  ];
}
