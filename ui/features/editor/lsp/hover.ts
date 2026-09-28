import { hoverTooltip, EditorView, type Tooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { api, type LspHover } from '../../../lib/api';
import { isLspSupported } from './sync';
import { offsetToLspPos, lspPosToOffset } from './pos';

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

/**
 * Render minimal markdown without heavy libraries: code blocks, inline code, paragraphs.
 */
function renderHoverMarkdown(raw: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cm-lsp-hover-content';

  const blocks = raw.split(/(```[\s\S]*?```)/g);
  for (const block of blocks) {
    if (!block.trim()) continue;
    if (block.startsWith('```') && block.endsWith('```')) {
      const lines = block.slice(3, -3).trim().split('\n');
      const firstLine = lines[0] || '';
      const codeLines = /^[a-zA-Z0-9_-]+$/.test(firstLine) ? lines.slice(1) : lines;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      root.appendChild(pre);
    } else {
      const p = document.createElement('p');
      const tokens = block.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
      for (const token of tokens) {
        if (token.startsWith('`') && token.endsWith('`')) {
          const c = document.createElement('code');
          c.textContent = token.slice(1, -1);
          p.appendChild(c);
        } else if (token.startsWith('**') && token.endsWith('**')) {
          const s = document.createElement('strong');
          s.textContent = token.slice(2, -2);
          p.appendChild(s);
        } else if (token) {
          p.appendChild(document.createTextNode(token));
        }
      }
      if (p.childNodes.length > 0) {
        root.appendChild(p);
      }
    }
  }

  return root;
}

export const hoverTheme = EditorView.theme({
  '.cm-tooltip.cm-lsp-hover-tooltip': {
    backgroundColor: '#1e2025 !important',
    border: '1px solid #34363d !important',
    borderRadius: '6px !important',
    padding: '8px 12px !important',
    color: '#d8d9dc !important',
    fontSize: '12px !important',
    maxWidth: '450px !important',
    maxHeight: '260px !important',
    overflowY: 'auto !important',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4) !important',
    fontFamily: "'JetBrains Mono', monospace !important",
    zIndex: '200 !important',
  },
  '.cm-lsp-hover-content pre': {
    backgroundColor: '#141518',
    border: '1px solid #26282d',
    borderRadius: '4px',
    padding: '6px 10px',
    margin: '6px 0',
    overflowX: 'auto',
  },
  '.cm-lsp-hover-content code': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11.5px',
    color: '#56a8f5',
  },
  '.cm-lsp-hover-content p': {
    margin: '4px 0',
    lineHeight: '1.45',
  },
  '.cm-lsp-hover-content strong': {
    color: '#e6efff',
  },
});

export function createLspHoverExtension(getPath: () => string | null): Extension {
  return [
    hoverTooltip(async (view: EditorView, pos: number): Promise<Tooltip | null> => {
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
            dom.appendChild(renderHoverMarkdown(text));
            return { dom };
          },
        };
      } catch (e) {
        console.error('LSP hover error:', e);
        return null;
      }
    }),
    hoverTheme,
  ];
}
