import assert from 'node:assert/strict';
import { attachmentInput } from '../../../self/host/document-comparison.js';
import { sourceMap } from '../calculate.js';
import { literalCatalog, calculateCatalog } from './catalog.js';

const messages = text => [{ role: 'user', content: attachmentInput('Inspect the exact source; cite [D1:P1].', [{ name: 'independent test', text }]) }];
const m = messages('Seven labels cost $13.70 each. Limit $413. Start January 28; allow six days. Deposit 11%. An included allowance is $90, not an extra charge. A separate optional service is also $90.');
const c = literalCatalog(m);
assert.deepEqual(c.entries.map(({ kind, value }) => [kind, value]), [['number', 'Seven'], ['money', '$13.70'], ['money', '$413'], ['date', 'January 28'], ['days', 'six'], ['percent', '11%'], ['money', '$90'], ['money', '$90']]);
assert.equal(new Set(c.entries.map(x => x.id)).size, c.entries.length);
assert.deepEqual(literalCatalog(m), c);
for (const span of c.spans) {
  const f = c.facts.find(x => x.id === span.id);
  const source = sourceMap(m).get(span.source);
  assert.equal(source.slice(span.start, span.end), f.value);
  assert.equal(source.slice(span.quoteStart, span.quoteEnd), f.quote);
  assert.equal(f.quote.includes(f.value), true);
}
const ops = [{ id: 'total', op: 'multiply', args: ['f001', 'f000'] }, { id: 'left', op: 'subtract', args: ['f002', 'total'] }, { id: 'end', op: 'addCalendarDuration', args: ['f003', 'f004'] }, { id: 'deposit', op: 'percent', args: ['total', 'f005'] }];
assert.deepEqual((await calculateCatalog({ operations: ops }, m)).results.map(x => x.value), ['95.9', '317.1', 'february 3 (year unspecified)', '10.549']);
assert.deepEqual(literalCatalog([...m, { role: 'assistant', content: 'The amount is $999.' }]), c);
assert.throws(() => literalCatalog(messages('$12.345')), /Partial/);
for (const text of ['$10%', '-$10', '- 10', '+10', '$-10', '$ 10', '10 %', '€10', 'USD 10', '$10-$20', '3/4', '1e3', 'twenty-one', 'one-two', 'one hundred', '7 dollars', '3 business days', '2 days or weeks', 'February 31', 'January 2, 26', '10kg', '1,23']) assert.throws(() => literalCatalog(messages(text)), undefined, text);
assert.equal(literalCatalog(messages('Someone handles money by telephone.')).entries.length, 0);
assert.throws(() => literalCatalog(messages('3.14159')), /Partial/);
assert.throws(() => literalCatalog(messages(Array(41).fill('$9').join(' '))), /bounds/);
await assert.rejects(calculateCatalog({ facts: [], operations: [] }, m), /operations only/);
await assert.rejects(calculateCatalog({ operations: [{ id: 'x', op: 'add', args: ['f001', 'invented'] }] }, m), /existing/);
await assert.rejects(calculateCatalog({ operations: [{ id: 'x', op: 'add', args: ['f001', 'f003'] }] }, m), /date/);
await assert.rejects(calculateCatalog({ operations: ops }, m, { authorized: false }), /denied/);
const aborted = new AbortController(); aborted.abort();
await assert.rejects(calculateCatalog({ operations: ops }, m, { signal: aborted.signal }), /abort/i);
const leap = messages('Start February 28 for two days.');
await assert.rejects(calculateCatalog({ operations: [{ id: 'end', op: 'addCalendarDuration', args: ['f000', 'f001'] }] }, leap), /Missing year/);
const changed = [...m, { role: 'assistant', content: 'Untrusted prior claim.' }, ...messages('Replacement $30.')];
assert.throws(() => literalCatalog(changed), /Conflicting/);
console.log('Lexical spans, units, partial-value rejection, dates, aliases, assistant exclusion and governed execution passed; no semantic qualification.');
