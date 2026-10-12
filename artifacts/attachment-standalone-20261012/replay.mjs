import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const repo=process.env.REPLOID_ROOT||'/home/x/deco/reploid';
const load=specifier=>import(specifier);
const fixture=JSON.parse(await fs.readFile(new URL('input.json',import.meta.url),'utf8'));
const r={startedAt:new Date().toISOString(),fixture,kind:'Unsplit accepted-runtime diagnostic, not source-model reference',cases:[]};let gpu,session;
const save=()=>fs.writeFile(new URL('result.json',import.meta.url),JSON.stringify(r,null,2));
try{
 const archive=await fs.readFile(repo+'/deploy/artifacts/doppler-gpu-0.6.27.tgz');r.archiveSha256=createHash('sha256').update(archive).digest('hex');if(r.archiveSha256!==fixture.archiveSha256)throw Error('Archive identity mismatch');
 const {createNativeGpuHost}=await import(pathToFileURL(repo+'/server/native-participant.js'));gpu=createNativeGpuHost(()=>load('webgpu'));await gpu.open();
 const {configureDeviceMemoryBudget,inspectDeviceMemory}=await load('doppler-gpu/partitions');await configureDeviceMemoryBudget({maxBytes:1420000000});
 const policy=JSON.parse(await fs.readFile(repo+'/self/config/partition-policy.json','utf8'));
 const catalog=JSON.parse(await fs.readFile(repo+'/self/config/chat-models.json','utf8'));const model=(Array.isArray(catalog)?catalog:catalog.models).find(m=>m.id==='qwen-3-5-0-8b-q4k-ehaf16');
 const {resolvePartitionGeneration}=await import(pathToFileURL(repo+'/self/config/partition-generation.js'));r.generation=resolvePartitionGeneration(model);
 const {doppler}=await load('doppler-gpu/compat');session=await doppler.open({url:'file:///home/x/deco/doppler/models/local/qwen-3-5-0-8b-q4k-ehaf16/'},{cache:false,runtimeConfig:{shared:{bufferPool:policy.bufferPool,debug:{profiler:{enabled:false}}},inference:{session:{kvcache:{maxSeqLen:r.generation.maxSeqLen}},prefillChunkLayers:policy.prefillChunkLayers,prefillTokenChunkSize:policy.prefillTokenChunkSize}}});
 for(const row of fixture.cases){session.resetGenerationState();const result=await session.generate({messages:row.messages},r.generation);r.cases.push({id:row.id,result,matchesMesh:result.outputText===row.meshOutput,memory:inspectDeviceMemory()});await save();}
 r.executionPass=true;
}catch(error){r.executionPass=false;r.error=error.stack;}finally{try{await session?.close();await gpu?.close();r.settled=true;}catch(error){r.cleanupError=error.stack;}r.finishedAt=new Date().toISOString();await save();}
console.log(JSON.stringify({executionPass:r.executionPass,error:r.error,settled:r.settled,cases:r.cases.map(c=>({id:c.id,output:c.result.outputText,matchesMesh:c.matchesMesh}))}));process.exitCode=r.executionPass?0:1;
