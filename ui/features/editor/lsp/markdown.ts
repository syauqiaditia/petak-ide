/**
 * Lightweight, safe markdown rendering for LSP hover tooltips and completion docs.
 * Zero external dependencies. Enforces XSS sanitization and clean link rendering.
 */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(trimmed)) {
    return trimmed;
  }
  return '#';
}

/**
 * Format inline markdown tokens: `code`, **bold**, *italic*, [label](url).
 * Input string is already HTML-escaped.
 */
export function formatInlineMarkdown(escapedText: string): string {
  // Replace links: [label](url) -> <a href="..." target="_blank" rel="noopener noreferrer">label</a>
  let out = escapedText.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label, url) => {
      const safeHref = escapeHtml(sanitizeUrl(url));
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="cm-lsp-link">${label}</a>`;
    }
  );

  // Replace inline code: `code` -> <code>code</code>
  out = out.replace(/`([^`]+)`/g, (_match, code) => {
    return `<code class="cm-lsp-inline-code">${code}</code>`;
  });

  // Replace bold: **text** -> <strong>text</strong>
  out = out.replace(/\*\*([^*]+)\*\*/g, (_match, bold) => {
    return `<strong>${bold}</strong>`;
  });

  // Replace italic: *text* -> <em>text</em>
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, italic) => {
    return `<em>${italic}</em>`;
  });

  return out;
}

/**
 * Render raw markdown into sanitized HTML string.
 */
export function renderMarkdownToHtml(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const normalized = raw.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/(```[\s\S]*?```)/g);
  const htmlParts: string[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;

    if (block.startsWith('```') && block.endsWith('```')) {
      const inner = block.slice(3, -3);
      const lines = inner.split('\n');
      const firstLine = (lines[0] || '').trim();
      const hasLang = /^[a-zA-Z0-9_#-]+$/.test(firstLine);
      const codeLines = hasLang ? lines.slice(1) : lines;
      const codeText = codeLines.join('\n').replace(/^\n+|\n+$/g, '');
      const escapedCode = escapeHtml(codeText);
      const langClass = hasLang ? ` class="language-${escapeHtml(firstLine)}"` : '';

      htmlParts.push(
        `<div class="cm-lsp-signature-wrap"><pre class="cm-lsp-code-block"><code${langClass}>${escapedCode}</code></pre></div>`
      );
    } else {
      const paragraphs = block.split(/\n\s*\n/);
      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const escaped = escapeHtml(trimmed);
        const formatted = formatInlineMarkdown(escaped).replace(/\n/g, '<br/>');
        htmlParts.push(`<p class="cm-lsp-para">${formatted}</p>`);
      }
    }
  }

  return htmlParts.join('');
}

/**
 * Render raw markdown into a DOM HTMLElement.
 */
export function renderMarkdownToDom(raw: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'cm-lsp-markdown-root';
  container.innerHTML = renderMarkdownToHtml(raw);
  return container;
}
