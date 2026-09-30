/**
 * Minimal, zero-dependency Markdown renderer and XSS sanitizer for GitLab MR Viewer.
 * Reuses escapeHtml and sanitizeUrl from lsp/markdown.ts.
 * Enforces NO raw HTML and NO external images (prevents IP/token leak).
 */
import { escapeHtml, sanitizeUrl } from '../editor/lsp/markdown.ts';

/**
 * Neutralizes image markdown tokens: ![alt](url) -> [Gambar: alt]
 * External images are blocked to prevent token/IP sniffing.
 */
export function stripImages(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt) => {
    const label = alt ? `[Gambar: ${alt}]` : '[Gambar]';
    return label;
  });
}

/**
 * Format inline markdown tokens: `code`, **bold**, *italic*, [label](url).
 * Input is already HTML-escaped.
 */
export function formatMrInlineMarkdown(escapedText: string): string {
  // Links: [label](url) -> safe <a>
  let out = escapedText.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label, url) => {
      const safeHref = escapeHtml(sanitizeUrl(url));
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="mr-link">${label}</a>`;
    }
  );

  // Inline code: `code`
  out = out.replace(/`([^`]+)`/g, (_match, code) => {
    return `<code class="mr-inline-code">${code}</code>`;
  });

  // Bold: **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_match, bold) => {
    return `<strong>${bold}</strong>`;
  });

  // Italic: *text*
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, italic) => {
    return `<em>${italic}</em>`;
  });

  return out;
}

/**
 * Render raw MR markdown (description, comments) into sanitized HTML string.
 */
export function renderMrMarkdown(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '';

  // 1. Strip external images
  const noImages = stripImages(raw);

  // 2. Normalize newlines
  const normalized = noImages.replace(/\r\n/g, '\n');

  // 3. Split by fenced code blocks
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
        `<pre class="mr-code-block"><code${langClass}>${escapedCode}</code></pre>`
      );
    } else {
      const paragraphs = block.split(/\n\s*\n/);
      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const escaped = escapeHtml(trimmed);
        const formatted = formatMrInlineMarkdown(escaped).replace(/\n/g, '<br/>');
        htmlParts.push(`<p class="mr-para">${formatted}</p>`);
      }
    }
  }

  return htmlParts.join('');
}
