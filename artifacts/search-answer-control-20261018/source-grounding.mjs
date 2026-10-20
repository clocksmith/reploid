import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNativeGpuHost} from '../../server/native-participant.js';
import {createNativeWholeModel} from '../../server/native-whole-model.js';
import {createReploidDopplerRuntimeService} from '../../self/infrastructure/doppler-runtime-service.js';
const contract=JSON.parse(await fs.readFile(new URL('./source-grounding-contract.json',import.meta.url)));
assert.equal(createHash('sha256').update(contract.instructions).digest('hex'),contract.instructionSha256);
const catalog=JSON.parse(await fs.readFile(new URL('../../self/config/chat-models.json',import.meta.url)));
const model=catalog.find(m=>m.id==='qwen-3-5-2b-q4k-ehaf16');assert.equal(model.identity,contract.modelIdentity);
const baseline=JSON.parse(await fs.readFile(new URL('../../packages/reploid/src/retrieval/policy.json',import.meta.url))).context.instructions;
const gpu=createNativeGpuHost(()=>import('webgpu'));
const service=createReploidDopplerRuntimeService({loadModule:()=>import('doppler-gpu/compat')});
const owner=createNativeWholeModel({model,modelDirectory:'/Users/xyz/deco/doppler/models/local/qwen-3-5-2b-q4k-ehaf16',nativeGpu:()=>gpu.open(),service});
const output=new URL('./source-grounding.json',import.meta.url);
const receipt={at:new Date().toISOString(),contract,baselineInstructions:baseline,rows:[],completed:false};
await fs.writeFile(output,JSON.stringify(receipt,null,2),{flag:'wx'});
const save=()=>fs.writeFile(output,JSON.stringify(receipt,null,2));
try{
 await owner.contribute(true);
 for(const [index,item] of contract.cases.entries()){
  for(const arm of (index%2?['candidate','baseline']:['baseline','candidate'])){
   assert(receipt.rows.length<contract.maxGenerations);
   const instruction=arm==='candidate'?contract.instructions:baseline;
   const sources=item.sources.map((text,i)=>`[${i+1}] Fixture ${i+1}\nhttps://source.example.test/${item.id}/${i+1}\n${text}`).join('\n\n');
   const messages=[{role:'user',content:`${instruction}\n\nSources:\n\n${sources}\n\nQuestion: ${item.query}`}];
   const result=await owner.generate(messages,()=>{},{signal:AbortSignal.timeout(contract.perRequestTimeoutMs),adapters:[],maxOutputTokens:contract.maxOutputTokens});
   const text=result.content.toLowerCase();const checks={required:item.required.every(s=>text.includes(s.toLowerCase())),forbidden:item.forbidden.every(s=>!text.includes(s.toLowerCase())),naturalStop:result.completion.stopReason==='stop-token'};
   const row={id:item.id,arm,messages,result,checks,passed:Object.values(checks).every(Boolean)};receipt.rows.push(row);await save();
   console.log(JSON.stringify({id:item.id,arm,content:result.content,checks}));
  }
 }
 receipt.completed=true;receipt.candidatePassed=receipt.rows.filter(r=>r.arm==='candidate').every(r=>r.passed);
}catch(e){receipt.error=e.stack;throw e;}finally{await save();await owner.close();await gpu.close();receipt.cleanup='settled';await save();}
