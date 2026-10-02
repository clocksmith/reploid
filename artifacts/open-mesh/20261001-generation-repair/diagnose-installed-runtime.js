// Run from the Reploid repository with its server listening on localhost:8000.
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.cwd() + '/node_modules/@playwright/test/index.mjs'));
import { readFile } from 'node:fs/promises';
const root=process.cwd();
const modelRoot=process.env.DOPPLER_CHAT_MODEL_DIR;
const model=JSON.parse(await readFile(root+'/self/config/chat-models.json','utf8'))[0];
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu',...(process.env.METAL ? ['--use-angle=metal']:[])]});
try {
const context=await browser.newContext();
await context.route(model.source.baseUrl+'*',async route=>{
 const name=new URL(route.request().url()).pathname.split('/').pop();
 await route.fulfill({body:await readFile(modelRoot+'/'+name)});
});
const page=await context.newPage();
page.on('console',m=>{if(/Embedding|embedding|range-backed|GPU|dtype|Prefill|error|layer=0|Probe|EVENT/i.test(m.text()))console.log(m.type(),m.text())});
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.goto('http://localhost:8000/config/chat-files.json');
const result=await page.evaluate(async model=>{
 const {createWorkModelFiles}=await import('/host/work-model-files.js');
 const {createReploidDopplerRuntimeService}=await import('/infrastructure/doppler-runtime-service.js');
 const profile=await (await fetch('/config/work-profile.json')).json();
 const files=createWorkModelFiles({getTransport:()=>null});const service=createReploidDopplerRuntimeService();const result={model:model.id,identity:model.identity,events:[]};let session;
 try {
 const source=await files.prepareSource(model,{signal:new AbortController().signal});
 session=await service.open({source,options:{runtimeConfig:{shared:{harness:{mode:'diagnose'},debug:{trace:{enabled:true,categories:['all'],layers:[0],maxDecodeSteps:1},probes:['embed_out','attn_input','attn_normed','linear_qkv_proj','linear_z_proj','linear_a_proj','linear_b_proj','linear_core_out','post_attn','ffn_out','layer_out','final_norm','logits'].map(stage=>({stage,layers:[0],stats:true,tokens:[0],dims:[0,1,2,3,4,5,6,7]}))}}},onProgress:p=>console.log('PROGRESS',p.message)}});
 result.resolved=session.advanced.getResolvedRuntimeSession();
 const messages=[{role:'user',content:'Reply with only the word Hello.'}];
 result.tokens=session.advanced.tokenizePrompt(messages,profile.generation);
 await session.resetGenerationState();
 for await(const event of session.stream(messages,profile.generation)) {result.events.push(event); console.log('EVENT',JSON.stringify(event));}
 } catch(error){result.error={message:error.message,stack:error.stack}}finally{result.stats=session?.advanced.getStats();await service.closeAll();await files.close();}
 return result;
},model);
console.log('RESULT',JSON.stringify(result,null,2));
} finally {await browser.close();}
