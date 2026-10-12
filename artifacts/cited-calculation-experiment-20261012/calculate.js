import { comparisonSources } from '../../self/host/document-comparison.js';
import { createToolRunner } from '../../packages/reploid/src/agent/tool-runner.js';

const need = (ok, message) => { if (!ok) throw Error(message); };
const kinds = new Set(['money', 'number', 'percent', 'date', 'days', 'weeks']);
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function rational(text) {
  let value = text.trim().toLowerCase();
  if (words.includes(value)) value = String(words.indexOf(value));
  need(/^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?%?$/.test(value), 'Unsupported numeric lexeme');
  value = value.replace(/[$,%]/g, '');
  const [whole, fraction = ''] = value.split('.');
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}

function date(text) {
  const match = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})(?:,? (\d{4}))?$/i);
  need(match, 'Unsupported calendar date');
  const value = { month: months.indexOf(match[1].toLowerCase()), day: Number(match[2]), year: match[3] ? Number(match[3]) : null };
  const year = value.year ?? 2000;
  const check = new Date(Date.UTC(year, value.month, value.day));
  need(check.getUTCFullYear() === year && check.getUTCMonth() === value.month && check.getUTCDate() === value.day, 'Invalid calendar date');
  return value;
}

function decimal({ n, d }) {
  need(n <= 10n ** 16n && n >= -(10n ** 16n) && d > 0n && d <= 10n ** 12n, 'Calculation exceeds exact bounds');
  const negative = n < 0n; let remainder = negative ? -n : n;
  let result = String(remainder / d); remainder %= d;
  if (remainder) {
    result += '.';
    for (let i = 0; remainder && i < 8; i++) { remainder *= 10n; result += String(remainder / d); remainder %= d; }
    need(remainder === 0n, 'Nonterminating result requires an explicit rounding policy');
  }
  return (negative ? '-' : '') + result;
}

export function sourceMap(messages) {
  const sources = new Map();
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'user') continue;
    const parsed = comparisonSources(message.content);
    sources.set(`U${index}`, parsed?.question ?? message.content);
    for (const document of parsed?.documents ?? []) for (const passage of document.passages) {
      need(!sources.has(passage.id) || sources.get(passage.id) === passage.text, 'Conflicting passage identity');
      sources.set(passage.id, passage.text);
    }
  }
  return sources;
}

export function calculate(plan, messages) {
  need(plan && Object.keys(plan).sort().join(',') === 'facts,operations', 'Expected facts and operations only');
  need(Array.isArray(plan.facts) && plan.facts.length <= 40 && Array.isArray(plan.operations) && plan.operations.length <= 30, 'Plan exceeds bounds');
  const sources = sourceMap(messages), facts = new Map(), results = [];
  for (const fact of plan.facts) {
    need(fact && Object.keys(fact).sort().join(',') === 'id,kind,quote,source,value', 'Unexpected fact fields');
    need(typeof fact.id === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(fact.id) && !facts.has(fact.id), 'Invalid or duplicate fact ID');
    need(kinds.has(fact.kind) && typeof fact.quote === 'string' && fact.quote.length > 0 && fact.quote.length <= 600, 'Invalid fact kind/quote');
    need(sources.has(fact.source) && sources.get(fact.source).includes(fact.quote), 'Citation quote mismatch');
    need(typeof fact.value === 'string' && fact.value.length <= 64 && fact.quote.includes(fact.value), 'Value is not an exact quoted lexeme');
    // Prevent a numeric substring (e.g. 9 from 99) from becoming a new operand.
    const escaped = fact.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    need(new RegExp(`(?<![$\\p{L}\\p{N}-])(?<!\\d[.,])${escaped}(?![%\\p{L}\\p{N}-]|[.,]\\d)`, 'u').test(fact.quote), 'Partial numeric lexeme');
    need((!fact.value.includes('$') || fact.kind === 'money') && (!fact.value.includes('%') || fact.kind === 'percent'), 'Explicit lexical unit conflicts with fact kind');
    const value = fact.kind === 'date' ? date(fact.value) : rational(fact.value);
    if (fact.kind !== 'date') decimal(value);
    facts.set(fact.id, { ...fact, parsed: value, sources: [fact.source] });
  }
  for (const op of plan.operations) {
    need(op && Object.keys(op).sort().join(',') === 'args,id,op', 'Unexpected operation fields');
    need(typeof op.id === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(op.id) && !facts.has(op.id), 'Invalid operation ID');
    need(Array.isArray(op.args) && op.args.length === 2 && op.args.every(id => typeof id === 'string' && facts.has(id)), 'Operations require two existing fact/result IDs');
    const [a, b] = op.args.map(id => facts.get(id)); let value, kind = a.kind;
    if (op.op === 'addCalendarDuration') {
      need(a.kind === 'date' && ['days', 'weeks'].includes(b.kind) && b.parsed.n % b.parsed.d === 0n, 'Calendar operands require a date and whole duration');
      const days = Number(b.parsed.n / b.parsed.d) * (b.kind === 'weeks' ? 7 : 1);
      need(days >= 0 && days <= 366, 'Calendar duration exceeds bounds');
      const dates = (a.parsed.year ? [a.parsed.year] : [2000, 2001]).map(year => {
        const current = new Date(Date.UTC(year, a.parsed.month, a.parsed.day));
        need(current.getUTCFullYear() === year && current.getUTCMonth() === a.parsed.month && current.getUTCDate() === a.parsed.day, 'Invalid calendar date');
        current.setUTCDate(current.getUTCDate() + days);
        return { month: current.getUTCMonth(), day: current.getUTCDate(), year: a.parsed.year ? current.getUTCFullYear() : null };
      });
      need(dates.every(d => d.month === dates[0].month && d.day === dates[0].day), 'Missing year changes calendar result');
      value = dates[0];
    } else {
      need(a.kind !== 'date' && b.kind !== 'date', 'Numeric operation received a date');
      const x = a.parsed, y = b.parsed;
      if (op.op === 'add' || op.op === 'subtract') {
        need(a.kind === b.kind, 'Incompatible addition units');
        value = { n: x.n * y.d + (op.op === 'add' ? 1n : -1n) * y.n * x.d, d: x.d * y.d };
      } else if (op.op === 'multiply' || op.op === 'percent') {
        need(b.kind === (op.op === 'percent' ? 'percent' : 'number') && a.kind !== 'percent', 'Invalid multiplier unit');
        value = { n: x.n * y.n, d: x.d * y.d * (op.op === 'percent' ? 100n : 1n) };
      } else throw Error('Unknown operation');
    }
    const sources = [...new Set([...a.sources, ...b.sources])];
    const result = { id: op.id, kind, value: kind === 'date' ? `${months[value.month]} ${value.day}${value.year ? ', ' + value.year : ' (year unspecified)'}` : decimal(value), sources, operation: op };
    results.push(result); facts.set(op.id, { kind, parsed: value, sources });
  }
  return { results, verifiedFacts: plan.facts, scope: 'Exact quoted text and deterministic calculations only. Semantic attribution, completeness, conditions and contradictions remain unverified.' };
}

export async function runCalculation(plan, messages, { authorized = true, signal } = {}) {
  const runner = createToolRunner({ builtInTools: { Calculate: input => calculate(input, messages) }, authorize: ({ name }) => authorized && name === 'Calculate' });
  try { return await runner.executeTool('Calculate', plan, { signal }); }
  finally { runner.close(); }
}

