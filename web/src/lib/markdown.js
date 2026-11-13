function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inline(value) {
  const code = [];
  let output = value.replace(/`([^`]+)`/g, (_, body) => {
    code.push(`<code>${body}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  output = output
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  output = output.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
  return output;
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let index = 0;
  let listMode = null;

  const closeList = () => {
    if (!listMode) return;
    output.push(`</${listMode}>`);
    listMode = null;
  };

  while (index < lines.length) {
    const raw = lines[index];
    const line = escapeHtml(raw);
    if (raw.startsWith('```')) {
      closeList();
      const language = escapeHtml(raw.slice(3).trim());
      const body = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        body.push(escapeHtml(lines[index]));
        index += 1;
      }
      output.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${body.join('\n')}</code></pre>`);
      index += 1;
      continue;
    }
    if (!raw.trim()) {
      closeList();
      index += 1;
      continue;
    }
    const heading = raw.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length + 1);
      output.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      index += 1;
      continue;
    }
    const bullet = raw.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (listMode !== 'ul') {
        closeList();
        listMode = 'ul';
        output.push('<ul>');
      }
      output.push(`<li>${inline(escapeHtml(bullet[1]))}</li>`);
      index += 1;
      continue;
    }
    const ordered = raw.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      if (listMode !== 'ol') {
        closeList();
        listMode = 'ol';
        output.push('<ol>');
      }
      output.push(`<li>${inline(escapeHtml(ordered[1]))}</li>`);
      index += 1;
      continue;
    }
    const quote = raw.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      output.push(`<blockquote>${inline(escapeHtml(quote[1]))}</blockquote>`);
      index += 1;
      continue;
    }
    closeList();
    output.push(`<p>${inline(line)}</p>`);
    index += 1;
  }
  closeList();
  return output.join('\n');
}
