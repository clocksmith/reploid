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
const sdkPackage=JSON.parse(await fs.readFile(path.join(consumerRoot,'node_modules/@anthropic-ai/sdk/package.json')));
const {default:Anthropic}=await import(pathToFileURL(require.resolve('@anthropic-ai/sdk')));
assert.equal(typeof native.createMessages,'function');
const model={id:'injected-local-model',identity:'sha256:'+'a'.repeat(64),partition:{fixture:true},textGeneration:{schema:'reploid.text-generation/v1',usage:'raw-model-tokens/v1'}};
const inputTokenIds=[7,8,9], approvals=[];let generated=0,empty=false,held=null,entered=null,signal;
const participant={getState:()=>({models:[model]}),async generate(request,controls){
  assert(await controls.requestApproval({threadId:request.threadId,attemptId:request.attemptId,modelId:model.id,modelIdentity:model.identity,recipients:['fixture-recipient'],input:{messages:request.messages,...(request.generationRequest?{generationRequest:request.generationRequest}:{})}}));generated++;
  if(held){signal=controls.signal;entered.resolve();await held.promise;signal.throwIfAborted();}
  const requested=request.generationRequest,cap=requested?.maxOutputTokens??3,outputTokens=[];let content='',reason='max-tokens';
  if(requested)await controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:requested.usage,inputTokens:inputTokenIds.length,outputTokens:0});
  for(let step=0;step<cap;step++){
    const tokenId=empty||step===1?0:11;outputTokens.push(tokenId);
    const text=tokenId===0?'':'fixture text';content+=text;
    if(text)controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text});
    if(tokenId===0){reason='stop-token';break;}
  }
  return {threadId:request.threadId,attemptId:request.attemptId,modelId:model.id,modelIdentity:model.identity,content,
    ...(requested?{usage:{schema:requested.usage,inputTokens:inputTokenIds.length,outputTokens:outputTokens.length}}:{}),execution:{stopReason:reason,stepSummary:{count:outputTokens.length}}};
}};
const options={participant,authenticate:async req=>req.headers['x-api-key']==='local-fixture-token'||req.headers.authorization==='Bearer local-fixture-token'?{subject:'installed-fixture-user'}:null,
  authorize:async request=>{approvals.push(request);return true;}};
const messages=native.createMessages(options),chat=native.createChatCompletions(options),responses=native.createResponses(options);
const server=http.createServer((req,res)=>{const route=new URL(req.url,'http://localhost').pathname;return(route==='/v1/messages'?messages:route==='/v1/responses'?responses:chat).handle(req,res);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const baseURL=`http://127.0.0.1:${server.address().port}`,client=new Anthropic({apiKey:'local-fixture-token',baseURL,maxRetries:0});
  const input={model:model.id,messages:[{role:'user',content:'fixture request'}],max_tokens:3};
  const completed=await client.messages.create(input);assert.equal(completed.content[0].text,'fixture text');assert.equal(completed.stop_reason,'end_turn');assert.deepEqual(completed.usage,{input_tokens:3,output_tokens:2});
  const rows=[];for await(const row of await client.messages.create({...input,stream:true}))rows.push(row);
  assert.equal(rows[0].type,'message_start');assert.deepEqual(rows[0].message.usage,{input_tokens:3,output_tokens:0});assert.equal(rows.at(-1).type,'message_stop');assert.equal(rows.at(-2).usage.output_tokens,2);
  const accumulated=await client.messages.stream(input).finalMessage();assert.equal(accumulated.content[0].text,'fixture text');assert.equal(accumulated.usage.output_tokens,2);
  const limited=await client.messages.create({...input,max_tokens:1});assert.equal(limited.stop_reason,'max_tokens');assert.equal(limited.usage.output_tokens,1);
  const limitedStream=await client.messages.stream({...input,max_tokens:1}).finalMessage();assert.equal(limitedStream.stop_reason,'max_tokens');assert.equal(limitedStream.usage.output_tokens,1);
  empty=true;const emptyMessage=await client.messages.stream(input).finalMessage();assert.equal(emptyMessage.content[0].text,'');assert.equal(emptyMessage.usage.output_tokens,1);empty=false;
  for(const parameter of ['tools','thinking','output_config','temperature','top_p','stop_sequences'])await assert.rejects(client.messages.create({...input,[parameter]:null}),error=>error.status===400);
  await assert.rejects(client.messages.create({...input,max_tokens:0}),error=>error.status===400);
  held=Promise.withResolvers();entered=Promise.withResolvers();const controller=new AbortController(),pending=client.messages.create(input,{signal:controller.signal});pending.catch(()=>{});
  await entered.promise;controller.abort();await assert.rejects(pending);for(let i=0;i<100&&!signal.aborted;i++)await new Promise(resolve=>setTimeout(resolve,10));assert(signal.aborted);assert.equal(messages.getState().active,1);held.resolve();
  for(let i=0;i<100&&messages.getState().active;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(messages.getState().active,0);held=null;
  const openai=new OpenAI({apiKey:'local-fixture-token',baseURL:baseURL+'/v1',maxRetries:0});
  const completion=await openai.chat.completions.create({model:model.id,messages:input.messages});assert.equal(completion.choices[0].message.content,'fixture text');assert.equal(completion.usage,undefined);
  const response=await openai.responses.stream({model:model.id,input:'fixture request',store:false}).finalResponse();assert.equal(response.output_text,'fixture text');assert.equal(response.usage,undefined);
  assert.equal(generated,9);assert(approvals.every(row=>row.principal.subject==='installed-fixture-user'));
  await fs.writeFile(outputFile,JSON.stringify({passed:true,scope:'installed public native Messages + official SDK; injected tokenization/sampling, no model claim',
    nativeArchiveSha256:pack.archiveSha256,nativeDeliverySha256:pack.manifestSha256,nativeFiles:descriptor.entries.length,runtimeArchiveSha256:digest(archive),runtimeVersion:pin.version,runtimeFiles,
    sdk:{name:sdkPackage.name,version:sdkPackage.version,lockSha256:digest(await fs.readFile(path.join(consumerRoot,'package-lock.json')))},
    controls:['Messages nonstream','Messages typed stream','SDK finalMessage accumulator','actual caller cap=1 nonstream and stream','empty visible answer still counts sampled terminal','unsupported parameters/cache-only rejected','SDK abort retains unresolved HTTP admission','Chat Completions and Responses regressions'],
    generatedRequests:generated,tokenUsage:'raw-model-tokens/v1; local template and selected tokens including terminal; no Claude billing equivalence',providerInitialized:false,modelLoaded:false,cloudCalls:false,node:process.version,platform:process.platform},null,2)+'\n');
}finally{held?.resolve();await Promise.all([messages.close(),chat.close(),responses.close()]);server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}
