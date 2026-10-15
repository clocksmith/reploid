/**
 * @fileoverview Chooses the passage of an extracted document that is sent as a numbered source. The result is
 * always an exact slice of the document, text === document.slice(start, end), so its offsets and hashes can be
 * checked against the document later. Relevance is lexical: query content words per paragraph.
 */
import { contentWords, wordTokens } from '../../packages/reploid/src/retrieval/text.js';

const PARAGRAPH = /\S[\s\S]*?(?=\n[ \t]*\n|$)/g;

function trimmedEnd(text, start, end) {
  while (end > start && /\s/.test(text[end - 1])) end--;
  // Never end between the halves of a surrogate pair.
  if (end > start && /[\ud800-\udbff]/.test(text[end - 1])) end--;
  return end;
}

/** { text, start, end }: the best-matching paragraph (earliest on ties), extended with following paragraphs within maxCharacters. */
export function selectPassage({ text, query = '', maxCharacters }) {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error('maxCharacters must be a positive integer');
  const document = String(text ?? '');
  const paragraphs = [...document.matchAll(PARAGRAPH)].map(match => ({ start: match.index,
    end: trimmedEnd(document, match.index, match.index + match[0].length) })).filter(item => item.end > item.start);
  if (!paragraphs.length) return { text: '', start: 0, end: 0 };
  const terms = contentWords(query);
  const score = item => { const words = new Set(wordTokens(document.slice(item.start, item.end))); return terms.filter(term => words.has(term)).length; };
  let best = 0, bestScore = -1;
  paragraphs.forEach((item, index) => { const value = score(item); if (value > bestScore) { best = index; bestScore = value; } });
  const start = paragraphs[best].start;
  let end = paragraphs[best].end;
  if (end - start > maxCharacters) {
    const cut = start + maxCharacters, window = document.slice(start, cut), space = window.search(/\s\S*$/);
    end = trimmedEnd(document, start, space > maxCharacters * 0.8 ? start + space : cut);
  } else {
    for (const next of paragraphs.slice(best + 1)) { if (next.end - start > maxCharacters) break; end = next.end; }
  }
  return { text: document.slice(start, end), start, end };
}
