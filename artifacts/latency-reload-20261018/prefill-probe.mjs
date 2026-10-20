import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createNativeGpuHost} from '../../server/native-participant.js';
import {createNativeWholeModel} from '../../server/native-whole-model.js';
import {createReploidDopplerRuntimeService} from '../../self/infrastructure/doppler-runtime-service.js';
import {withSourceContext} from '../../packages/reploid/src/retrieval/sources.js';
const fixture=JSON.parse(gunzipSync(await fs.readFile(new URL('../../artifacts/service-repair-20261018/live-browser-search.json.gz',import.meta.url))));
const baseline=fixture.observations[0], attempt=baseline.attempt;
const request=await withSourceContext(attempt.request,attempt.retrieval);
const catalog=JSON.parse(await fs.readFile(new URL('../../self/config/chat-models.json',import.meta.url)));
const model=catalog.find(m=>m.id===attempt.execution.modelId);
assert.equal(model.identity,attempt.execution.modelIdentity);
const captures=[];
const base=createReploidDopplerRuntimeService({loadModule:()=>import('doppler-gpu/compat')});
const service={...base,async open(args){const session=await base.open(args);return {...session,advanced:{...session.advanced,getStats(){const stats=session.advanced.getStats();captures.push(structuredClone(stats));return stats;}}};}};
const gpu=createNativeGpuHost(()=>import('webgpu'));
const owner=createNativeWholeModel({model,modelDirectory:'/Users/xyz/deco/doppler/models/local/qwen-3-5-2b-q4k-ehaf16',nativeGpu:()=>gpu.open(),service});
const receipt={at:new Date().toISOString(),scope:'Two diagnostic replays of the retained first 2B request, unchanged package and options; shared machine, not a speedup comparison',modelId:model.id,modelIdentity:model.identity,expected:baseline.answer,runs:[],passed:false};
const save=()=>fs.writeFile(new URL('./prefill-probe.json',import.meta.url),JSON.stringify(receipt,null,2));
try{
 const start=performance.now();await owner.contribute(true);receipt.openMs=performance.now()-start;await save();
 for(let i=0;i<2;i++){
  const events=[],started=performance.now();
  const result=await owner.generate(request.messages,text=>events.push({elapsedMs:performance.now()-started,text}),{signal:AbortSignal.timeout(90000),adapters:[],maxOutputTokens:256});
  const row={elapsedMs:performance.now()-started,result,stats:captures.at(-1),events};receipt.runs.push(row);await save();
  console.log(JSON.stringify({run:i,elapsedMs:row.elapsedMs,stats:row.stats,content:result.content}));
  assert.equal(result.content,baseline.answer);
 }
 receipt.passed=true;
}catch(e){receipt.error=e.stack;throw e;}finally{await save();await owner.close();await gpu.close();receipt.cleanup='settled';await save();}
