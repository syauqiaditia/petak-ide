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
    maxWidth: 'min(520px, calc(100vw - 460px), calc(100% - 24px)) !important',
    maxHeight: '280px !important',
    overflowY: 'auto !important',
    overflowX: 'hidden !important',
    boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3) !important',
    fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important",
    zIndex: '250 !important',
    scrollbarWidth: 'thin !important',
    scrollbarColor: '#3c3f4a transparent !important',
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

          const symbolText = doc.sliceString(from, to).trim() || 'symbol';
          const lineNum = lspPos.line + 1;

          return {
            pos: from,
            end: to,
            above: true,
            create(view: EditorView) {
              const dom = document.createElement('div');
              dom.className = 'cm-lsp-hover-tooltip';

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

                // Dynamic max width to always stay inside visible editor area
                const maxAllowedWidth = Math.max(260, editorRect.width - 24);
                dom.style.maxWidth = `${maxAllowedWidth}px`;

                // If right dock/panel causes tooltip to overflow right edge of visible editor
                if (domRect.right > editorRect.right - 12) {
                  const shift = domRect.right - (editorRect.right - 12);
                  dom.style.transform = `translateX(-${Math.max(0, shift)}px)`;
                } else if (domRect.left < editorRect.left + 12) {
                  const shift = (editorRect.left + 12) - domRect.left;
                  dom.style.transform = `translateX(${Math.max(0, shift)}px)`;
                } else {
                  dom.style.transform = 'none';
                }
              }

              return {
                dom,
                mount() {
                  requestAnimationFrame(adjustPosition);
                },
                positioned() {
                  adjustPosition();
                },
              };
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
