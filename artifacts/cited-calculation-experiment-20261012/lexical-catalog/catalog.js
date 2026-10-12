import { sourceMap, calculate, runCalculation } from '../calculate.js';

const need = (ok, message) => { if (!ok) throw Error(message); };
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const NUMBER = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?';
const literalPattern = new RegExp(`${MONTH} \\d{1,2}(?:,? \\d{4})?|\\$${NUMBER}|${NUMBER}%|(?<![\\p{L}\\p{N}-])${WORD}(?![\\p{L}\\p{N}-])|${NUMBER}`, 'giu');
const unsupported = /[€£¥]|(?:USD|EUR|GBP)\s*\d|[-+]\s*\$?\d|\$\s*[-+]|\$\d[\d,.]*%|\d\s*[-–—/]\s*\$?\d|\d[eE][+-]?\d|\b(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/iu;

/** Lexical copying only. No totals, semantic labels, defaults or entailment. */
export function literalCatalog(messages) {
  const sources = sourceMap(messages), facts = [], spans = [];
  for (const [source, text] of sources) {
    need(!unsupported.test(text), `Unsupported quantity syntax in ${source}`);
    need(!new RegExp(`\\b${WORD}-${WORD}\\b`, 'iu').test(text), `Unsupported word range in ${source}`);
    const covered = new Uint8Array(text.length);
    for (const match of text.matchAll(/\bD[1-8]:P[1-9]\d*\b/gu)) covered.fill(1, match.index, match.index + match[0].length);
    for (const match of text.matchAll(literalPattern)) {
      const start = match.index, end = start + match[0].length, value = match[0];
      if (covered.slice(start, end).some(Boolean)) continue;
      const before = text.slice(0, start), after = text.slice(end);
      need(!/[$%\p{L}\p{N}+\-]$/u.test(before) && !/^[%\p{L}\p{N}\-]/u.test(after), `Partial or signed quantity in ${source}`);
      need(!/\d[.,]$/.test(before) && !/^[.,]\d/.test(after), `Partial decimal in ${source}`);
      let kind = value.startsWith('$') ? 'money' : value.endsWith('%') ? 'percent' : new RegExp(`^${MONTH} `, 'iu').test(value) ? 'date' : 'number';
      if (kind === 'number') {
        need(!/^\s+(?:dollars?|cents?|months?|years?|hours?|minutes?|(?:business|working|calendar)\s+(?:days?|weeks?))\b/iu.test(after), `Unsupported quantity unit in ${source}`);
        const duration = after.match(/^\s+(days?|weeks?)\b/iu);
        if (duration) {
          need(!/^\s+(?:days?|weeks?)\s*(?:\/|or)\s*(?:days?|weeks?)\b/iu.test(after), `Ambiguous duration unit in ${source}`);
          kind = duration[1].toLowerCase().startsWith('day') ? 'days' : 'weeks';
        }
      }
      if (kind === 'date') need(!/^,?\s*\d/.test(after), `Unsupported date year in ${source}`);
      const quoteStart = Math.max(0, start - 96), quoteEnd = Math.min(text.length, end + 96);
      const id = `f${String(facts.length).padStart(3, '0')}`;
      facts.push({ id, kind, source, quote: text.slice(quoteStart, quoteEnd), value });
      spans.push({ id, source, start, end, quoteStart, quoteEnd });
      covered.fill(1, start, end);
    }
    for (let index = 0; index < text.length; index++) need(!/[\d$%]/.test(text[index]) || covered[index], `Unrecognized numeric span in ${source}`);
  }
  // Reuse the same exact lexeme, kind, calendar and magnitude checks.
  calculate({ facts, operations: [] }, messages);
  return { facts, spans, entries: facts.map(({ id, kind, source, value }) => ({ id, kind, source, value })),
    scope: 'Exact source literals only. No semantic attribution, conditions, contradictions or truth are established.' };
}

/** New operations-only input contract; original generated operations are untouched. */
export async function calculateCatalog(input, messages, options = {}) {
  need(input && Object.keys(input).join(',') === 'operations', 'Expected operations only');
  const catalog = literalCatalog(messages);
  const result = await runCalculation({ facts: catalog.facts, operations: input.operations }, messages, options);
  return { results: result.results, scope: result.scope };
}
