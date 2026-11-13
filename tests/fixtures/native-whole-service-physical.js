// Private, explicitly provisioned native service check; never joins the public room.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import {pathToFileURL} from 'node:url';
import rtcModule from '@roamhq/wrtc';
import Socket from 'ws';
import {createNativeParticipant,createNativeRtcAdapter} from '../../server/native-participant.js';
import {createNativeWholeModel} from '../../server/native-whole-model.js';
import {ROOM_ID_PATTERN} from '../../server/swarm-protocol.js';
import {createReploidDopplerRuntimeService} from '../../shared/infrastructure/doppler-runtime-service.js';
import {createSigningIdentity} from '../../packages/reploid/src/artifacts/identity.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with {type:'json'};
assert.equal(process.env.REPLOID_NATIVE_SERVICE_PHYSICAL,'1','Explicit physical opt-in required');
const c=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
assert(c.roomId&&c.roomId!==bootstrap.publicRoomId,'Separate private room required');
assert(ROOM_ID_PATTERN.test(c.roomId),'Invalid private discovery namespace');
assert(['provider','requester'].includes(c.role));
const executionMode=c.executionMode??(c.role==='provider'?'whole-model':'partition');
assert(['whole-model','partition'].includes(executionMode));
const identity=await createSigningIdentity({algorithm:'Ed25519'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
class WS extends Socket {constructor(url){super(url,{origin:'http://localhost:8000'})}}
const report={started:new Date().toISOString(),role:c.role,pid:process.pid,participantId:identity.peerId,model:{id:c.model.id,identity:c.model.identity},rows:[]};
report.fixtureSha256=sha(await fs.readFile(new URL(import.meta.url)));
report.nativeParticipantSha256=sha(await fs.readFile(new URL('../../server/native-participant.js',import.meta.url)));
const save=()=>fs.writeFile(c.output,JSON.stringify(report,null,2)+'\n');
const logger={log(){},info(){},debug(){},warn(...v){console.error(...v)},error(...v){console.error(...v)}};
let participant,service,device,provider,parts;
let finish;const done=new Promise(r=>{finish=r});
const keep=setInterval(()=>{},1000);
process.once('SIGTERM',finish);process.once('SIGINT',finish);
try{
 let nativeGpu=async()=>{throw Error('Requester must not open a GPU')};
 let factory=createNativeWholeModel;
 if(c.role==='provider'){
  const manifest=await fs.readFile(c.modelDirectory+'/manifest.json');
  assert.equal('sha256:'+createHash('sha256').update(manifest).digest('hex'),c.model.identity);
  const base=pathToFileURL(c.dopplerDirectory+'/');const from=p=>import(new URL(p,base));
  const runtime=await from('src/index.js');device=await from('src/gpu/device.js');provider=await from('src/tooling/node-webgpu.js');parts=await from('src/partitions.js');
  (await from('src/tooling/node-file-fetch.js')).installNodeFileFetchShim();
  report.runtimeVersion=runtime.DOPPLER_VERSION;report.runtimeRevision=c.runtimeRevision;
  assert.equal(runtime.DOPPLER_VERSION,c.runtimeVersion,'Pinned runtime version required');
  report.runtimeEntrySha256=sha(await fs.readFile(new URL('src/index.js',base)));
  service=createReploidDopplerRuntimeService({loadModule:async()=>runtime,expectedVersion:c.runtimeVersion});
  nativeGpu=async()=>{const r=await provider.bootstrapNodeWebGPU();assert(r.ok,r.detail);};
  factory=options=>{
   const whole=createNativeWholeModel({...options,service,configureMemory:maxBytes=>parts.configureDeviceMemoryBudget({maxBytes})});
   return {...whole,async generate(...args){try{return await whole.generate(...args)}catch(error){console.error(error.stack);throw error;}}};
  };
 }
 participant=await createNativeParticipant({model:c.model,modelDirectory:c.modelDirectory,identity,
  rtc:createNativeRtcAdapter(rtcModule),WebSocket:WS,signalingUrl:bootstrap.signalingUrl,
  roomId:c.roomId,roomToken:await fs.readFile(c.roomTokenFile,'utf8'),nativeGpu,executionMode,ordered:c.ordered??null,
  createWholeModel:factory,logger});
 if(c.role==='provider'){
  const t=performance.now();report.phase='loading';await save();await participant.contribute(true);
  if(executionMode==='partition'){
   const deadline=Date.now()+c.discoveryTimeoutMs;
   while(!participant.getState().descriptor?.ready){
    const state=participant.getState();assert(state.phase!=='failed',state.error);
    assert(Date.now()<deadline,'Assigned partition did not become ready');
    await new Promise(r=>setTimeout(r,500));
   }
   report.descriptor=participant.getState().descriptor;
  }
  report.loadMs=performance.now()-t;report.phase='ready';await save();console.log(JSON.stringify({ready:true,participantId:identity.peerId,loadMs:report.loadMs}));
  await done;
 }else{
  const deadline=Date.now()+c.discoveryTimeoutMs;let found;
  while(Date.now()<deadline){found=participant.getState().models?.find(m=>m.id===c.model.id&&m.identity===c.model.identity&&m.availability==='ready');if(found)break;await new Promise(r=>setTimeout(r,500));}
  assert(found,'Exact private model was not discovered');
  for(const prompt of c.prompts){
   const t=performance.now();let first=null;const deltas=[];
   const result=await participant.generate({model:found,threadId:randomUUID(),attemptId:randomUUID(),messages:[{role:'user',content:prompt}]},
    {signal:AbortSignal.timeout(c.requestTimeoutMs),onDelta:v=>{first??=performance.now()-t;deltas.push(v);console.log(JSON.stringify({delta:v,elapsedMs:performance.now()-t}));},requestApproval:async d=>{
      const peer=typeof d.recipientIdentity==='string'?d.recipientIdentity:d.recipientIdentity?.participantId;
      const allowed=c.expectedProviders??[c.expectedProvider];
      assert(allowed.includes(peer),'Disclosure recipient differs from the approved providers');
      if(c.ordered){
       assert.deepEqual([...new Set(d.disclosure.tokenRecipients)].sort(),[...new Set(allowed)].sort());
       for(const recipient of [...d.disclosure.activationPaths.flat(),...d.disclosure.outputRecipients]){
        assert(recipient===identity.peerId||allowed.includes(recipient),'Unapproved partition disclosure recipient');
       }
       assert.equal(d.planId,c.model.partitionPlanId);
       (report.disclosures??=[]).push(d.disclosure);
      }
      return true;}});
   assert.equal(result.modelIdentity,c.model.identity);
   const answerMatched=c.expectedAnswer===undefined?null:result.content.trim()===c.expectedAnswer;
   report.rows.push({prompt,wallMs:performance.now()-t,firstDeltaMs:first,deltas,result,answerMatched});await save();console.log(JSON.stringify(report.rows.at(-1)));
   assert(answerMatched!==false,'Answer differs from the requested exact result');
  }
  report.completed=true;
 }
}catch(e){report.failure={message:e.message,stack:e.stack};process.exitCode=1;console.error(e);}
finally{clearInterval(keep);try{await participant?.close();await service?.closeAll();device?.destroyDevice();await provider?.releaseNodeWebGPU();report.cleanup='settled';}catch(e){report.cleanupFailure=String(e);process.exitCode=1;}report.finished=new Date().toISOString();await save();}
