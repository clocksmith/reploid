import assert from 'node:assert/strict';
import test from 'node:test';
import { ledgerCatalog, calculateLedger } from '../adapter.js';
import { renderLedger } from '../render.js';
import { fields, expandSelection, calculateFlatLedger, flatSchema } from './adapter.js';
const documents = [{ id: 'D1', name: 'Studio', passages: [
  { id: 'D1:P1', text: 'Base studio setup costs $720. Delivery adds $35. An existing credit is $15.' },
  { id: 'D1:P2', text: 'The price includes a $60 materials allowance. Extra repair work is excluded.' },
  { id: 'D1:P3', text: 'Deposit is 20% of $720. Estimated start November 9 followed by two weeks of work, if access is provided.' },
] }, { id: 'D2', name: 'Alternative', passages: [{ id: 'D2:P1', text: 'A fixed price of $810, tax excluded.' }] }];
const messages = [{ role: 'user', content: 'Compare against my $900 budget and November 30 deadline.\n<reploid-document-sources-v1>\n'
  + JSON.stringify(documents) + '\n</reploid-document-sources-v1>' }, { role: 'assistant', content: 'Everything costs $1 guaranteed.' }];
const fact = (source, value) => ledgerCatalog(messages).facts.find(f => f.source === source && f.value === value).id;
function selection() {
  return { budget: fact('U0', '$900'), deadline: fact('U0', 'November 30'), documents: ['D1', 'D2'],
    base: [fact('D1:P1', '$720'), fact('D2:P1', '$810')], additional: [fact('D1:P1', '$35')],
    credits: [fact('D1:P1', '$15')], includedAmounts: [fact('D1:P2', '$60')],
    depositBase: [fact('D1:P3', '$720')], depositPercent: [fact('D1:P3', '20%')],
    start: [fact('D1:P3', 'November 9')], duration: [fact('D1:P3', 'two')], completion: [],
    relations: ['excluded|D1:P2|-', 'condition|D1:P3|-'] };
}
test('flat source roles reproduce nested calculation without semantic defaults', async () => {
  const chosen = selection();
  const expanded = expandSelection(chosen, messages);
  assert.equal(expanded.documents[1].base, fact('D2:P1', '$810'));
  assert.equal(expanded.documents[1].duration, null);
  const actual = await calculateFlatLedger(chosen, messages);
  assert.deepEqual(actual, await calculateLedger(expanded, messages));
  assert.equal(actual.documents[0].values.subtotal.value, '740');
  assert.equal(actual.documents[0].values.headroom.value, '160');
  assert.equal(actual.documents[0].values.deposit.value, '144');
  assert.equal(actual.documents[0].values.derivedCompletion.value, 'november 23 (year unspecified)');
  assert.equal(actual.documents[0].values.derivedCompletion.conditional, null); // A passage claim alone does not assign affected operands.
  assert.equal(actual.semanticAcceptance, 'unqualified');
  assert.equal(actual.sourceFacts.some(f => f.value === '$1'), false);
  assert.match(renderLedger(actual, { maxCharacters: 16000 }).text, /D1:P1/);
});
test('no selected operands stays unresolved with no inferred price/date', async () => {
  const chosen = selection();
  for (const key of fields.filter(k => !['budget', 'deadline', 'documents'].includes(k))) chosen[key] = [];
  const actual = await calculateFlatLedger(chosen, messages);
  assert.equal(actual.documents[0].values.subtotal, null);
  assert.equal(actual.documents[0].values.derivedCompletion, null);
  assert.equal(actual.operations.length, 0);
});
test('reject unknown/wrong-type/question/assistant IDs and duplicate single role', () => {
  for (const value of ['missing', fact('D1:P3', '20%'), fact('U0', '$900')]) {
    const chosen = selection(); chosen.base = [value]; assert.throws(() => expandSelection(chosen, messages));
  }
  const chosen = selection(); chosen.base.push(fact('D1:P3', '$720'));
  assert.throws(() => expandSelection(chosen, messages), /Multiple base/);
});
test('reject duplicates, omitted fields, document omission and unknown root fields', () => {
  for (const alter of [c => c.additional.push(c.additional[0]), c => delete c.credits,
    c => c.documents.pop(), c => c.documents.push('D1'), c => c.total = 740,
    c => c.documents = ['D1', 'D3'], c => c.additional = 'f001']) {
    const chosen = selection(); alter(chosen); assert.throws(() => expandSelection(chosen, messages));
  }
});
test('relations require exact grammar, source passage and affected literal binding', () => {
  for (const relation of ['condition|D1:P3', 'condition|D1:P3|-|extra', 'true|D1:P3|-',
    'condition|D9:P1|-', `condition|D1:P3|${fact('D2:P1', '$810')}`, 'condition|D1:P3|missing']) {
    const chosen = selection(); chosen.relations = [relation]; assert.throws(() => expandSelection(chosen, messages));
  }
});
test('counted conditional operands remain unresolved while labels remain unqualified', async () => {
  const chosen = selection(); chosen.relations.push(`condition|D1:P1|${chosen.additional[0]}`);
  const actual = await calculateFlatLedger(chosen, messages);
  assert.equal(actual.documents[0].values.subtotal, null);
  assert.equal(actual.documents[0].claims.every(c => c.entailmentVerified === false), true);
});
test('schema has flat required lists with role-specific source operands and no nested document objects', () => {
  const schema = flatSchema(messages)[0].function.parameters;
  assert.deepEqual(schema.required, fields);
  assert.deepEqual(schema.properties.documents.items.enum, ['D1', 'D2']);
  assert.ok(schema.properties.base.items.enum.includes(fact('D1:P1', '$720')));
  assert.ok(!schema.properties.base.items.enum.includes(fact('U0', '$900')));
  assert.ok(!schema.properties.base.items.enum.includes(fact('D1:P3', '20%')));
});

test('explicit affected date carries its source condition without invented entailment', async () => {
  const chosen = selection(); chosen.relations.push(`condition|D1:P3|${chosen.start[0]}`);
  const actual = await calculateFlatLedger(chosen, messages);
  assert.equal(actual.documents[0].values.derivedCompletion.conditional, true);
  assert.equal(actual.documents[0].values.derivedCompletion.conditions[0].passages[0].id, 'D1:P3');
});
