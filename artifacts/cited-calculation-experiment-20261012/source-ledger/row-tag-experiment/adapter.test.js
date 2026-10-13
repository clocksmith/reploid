import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceRows, rowSchema, compileRows, calculateRows } from './adapter.js';
const docs = [{ id: 'D1', name: 'Unrelated badges', passages: [
  { id: 'D1:P1', text: 'Each badge costs $13.25. Shipping is included.' },
  { id: 'D1:P2', text: 'An advance payment of $9 has been received. Tax remains unknown.' },
  { id: 'D1:P3', text: 'Start November 9 for two weeks if access is granted. Deposit 20% of $90.' },
] }, { id: 'D2', name: 'Alternative', passages: [{ id: 'D2:P1', text: 'Fixed order price $110.' }] }];
const messages = [{ role: 'user', content: 'Compare seven badges to my $150 budget and November 30 deadline.\n<reploid-document-sources-v1>\n'
  + JSON.stringify(docs) + '\n</reploid-document-sources-v1>' }, { role: 'assistant', content: 'Everything is $1 and guaranteed.' },
{ role: 'user', content: 'Check your earlier claims.' }];
const index = (source, value) => sourceRows(messages).facts.findIndex(f => f.source === source && f.value === value);
const empty = () => ({ factRoles: sourceRows(messages).facts.map(() => []), passageRelations: sourceRows(messages).passages.map(() => []) });
function selected() {
  const result = empty();
  for (const [source, value, roles] of [
    ['U0', 'seven', ['quantityFor:D1']], ['U0', '$150', ['budget']], ['U0', 'November 30', ['deadline']],
    ['D1:P1', '$13.25', ['unitPrice']], ['D1:P2', '$9', ['payment']],
    ['D1:P3', 'November 9', ['start', 'condition']], ['D1:P3', 'two', ['duration']],
    ['D1:P3', '20%', ['depositPercent']], ['D1:P3', '$90', ['depositBase']], ['D2:P1', '$110', ['base']],
  ]) result.factRoles[index(source, value)] = roles;
  result.passageRelations[1] = ['unknown']; result.passageRelations[2] = ['condition'];
  return result;
}

test('rows preserve original source quotes, occurrence order and assistant exclusion', () => {
  const rows = sourceRows(messages);
  assert.ok(rows.facts.every(f => f.quote.includes(f.value)));
  assert.equal(rows.facts.some(f => f.value === '$1'), false);
  assert.deepEqual(rows.passages[0], { ...docs[0].passages[0], documentId: 'D1' });
  assert.equal(rowSchema(messages)[0].function.parameters.properties.factRoles.minItems, rows.facts.length);
});
test('explicit unit price, question quantity and payment use existing bound calculator', async () => {
  const result = await calculateRows(selected(), messages);
  assert.equal(result.documents[0].values.subtotal.value, '83.75');
  assert.equal(result.documents[0].values.headroom.value, '66.25');
  assert.equal(result.documents[0].values.deposit.value, '18');
  assert.equal(result.documents[0].values.derivedCompletion.value, 'november 23 (year unspecified)');
  assert.equal(result.documents[0].values.derivedCompletion.conditional, true);
  assert.equal(result.documents[1].values.subtotal.value, '$110');
  assert.equal(result.semanticAcceptance, 'unqualified');
});
test('unknown/missing operands and conditional prices are never repaired', async () => {
  const blank = await calculateRows(empty(), messages); assert.equal(blank.operations.length, 0);
  assert.equal(blank.documents[0].values.subtotal, null);
  const choice = selected(); choice.factRoles[index('D1:P1', '$13.25')].push('condition');
  const conditional = await calculateRows(choice, messages);
  assert.equal(conditional.documents[0].values.subtotal, null);
  assert.equal(conditional.documents[0].values.headroom, null);
});
test('reject row-count, unknown, duplicate and wrong-type roles without repair', () => {
  for (const alter of [c => c.factRoles.pop(), c => c.passageRelations.pop(),
    c => c.factRoles[0] = ['invented'], c => c.factRoles[0] = ['budget', 'budget'],
    c => c.factRoles[index('D1:P3', '20%')] = ['base'],
    c => c.extra = 'value', c => c.passageRelations[0] = ['made-up']]) {
    const choice = selected(); alter(choice); assert.throws(() => compileRows(choice, messages));
  }
});
test('reject duplicate same-document role, conflicting prices and cross-source quantity', () => {
  for (const alter of [c => c.factRoles[index('D1:P3', '$90')] = ['unitPrice'],
    c => c.factRoles[index('D1:P1', '$13.25')] = ['unitPrice', 'additional'],
    c => c.factRoles[index('D1:P3', 'two')] = ['quantityFor:D2'],
    c => c.factRoles[index('D1:P1', '$13.25')] = ['budget'],
    c => c.factRoles[index('U0', '$150')] = ['base']]) {
    const choice = selected(); alter(choice); assert.throws(() => compileRows(choice, messages));
  }
});
test('passage claim alone supplies no hidden condition operand or semantic truth', async () => {
  const choice = selected(); choice.factRoles[index('D1:P3', 'November 9')] = ['start'];
  const result = await calculateRows(choice, messages);
  assert.equal(result.documents[0].values.derivedCompletion.conditional, null);
  assert.ok(result.passageClaims.every(c => c.entailmentVerified === false));
});
test('tool authorization remains enforced by existing runner', async () => {
  await assert.rejects(calculateRows(selected(), messages, { authorized: false }), /Host denied tool: Calculate/);
});


test('document-local numerical quantity cannot be assigned to another document', () => {
  const local = structuredClone(messages);
  local[0].content = local[0].content.replace('Each badge costs', 'Batch contains eight badges. Each badge costs');
  const rows = sourceRows(local);
  const choice = { factRoles: rows.facts.map(() => []), passageRelations: rows.passages.map(() => []) };
  const at = rows.facts.findIndex(f => f.source === 'D1:P1' && f.value === 'eight');
  assert.ok(at >= 0); choice.factRoles[at] = ['quantityFor:D2'];
  assert.throws(() => compileRows(choice, local), /Quantity scope or type mismatch/);
});
