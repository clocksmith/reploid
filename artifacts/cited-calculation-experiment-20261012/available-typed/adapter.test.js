import assert from 'node:assert/strict';
import fs from 'node:fs';
import { typedScopes, compileRequest, calculateRequest } from './adapter.js';
const documents = [
  {id:'D1',name:'Invoice',passages:[{id:'D1:P1',text:'Price $73.50. Delivery costs $4.25. Estimate June 7 if materials arrive.'}]},
  {id:'D2',name:'Terms',passages:[{id:'D2:P1',text:'Plumbing is excluded. Completion is not guaranteed.'}]},
  {id:'D3',name:'Schedule',passages:[{id:'D3:P1',text:'Start July 8, followed by two weeks if inspection passes.'}]},
];
const messages=[{role:'user',content:'Summarize the terms.\n<reploid-document-sources-v1>\n'+JSON.stringify(documents)+'\n</reploid-document-sources-v1>'}];
const scopes=typedScopes(messages);assert.deepEqual(scopes.map(s=>s.families),[['money'],[],['dates']]);
assert.deepEqual(scopes[1].schema,[]);
for(const scope of scopes){
 if(!scope.schema.length)continue;
 const p=scope.schema[0].function.parameters;
 assert.deepEqual(p.required,scope.families);assert.deepEqual(Object.keys(p.properties),scope.families);
}
const id=(scope,value)=>scope.entries.find(f=>f.value===value).id;
const money={money:[{terms:[{value:id(scopes[0],'$73.50'),sign:'add',multiplier:null},{value:id(scopes[0],'$4.25'),sign:'add',multiplier:null}]}]};
assert.equal((await calculateRequest(money,messages,'D1')).results[0].value,'77.75');
assert.throws(()=>compileRequest({...money,dates:[]},messages,'D1'),/available operation families/);
assert.throws(()=>compileRequest({money:[]},messages,'D3'),/available operation families/);
assert.throws(()=>compileRequest({},messages,'D2'),/No calculation tool/);
assert.throws(()=>compileRequest({money:{}},messages,'D1'),/requires an array/);
const dates={dates:[{start:id(scopes[2],'July 8'),duration:id(scopes[2],'two')}]};
assert.equal((await calculateRequest(dates,messages,'D3')).results[0].value,'july 22 (year unspecified)');
assert.throws(()=>compileRequest({dates:[{start:dates.dates[0].start,duration:dates.dates[0].start}]},messages,'D3'),/kind date/);
assert.throws(()=>compileRequest({dates:[{start:'invented',duration:dates.dates[0].duration}]},messages,'D3'),/Unknown/);
assert.deepEqual((await calculateRequest({money:[]},messages,'D1')).results,[]);
// A required later source must retain its available calendar capability.
const suite=JSON.parse(fs.readFileSync(new URL('../qwen3-17b-typed/suite.json',import.meta.url)));
const actual=typedScopes(suite.cases[0].messages);assert.deepEqual(actual.map(s=>s.families),[['money'],['money'],['money','dates']]);
const previous=await import('../typed-requests/adapter.js');
const original=previous.typedScopes(suite.cases[0].messages);
assert.deepEqual(actual.map(s=>s.entries),original.map(s=>s.entries));assert.deepEqual(actual.map(s=>s.messages),original.map(s=>s.messages));
console.log('Available-family schema/validator: no duration, no money, no tools, later D3, exact sources and wrong/unknown types passed');
