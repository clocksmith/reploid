import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
import { createPartitionStageCommitAuthority } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
const root=process.env.DOPPLER_SOURCE_ROOT;assert(root,'Explicit source root required');
const runtime=await import(pathToFileURL(root+'/src/partitions.js'));
const {createResidentTargetState}=await import(pathToFileURL(root+'/src/inference/resident-target-state.js'));
const {createResidentOutputState}=await import(pathToFileURL(root+'/src/inference/resident-output-state.js'));
const {createBundledIncrementalDecoder}=await import(pathToFileURL(root+'/src/inference/tokenizers/bundled/incremental-decoder.js'));
const {createCanonicalPartitionContract}=await import('../packages/reploid/src/mesh/partitions/partition-canonical-contract.js');
const policy=JSON.parse(await readFile(root+'/tests/fixtures/canonical-generation-policy.json','utf8'));
const h='sha256:'+'a'.repeat(64),o='sha256:'+'b'.repeat(64),epoch='0'.repeat(32);
const keys=await Promise.all([0,1].map(()=>createSigningIdentity({algorithm:'ECDSA'})));
const stages=keys.map((key,i)=>({stageId:i?o:h,participantId:key.peerId,participantEpoch:epoch,deviceEpoch:epoch,residentId:'r'+i,partitionIndex:i,executionId:h}));
const generation=runtime.canonicalGenerationIdentity(policy,h,100);
const plan=runtime.createLayerPartitionPlan({modelId:'fixture',numLayers:4,hiddenSize:8,vocabSize:100,splitLayer:2});
const planId=runtime.hashLayerPartitionPlan(plan);
const identity={modelId:'fixture',modelIdentity:h,planId,threadId:'thread',attemptId:'attempt',participantA:keys[0].peerId,
 participantB:keys[1].peerId,requesterId:'requester',placementGeneration:0};
const attempt={schema:'doppler.resident-attempt/v2',attemptId:'attempt',requesterId:'requester',inputDigest:runtime.tokenDigest([1,2],100,64),authorizationScope:o,
 routeId:h,generationId:generation.generationId,coordinatorEpoch:epoch,publisherEpoch:epoch,routeKind:'two-stage-layer',stages};
const grant={claim:{canonicalAttempt:attempt,generation,vocabSize:100,limits:{maxPromptTokens:64,maxActivationBytes:4096}}};
const contract=createCanonicalPartitionContract({runtime,plan,planId,modelIdentity:h});
const base={schema:'reploid.canonical-partition-request/v1',operation:'step',phase:'step',identity,canonicalAttempt:attempt,
 generationId:generation.generationId,sequence:0,step:0,tokenPosition:0,inputTokenCount:2,inputTokenIds:[1,2],baseCursorId:null,baseCursor:null,grant,continuation:null};
const activationTensor={data:new Float32Array(16),dtype:'f32',shape:[1,2,8],seqOffset:0,step:0};
const frame=await contract.serializeActivation({...base,activationTensor});
const {buffer,...header}=frame;const request={...base,frame:header};
assert.equal(contract.validateHeader(request,buffer.byteLength),true);
assert.deepEqual(contract.validatePayload(request,new Uint8Array(buffer)).shape,[1,2,8]);
for(const mutate of [r=>{r.frame.metadata.activation.proposalId=h;},r=>{r.frame.metadata.activation.baseCursorId=h;},
 r=>{r.frame.metadata.activation.sourceStageId=o;},r=>{r.frame.metadata.activation.tokenContextDigest=o;},
 r=>{r.frame.metadata.identity.threadId='other';},r=>{r.frame.metadata.extra=true;},r=>{r.inputTokenIds=[3,4];},
 r=>{r.unexpected=true;},r=>{r.frame.byteLength++;},r=>{r.frame.metadata.activation.layout.components=2;},r=>{r.canonicalAttempt.stages[1].deviceEpoch='1'.repeat(32);}]) {
 const changed=structuredClone(request);mutate(changed);assert.equal(contract.validateHeader(changed,buffer.byteLength),false);
}
const mutable=structuredClone({...base,activationTensor});const serializing=contract.serializeActivation(mutable);
mutable.identity.threadId='changed';mutable.inputTokenIds[0]=9;mutable.activationTensor.data[0]=99;
assert.deepEqual(await serializing,frame,'serialization snapshots caller bytes and metadata before asynchronous digest');
const changed=new Uint8Array(buffer.slice(0));changed[0]=1;assert.throws(()=>contract.validatePayload(request,changed),/digest/);
assert.notEqual(await contract.fingerprint({...request,payload:changed}),await contract.fingerprint({...request,payload:new Uint8Array(buffer)}));
const decoder=()=>createBundledIncrementalDecoder({tokenForId:id=>String(id),byteLevel:false,byteDecoder:new Map(),wordPiece:false,splitEveryCharacter:false,wordPiecePrefix:'##'});
const target=createResidentTargetState([1,2],policy,100,generation.generationId,createResidentOutputState(decoder(),decoder(),policy,100));
const logits=new Float32Array(100).fill(-Infinity);logits[3]=0;const transition=target.bootstrap(logits);
const authorities=keys.map((identity,i)=>createPartitionStageCommitAuthority({runtime,identity,stage:stages[i]}));
const commits=await Promise.all(authorities.map(a=>a.sign({attempt,sequence:0,baseCursorId:null,transition})));
const body={schema:'doppler.execution-publication/v2',attemptId:attempt.attemptId,coordinatorEpoch:epoch,
 attemptDigest:runtime.residentAttemptDigest(attempt),sequence:0,expectedRevision:null,previousPublicationDigest:null,
 baseCursorId:null,decisionId:commits[0].acknowledgment.decisionId,acceptedTokenIds:transition.acceptedTokenIds,
 tokenRange:transition.tokenRange,successor:transition.successor,delta:{text:transition.delta,outputDigest:transition.outputDigest},
 stoppingOutcome:transition.successor.stopReason,acknowledgments:commits.map(c=>c.acknowledgment)};
const publication={...body,publicationDigest:runtime.metadataDigest(body.schema,body)};
const receiptBody={schema:'reploid.publication-receipt/v1',conversationId:'thread',writerEpoch:epoch,index:0,coordinatorEpoch:epoch,
 attemptId:'attempt',sequence:0,publicationDigest:publication.publicationDigest};
const receipt={...receiptBody,receiptDigest:runtime.metadataDigest(receiptBody.schema,receiptBody)};
const published={...base,operation:'published',phase:'published',publication,receipt,commits};
const retained={transition,commit:commits[1]};
assert.equal(await contract.verifyPublication(published,retained),true);
for(const mutate of [r=>{r.receipt.conversationId='other';},r=>{r.receipt.writerEpoch='1'.repeat(32);},r=>{r.receipt.extra=true;},
 r=>{r.publication.delta.text='unpublished text';},r=>{r.commits[0].evidence.signature=r.commits[0].evidence.signature.slice(1);},
 r=>{r.commits=[r.commits[1],r.commits[1]];},r=>{r.sequence=1;},r=>{r.publication.acknowledgments.pop();}]) {
 const changed=structuredClone(published);mutate(changed);assert.equal(await contract.verifyPublication(changed,retained),false);
}
assert.equal(await contract.verifyPublication(published,{...retained,commit:commits[0]}),false);
console.log('canonical peer contract: actual codecs, payload/epoch binding, real stage signatures and exact publication/receipt controls pass');

// Actual in-memory data-channel framing and grant/stage signatures; computation is injected.
const {createPartitionPeer}=await import('../packages/reploid/src/mesh/partitions/partition-peer.js');
const {createPartitionGrantAuthority}=await import('../packages/reploid/src/mesh/partitions/partition-grants.js');
const {createResidentCursorMirror}=await import(pathToFileURL(root+'/src/inference/resident-target-state.js'));
const auth=keys.map(identity=>createPartitionGrantAuthority({identity,meshId:'mesh',maxGrants:8,maxTtlMs:60000,canonicalRuntime:runtime}));
const caps={maxTokens:16,maxPromptTokens:64,maxActivationBytes:4096,maxOutputCharacters:4096};
const scoped={...attempt,authorizationScope:auth[0].canonicalScope({identity,limits:caps,disclosure:'partition-activations-and-tokens',generationId:generation.generationId})};
const approved=await auth[0].issueCanonical(identity,caps,{approved:true,ttlMs:60000,disclosure:'partition-activations-and-tokens',generation,canonicalAttempt:scoped,vocabSize:100});
const pair=[new EventTarget(),new EventTarget()];
pair.forEach((channel,index)=>Object.assign(channel,{readyState:'open',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,bufferedAmount:0,
 send(data){queueMicrotask(()=>{if(pair[1-index].readyState==='open')pair[1-index].dispatchEvent(new MessageEvent('message',{data:structuredClone(data)}));});},
 close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));queueMicrotask(()=>pair[1-index].close());}}));
let executions=0,admissions=0,settlements=0,failCleanup=false;
const numerical=createResidentTargetState([1,2],policy,100,generation.generationId,createResidentOutputState(decoder(),decoder(),policy,100));
const supplier={id:keys[1].peerId,index:1,getCanonicalStage:()=>stages[1],getCanonicalGeneration:()=>generation,
 canAccept:()=>true,getState:()=>({ready:true,descriptor:{schema:'doppler.resident-partition/v1',ready:true,index:1,modelId:'fixture',
 modelIdentity:h,planId,layerRange:plan.partitions[1].layerRange,canonicalGenerationId:generation.generationId}}),
 reserve:binding=>({identity:binding,participantId:keys[1].peerId,index:1,phase:'reserved',resources:{attemptSlots:1}}),
 admitCanonicalPrompt:async request=>{admissions++;return runtime.admitResidentPrompt(request.tokenIds,policy,100,generation.generationId);},
 executeCanonicalGroup1:async request=>{executions++;const transition=request.step===0?numerical.bootstrap(logits):numerical.advance(request.baseCursorId,logits);
 return{identity:request.identity,step:request.step,tokenPosition:request.tokenPosition,tokenId:transition.acceptedTokenIds[0],
 delta:transition.delta,done:transition.successor.terminal,transition,commit:await authorities[1].sign({attempt:scoped,sequence:request.sequence,baseCursorId:request.baseCursorId,transition})};},
 closeAttempt:async()=>{settlements++;if(failCleanup)throw Error('fixture cleanup rejected');}};
const limits={maxFrameBytes:1024,maxControlBytes:65536,maxPayloadBytes:4096,maxPendingBytes:16384,maxPendingRequests:8,
 maxRequestsPerChannel:256,maxBufferedBytes:131072,maxTransferBytes:1048576,timeoutMs:3000};
const peers=keys.map((key,i)=>createPartitionPeer({channel:pair[i],localParticipantId:key.peerId,remoteParticipantId:keys[1-i].peerId,
 runtime,plan,planId,modelIdentity:h,authority:auth[i],contributor:i?supplier:null,limits,receiverLimits:{maxAttempts:8,maxSteps:16},canonical:true}));
try {
 assert.equal((await peers[0].refresh()).ready,true);assert.deepEqual(peers[0].getCanonicalStage(),stages[1]);
 const input={...base,canonicalAttempt:scoped,grant:approved};
 console.log('peer reserve');await peers[0].reserveCanonical(input);console.log('peer admit');await peers[0].admitCanonicalPrompt(input);assert.equal(admissions,1);
 const frame=await contract.serializeActivation({...input,activationTensor});
 console.log('peer first step');const result=await peers[0].executeCanonicalFrame({...input,frame});assert.equal(executions,1);
 assert.deepEqual(await peers[0].executeCanonicalFrame({...input,frame}),result);assert.equal(executions,1);
 const mirror=createResidentCursorMirror([1,2],policy,100,generation.generationId);
 const accepted=mirror.acceptTransition(null,result.transition);
 const aCommit=await authorities[0].sign({attempt:scoped,sequence:0,baseCursorId:null,transition:accepted});
 const actualBody={...body,attemptDigest:runtime.residentAttemptDigest(scoped),decisionId:aCommit.acknowledgment.decisionId,
 acknowledgments:[aCommit.acknowledgment,result.commit.acknowledgment]};
 const actualPublication={...actualBody,publicationDigest:runtime.metadataDigest(actualBody.schema,actualBody)};
 const actualReceiptBody={...receiptBody,publicationDigest:actualPublication.publicationDigest};
 const actualReceipt={...actualReceiptBody,receiptDigest:runtime.metadataDigest(actualReceiptBody.schema,actualReceiptBody)};
 const next={...input,sequence:1,step:1,tokenPosition:2,inputTokenCount:1,inputTokenIds:[3],baseCursor:accepted.successor,baseCursorId:accepted.successor.cursorId};
 const nextFrame=await contract.serializeActivation({...next,activationTensor:{...activationTensor,data:new Float32Array(8),shape:[1,1,8],step:1,seqOffset:2}});
 await assert.rejects(peers[0].executeCanonicalFrame({...next,frame:nextFrame}));assert.equal(executions,1,'publication acknowledgment blocks next dispatch');
 console.log('peer publication');assert.deepEqual(await peers[0].acknowledgeCanonicalPublication({...input,publication:actualPublication,receipt:actualReceipt,commits:[aCommit,result.commit]}),actualReceipt);
 await peers[0].executeCanonicalFrame({...next,frame:nextFrame});assert.equal(executions,2);
 const corrupted=structuredClone(nextFrame);new Uint8Array(corrupted.buffer)[0]=1;
 await assert.rejects(peers[0].executeCanonicalFrame({...next,frame:corrupted}));assert.equal(executions,2,'changed duplicate payload never dispatches');
 failCleanup=true;await assert.rejects(peers[1].close(),/settlement failed/);
 const failedCalls=settlements;failCleanup=false;await peers[1].close();assert(settlements>failedCalls,'explicit peer close retries failed ownership');
} catch(error) {console.log(peers[1].getState().receipt.lastFailure);throw error;} finally {await Promise.allSettled(peers.map(peer=>peer.close()));auth.forEach(a=>a.close());}
console.log('canonical peer RPC: actual grants/channel frames/stage evidence, duplicate replay and publication barrier pass');

{
 const zeroPolicy={...policy,maxGeneratedTokens:0};const zero=runtime.canonicalGenerationIdentity(zeroPolicy,h,100);
 const zeroAttempt={...attempt,generationId:zero.generationId};
 const result=runtime.admitResidentPrompt([1,2],zeroPolicy,100,zero.generationId);
 const body={schema:'doppler.admission-publication/v1',attemptId:'attempt',coordinatorEpoch:epoch,
  attemptDigest:runtime.residentAttemptDigest(zeroAttempt),sequence:0,expectedRevision:null,previousPublicationDigest:null,result};
 const publication={...body,publicationDigest:runtime.metadataDigest(body.schema,body)};
 const saved={...receiptBody,publicationDigest:publication.publicationDigest};
 const request={...base,operation:'published',phase:'published',generationId:zero.generationId,canonicalAttempt:zeroAttempt,
  grant:{claim:{...grant.claim,canonicalAttempt:zeroAttempt,generation:zero}},publication,
  receipt:{...saved,receiptDigest:runtime.metadataDigest(saved.schema,saved)},commits:[]};
 assert.equal(await contract.verifyPublication(request,result),true);
 assert.equal(await contract.verifyPublication({...request,commits:[commits[0]]},result),false,'no GPU acknowledgment for admission-only result');
}
