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
 * Parse markdown text section into HTML paragraphs, lists, and doc tags.
 */
function parseMarkdownSection(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let currentListType: 'ul' | 'ol' | null = null;
  let currentListItems: string[] = [];
  let currentParaLines: string[] = [];

  function flushList() {
    if (currentListType && currentListItems.length > 0) {
      const tag = currentListType;
      const cls = tag === 'ul' ? 'cm-lsp-bullet-list' : 'cm-lsp-numbered-list';
      result.push(`<${tag} class="cm-lsp-list ${cls}">${currentListItems.map((li) => `<li>${li}</li>`).join('')}</${tag}>`);
      currentListType = null;
      currentListItems = [];
    }
  }

  function flushPara() {
    if (currentParaLines.length > 0) {
      const escaped = escapeHtml(currentParaLines.join(' ').trim());
      if (escaped) {
        result.push(`<p class="cm-lsp-para">${formatInlineMarkdown(escaped)}</p>`);
      }
      currentParaLines = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushPara();
      continue;
    }

    // Check bullet list: * item or - item or + item
    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch) {
      flushPara();
      if (currentListType && currentListType !== 'ul') {
        flushList();
      }
      currentListType = 'ul';
      const itemContent = formatInlineMarkdown(escapeHtml(bulletMatch[1].trim()));
      currentListItems.push(itemContent);
      continue;
    }

    // Check numbered list: 1. item or 2. item
    const numberMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (numberMatch) {
      flushPara();
      if (currentListType && currentListType !== 'ol') {
        flushList();
      }
      currentListType = 'ol';
      const itemContent = formatInlineMarkdown(escapeHtml(numberMatch[2].trim()));
      currentListItems.push(itemContent);
      continue;
    }

    // Check doc tags: @param, @return, @returns, @throws, @deprecated, @see, etc.
    const tagMatch = line.match(/^\s*(@[a-zA-Z0-9_-]+)\s*(.*)$/);
    if (tagMatch) {
      flushList();
      flushPara();
      const tagName = escapeHtml(tagMatch[1]);
      const tagDesc = formatInlineMarkdown(escapeHtml(tagMatch[2].trim()));
      result.push(
        `<div class="cm-lsp-doc-tag"><span class="cm-lsp-tag-name">${tagName}</span><span class="cm-lsp-tag-content">${tagDesc}</span></div>`
      );
      continue;
    }

    // Indented continuation of list item
    if (currentListType && /^\s{2,}\S/.test(line)) {
      const lastIdx = currentListItems.length - 1;
      if (lastIdx >= 0) {
        currentListItems[lastIdx] += ' ' + formatInlineMarkdown(escapeHtml(trimmed));
        continue;
      }
    }

    // Otherwise, normal text line
    flushList();
    currentParaLines.push(trimmed);
  }

  flushList();
  flushPara();

  return result.join('');
}

/**
 * Render raw markdown into sanitized HTML string.
 * Separates function signature header from body documentation.
 */
export function renderMarkdownToHtml(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const normalized = raw.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/(```[\s\S]*?```)/g);
  const signatureParts: string[] = [];
  const bodyParts: string[] = [];
  let isFirstCodeBlock = true;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
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

      const codeHtml = `<div class="cm-lsp-signature-wrap"><pre class="cm-lsp-code-block"><code${langClass}>${escapedCode}</code></pre></div>`;

      // If this is the first code block, treat it as the signature header
      if (isFirstCodeBlock) {
        signatureParts.push(codeHtml);
        isFirstCodeBlock = false;
      } else {
        bodyParts.push(codeHtml);
      }
    } else {
      const sectionHtml = parseMarkdownSection(block);
      if (sectionHtml) {
        bodyParts.push(sectionHtml);
      }
    }
  }

  let result = '';
  if (signatureParts.length > 0) {
    result += `<div class="cm-lsp-header-signature">${signatureParts.join('')}</div>`;
  }
  if (bodyParts.length > 0) {
    result += `<div class="cm-lsp-doc-body">${bodyParts.join('')}</div>`;
  }
  return result || signatureParts.join('') || bodyParts.join('');
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
