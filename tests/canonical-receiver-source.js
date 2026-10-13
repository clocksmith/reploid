// Source-selected CPU test: actual Doppler target and stage evidence; no numerical execution.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPartitionStepReceiver } from '../packages/reploid/src/mesh/partitions/partition-step-receiver.js';
import { createPartitionStageCommitAuthority } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
import { createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
const root=process.env.DOPPLER_SOURCE_ROOT;assert(root,'Explicit source root required');
const runtime=await import(pathToFileURL(root+'/src/partitions.js'));
const {createResidentTargetState}=await import(pathToFileURL(root+'/src/inference/resident-target-state.js'));
const {createResidentOutputState}=await import(pathToFileURL(root+'/src/inference/resident-output-state.js'));
const {createBundledIncrementalDecoder}=await import(pathToFileURL(root+'/src/inference/tokenizers/bundled/incremental-decoder.js'));
const policy=JSON.parse(await readFile(root+'/tests/fixtures/canonical-generation-policy.json','utf8'));
const h='sha256:'+'a'.repeat(64),o='sha256:'+'b'.repeat(64),epoch='0'.repeat(32);
const key=await createSigningIdentity({algorithm:'ECDSA'});
const stage={stageId:o,participantId:key.peerId,participantEpoch:epoch,deviceEpoch:epoch,residentId:'B',partitionIndex:1,executionId:h};
const generation=runtime.canonicalGenerationIdentity(policy,h,100);
const attempt={schema:'doppler.resident-attempt/v2',attemptId:'attempt',requesterId:'requester',inputDigest:h,authorizationScope:o,
 routeId:h,generationId:generation.generationId,coordinatorEpoch:epoch,publisherEpoch:epoch,routeKind:'two-stage-layer',
 stages:[{...stage,stageId:h,participantId:'A',residentId:'A',partitionIndex:0},stage]};
const identity={modelId:'fixture',modelIdentity:h,planId:h,threadId:'thread',attemptId:'attempt',participantA:'A',participantB:key.peerId};
const decoder=()=>createBundledIncrementalDecoder({tokenForId:id=>String(id),byteLevel:false,byteDecoder:new Map(),wordPiece:false,splitEveryCharacter:false,wordPiecePrefix:'##'});
const target=createResidentTargetState([1,2],policy,100,generation.generationId,createResidentOutputState(decoder(),decoder(),policy,100));
const authority=createPartitionStageCommitAuthority({runtime,identity:key,stage});
const logits=new Float32Array(100).fill(-Infinity);logits[3]=0;
let clock=0,calls=0,allowed=true,settlements=0,failClose=false;const gates=[];
const receiver=createPartitionStepReceiver({executeStep:()=>{throw Error('legacy');},authorize:async()=>allowed,
 fingerprint:request=>runtime.metadataDigest('test-request',request),settleAttempt:async()=>{settlements++;if(failClose)throw Error('close failed');},
 limits:{maxAttempts:2,maxSteps:10},canonical:{runtime,stage,now:()=>clock,
 verifyPublication:async(request,result)=>request.receipt.decisionId===result.commit.acknowledgment.decisionId,
 execute:async request=>{calls++;if(gates.length)await gates.shift().promise;
 if(request.phase==='admit')return{kind:'prefill',tokenIds:[1,2],generationId:generation.generationId};
 const transition=request.sequence===0?target.bootstrap(logits):target.advance(request.baseCursorId,logits);
 return{transition,commit:await authority.sign({attempt,sequence:request.sequence,baseCursorId:request.baseCursorId,transition})};}}});
const request=(phase,sequence=0,baseCursorId=null)=>({identity,canonicalAttempt:attempt,generationId:generation.generationId,
 phase,sequence,step:sequence,tokenPosition:sequence?sequence+1:0,inputTokenCount:sequence?1:2,baseCursorId});
assert.equal(typeof receiver.receiveCanonical,'function');
await receiver.receiveCanonical(request('admit'));assert.equal(calls,1);
const gate=Promise.withResolvers();gates.push(gate);
const first=receiver.receiveCanonical(request('step')),duplicate=receiver.receiveCanonical(request('step'));
await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,2,'identical pending requests join');
await assert.rejects(receiver.receiveCanonical({...request('step'),inputTokenCount:1}),/collision/);
gate.resolve();const [a,b]=await Promise.all([first,duplicate]);assert.deepEqual(a,b);assert.equal(calls,2);
assert.deepEqual(await receiver.receiveCanonical(request('step')),a,'replays exact signed envelope');
allowed=false;await assert.rejects(receiver.receiveCanonical(request('step')),/authorization/);allowed=true;
for(const mutate of [r=>{r.canonicalAttempt.coordinatorEpoch='1'.repeat(32);},r=>{r.canonicalAttempt.stages[1].participantEpoch='1'.repeat(32);},
 r=>{r.generationId=o;},r=>{r.phase='prepare';}]) {
 const changed=structuredClone(request('step'));mutate(changed);await assert.rejects(receiver.receiveCanonical(changed));
}
clock=60001;
assert.deepEqual(await receiver.receiveCanonical(request('step')),a,'unpublished result remains pinned beyond retention');
await assert.rejects(receiver.receiveCanonical(request('step',1,a.transition.successor.cursorId)),/Out-of-order/);
const published=(sequence,result)=>({...request('published',sequence),receipt:{decisionId:result.commit.acknowledgment.decisionId}});
await receiver.receiveCanonical(published(0,a));
assert.deepEqual(await receiver.receiveCanonical(published(0,a)),published(0,a).receipt);
await assert.rejects(receiver.receiveCanonical({...published(0,a),receipt:{decisionId:o}}),/collision/);
const secondRequest=request('step',1,a.transition.successor.cursorId);
const second=await receiver.receiveCanonical(secondRequest);assert.equal(calls,3);
await receiver.receiveCanonical(published(1,second));
assert.deepEqual(await receiver.receiveCanonical(request('step')),a,'two completed sequence sets retained');
const third=await receiver.receiveCanonical(request('step',2,second.transition.successor.cursorId));assert.equal(calls,4);assert(third.commit);await receiver.receiveCanonical(published(2,third));
await assert.rejects(receiver.receiveCanonical(request('step')),error=>error.code==='RESULT_EXPIRED');
clock=120002;await assert.rejects(receiver.receiveCanonical(secondRequest),error=>error.code==='RESULT_EXPIRED');assert.equal(calls,4);
failClose=true;await assert.rejects(receiver.closeAttempt(identity),/close failed/);failClose=false;
await receiver.closeAttempt(identity);assert.equal(settlements,2,'failed cleanup retains owner and permits explicit retry');
await assert.rejects(receiver.receiveCanonical(request('step',3)),/retired/);await receiver.close();
console.log('canonical receiver: real signed transitions; pending join, replay, epoch/payload collision, expiry and cleanup retry pass');

// Bounds/cancellation controls exercise the same receiver, with explicitly injected execution.
function controlled({execute=async()=>({kind:'prefill'}),authorize=async()=>true,fingerprint=request=>runtime.metadataDigest('test-request',request),maxAttempts=2}={}) {
 let runs=0,closes=0;
 const owner=createPartitionStepReceiver({executeStep:async()=>{throw Error('legacy');},authorize,fingerprint,
 settleAttempt:async()=>{closes++;},limits:{maxAttempts,maxSteps:10},canonical:{runtime,stage,now:()=>clock,verifyPublication:async()=>true,
 execute:async(...args)=>{runs++;return execute(...args);}}});
 return{owner,get runs(){return runs;},get closes(){return closes;}};
}
{
 const f=controlled();await assert.rejects(f.owner.receiveCanonical({...request('admit'),extra:'x'.repeat(65536)}),/budget|Metadata exceeds admission/);
 assert.equal(f.runs,0);await f.owner.close();
}
{
 const f=controlled({execute:async()=>({kind:'prefill',oversized:'x'.repeat(65536)})});
 await assert.rejects(f.owner.receiveCanonical(request('admit')),/budget|Metadata exceeds admission/);
 await assert.rejects(f.owner.receiveCanonical(request('admit')),/retired/);assert.equal(f.runs,1);await f.owner.close();
}
{
 const gate=Promise.withResolvers();const f=controlled({fingerprint:async request=>{await gate.promise;return runtime.metadataDigest('test-request',request);}});
 const pending=f.owner.receiveCanonical(request('admit'));await f.owner.closeAttempt(identity);gate.resolve();
 await assert.rejects(pending,/collision/);assert.equal(f.runs,0);await f.owner.close();
}
{
 const f=controlled({maxAttempts:1});await f.owner.receiveCanonical(request('admit'));await f.owner.closeAttempt(identity);
 const next=structuredClone(request('admit'));next.identity.attemptId='new';next.canonicalAttempt.attemptId='new';
 await assert.rejects(f.owner.receiveCanonical(next),/budget/);assert.equal(f.runs,1);await f.owner.close();
}
{
 let allow=true;const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const f=controlled({authorize:async()=>allow,execute:async()=>{entered.resolve();await gate.promise;return{kind:'prefill'};}});
 const pending=f.owner.receiveCanonical(request('admit'));await entered.promise;allow=false;gate.resolve();
 await assert.rejects(pending,/authorization/);allow=true;
 assert.deepEqual(await f.owner.receiveCanonical(request('admit')),{kind:'prefill'});assert.equal(f.runs,1);await f.owner.close();
}
{
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const f=controlled({execute:async()=>{entered.resolve();await gate.promise;return{kind:'prefill'};}});
 const pending=f.owner.receiveCanonical(request('admit'));await entered.promise;
 let settled=false;const closing=f.owner.closeAttempt(identity).then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
 gate.resolve();await assert.rejects(pending,/closed/);await closing;assert.equal(f.closes,1);await f.owner.close();
}
console.log('canonical receiver bounds: control sizes, tombstones, close-over-hash, post-execution permission and pending settlement pass');
{
 const zeroPolicy={...policy,maxGeneratedTokens:0};const zero=runtime.canonicalGenerationIdentity(zeroPolicy,h,100);
 const admission=runtime.admitResidentPrompt([1,2],zeroPolicy,100,zero.generationId);
 const f=controlled({execute:async()=>admission});const input=structuredClone(request('admit'));
 input.generationId=zero.generationId;input.canonicalAttempt.generationId=zero.generationId;
 assert.deepEqual(await f.owner.receiveCanonical(input),admission);assert.equal(f.runs,1);
 await assert.rejects(f.owner.receiveCanonical({...input,phase:'step'}),error=>error.code==='RESULT_EXPIRED');
 const receipt={admission:true};assert.deepEqual(await f.owner.receiveCanonical({...input,phase:'published',receipt}),receipt);
 assert.equal(f.runs,1,'admission-only publication never dispatches a numerical step');await f.owner.close();
}
