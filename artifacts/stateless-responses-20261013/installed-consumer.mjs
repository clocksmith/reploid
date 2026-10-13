// Exact installed public entry + official SDK. Numerical output is injected test data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
const [packageFile,consumerRoot,outputFile]=process.argv.slice(2);
const pack=JSON.parse(await fs.readFile(packageFile)), directory=pack.directory;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'), exec=promisify(execFile);
assert.equal(digest(await fs.readFile(pack.archive)),pack.archiveSha256);
const descriptorBytes=await fs.readFile(path.join(directory,'native-delivery.json')),descriptor=JSON.parse(descriptorBytes);
assert.equal(digest(descriptorBytes),pack.manifestSha256);
for(const entry of descriptor.entries){
  assert(!path.isAbsolute(entry.path)&&!entry.path.split('/').includes('..'));
  const bytes=await fs.readFile(path.join(directory,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256,entry.path);
}
const pin=JSON.parse(await fs.readFile(path.join(directory,'self/config/doppler-package.json')));
const archivePath=path.join(directory,pin.spec.slice(5)),archive=await fs.readFile(archivePath);
assert.equal('sha512-'+createHash('sha512').update(archive).digest('base64'),pin.integrity);
const extracted=await fs.mkdtemp(path.join(os.tmpdir(),'api-runtime-verify-'));let runtimeFiles=0;
async function compare(source,target){for(const item of await fs.readdir(source,{withFileTypes:true})){
  assert(!item.isSymbolicLink());const a=path.join(source,item.name),b=path.join(target,item.name);
  if(item.isDirectory())await compare(a,b);else{assert((await fs.readFile(a)).equals(await fs.readFile(b)),a);runtimeFiles++;}
}}
try{await exec('tar',['-xzf',archivePath,'-C',extracted]);await compare(path.join(extracted,'package'),path.join(directory,'node_modules/doppler-gpu'));}
finally{await fs.rm(extracted,{recursive:true});}
const native=await import(pathToFileURL(path.join(directory,'server/native-participant.js')));
assert.equal(typeof native.createNativeParticipant,'function');assert.equal(typeof native.createChatCompletions,'function');assert.equal(typeof native.createResponses,'function');
const require=createRequire(path.join(consumerRoot,'package.json'));
const {default:OpenAI}=await import(pathToFileURL(require.resolve('openai')));
const sdkPackage=JSON.parse(await fs.readFile(path.join(consumerRoot,'node_modules/openai/package.json')));
const model={id:'injected-text-fixture',identity:'sha256:'+'a'.repeat(64),partition:{fixture:true}}, approvals=[];let generated=0;let reason='stop-token',hold=null,entered=null,heldSignal=null;
const participant={getState:()=>({models:[model]}),async generate(request,controls){
  assert(await controls.requestApproval({recipients:['fixture-recipient'],messages:request.messages}));generated++;
  if(hold){heldSignal=controls.signal;entered.resolve();await hold.promise;controls.signal.throwIfAborted();}
  for(const [sequence,text] of ['fixture ','text'].entries())controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence,text});
  return {threadId:request.threadId,attemptId:request.attemptId,modelId:model.id,modelIdentity:model.identity,content:'fixture text',execution:{stopReason:reason}};
}};
const options={participant,
  authenticate:async req=>req.headers.authorization==='Bearer local-fixture-token'?{subject:'installed-fixture-user'}:null,
  authorize:async request=>{approvals.push(request);return true;}};
const api=native.createChatCompletions(options),responses=native.createResponses(options);
const server=http.createServer((req,res)=>new URL(req.url,'http://localhost').pathname==='/v1/responses'?responses.handle(req,res):api.handle(req,res));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const client=new OpenAI({apiKey:'local-fixture-token',baseURL:`http://127.0.0.1:${server.address().port}/v1`,maxRetries:0});
  const input={model:model.id,messages:[{role:'user',content:'test fixture'}]};
  const result=await client.chat.completions.create(input);
  assert.equal(result.choices[0].message.content,'fixture text');assert.equal(result.choices[0].finish_reason,'stop');assert.equal(result.usage,undefined);
  const chunks=[];for await(const chunk of await client.chat.completions.create({...input,stream:true}))chunks.push(chunk);
  assert.equal(chunks.map(row=>row.choices[0]?.delta?.content||'').join(''),'fixture text');
  assert.equal(chunks.at(-1).choices[0].finish_reason,'stop');assert.equal(new Set(chunks.map(row=>row.id)).size,1);
  await assert.rejects(client.chat.completions.create({...input,temperature:0}),error=>error.status===400&&error.param==='temperature');
  const responseInput={model:model.id,input:'fixture request',store:false};
  const complete=await client.responses.create(responseInput);
  assert.equal(complete.output_text,'fixture text');assert.equal(complete.status,'completed');assert.equal(complete.usage,undefined);
  const rows=[];for await(const row of await client.responses.create({...responseInput,stream:true}))rows.push(row);
  assert.deepEqual(rows.map(r=>r.sequence_number),rows.map((_,i)=>i));assert.equal(rows.at(-1).type,'response.completed');
  assert.equal(rows.filter(r=>r.type==='response.output_text.delta').map(r=>r.delta).join(''),'fixture text');
  const accumulated=await client.responses.stream(responseInput).finalResponse();assert.equal(accumulated.output_text,'fixture text');
  reason='max-tokens';
  const limited=await client.responses.create(responseInput);assert.equal(limited.status,'incomplete');assert.equal(limited.completed_at,null);
  assert.deepEqual(limited.incomplete_details,{reason:'max_output_tokens'});
  const partial=await client.responses.stream(responseInput).finalResponse();assert.equal(partial.status,'incomplete');assert.equal(partial.output_text,'fixture text');
  reason='context-limit';
  await assert.rejects(client.responses.create(responseInput),error=>error.status===502&&error.message.includes('context limit'));
  await assert.rejects(client.responses.stream(responseInput).finalResponse(),error=>error.message.includes('context limit'));
  for(const parameter of ['previous_response_id','conversation','background','tools','text','seed','top_p','temperature','max_output_tokens']){
    await assert.rejects(client.responses.create({...responseInput,[parameter]:null}),error=>error.status===400&&error.param===parameter);
  }
  await assert.rejects(client.responses.create({model:model.id,input:'missing store'}),error=>error.status===400&&error.param==='store');
  reason='stop-token';hold=Promise.withResolvers();entered=Promise.withResolvers();
  const controller=new AbortController(),pending=client.responses.create(responseInput,{signal:controller.signal});pending.catch(()=>{});
  await entered.promise;controller.abort();await assert.rejects(pending);
  for(let i=0;i<100&&!heldSignal.aborted;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert(heldSignal.aborted);assert.equal(responses.getState().active,1);hold.resolve();
  for(let i=0;i<100&&responses.getState().active;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(responses.getState().active,0);
  assert.equal(generated,10);assert.equal(approvals.length,20);assert(approvals.every(row=>row.principal.subject==='installed-fixture-user'));
  assert.equal(api.getState().active,0);
  await fs.writeFile(outputFile,JSON.stringify({passed:true,scope:'installed native public adapter + official SDK HTTP compatibility; injected numerical output',
    nativeArchiveSha256:pack.archiveSha256,nativeDeliverySha256:pack.manifestSha256,nativeFiles:descriptor.entries.length,
    runtimeArchiveSha256:digest(archive),runtimeVersion:pin.version,runtimeFiles,
    sdk:{name:sdkPackage.name,version:sdkPackage.version,lockSha256:digest(await fs.readFile(path.join(consumerRoot,'package-lock.json')))},
    controls:['Chat Completions nonstream and stream regressions','Responses SDK nonstream output_text','Responses SDK typed stream sequence','Responses SDK stream accumulator finalResponse','max-tokens nonstream and stream incomplete','context-limit nonstream and stream error','unsupported state/tools/sampling parameters 400','explicit store:false required','SDK cancellation retains pending admission until actual promise settles','exact authenticated principal and disclosure approvals'],
    generatedRequests:generated,providerInitialized:false,modelLoaded:false,cloudCalls:false,installedParticipantGPUQualified:false,
    node:process.version,platform:process.platform},null,2)+'\n');
}finally{hold?.resolve();await Promise.all([api.close(),responses.close()]);server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}
