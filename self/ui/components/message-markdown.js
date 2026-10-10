/** Bounded Markdown presentation. No HTML evaluation or execution; reconcile existing DOM. */
const text = value => ({ text: value });
const element = (tag, children, attrs = {}) => ({ tag, children, attrs });
const literal = value => element('span', [text(value)]);
const MAX_FORMATTED_CHARACTERS = 100000, MAX_BLOCKS = 2000;

function inline(value, targets, depth = 0) {
  if (depth > 4) return [text(value)];
  const pattern = /\[D\d+:P\d+\]|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
  const nodes = []; let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (nodes.length > 2000) break;
    if (match.index > cursor) nodes.push(text(value.slice(cursor, match.index)));
    if (/^\[D\d+:P\d+\]$/.test(match[0])) {
      const target = targets.get(match[0].slice(1, -1));
      nodes.push(element(target ? 'a' : 'span', [text(match[0])], target ? { href: '#' + target, 'data-source-reference': '' } : { title: 'No supplied passage has this reference' }));
    } else if (match[1]) nodes.push(element('code', [text(match[1])]));
    else if (match[2] || match[3]) nodes.push(element(match[2] ? 'strong' : 'em', inline(match[2] || match[3], targets, depth + 1)));
    else {
      // Relative URLs, executable schemes, images and generated HTML remain literal.
      let href; try { const url = new URL(match[5]); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) href = url.href; } catch {}
      nodes.push(href ? element('a', inline(match[4], targets, depth + 1), { href, target: '_blank', rel: 'noopener noreferrer' }) : text(match[0]));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length || !nodes.length) nodes.push(text(value.slice(cursor)));
  return nodes;
}
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
const tableRule = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
function parse(value, targets) {
  if (value.length > MAX_FORMATTED_CHARACTERS) return [element('div', [literal(value)], { 'data-text-block': '' })];
  const lines = value.split('\n'), blocks = [];
  for (let i = 0; i < lines.length;) {
    if (blocks.length >= MAX_BLOCKS) { blocks.push(element('div', [literal(lines.slice(i).join('\n'))], { 'data-text-block': '' })); break; }
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) { code.push(''); i++; }
      blocks.push(element('pre', [element('code', [text(code.join('\n'))]), element('button', [text('Copy code')], { type: 'button', class: 'pool-button', 'data-copy-code': '' })], { 'data-text-block': '' }));
    } else if (/^#{1,6}\s+/.test(line)) {
      const [, marks, content] = line.match(/^(#{1,6})\s+(.*)$/); blocks.push(element('h' + marks.length, inline(content, targets), { 'data-text-block': '' })); i++;
    } else if (tableRule(lines[i + 1])) {
      const headings = cells(line); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(element('tr', cells(lines[i++]).slice(0, headings.length).map(cell => element('td', inline(cell, targets)))));
      blocks.push(element('div', [element('table', [element('thead', [element('tr', headings.map(cell => element('th', inline(cell, targets), { scope: 'col' })))]), element('tbody', rows)])], { 'data-text-block': '', class: 'chat-table-scroll' }));
    } else if (/^\s*(?:[-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\. /.test(line), items = [];
      const pattern = ordered ? /^\s*\d+\. (.*)$/ : /^\s*[-*+] (.*)$/;
      while (i < lines.length && pattern.test(lines[i])) items.push(element('li', inline(lines[i++].match(pattern)[1], targets)));
      const attrs = { 'data-text-block': '' }; if (ordered) attrs.start = line.match(/\d+/)[0];
      blocks.push(element(ordered ? 'ol' : 'ul', items, attrs));
    } else {
      const prose = [line]; i++;
      while (i < lines.length && lines[i].trim() && !/^(?:```|#{1,6}\s)|^\s*(?:[-*+] |\d+\. )/.test(lines[i]) && !tableRule(lines[i + 1])) prose.push(lines[i++]);
      blocks.push(element('div', [element('span', inline(prose.join('\n'), targets))], { 'data-text-block': '' }));
    }
  }
  return blocks;
}
function updateText(node, value) {
  const previous = node.data; if (previous === value) return;
  let start = 0, end = 0;
  while (start < previous.length && start < value.length && previous[start] === value[start]) start++;
  while (end < previous.length - start && end < value.length - start && previous.at(-1 - end) === value.at(-1 - end)) end++;
  node.replaceData(start, previous.length - start - end, value.slice(start, value.length - end));
}
function reconcile(parent, descriptions) {
  descriptions.forEach((item, index) => {
    let node = parent.childNodes[index]; const name = item.tag?.toUpperCase() || '#text';
    if (node?.nodeName !== name) {
      const replacement = item.tag ? parent.ownerDocument.createElement(item.tag) : parent.ownerDocument.createTextNode('');
      if (node) node.replaceWith(replacement); else parent.append(replacement); node = replacement;
    }
    if (!item.tag) { updateText(node, item.text); return; }
    for (const attr of [...node.attributes]) if (!(attr.name in item.attrs)) node.removeAttribute(attr.name);
    for (const [key, value] of Object.entries(item.attrs)) if (node.getAttribute(key) !== value) node.setAttribute(key, value);
    reconcile(node, item.children);
  });
  while (parent.childNodes.length > descriptions.length) parent.lastChild.remove();
}
export function updateMessageMarkdown(body, value, targets = new Map()) {
  reconcile(body, parse(String(value || ''), targets));
}
