export function processSnippet(text) {
  if (!text.includes('$')) {
    return { cleanText: text, placeholderOffset: null, placeholderLen: null };
  }

  // Matches ${1:placeholder}, ${1}, $1
  const snippetRegex = /\$\{([0-9]+)(?::([^}]*))?\}|\$([0-9]+)/g;
  let match;
  let cleanText = '';
  let lastIndex = 0;
  let targetPlaceholder = null; // offset and len for placeholder 1, or 0 if no 1

  while ((match = snippetRegex.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;
    const num = parseInt(match[1] || match[3] || '0', 10);
    const content = match[2] !== undefined ? match[2] : '';

    cleanText += text.slice(lastIndex, matchIndex);
    const offsetInClean = cleanText.length;
    cleanText += content;

    if (num === 1 || (targetPlaceholder === null && num === 0)) {
      targetPlaceholder = {
        offset: offsetInClean,
        len: content.length,
      };
    }

    lastIndex = matchIndex + rawMatch.length;
  }

  cleanText += text.slice(lastIndex);

  return {
    cleanText,
    placeholderOffset: targetPlaceholder ? targetPlaceholder.offset : null,
    placeholderLen: targetPlaceholder ? targetPlaceholder.len : null,
  };
}

// Test cases
console.log(processSnippet("${1:widget}(child: foo)"));
console.log(processSnippet("${1:Padding}(\n  child: $0\n)"));
console.log(processSnippet("normal text without snippet"));
console.log(processSnippet("$0"));
