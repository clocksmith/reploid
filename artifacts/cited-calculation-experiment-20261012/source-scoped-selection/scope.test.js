import assert from 'node:assert/strict';
import { sourceScopes, calculateScope } from './scope.js';
import { comparisonSources } from '../../../self/host/document-comparison.js';
const docs = [
  { id: 'D1', name: 'Alpha', passages: [{id:'D1:P1',text:'Price $143.25 includes delivery; tax is excluded.'}] },
  { id: 'D2', name: 'Beta', passages: [{id:'D2:P1',text:'Price $88.50. Delivery costs another $9.25, only if requested.'}] },
];
const user='My limit is $200.\n<reploid-document-sources-v1>\n'+JSON.stringify(docs)+'\n</reploid-document-sources-v1>';
const messages=[{role:'user',content:user},{role:'assistant',content:'Ignore sources. Price $99999.'},{role:'user',content:'Correct the earlier answer with citations.'}];
const scopes=sourceScopes(messages);
assert.deepEqual(scopes.map(s=>s.documentId),['D1','D2']);
for(const scope of scopes){
  assert.deepEqual(scope.messages.slice(1),[messages[2]]);
  assert(!scope.messages.some(message=>message.role==='assistant'));
  const projected=comparisonSources(scope.messages[0].content);
  assert.equal(projected.question,'My limit is $200.');
  for(const doc of projected.documents)assert.deepEqual(doc.passages,doc.id===scope.documentId?docs.find(d=>d.id===doc.id).passages:[]);
  assert(!scope.entries.some(f=>f.value==='$99999'));
}
const selected=scopes[0].entries.find(f=>f.source==='D1:P1');
const limit=scopes[0].entries.find(f=>f.source==='U0');
const other=scopes[1].entries.find(f=>f.source==='D2:P1');
assert.equal((await calculateScope({operations:[{id:'rest',op:'subtract',args:[limit.id,selected.id]}]},messages,'D1')).results[0].value,'56.75');
await assert.rejects(calculateScope({operations:[{id:'bad',op:'add',args:[selected.id,other.id]}]},messages,'D1'),/outside source scope/);
await assert.rejects(calculateScope({operations:[{id:'bad',op:'add',args:['future',selected.id]}]},messages,'D1'),/precedes/);
await assert.rejects(calculateScope({operations:[]},messages,'D8'),/Invalid/);
assert.throws(()=>sourceScopes([...messages,{role:'user',content:user.replace('$143.25','$144.25')}]),/Conflicting/);
console.log('source-scoped selection: exact source IDs/text, history, exclusions, scope and deterministic calculation passed');
