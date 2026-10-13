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
assert.equal(typeof native.createNativeParticipant,'function');assert.equal(typeof native.createChatCompletions,'function');
const require=createRequire(path.join(consumerRoot,'package.json'));
const {default:OpenAI}=await import(pathToFileURL(require.resolve('openai')));
const sdkPackage=JSON.parse(await fs.readFile(path.join(consumerRoot,'node_modules/openai/package.json')));
const model={id:'injected-text-fixture',identity:'sha256:'+'a'.repeat(64),partition:{fixture:true}}, approvals=[];let generated=0;
const participant={getState:()=>({models:[model]}),async generate(request,controls){
  assert(await controls.requestApproval({recipients:['fixture-recipient'],messages:request.messages}));generated++;
  for(const [sequence,text] of ['fixture ','text'].entries())controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence,text});
  return {threadId:request.threadId,attemptId:request.attemptId,modelId:model.id,modelIdentity:model.identity,content:'fixture text',execution:{stopReason:'stop-token'}};
}};
const api=native.createChatCompletions({participant,
  authenticate:async req=>req.headers.authorization==='Bearer local-fixture-token'?{subject:'installed-fixture-user'}:null,
  authorize:async request=>{approvals.push(request);return true;}});
const server=http.createServer(api.handle);
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
  await assert.rejects(client.responses.create({model:model.id,input:'unsupported'}),error=>error.status===404);
  assert.equal(generated,2);assert.equal(approvals.length,4);assert(approvals.every(row=>row.principal.subject==='installed-fixture-user'));
  assert.equal(api.getState().active,0);
  await fs.writeFile(outputFile,JSON.stringify({passed:true,scope:'installed native public adapter + official SDK HTTP compatibility; injected numerical output',
    nativeArchiveSha256:pack.archiveSha256,nativeDeliverySha256:pack.manifestSha256,nativeFiles:descriptor.entries.length,
    runtimeArchiveSha256:digest(archive),runtimeVersion:pin.version,runtimeFiles,
    sdk:{name:sdkPackage.name,version:sdkPackage.version,lockSha256:digest(await fs.readFile(path.join(consumerRoot,'package-lock.json')))},
    controls:['official SDK nonstream completion','official SDK stream stable identity/text/termination','unsupported temperature rejected 400','Responses rejected 404','exact authenticated principal and disclosure approvals'],
    generatedRequests:generated,providerInitialized:false,modelLoaded:false,cloudCalls:false,installedParticipantGPUQualified:false,
    node:process.version,platform:process.platform},null,2)+'\n');
}finally{await api.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}
