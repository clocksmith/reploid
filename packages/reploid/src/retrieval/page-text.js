/**
 * @fileoverview Text extraction from fetched pages, shared by the server and device-side extractors so the same
 * bytes yield the same document text and hash on every route. HTML is reduced to readable paragraphs without a DOM:
 * scripts, styles and page chrome are dropped, the main content region is preferred, and block elements
 * become paragraph breaks. Plain text is decoded as-is. PDF and other types are refused before this point.
 * Environment-neutral: no Node or DOM APIs.
 */

// A tag whose quoted attributes may contain '>'.
const ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const TAG = new RegExp(String.raw`<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)(${ATTRS})>`, 'g');
const RAW_TEXT = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'canvas', 'math'];
const CHROME = ['nav', 'header', 'footer', 'aside', 'select', 'button', 'textarea', 'dialog'];
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'table',
  'thead', 'tbody', 'tfoot', 'blockquote', 'pre', 'figure', 'figcaption', 'address', 'hr', 'details', 'summary', 'fieldset',
  'legend', 'caption', 'center', 'body', 'html', 'form']);
const LINE = new Set(['li', 'dt', 'dd', 'br', 'tr', 'option']);
const CELL = new Set(['td', 'th']);

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', shy: '',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…', middot: '·',
  bull: '•', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', prime: '′', Prime: '″', dagger: '†', Dagger: '‡', permil: '‰',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷', minus: '−', frac12: '½', frac14: '¼',
  frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', micro: 'µ', para: '¶', sect: '§', cent: '¢', pound: '£', euro: '€', yen: '¥',
  curren: '¤', iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º', not: '¬', macr: '¯', acute: '´', cedil: '¸', uml: '¨', brvbar: '¦',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', szlig: 'ß',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', tau: 'τ', phi: 'φ',
  omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω'
};
// Latin-1 letters by name: agrave, Agrave, eacute, ...
const LETTERS = { a: 'àáâãäå', e: 'èéêë', i: 'ìíîï', o: 'òóôõöø', u: 'ùúûü', y: 'ýÿ', n: 'ñ', c: 'ç' };
const MARKS = { a: ['grave', 'acute', 'circ', 'tilde', 'uml', 'ring'], e: ['grave', 'acute', 'circ', 'uml'],
  i: ['grave', 'acute', 'circ', 'uml'], o: ['grave', 'acute', 'circ', 'tilde', 'uml', 'slash'], u: ['grave', 'acute', 'circ', 'uml'],
  y: ['acute', 'uml'], n: ['tilde'], c: ['cedil'] };
for (const [base, letters] of Object.entries(LETTERS)) {
  [...letters].forEach((letter, index) => {
    NAMED[base + MARKS[base][index]] = letter;
    const upper = letter.toUpperCase();
    if (upper !== letter && !(base === 'y' && index === 1)) NAMED[base.toUpperCase() + MARKS[base][index]] = upper;
  });
}
Object.assign(NAMED, { aelig: 'æ', AElig: 'Æ', eth: 'ð', ETH: 'Ð', thorn: 'þ', THORN: 'Þ', oelig: 'œ', OElig: 'Œ', Yuml: 'Ÿ' });
// Legacy names browsers accept without a semicolon.
const BARE = new Set(['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg']);

const codePoint = value => (Number.isSafeInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff))
  ? String.fromCodePoint(value) : '�';

/** Decodes numeric and common named character references; unknown names stay as written. */
export function decodeEntities(text) {
  return String(text).replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,31}))(;?)/g, (match, decimal, hex, name, semi) => {
    if (decimal) return codePoint(Number(decimal));
    if (hex) return codePoint(parseInt(hex, 16));
    if (!Object.hasOwn(NAMED, name) || (!semi && !BARE.has(name))) return match;
    return NAMED[name];
  });
}

/** Removes tags and decodes entities from a short HTML fragment, such as a search result title or snippet. */
export function htmlFragmentText(fragment) {
  return decodeEntities(String(fragment ?? '').replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(TAG, (match, closing, name) => BLOCK.has(name.toLowerCase()) || LINE.has(name.toLowerCase()) ? ' ' : ''))
    .replace(/[\s ]+/g, ' ').trim();
}

const anyTag = name => new RegExp(String.raw`<(\/?)${name}(?=[\s/>])${ATTRS}>`, 'gi');

/** Balanced elements named `name`: [{ start, innerStart, innerEnd, end }]. Unclosed elements run to the end. */
function elements(html, name) {
  const found = [], pattern = anyTag(name);
  let depth = 0, current = null, match;
  while ((match = pattern.exec(html))) {
    if (!match[1]) {
      if (match[0].endsWith('/>')) continue;
      if (depth === 0) current = { start: match.index, innerStart: match.index + match[0].length };
      depth++;
    } else if (depth > 0 && --depth === 0) {
      found.push({ ...current, innerEnd: match.index, end: match.index + match[0].length });
      current = null;
    }
  }
  if (current) found.push({ ...current, innerEnd: html.length, end: html.length, unclosed: true });
  return found;
}

/** Removes every `name` element with its content; an unclosed one loses only its opening tag. */
function removeElements(html, name) {
  let output = '', cursor = 0;
  for (const element of elements(html, name)) {
    if (element.start < cursor) continue;
    output += html.slice(cursor, element.start) + ' ';
    cursor = element.unclosed ? element.innerStart : element.end;
  }
  return output + html.slice(cursor);
}

function removeRawText(html) {
  // Raw-text elements cannot nest; an unclosed one hides everything after it, as browsers do.
  const pattern = new RegExp(String.raw`<(${RAW_TEXT.join('|')})(?=[\s/>])${ATTRS}>[\s\S]*?(?:<\/\1\s*>|$)`, 'gi');
  return html.replace(pattern, ' ');
}

function region(html) {
  const main = elements(html, 'main')[0];
  if (main) return html.slice(main.innerStart, main.innerEnd);
  const articles = elements(html, 'article');
  if (articles.length) {
    const largest = articles.reduce((best, item) => item.innerEnd - item.innerStart > best.innerEnd - best.innerStart ? item : best);
    return html.slice(largest.innerStart, largest.innerEnd);
  }
  const body = elements(html, 'body')[0];
  return body ? html.slice(body.innerStart, body.innerEnd) : html;
}

function render(html) {
  const marked = html.replace(/[\s ]+/g, ' ').replace(TAG, (match, closing, name) => {
    const tag = name.toLowerCase();
    if (BLOCK.has(tag)) return '\n\n';
    if (LINE.has(tag)) return closing ? '' : '\n';
    if (CELL.has(tag)) return ' ';
    return '';
  });
  return decodeEntities(marked).replace(/ /g, ' ').split('\n').map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function htmlText(source) {
  let html = source.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, ' ')
    .replace(/<![^>]*>|<\?[^>]*>/g, ' ');
  html = removeRawText(html);
  const titleMatch = html.match(new RegExp(String.raw`<title(?=[\s>])${ATTRS}>([\s\S]*?)<\/title\s*>`, 'i'));
  const title = titleMatch ? htmlFragmentText(titleMatch[1]) : '';
  for (const head of elements(html, 'head').filter(item => !item.unclosed).reverse()) html = html.slice(0, head.start) + ' ' + html.slice(head.end);
  const chosen = region(html);
  // Page chrome is dropped inside the chosen region; if that leaves nothing, the region is kept whole.
  const cleaned = render(CHROME.reduce(removeElements, chosen));
  return { text: cleaned || render(chosen), title };
}

const CHARSET = /charset\s*=\s*["']?([\w.:-]+)/i;
/** The charset named by the header, else a <meta> declaration in the first 2 KB, else a byte-order mark, else UTF-8. */
export function detectCharset(body, contentType = '', charset = null) {
  if (charset) return charset;
  const declared = String(contentType).match(CHARSET)?.[1];
  if (declared) return declared;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return 'utf-8';
  if (body[0] === 0xff && body[1] === 0xfe) return 'utf-16le';
  if (body[0] === 0xfe && body[1] === 0xff) return 'utf-16be';
  const head = Array.from(body.subarray(0, 2048), byte => String.fromCharCode(byte)).join('');
  for (const meta of head.matchAll(new RegExp(String.raw`<meta(?=[\s/])${ATTRS}>`, 'gi'))) {
    const direct = meta[0].match(/\bcharset\s*=\s*["']?([\w.:-]+)/i)?.[1];
    if (direct) return direct;
  }
  return 'utf-8';
}

// windows-1252 bytes 0x80-0x9F. Some Node releases decode this label as ISO-8859-1, so it is mapped here.
const CP1252 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f'
  + '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

function decode(body, label) {
  let decoder;
  try { decoder = new TextDecoder(label); } catch { decoder = new TextDecoder('utf-8'); }
  if (decoder.encoding !== 'windows-1252') return decoder.decode(body);
  let text = '';
  for (const byte of body) text += byte >= 0x80 && byte <= 0x9f ? CP1252[byte - 0x80] : String.fromCharCode(byte);
  return text;
}

/** { text, title, characters } for an HTML or plain-text body. */
export function extractDocumentText({ body, contentType = '', charset = null }) {
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(String(body ?? ''));
  const source = decode(bytes, detectCharset(bytes, contentType, charset)).replace(/^﻿/, '');
  const mime = String(contentType).split(';')[0].trim().toLowerCase();
  if (mime === 'text/plain') {
    const text = source.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    return { text, title: '', characters: text.length };
  }
  const { text, title } = htmlText(source);
  return { text, title, characters: text.length };
}
