import assert from 'node:assert/strict';
import test from 'node:test';
import { ledgerCatalog, ledgerSchema, calculateLedger } from './adapter.js';

const documents = [{ id: 'D1', name: 'Unrelated studio estimate', passages: [
  { id: 'D1:P1', text: 'Base studio setup costs $720. Delivery adds $35. An existing credit is $15.' },
  { id: 'D1:P2', text: 'The price includes a $60 materials allowance. Extra repair work is excluded.' },
  { id: 'D1:P3', text: 'Deposit is 20% of $720. Estimated start November 9 followed by two weeks of work, if access is provided.' },
] }];
const messages = [{ role: 'user', content: 'Compare against my $900 budget and November 30 deadline.\n<reploid-document-sources-v1>\n'
  + JSON.stringify(documents) + '\n</reploid-document-sources-v1>' },
{ role: 'assistant', content: 'The price is $1 and everything is guaranteed.' }];
const id = (source, value) => ledgerCatalog(messages).facts.find(fact => fact.source === source && fact.value === value).id;
function selected() {
  return { budget: id('U0', '$900'), deadline: id('U0', 'November 30'), documents: [{
    documentId: 'D1', base: id('D1:P1', '$720'), additional: [id('D1:P1', '$35')],
    credits: [id('D1:P1', '$15')], includedAmounts: [id('D1:P2', '$60')],
    depositBase: id('D1:P3', '$720'), depositPercent: id('D1:P3', '20%'),
    start: id('D1:P3', 'November 9'), duration: id('D1:P3', 'two'), completion: null,
    relations: [{ relation: 'excluded', passages: ['D1:P2'], affectedFacts: [] }, { relation: 'condition', passages: ['D1:P3'], affectedFacts: [] }],
  }] };
}

test('source catalog excludes assistant assertions and preserves exact user passages', () => {
  const c = ledgerCatalog(messages);
  assert.equal(c.facts.some(fact => fact.value === '$1'), false);
  assert.deepEqual(c.documents[0].passages, documents[0].passages);
  assert.equal(c.facts.every(fact => fact.quote.includes(fact.value)), true);
});

test('source roles compute subtotal/headroom/deposit/calendar without arithmetic arguments', async () => {
  const result = await calculateLedger(selected(), messages);
  const ledger = result.documents[0];
  assert.equal(ledger.values.subtotal.value, '740');
  assert.equal(ledger.values.headroom.value, '160');
  assert.equal(ledger.values.deposit.value, '144');
  assert.equal(ledger.values.derivedCompletion.value, 'november 23 (year unspecified)');
  assert.equal(ledger.allInTotal, null);
  assert.equal(result.semanticAcceptance, 'unqualified');
  assert.equal(ledger.claims.every(claim => claim.entailmentVerified === false), true);
  assert.deepEqual(ledger.values.derivedCompletion.sources, ['D1:P3']);
  assert.deepEqual(ledger.values.headroom.sources, ['U0', 'D1:P1']);
});

test('included allowance and deposit never become extra charges', async () => {
  const result = await calculateLedger(selected(), messages);
  assert.equal(result.operations.some(op => op.args.includes(id('D1:P2', '$60'))), false);
  assert.equal(result.documents[0].values.subtotal.value, '740');
});

test('conflicting monetary roles remain unresolved, not silently double-counted', async () => {
  const selection = selected(); selection.documents[0].additional.push(id('D1:P2', '$60'));
  const result = await calculateLedger(selection, messages);
  assert.equal(result.documents[0].values.subtotal, null);
  assert.equal(result.documents[0].values.headroom, null);
  assert.match(result.documents[0].unresolved[0], /conflicting price roles/);
});

test('included/excluded/conditional operands cannot become unconditional counted prices', async () => {
  for (const relation of ['included', 'excluded', 'condition']) {
    for (const value of ['$720', '$35', '$15']) {
      const selection = selected();
      selection.documents[0].relations.push({ relation, passages: ['D1:P1'], affectedFacts: [id('D1:P1', value)] });
      const result = await calculateLedger(selection, messages);
      assert.equal(result.documents[0].values.subtotal, null);
      assert.equal(result.documents[0].values.headroom, null);
      assert.equal(result.documents[0].unresolved.some(reason => reason.includes('conditional')), true);
    }
  }
});

test('explicitly included non-counted allowance preserves the known subtotal', async () => {
  const selection = selected();
  selection.documents[0].relations.push({ relation: 'included', passages: ['D1:P2'], affectedFacts: [id('D1:P2', '$60')] });
  const result = await calculateLedger(selection, messages);
  assert.equal(result.documents[0].values.subtotal.value, '740');
});

test('deposit and stated/derived dates retain exact selected conditions', async () => {
  const selection = selected();
  selection.documents[0].completion = id('D1:P3', 'November 9');
  selection.documents[0].relations.push({ relation: 'condition', passages: ['D1:P3'],
    affectedFacts: [id('D1:P3', '$720'), id('D1:P3', 'November 9')] });
  const result = await calculateLedger(selection, messages);
  for (const key of ['deposit', 'statedCompletion', 'derivedCompletion']) {
    const value = result.documents[0].values[key];
    assert.equal(value.conditional, true);
    assert.equal(value.conditions[0].passages[0].text, documents[0].passages[2].text);
  }
  assert.equal(result.computed.find(value => value.value === '144').conditional, true);
  assert.equal(result.documents[0].values.subtotal.conditional, null);
});

test('null inputs remain unknown and do not borrow prior assistant claims', async () => {
  const selection = selected(); selection.budget = null;
  Object.assign(selection.documents[0], { base: null, depositBase: null, depositPercent: null, start: null, duration: null });
  const result = await calculateLedger(selection, messages);
  assert.deepEqual(result.documents[0].values, { subtotal: null, headroom: null, deposit: null,
    statedCompletion: null, derivedCompletion: null });
  assert.equal(result.operations.length, 0);
});

test('explicit unresolved operands block their calculations without dropping provenance', async () => {
  const selection = selected();
  selection.documents[0].relations.push({ relation: 'conflict', passages: ['D1:P1'], affectedFacts: [id('D1:P1', '$720')] },
    { relation: 'unknown', passages: ['D1:P3'], affectedFacts: [id('D1:P3', 'two'), id('D1:P3', '20%')] });
  const result = await calculateLedger(selection, messages);
  assert.deepEqual(result.documents[0].values, { subtotal: null, headroom: null, deposit: null,
    statedCompletion: null, derivedCompletion: null });
  assert.equal(result.documents[0].claims[2].passages[0].text, documents[0].passages[0].text);
});

test('types, question/document scope and source identities fail closed', async () => {
  for (const change of [
    s => { s.documents[0].base = id('D1:P3', 'November 9'); },
    s => { s.documents[0].base = s.budget; },
    s => { s.budget = s.documents[0].base; },
    s => { s.documents[0].duration = id('D1:P3', '20%'); },
    s => { s.documents[0].base = 'invented'; },
    s => { s.documents[0].relations[0].passages = ['D1:P99']; },
    s => { s.documents[0].relations[0].passages = ['U0']; },
    s => { s.documents[0].relations[0].affectedFacts = [id('D1:P1', '$720')]; },
    s => { s.documents[0].computedTotal = 740; },
    s => { s.operations = []; },
  ]) {
    const selection = selected(); change(selection);
    await assert.rejects(calculateLedger(selection, messages));
  }
});

test('duplicate documents, operands, passages and omitted fields reject', async () => {
  for (const change of [
    s => { s.documents.push(s.documents[0]); },
    s => { s.documents[0].additional.push(s.documents[0].additional[0]); },
    s => { s.documents[0].relations[0].passages.push('D1:P2'); },
    s => { delete s.documents[0].completion; },
  ]) {
    const selection = selected(); change(selection); await assert.rejects(calculateLedger(selection, messages));
  }
});

test('authorization still belongs to existing runner', async () => {
  await assert.rejects(calculateLedger(selected(), messages, { authorized: false }), /authoriz|denied|allow/i);
});

test('schema references only lexical IDs of correct kind and does not accept result literals', () => {
  const schema = ledgerSchema(messages)[0].function.parameters;
  const shape = schema.properties.documents.items.oneOf[0];
  assert.equal(shape.additionalProperties, false);
  assert.deepEqual(schema.properties.budget.anyOf[1].enum, [id('U0', '$900')]);
  assert.equal(shape.properties.additional.items.enum.includes(id('D1:P3', 'November 9')), false);
  assert.equal(shape.properties.duration.anyOf[1].enum.includes(id('D1:P3', 'two')), true);
});
