import { expect, it, vi } from 'vitest';
import * as legacy from 'doppler-gpu/partitions';
import fixture from '../fixtures/paired-activation-contract.json' with { type: 'json' };
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';
import { createPartitionPeer } from '../../packages/reploid/src/mesh/partitions/partition-peer.js';
import { partitionFingerprint } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';

// Frozen Doppler byte fixture, injected codecs: no inference or numerical qualification.
function setup(mutate = value => value, maxActivationBytes = 16384) {
  const original = Uint8Array.from(Buffer.from(fixture.bufferBase64, 'base64'));
  const runtime = { ...legacy,
    getPartitionActivationContract(plan) {
      expect(plan).toEqual(fixture.plan); return fixture.contract;
    },
    validateActivationFrameForPlan(frame, plan) {
      expect(plan).toEqual(fixture.plan);
      return { tensorData: new Float32Array(frame.buffer), shape: frame.shape, dtype: frame.dtype };
    },
    serializeActivationFrame(tensor) { const { data, ...header } = tensor; return { ...fixture.frame, ...header,
      buffer: data.buffer.slice(0), byteLength: data.byteLength }; }
  };
  const received = vi.fn(async request => {
    expect(new Uint8Array(request.frame.buffer)).toEqual(original);
    expect(request.frame.precision).toBe('two-f32');
    return { identity: request.identity, step: 0, tokenPosition: 0,
      tokenId: 3, delta: 'ok', done: true, stopReason: 'eos', continuation: null };
  });
  const deviceA = { id: 'a', closeAttempt: vi.fn(async () => {}), executeGroup0: async () => ({
    activationTensor: mutate({ ...fixture.frame, data: original.slice(), seqOffset: 0, step: 0 }), continuation: null
  }) };
  const deviceB = { id: 'b', closeAttempt: vi.fn(async () => {}), executeFrame: received };
  const limits = { maxTokens: 1, maxPromptTokens: 2, maxActivationBytes,
    maxOutputCharacters: 8, maxAttempts: 2, maxConcurrentAttempts: 1 };
  const execute = () => createLayerPartitionRunner({runtime,plan:fixture.plan,deviceA,deviceB,authorize:async()=>true,limits}).execute({
    tokenIds:[1,2], generation:{maxTokens:1},maxTokens:1,
    identity:{modelIdentity:'sha256:'+'a'.repeat(64),planId:fixture.planId,threadId:'thread',attemptId:'attempt'},
    grants:{executionA:{},executionB:{},activation:{},tokenContext:{},output:{}}
  });
  return {execute,received,deviceA,deviceB,runtime,original};
}
it('forwards every high/low bit with the provider-declared paired contract', async()=>{
  const f=setup(); const result=await f.execute();
  expect(result.content).toBe('ok');expect(result.execution.activationBytes).toBe(16384);
  expect(f.received).toHaveBeenCalledOnce();
  expect(f.deviceA.closeAttempt).toHaveBeenCalledOnce();expect(f.deviceB.closeAttempt).toHaveBeenCalledOnce();
});
it.each(['precision','components','elementStrideBytes'])('rejects a missing %s before remote disclosure',async key=>{
  const f=setup(value=>{delete value[key];return value;});
  await expect(f.execute()).rejects.toThrow('activation');expect(f.received).not.toHaveBeenCalled();
});
it('charges both components to the unchanged transfer allowance',async()=>{
  const f=setup(undefined,8192);await expect(f.execute()).rejects.toThrow('transfer allocation');
  expect(f.received).not.toHaveBeenCalled();
});

it.each([false,true,'scalar-fields'])('validates paired headers and preserves low bits over peer RPC (corrupt=%s)',async corrupt=>{
  const f=setup(), channels=[new EventTarget(),new EventTarget()];
  const scalar = corrupt === 'scalar-fields';
  if (scalar) f.runtime.getPartitionActivationContract = () => fixture.legacyContract;
  channels.forEach((channel,index)=>Object.assign(channel,{readyState:'open',ordered:true,
    maxRetransmits:null,maxPacketLifeTime:null,bufferedAmount:0,
    send(data){queueMicrotask(()=>channels[1-index].dispatchEvent(new MessageEvent('message',{data:structuredClone(data)})));},
    close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));}
  }));
  const identity={modelId:fixture.plan.modelId,modelIdentity:'sha256:'+'a'.repeat(64),planId:fixture.planId,
    participantA:'a',participantB:'b',threadId:'thread',attemptId:'attempt'};
  const generation={maxTokens:1}, generationDigest=await partitionFingerprint(generation);
  const grant={claim:{id:'grant',limits:{maxTokens:1,maxOutputCharacters:8}}};
  const executeGroup1=vi.fn(async request=>{
    expect(new Uint8Array(request.activation.tensorData.buffer)).toEqual(f.original);
    return {identity,step:0,tokenPosition:0,tokenId:3,delta:'ok',done:true,stopReason:'eos'};
  });
  const base={runtime:f.runtime,plan:scalar ? fixture.legacyPlan : fixture.plan,planId:fixture.planId,modelIdentity:identity.modelIdentity,
    authority:{verify:async()=>true},receiverLimits:{maxAttempts:2,maxSteps:2},
    limits:{maxFrameBytes:1024,maxControlBytes:8192,maxPayloadBytes:32768,maxPendingBytes:65536,
      maxPendingRequests:4,maxRequestsPerChannel:8,maxBufferedBytes:65536,maxTransferBytes:131072,timeoutMs:1000}};
  const a=createPartitionPeer({...base,channel:channels[0],localParticipantId:'a',remoteParticipantId:'b'});
  const b=createPartitionPeer({...base,channel:channels[1],localParticipantId:'b',remoteParticipantId:'a',
    contributor:{id:'b',index:1,canAccept:()=>true,getState:()=>({ready:true}),executeGroup1,closeAttempt:async()=>{}}});
  try{
    const frame={...fixture.frame,buffer:f.original.slice().buffer,step:0,seqOffset:0,
      metadata:{...identity,maxTokens:1,generationDigest,from:'a',to:'b'}};
    if(corrupt)frame.elementStrideBytes=4;
    if(scalar)Object.assign(frame,{schema:legacy.ACTIVATION_TENSOR_SCHEMA,precision:'f32',components:1,
      byteLength:8192,buffer:f.original.slice(0,8192).buffer});
    const response=a.executeFrame({frame,identity,step:0,tokenPosition:0,inputTokenCount:2,inputTokenIds:[1,2],
      maxTokens:1,generation,generationDigest,executionGrant:grant,outputGrant:grant});
    if(corrupt){await expect(response).rejects.toThrow();expect(executeGroup1).not.toHaveBeenCalled();}
    else{expect((await response).delta).toBe('ok');expect(executeGroup1).toHaveBeenCalledOnce();await a.closeAttempt({identity});}
  }finally{await Promise.all([a.close(),b.close()]);}
});
