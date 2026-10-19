import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createFixedSearchProvider, createRetrieval, renderSourceContext } from '../../packages/reploid/src/retrieval/index.js';
const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
const sha=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
const record=read('context-candidates/whole-passages-250.json');
const identity=read('context-candidates/identity.json');
const fixtureBytes=fs.readFileSync(new URL('context-candidates/'+identity.file,import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'),identity.fileSha256);
const canonical=value=>JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortKeys(value[key])]));
  return value;
}
const input={sourceSet:record.sourceSet,routePromptTokenLimit:record.routePromptTokenLimit,textPath:record.textPath,policy:record.policy,candidate:record.variants.find(v=>v.id===record.selectedCandidate)};
assert.equal(createHash('sha256').update(canonical(input)).digest('hex'),identity.selectedInputSha256);
for (const variant of record.variants) assert.equal(createHash('sha256').update(canonical(variant)).digest('hex'),identity.variantSha256[variant.id]);
const selected=record.variants.find(v=>v.id===record.selectedCandidate);
const rejected=record.variants.find(v=>v.id==='compact-instructions-top2-token-budget250');
const sourceBytes=fs.readFileSync(new URL('../../'+record.sourceSet.file,import.meta.url));
assert.equal(createHash('sha256').update(sourceBytes).digest('hex'),record.sourceSet.sha256);
const original=JSON.parse(sourceBytes);
const policy=record.policy;
assert.deepEqual(read('context-candidates/candidate-context-policy.json'),policy);
for (const variant of record.variants) {
  if (!variant.policyFile) continue;
  const bytes=fs.readFileSync(new URL('context-candidates/'+variant.policyFile,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),variant.policySha256);
}
const checks=[];
for (const item of selected.items) {
  const frozen=original.items.find(i=>i.id===item.id);
  const provider=createFixedSearchProvider({documents:frozen.documents,now:()=>original.retrieval.fixedNow});
  const port=createRetrieval({provider,extractor:provider,supportChecker:null,policy,now:()=>original.retrieval.fixedNow});
  const request=port.request({query:frozen.prompt,limits:item.limits},frozen.prompt);
  const retrieved=await port.retrieve(port.pending(request,original.retrieval.fixedNow),null);
  assert.deepEqual(retrieved,item.retrieval,'Retained provenance must reproduce through the public retrieval API');
  if (retrieved.outcome==='retrieved') {
    const dispatched=await port.dispatch({messages:[{role:'user',content:frozen.prompt}],retrieval:request},retrieved);
    assert.deepEqual(dispatched.messages,item.dispatchedMessages,'Dispatched source context must reproduce exactly');
  }
  assert.deepEqual(item.truncatedSourceIds,[]);
  for (const source of item.retrieval.sources) {
    const doc=frozen.documents.find(d=>d.id===source.sourceId);
    assert.equal(source.passage,doc.text);
    assert.equal(source.passageHash,sha(doc.text));
  }
  assert(frozen.citedSources.every(id=>item.retrieval.sources.some(s=>s.sourceId===id)));
  if (item.promptTokens===null) {assert.equal(item.retrieval.outcome,'empty');assert.equal(item.dispatchedMessages,null);continue;}
  assert.equal(item.promptTokens,item.promptTokenIds.length);
  assert(item.promptTokens<=250);
  assert.equal(sha(renderSourceContext(item.retrieval.sources,policy)),item.retrieval.context.digest);
  // A synthetic exact quote checks evidence binding only; support remains unreviewed.
  const quote=item.retrieval.sources[0].passage.split(/(?<=[.!?])\s+/)[0];
  const answer=quote+' [1]';
  const verified=await port.verify(answer,item.retrieval,null);
  assert.equal(verified.claimSupport.contextValid,true);
  assert(verified.claimSupport.claims.flatMap(c=>c.citations).every(c=>c.valid));
  assert(verified.claimSupport.claims.every(c=>c.verdict==='unverified'));
  const tampered=structuredClone(item.retrieval);tampered.sources[0].passage+=' fabricated text';
  const invalid=await port.verify(answer,tampered,null);
  assert.equal(invalid.claimSupport.contextValid,false);
  assert(invalid.claimSupport.claims.flatMap(c=>c.citations).every(c=>!c.valid));
  checks.push({id:item.id,fullPassages:true,budgetPass:true,deterministicCitationBindingPass:true,alteredSourceRejected:true,semanticSupport:'unverified'});
}
const kettle=selected.items.find(i=>i.id==='search-kettle-recall-models').retrieval.sources[0].passage;
const oldKettle=rejected.items.find(i=>i.id==='search-kettle-recall-models').retrieval.sources[0].passage;
const exclusion='The BrewMate BM-300 is not part of this recall.';
assert(!oldKettle.includes(exclusion),'Retain the formerly truncated failure');
assert(kettle.includes(exclusion));
const thermostat=selected.items.find(i=>i.id==='search-thermostat-reset-steps').retrieval.sources[0].passage;
assert(thermostat.includes('Then press Mode once to confirm.')&&thermostat.includes('saved Wi-Fi details are erased.'));
const rejectedThermostat=record.variants.find(v=>v.id==='top2-source160').items.find(i=>i.id==='search-thermostat-reset-steps').retrieval.sources[0].passage;
assert(!rejectedThermostat.includes('Then press Mode once to confirm.'));
assert(!rejectedThermostat.includes('saved Wi-Fi details are erased.'));
// Keep this check read-only: retained model input fixtures are never rewritten by tests.
console.log(JSON.stringify({passed:true,candidateSha256:identity.selectedInputSha256,items:checks.length,emptyItems:1,kettleCoverage:'complete',support:'unverified; no model executed'}));
