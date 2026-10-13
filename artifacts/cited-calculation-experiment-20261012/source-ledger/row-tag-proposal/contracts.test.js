import assert from 'node:assert/strict';
import test from 'node:test';
import { ledgerCatalog, calculateLedger } from '../adapter.js';
import { fields, flatSchema } from '../flat-experiment/adapter.js';
import { runCalculation } from '../../calculate.js';
import { renderLedger } from '../render.js';

const docs = [{ id: 'D1', name: 'Unrelated badge order', passages: [
  { id: 'D1:P1', text: 'Each badge costs $13.25. Shipping is included.' },
  { id: 'D1:P2', text: 'An advance payment of $9 has been received. Tax has not been determined.' },
] }];
const user = { role: 'user', content: 'What is due for seven badges?\n<reploid-document-sources-v1>\n'
  + JSON.stringify(docs) + '\n</reploid-document-sources-v1>' };
const source = [user];
const fact = (kind, value) => ledgerCatalog(source).facts.find(f => f.kind === kind && f.value === value);

test('existing calculator supports quantity multiplication but ledger contract cannot select quantity', async () => {
  const price = fact('money', '$13.25'), count = fact('number', 'seven'), payment = fact('money', '$9');
  assert.ok(price && count && payment);
  const result = await runCalculation({ facts: [price, count, payment], operations: [
    { id: 'gross', op: 'multiply', args: [price.id, count.id] },
    { id: 'due', op: 'subtract', args: ['gross', payment.id] },
  ] }, source);
  assert.equal(result.results[0].value, '92.75');
  assert.equal(result.results[1].value, '83.75');
  assert.deepEqual(result.results[1].sources, ['D1:P1', 'U0', 'D1:P2']);
  assert.equal(fields.includes('quantity'), false);
  const schema = flatSchema(source)[0].function.parameters;
  assert.equal(Object.values(schema.properties).some(p => p.items?.enum?.includes(count.id)), false);
});

test('current renderer gets prior-assistant presence, not distinct false claims', async () => {
  const price = fact('money', '$13.25');
  const selected = { budget: null, deadline: null, documents: [{ documentId: 'D1',
    base: price.id, additional: [], credits: [], includedAmounts: [], depositBase: null,
    depositPercent: null, start: null, duration: null, completion: null, relations: [],
  }] };
  // This deliberate semantic misuse of a per-unit price as base is NOT a qualified answer.
  const histories = ['Shipping costs extra.', 'No advance payment has been received.'].map(content => [user,
    { role: 'assistant', content }, { role: 'user', content: 'Correct that answer using the original terms.' }]);
  const ledgers = await Promise.all(histories.map(messages => calculateLedger(selected, messages)));
  assert.deepEqual(ledgers[0], ledgers[1]);
  const answers = ledgers.map(ledger => renderLedger(ledger, { maxCharacters: 16000 }));
  assert.equal(answers[0].text, answers[1].text);
  assert.equal(ledgers[0].priorAssistantClaimsPresent, true);
  assert.equal(answers[0].semanticAcceptance, 'unqualified');
  assert.equal(answers[0].text.includes('Shipping costs extra.'), false);
  assert.equal(answers[0].text.includes('No advance payment'), false);
});
