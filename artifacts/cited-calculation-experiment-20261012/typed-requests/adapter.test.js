import assert from 'node:assert/strict';
import { typedScope, compileRequest, calculateRequest } from './adapter.js';
const documents = [
  { id: 'D1', name: 'Print', passages: [
    { id: 'D1:P1', text: 'Each sheet costs $13.25. Delivery costs $6.75. A payment of $19.50 was received. Tax is unknown.' },
    { id: 'D1:P2', text: 'Work starts July 2 and takes two weeks if inspection passes. A deposit of 15% applies.' },
  ] },
  { id: 'D2', name: 'Other', passages: [{ id: 'D2:P1', text: 'Price $211 includes delivery.' }] },
];
const messages = [{ role: 'user', content: 'Price for five sheets?\n<reploid-document-sources-v1>\n'+JSON.stringify(documents)+'\n</reploid-document-sources-v1>' },
  { role: 'assistant', content: 'The payment was $999.' }, { role: 'user', content: 'Check the originals.' }];
const scope = typedScope(messages, 'D1');
const id = value => scope.entries.find(fact => fact.value === value).id;
const term = (value, sign = 'add', multiplier = null) => ({ value: id(value), sign, multiplier: multiplier === null ? null : id(multiplier) });
const plan = { money: [ { terms: [term('$13.25', 'add', 'five'), term('$6.75'), term('$19.50', 'subtract')] },
  { terms: [term('$13.25', 'add', '15%')] } ], dates: [{start: id('July 2'), duration: id('two')}] };
assert.equal(scope.entries.some(f => f.value === '$999'), false);
assert.deepEqual(scope.messages.slice(1), [messages[2]]);
const result = await calculateRequest(plan, messages, 'D1');
assert.deepEqual(result.results.map(r=>r.value), ['53.5', '1.9875', 'july 16 (year unspecified)']);
assert.deepEqual(result.results[0].sources, ['D1:P1', 'U0']);
assert.match(result.scope, /Semantic attribution.*unverified/);
assert.equal(result.operations, 5);
const first = scope.schema[0].function.parameters.properties.money.items.properties.terms.items.properties;
assert(!first.value.enum.includes(id('July 2')));
assert(!first.multiplier.anyOf[1].enum.includes(id('$13.25')));
for (const [label, mutation, pattern] of [
  ['date as money', p=>p.money[0].terms[0].value=id('July 2'), /kind date/],
  ['money multiplier', p=>p.money[0].terms[0].multiplier=id('$6.75'), /kind money/],
  ['invented alias', p=>p.money[0].terms[0].value='calc_000', /Unknown/],
  ['negative start', p=>p.money[0].terms[0].sign='subtract', /First money/],
  ['cross source', p=>p.money[0].terms[0].value=typedScope(messages,'D2').entries.find(f=>f.value==='$211').id, /out-of-source/],
  ['unknown field', p=>p.expectedAnswer='53.5', /Required/],
  ['date unit', p=>p.dates[0].duration=id('five'), /kind number/],
]) { const bad=structuredClone(plan); mutation(bad); assert.throws(()=>compileRequest(bad,messages,'D1'),pattern,label); }
assert.deepEqual((await calculateRequest({money:[],dates:[]},messages,'D1')).results, []);
// A permitted type is not semantic approval: preserve a wrong selected sign exactly.
const wrong=structuredClone(plan); wrong.money[0].terms[2].sign='add';
assert.equal((await calculateRequest(wrong,messages,'D1')).results[0].value,'92.5');
const huge={money:Array.from({length:6},()=>({terms:Array.from({length:5},()=>term('$13.25','add','five'))})),dates:[]};
assert.throws(()=>compileRequest(huge,messages,'D1'),/operation limit/);
const singleton=await calculateRequest({money:[{terms:[term('$6.75')]}],dates:[]},messages,'D1');
assert.equal(singleton.results[0].derived,false);assert.equal(singleton.operations,0);
console.log('typed request adapter: types, provenance, exact translation, scope, semantic nonrepair and bounds passed');
