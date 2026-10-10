import { chromium } from '/home/x/deco/reploid/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { physicalWebGpuBrowserOptions } from '/home/x/deco/reploid/tests/fixtures/physical-webgpu-browser.js';
import { routeDiagnosticModel } from '/home/x/deco/reploid/tests/fixtures/capacity-observer.js';
const root='/home/x/deco/reploid';
const stateBytes=await readFile('/tmp/reploid-contracts027-reverse-generation-state.json');
const state=JSON.parse(stateBytes);
const thread=state.states[0].history.threads.find(t=>t.messages[0].content==='Count from one to two hundred, one number per line.');
const selected=JSON.parse(await readFile(root+'/self/config/chat-models.json')).find(m=>m.id===thread.model.id);
const server=createServer(async (req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Installed numerical diagnostic</title>');return;}
  const file=resolve(root+'/self','.'+url.pathname);
  if(!file.startsWith(root+'/self/'))throw Error('outside fixture');
  res.setHeader('Content-Type', {'.js':'text/javascript','.json':'application/json','.wgsl':'text/plain'}[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
process.env.DOPPLER_CHAT_MODEL_DIR='/home/x/deco/doppler/models/local/'+selected.id;
process.env.REPLOID_MODEL_PORT='0';
const {server:modelServer}=await import('/home/x/deco/reploid/tests/fixtures/numerical-model-server.js');
if(!modelServer.listening)await once(modelServer,'listening');
let browser;
const report={schema:'reploid.conversation-isolation-control/v1',scope:'Unsplit prompt replay, no companion conversation or cancellation; not release acceptance',sourceStateSha256:createHash('sha256').update(stateBytes).digest('hex'),package:JSON.parse(await readFile(root+'/self/config/doppler-package.json')),input:{messages:[thread.messages[0]].map(({role,content})=>({role,content})),generation:thread.model.generation},modelIdentity:selected.identity};
try{
 browser=await chromium.launch(physicalWebGpuBrowserOptions('linux'));
 const context=await browser.newContext();
 await routeDiagnosticModel(context,selected,process.env.DOPPLER_CHAT_MODEL_DIR,`http://127.0.0.1:${modelServer.address().port}/`);
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
 report.result=await page.evaluate(async ({selected,input})=>{
  const config=await import('/config/doppler-local-models.js');
  const policy=await (await fetch('/config/partition-policy.json')).json();
  globalThis.__DOPPLER_KERNEL_BASE_PATH__=config.DOPPLER_KERNEL_BASE_URL;
  const runtime=await import(config.DOPPLER_PARTITIONS_MODULE_URL);
  const {load}=await import(config.DOPPLER_MODULE_URL);
  const {createHttpArtifactStorageContext}=await import(new URL('./storage/artifact-storage-context.js',new URL(config.DOPPLER_MODULE_URL,location.href)).href);
  const bytes=await (await fetch(selected.source.baseUrl+'manifest.json')).arrayBuffer();
  const identity='sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(identity!==selected.identity)throw Error('model identity mismatch');
  const manifestText=new TextDecoder().decode(bytes),manifest=JSON.parse(manifestText);
  await runtime.configureDeviceMemoryBudget({maxBytes:6000000000});
  let handle;
  try{
   handle=await load({manifest,manifestText,manifestHash:identity.slice(7),baseUrl:selected.source.baseUrl,storage:createHttpArtifactStorageContext(selected.source.baseUrl,manifest,{verifyHashes:true})},{runtimeConfig:{shared:{bufferPool:policy.bufferPool},inference:{session:{kvcache:{maxSeqLen:input.generation.maxSeqLen},prefillChunkLayers:policy.prefillChunkLayers,prefillTokenChunkSize:policy.prefillTokenChunkSize}}}});
   const tokenIds=handle.advanced.tokenizePrompt(input.messages,input.generation);
   const {maxSeqLen,...generation}=input.generation;
   const evidence=await handle.generateWithEvidence('',{...generation,inputIds:tokenIds,disableCommandBatching:true});
   return {tokenIds,evidence,memory:runtime.inspectDeviceMemory(),maxGpuBufferBytes:6000000000};
  }finally{await handle?.unload();}
 },{selected,input:report.input});
}catch(error){report.failure={name:error.name,message:error.message};process.exitCode=1;}
finally{await writeFile(root+'/artifacts/partition-contracts-20261010/physical/count-unsplit-control.json',JSON.stringify(report,null,2)+'\n');await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));modelServer.closeAllConnections();await new Promise(done=>modelServer.close(done));}
console.log(JSON.stringify({failure:report.failure,resultKeys:Object.keys(report.result||{})}));
