import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createNativeGpuHost} from '../../server/native-participant.js';
import {createNativeWholeModel} from '../../server/native-whole-model.js';
import {createReploidDopplerRuntimeService} from '../../self/infrastructure/doppler-runtime-service.js';
import {withSourceContext} from '../../packages/reploid/src/retrieval/sources.js';
const fixture=JSON.parse(gunzipSync(await fs.readFile(new URL('../../artifacts/service-repair-20261018/live-browser-search.json.gz',import.meta.url))));
const failed=JSON.parse(gunzipSync(await fs.readFile(new URL('../../artifacts/latency-reload-20261018/journey.json.gz',import.meta.url))));
const baseline=fixture.observations[0], attempt=baseline.attempt;
const cases=[{id:'failed-801',observation:failed.observations[0]},{id:'successful-1103',observation:baseline}];
const request=await withSourceContext(attempt.request,attempt.retrieval);
const catalog=JSON.parse(await fs.readFile(new URL('../../self/config/chat-models.json',import.meta.url)));
const model=catalog.find(m=>m.id===attempt.execution.modelId);
assert.equal(model.identity,attempt.execution.modelIdentity);
const profile=JSON.parse(await fs.readFile(new URL('../../self/config/work-profile.json',import.meta.url)));
model.generation={...profile.generation,...model.generation,repetitionPenalty:1.0};
const captures=[];
const base=createReploidDopplerRuntimeService({loadModule:()=>import('doppler-gpu/compat')});
const service={...base,async open(args){const session=await base.open(args);return {...session,advanced:{...session.advanced,getStats(){const stats=session.advanced.getStats();captures.push(structuredClone(stats));return stats;}}};}};
const gpu=createNativeGpuHost(()=>import('webgpu'));
const owner=createNativeWholeModel({model,modelDirectory:'/Users/xyz/deco/doppler/models/local/qwen-3-5-2b-q4k-ehaf16',nativeGpu:()=>gpu.open(),service});
const receipt={at:new Date().toISOString(),scope:'Development-only candidate: repetitionPenalty 1.0 on two exposed contexts, max32 output tokens, max2 generations, 90 seconds each; production unchanged; not held-out qualification',modelId:model.id,modelIdentity:model.identity,expected:baseline.answer,runs:[],passed:false};
const save=()=>fs.writeFile(new URL('./penalty-candidate.json',import.meta.url),JSON.stringify(receipt,null,2));
try{
 const start=performance.now();await owner.contribute(true);receipt.openMs=performance.now()-start;await save();
 for(const item of cases){
  const request=await withSourceContext(item.observation.attempt.request,item.observation.attempt.retrieval);
  const events=[],started=performance.now();
  const result=await owner.generate(request.messages,text=>events.push({elapsedMs:performance.now()-started,text}),{signal:AbortSignal.timeout(90000),adapters:[],maxOutputTokens:32});
  const row={caseId:item.id,elapsedMs:performance.now()-started,result,stats:captures.at(-1),events};receipt.runs.push(row);await save();
  console.log(JSON.stringify({caseId:item.id,elapsedMs:row.elapsedMs,stats:row.stats,content:result.content}));
  row.answerContainsYear=/1889/.test(result.content);row.hasCitation=/\[\d+\]/.test(result.content);await save();
 }
 receipt.passed=true;
}catch(e){receipt.error=e.stack;throw e;}finally{await save();await owner.close();await gpu.close();receipt.cleanup='settled';await save();}
