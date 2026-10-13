// Source-selected CPU proof: actual canonical transitions and WebCrypto signatures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createResidentPartition } from '../packages/reploid/src/mesh/partitions/resident-partition.js';
import { createHash } from 'node:crypto';
import { createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
import { createPartitionStageCommitAuthority, verifyPartitionStageCommit } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
const root = process.env.DOPPLER_SOURCE_ROOT;
assert(root, 'Explicit Doppler source root required');
const runtime = await import(pathToFileURL(root + '/src/partitions.js'));
const {createResidentTargetState, createResidentCursorMirror} = await import(pathToFileURL(root + '/src/inference/resident-target-state.js'));
const {createResidentOutputState} = await import(pathToFileURL(root + '/src/inference/resident-output-state.js'));
const {createBundledIncrementalDecoder} = await import(pathToFileURL(root + '/src/inference/tokenizers/bundled/incremental-decoder.js'));
const policy=JSON.parse(await readFile(root+'/tests/fixtures/canonical-generation-policy.json','utf8'));
const hash='sha256:'+'a'.repeat(64), other='sha256:'+'b'.repeat(64), epoch='0'.repeat(32);
const keys=await Promise.all(['ECDSA','Ed25519'].map(algorithm=>createSigningIdentity({algorithm})));
const generation=runtime.canonicalGenerationIdentity(policy,hash,100);
const stages=keys.map((key,index)=>({stageId:index?other:hash,participantId:key.peerId,participantEpoch:epoch,
  deviceEpoch:epoch,residentId:'resident'+index,partitionIndex:index,executionId:hash}));
const attempt={schema:'doppler.resident-attempt/v2',attemptId:'attempt',requesterId:'requester',inputDigest:hash,
  authorizationScope:other,routeId:hash,generationId:generation.generationId,coordinatorEpoch:epoch,publisherEpoch:epoch,
  routeKind:'two-stage-layer',stages};
const decoder=()=>createBundledIncrementalDecoder({tokenForId:id=>String(id),byteLevel:false,byteDecoder:new Map(),
  wordPiece:false,splitEveryCharacter:false,wordPiecePrefix:'##'});
const target=createResidentTargetState([1,2],policy,100,generation.generationId,
  createResidentOutputState(decoder(),decoder(),policy,100));
const logits=new Float32Array(100).fill(-Infinity);logits[3]=0;
const transition=target.bootstrap(logits);
for(let index=0;index<2;index++) {
 const authority=createPartitionStageCommitAuthority({runtime,identity:keys[index],stage:stages[index]});
 const result=await authority.sign({attempt,sequence:0,baseCursorId:null,transition});
 const input={runtime,attempt,stage:stages[index],...result};
 const signInput=structuredClone({attempt,sequence:0,baseCursorId:null,transition});
 const signing=authority.sign(signInput); signInput.transition.delta='mutated during crypto';
 const snapshotted=await signing;
 assert.equal(snapshotted.acknowledgment.decisionId,result.acknowledgment.decisionId);
 assert.equal(await verifyPartitionStageCommit(input),true);
 const mutable=structuredClone({attempt,stage:stages[index],...result});
 const verifying=verifyPartitionStageCommit({runtime,...mutable});
 mutable.evidence.claim.acknowledgment.decisionId=other;
 assert.equal(await verifying,true,'verification privately snapshots before asynchronous crypto');
 assert.equal(result.acknowledgment.decisionId,runtime.residentPublicationDecisionDigest({attemptDigest:runtime.residentAttemptDigest(attempt),
  sequence:0,baseCursorId:null,...transition,delta:{text:transition.delta,outputDigest:transition.outputDigest},stoppingOutcome:transition.successor.stopReason}));
 for(const mutate of [
  value=>{value.acknowledgment.sequence=1;},value=>{value.acknowledgment.baseCursorId=hash;},
  value=>{value.acknowledgment.successorCursorId=hash;},value=>{value.acknowledgment.deviceEpoch='1'.repeat(32);},
  value=>{value.evidence.signature=value.evidence.signature.slice(1);},
  value=>{value.evidence.publicJwk=keys[1-index].publicJwk;},
  value=>{value.evidence.claim.extra=true;},value=>{value.evidence.extra=true;},
  value=>{value.attempt={...attempt,coordinatorEpoch:'1'.repeat(32)};},
  value=>{value.stage={...stages[index],residentId:'replacement'};}
 ]) {
  const changed=structuredClone({attempt,stage:stages[index],...result});mutate(changed);
  assert.equal(await verifyPartitionStageCommit({runtime,...changed}),false);
 }
 await assert.rejects(authority.sign({attempt:{...attempt,stages:[stages[1],stages[0]]},sequence:0,baseCursorId:null,transition}));
 const unfinished=authority.sign({attempt,sequence:0,baseCursorId:null,transition});
 authority.close(); await assert.rejects(unfinished,/closed/);
 await assert.rejects(authority.sign({attempt,sequence:0,baseCursorId:null,transition}),/closed/);
}
console.log('stage commitments: real transitions, ECDSA/Ed25519, full stage/attempt binding and tamper rejection passed');

{
 const plan=runtime.createLayerPartitionPlan({modelId:'fixture',numLayers:4,hiddenSize:8,vocabSize:100,splitLayer:2});
 const planId=runtime.hashLayerPartitionPlan(plan), model={id:'fixture',identity:hash,generation:{maxTokens:16}};
 const generationDigest='sha256:'+createHash('sha256').update(JSON.stringify(model.generation)).digest('hex');
 const binding={modelId:model.id,modelIdentity:hash,planId,threadId:'thread',attemptId:attempt.attemptId,
  participantA:keys[0].peerId,participantB:keys[1].peerId};
 const limits={maxTokens:16,maxPromptTokens:64,maxActivationBytes:4096,maxOutputCharacters:1024,maxAttempts:8,maxConcurrentAttempts:2};
 const gate=Promise.withResolvers();let mirrorCalls=0, numericalDone=false;
 const mirror=createResidentCursorMirror([1,2],policy,100,generation.generationId);
 const numericalTarget=createResidentTargetState([1,2],policy,100,generation.generationId,
  createResidentOutputState(decoder(),decoder(),policy,100));
 const contributors=keys.map((key,index)=>createResidentPartition({runtime:{async openResidentPartition(){return{
  getDescriptor:()=>({schema:'doppler.resident-partition/v1',ready:true,modelId:model.id,modelIdentity:hash,planId,index,
   layerRange:[...plan.partitions[index].layerRange],residentWeightBytes:8,generationDigest,canonicalGenerationId:generation.generationId}),
  getCanonicalGeneration:()=>generation,getRecoveryCapabilities:()=>({schema:'doppler.resident-recovery/v1',inputReplay:false,checkpointExport:false,checkpointImport:false}),
  tokenize:async()=>({}),executeGroup0:async()=>{throw Error('legacy');},executeGroup1:async()=>{throw Error('legacy');},
  admitCanonicalPrompt:async()=>({kind:'prefill',tokenIds:[1,2],generationId:generation.generationId}),
  executeCanonicalGroup0:async()=>({}),
  executeCanonicalGroup1:async()=>{await gate.promise;numericalDone=true;return{transition:numericalTarget.bootstrap(logits)};},
  commitCanonicalTransition:async request=>{mirrorCalls++;return mirror.acceptTransition(request.baseCursorId,request.transition);},
  closeAttempt:async()=>{},close:async()=>{}
 };}},model,plan,planId,index,participantId:key.peerId,limits,canonicalGeneration:{policy,executionIdentity:hash},canonicalRuntime:runtime,
 canonicalCommitAuthority:createPartitionStageCommitAuthority({runtime,identity:key,stage:stages[index]})}));
 await Promise.all(contributors.map(owner=>owner.prepare({approved:true})));
 const common={identity:binding,canonicalAttempt:attempt,sequence:0,step:0,baseCursorId:null};
 let returned=false;const operation=contributors[1].executeCanonicalGroup1(common).then(value=>{returned=true;return value;});
 await Promise.resolve();assert.equal(returned,false);assert.equal(numericalDone,false);
 gate.resolve();const b=await operation;assert(numericalDone);
 assert.equal(await verifyPartitionStageCommit({runtime,attempt,stage:stages[1],...b.commit}),true);
 await assert.rejects(contributors[0].commitCanonicalTransition({...common,transition:{...b.transition,delta:'tampered'},targetCommit:b.commit}),/not authenticated/);
 assert.equal(mirrorCalls,0,'unauthenticated transition must not mutate A');
 const a=await contributors[0].commitCanonicalTransition({...common,transition:b.transition,targetCommit:b.commit});
 assert.equal(mirrorCalls,1);assert.deepEqual(a.transition,b.transition);
 assert.equal(await verifyPartitionStageCommit({runtime,attempt,stage:stages[0],...a.commit}),true);
 assert.equal(a.commit.acknowledgment.decisionId,b.commit.acknowledgment.decisionId);
 await Promise.all(contributors.map(owner=>owner.close()));
}
console.log('contributor stage evidence: B signs after result, tampered B cannot mutate A, both real successors bind one decision');
