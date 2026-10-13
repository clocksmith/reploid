import { describe, it, expect, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createPartitionChat } from '../../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionPeer } from '../../packages/reploid/src/mesh/partitions/partition-peer.js';
import { createPartitionEntry, createPartitionRequester } from '../../packages/reploid/src/mesh/partitions/partition-entry.js';
import { fixture as routeFixture } from '../fixtures/ordered-partition-ports.js';
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true,
    maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1-index].readyState === 'open') pair[1-index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1-index].close()); } }));
  return pair;
}
async function fixture(count = 3, peerMode = false) {
  const f = routeFixture(count), signer = await createSigningIdentity({ algorithm: 'ECDSA' });
  f.route.stages[0].participantId = signer.peerId; f.stages[0].id = signer.peerId;
  f.stages.forEach((stage, index) => Object.assign(stage, { index, getState: () => ({ ready: true }),
    subscribe: () => () => {}, refresh: vi.fn(async () => ({ ready: true })) }));
  f.stages[0].tokenize = vi.fn(async () => ({ modelIdentity: f.route.modelIdentity, tokenIds: [1,2], generation: f.request.generation }));
  const authority = createPartitionGrantAuthority({ identity: signer, meshId: 'mesh', maxGrants: 20, maxTtlMs: 10000 });
  const model = { id: 'model', name: 'Fixture', identity: f.route.modelIdentity, signedCapsule: { excluded: true } };
  const approvals = [], authorizeRequester = vi.fn(async () => true);
  const limits = { maxFrameBytes: 64, maxControlBytes: 131072, maxPayloadBytes: 4096,
    maxPendingBytes: 16384, maxPendingRequests: 8, maxRequestsPerChannel: 256, maxBufferedBytes: 262144,
    maxTransferBytes: 4194304, timeoutMs: 1000 };
  const peers = [], stageAuthorities = [], stageIdentities = [], stagePorts = [f.stages[0]];
  if (peerMode) for (let index=1;index<count;index++) {
    const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
    stageIdentities[index] = identity; f.route.stages[index].participantId = identity.peerId; f.stages[index].id = identity.peerId;
  }
  if (peerMode) for (let index=1;index<count;index++) {
    // Remote authorization verifies the coordinator's genuine signed grant;
    // stage signing identity is independent and never substitutes its claim.
    const identity = stageIdentities[index];
    const stageAuthority = createPartitionGrantAuthority({ identity, meshId: 'mesh', maxGrants: 20, maxTtlMs: 10000 });
    stageAuthorities.push(stageAuthority);
    const pair = channels(), stage = f.stages[index];
    f.plan.partitions[index].layerRange = [index*2,index*2+1];
    stage.canAccept = () => true;
    stage.getState = () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true,
      index, stageCount: count, modelId: f.route.modelId, modelIdentity: f.route.modelIdentity,
      planId: f.route.planId, layerRange: f.plan.partitions[index].layerRange } });
    const common = { runtime: f.runtime, plan: f.plan, planId: f.route.planId, modelIdentity: f.route.modelIdentity,
      limits, receiverLimits: {maxAttempts:20,maxSteps:10}, ordered: {route:f.route,partitionIndex:index} };
    const server = createPartitionPeer({ ...common, channel:pair[1], localParticipantId:stage.id,
      remoteParticipantId:signer.peerId, authority:stageAuthority, contributor:stage });
    const client = createPartitionPeer({ ...common, channel:pair[0], localParticipantId:signer.peerId,
      remoteParticipantId:stage.id, authority });
    peers.push(server,client); stagePorts.push(client);
  }
  const chat = createPartitionChat({ runtime: f.runtime, model, authority, plan: f.plan, planId: f.route.planId,
    limits: f.limits, grantTtlMs: 10000, now:()=>Date.now(), ordered: { route: f.route, stages: peerMode ? stagePorts : f.stages }, authorizeRequester });
  const pair = channels();
  const inputLimits = { maxInputCharacters: 4096, maxOutputCharacters: 100, maxAttempts: 20, maxConcurrentAttempts: 2, descriptorTtlMs: 10000 };
  const authorize = vi.fn(async (input, { action }) => { approvals.push({ input, action }); return true; });
  const server = createPartitionEntry({ channel: pair[1], localParticipantId: signer.peerId, remoteParticipantId: 'requester',
    service: chat, ordered: true, authorize, limits, inputLimits });
  const client = createPartitionEntry({ channel: pair[0], localParticipantId: 'requester', remoteParticipantId: signer.peerId,
    ordered: true, authorize, limits, inputLimits });
  await client.refresh();
  const request = { meshId: 'mesh', modelId: 'model', modelIdentity: model.identity, planId: f.route.planId,
    route: f.route, coordinatorId: signer.peerId, threadId: 'thread', attemptId: 'attempt', placementGeneration: 0,
    messages: [{ role: 'user', content: 'Hello' }] };
  return { f, chat, client, server, pair, request, authority, approvals, authorize, authorizeRequester,
    direct: { ...request, participantId: 'requester', model: chat.getModels()[0], permissions: { sharingScope: 'approved-partition-path' } },
    controls: { signal: new AbortController().signal, onState: vi.fn(), onDelta: vi.fn(), requestApproval: vi.fn(async () => true) },
    async close() { await Promise.allSettled([client.close(), server.close(), chat.close(), f.runner.close(), ...peers.map(peer=>peer.close())]); authority.close(); stageAuthorities.forEach(owner=>owner.close()); } };
}
describe('ordinary ordered chat and requester entry with genuine grants and injected numerical stages', () => {
  it.each([2,3,4,7])('streams through %i stages and preserves the complete route in compact returned evidence', async count => {
    const f = await fixture(count), deltas = [];
    try {
      const result = await f.client.generate(f.request, { onDelta: text => deltas.push(text) });
      expect(result.content).toBe('012'); expect(deltas).toEqual(['0','1','2']);
      expect(result.execution.schema).toBe('reploid.mesh.partition-summary/v2');
      expect(result.execution.identity.route).toEqual(f.f.route);
      expect(result.execution.stepSummary.stages).toEqual(Array.from({ length: count }, (_, partitionIndex) => ({ partitionIndex, steps: 3, stepMs: {count:3,total:expect.any(Number)} })));
      expect(result.execution.stepSummary.stages.every(stage=>Number.isFinite(stage.stepMs.total) && stage.stepMs.total>=0)).toBe(true);
      expect(f.chat.getModels()[0]).not.toHaveProperty('signedCapsule');
      expect(f.f.stages.every(stage => stage.closeAttempt.mock.calls.length === 1)).toBe(true);
      expect(f.chat.getState().unsettled).toBe(0);
      const followup = { ...f.request, attemptId: 'followup', messages: [...f.request.messages,
        { role: 'assistant', content: result.content }, { role: 'user', content: 'Continue' }] };
      await f.client.generate(followup);
      expect(f.f.stages[0].tokenize.mock.calls[1][0].messages).toEqual(followup.messages);
    } finally { await f.close(); }
  });
  it.each(['eos-token', 'max-tokens', 'stop-sequence', 'context-limit'])('preserves runtime ending %s through ordered chat and requester summary', async reason => {
    const f = await fixture(3, true);
    const last = f.f.stages.at(-1), execute = last.executeStage.getMockImplementation();
    last.executeStage.mockImplementation(async request => {
      const result = await execute(request);
      return result.done ? { ...result, stopReason: reason } : result;
    });
    try {
      const result = await f.client.generate(f.request, f.controls);
      expect(result.execution.stopReason).toBe(reason);
      expect(result.content).toBe('012');
      expect(result.execution.settlement.phase).toBe('completed');
    } finally { await f.close(); }
  });

  it('connects requester entry through real v4 grants, a remote middle activation and final peer response', async () => {
    const f = await fixture(3, true), deltas = [];
    try {
      const result = await f.client.generate(f.request, {onDelta:text=>deltas.push(text)});
      expect(deltas).toEqual(['0','1','2']); expect(result.content).toBe('012');
      expect(result.execution.identity.route).toEqual(f.f.route);
      expect(f.f.stages.every(stage=>stage.executeStage.mock.calls.length === 3 && stage.closeAttempt.mock.calls.length === 1)).toBe(true);
    } finally { await f.close(); }
  });
  it('approves every token recipient and all coordinator-mediated activation paths before tokenization', async () => {
    const f = await fixture();
    try {
      await f.chat.generate(f.direct, f.controls);
      const approval = f.controls.requestApproval.mock.calls[0][0];
      expect(approval.disclosure.tokenRecipients).toEqual(f.f.stages.map(stage => stage.id));
      expect(approval.disclosure.activationPaths[1]).toEqual([f.f.stages[1].id, f.f.stages[0].id, f.f.stages[2].id]);
      expect(approval.disclosure.outputRecipients).toEqual([f.f.stages[2].id, f.f.stages[0].id, 'requester']);
      expect(f.controls.requestApproval.mock.invocationCallOrder[0]).toBeLessThan(f.f.stages[0].tokenize.mock.invocationCallOrder[0]);
    } finally { await f.close(); }
  });
  it('rejects a changed middle replica before tokenizer or numerical admission', async () => {
    const f = await fixture();
    try {
      const request = structuredClone(f.request); request.route.stages[1].residentId = 'replacement';
      await expect(f.client.generate(request)).rejects.toThrow();
      expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();
      expect(f.f.stages.every(stage => stage.reserve.mock.calls.length === 0)).toBe(true);
    } finally { await f.close(); }
  });
  it('rejects tampered ordered stream identities and does not project their text', async () => {
    const f = await fixture(), deltas = [], send = f.pair[1].send;
    try {
      f.pair[1].send = function(data) {
        if (typeof data === 'string') { const value = JSON.parse(data);
          if (value.type === 'request' && value.metadata?.operation === 'delta') {
            value.metadata.identity.route.stages[1].executionId = 'other'; data = JSON.stringify(value);
          } }
        send.call(this, data);
      };
      await expect(f.client.generate(f.request, { onDelta: text => deltas.push(text) })).rejects.toThrow();
      expect(deltas).toEqual([]);
    } finally { await f.close(); }
  });
  it('rejects a final acknowledgment with another route even when its text matches', async () => {
    const f = await fixture(), send = f.pair[1].send;
    try {
      f.pair[1].send = function(data) {
        if (typeof data === 'string') { const value = JSON.parse(data);
          if (value.type === 'result' && value.result?.execution?.identity) {
            value.result.execution.identity.route.stages[1].residentId = 'other'; data = JSON.stringify(value);
          } }
        send.call(this, data);
      };
      await expect(f.client.generate(f.request)).rejects.toThrow('identity mismatch');
    } finally { await f.close(); }
  });
  it('rejects text invented in the final acknowledgment after a valid stream', async () => {
    const f = await fixture(), send = f.pair[1].send, deltas = [];
    try {
      f.pair[1].send = function(data) {
        if (typeof data === 'string') { const value = JSON.parse(data);
          if (value.type === 'result' && value.result?.execution?.identity) {
            value.result.content = 'invented'; data = JSON.stringify(value);
          } }
        send.call(this, data);
      };
      await expect(f.client.generate(f.request, {onDelta:text=>deltas.push(text)})).rejects.toThrow('delivered text');
      expect(deltas).toEqual(['0','1','2']);
    } finally { await f.close(); }
  });
  it('does not repeat runner-owned failed cleanup in the chat finally block', async () => {
    const f = await fixture();
    try {
      f.f.stages[0].closeAttempt.mockRejectedValueOnce(Error('unknown runner cleanup'));
      await expect(f.chat.generate(f.direct, f.controls)).rejects.toThrow('cleanup');
      expect(f.chat.getState().unsettled).toBe(1); expect(f.chat.getState().unsettledInputs).toBe(0);
      expect(f.f.stages[0].closeAttempt).toHaveBeenCalledTimes(1);
      await f.chat.close(); expect(f.f.stages[0].closeAttempt).toHaveBeenCalledTimes(2);
      expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  });
  it('refuses an unsupported provider plan hash before advertising or tokenizing', async () => {
    const f = await fixture();
    let invalid;
    try {
      invalid = createPartitionChat({ runtime: {...f.f.runtime, hashLayerPartitionPlan:async()=> 'sha256:'+'0'.repeat(64)},
        model:f.direct.model, authority:f.authority, plan:f.f.plan, planId:f.f.route.planId, limits:f.f.limits,
        grantTtlMs:10000, ordered:{route:f.f.route,stages:f.f.stages} });
      await expect(invalid.refresh()).rejects.toThrow();
      expect(invalid.getModels()[0].availability).toBe('unavailable');
      expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();
    } finally { await invalid?.close(); await f.close(); }
  });
  it('the public ordered requester helper uses the actual entry path without A/B projection', async () => {
    const f = await fixture(3, true), approvals = [], deltas = [];
    try {
      const requester = createPartitionRequester({ entries:()=>[f.client], requesterId:'requester', meshId:'mesh',
        modelId:'model', modelIdentity:f.f.route.modelIdentity, planId:f.f.route.planId, maxPlacements:1,
        ordered:true, authorize:async placement=>{approvals.push(placement);return true;},newId:()=> 'public-requester'});
      const result = await requester.generate({messages:f.request.messages,threadId:'thread'},{onDelta:delta=>deltas.push(delta)});
      expect(deltas.map(delta=>delta.text)).toEqual(['0','1','2']);
      expect(deltas.every(delta=>delta.attemptId==='public-requester' && delta.placementGeneration===0)).toBe(true);
      expect(result.content).toBe('012'); expect(result.execution.identity.route).toEqual(f.f.route);
      expect(approvals[0].route).toEqual(f.f.route); expect(approvals[0]).not.toHaveProperty('participantA');
      expect(approvals[0]).not.toHaveProperty('participantB');
    } finally { await f.close(); }
  });
  it('ordered requester retry preserves reviewed routes and uses a new full attempt after failure', async () => {
    const f = await fixture(), first = structuredClone(f.f.route), second = structuredClone(f.f.route), calls = [], reviewed = [];
    first.stages[0].participantId = 'first-coordinator'; second.stages[0].participantId = 'second-coordinator';
    second.stages[1].residentId = 'replacement-middle'; let next = 0;
    const entries = [first,second].map((route,index)=>({ id:route.stages[0].participantId,
      refresh:async()=>({ready:true,descriptor:{models:[{id:'model',identity:route.modelIdentity,availability:'ready',
        partition:{schema:'reploid.partition-selection/v2',planId:route.planId,coordinatorId:route.stages[0].participantId,route}}]}}),
      generate:async request=>{calls.push(structuredClone(request)); if(index===0)throw Error('first failed');return {content:'ok',execution:{}};} }));
    try {
      const requester = createPartitionRequester({entries:()=>entries,requesterId:'requester',meshId:'mesh',modelId:'model',
        modelIdentity:first.modelIdentity,planId:first.planId,maxPlacements:2,ordered:true,newId:()=> 'retry-'+next++,
        onAttempt:attempt=>{if(attempt.route)attempt.route.stages[1].residentId='observer-mutation';},
        authorize:async placement=>{reviewed.push(structuredClone(placement));placement.route.stages[1].residentId='mutated-callback';return true;}});
      const result = await requester.generate({messages:f.request.messages,threadId:'thread'});
      expect(result.recovery.attempts).toBe(2);
      expect(calls.map(call=>call.route)).toEqual(reviewed.map(value=>value.route));
      expect(calls.map(call=>call.attemptId)).toEqual(['retry-0','retry-1']);
      expect(calls.map(call=>call.placementGeneration)).toEqual([0,1]);
      expect(calls[1].route.stages[1].residentId).toBe('replacement-middle');
    } finally { await f.close(); }
  });
  it('snapshots requester messages before asynchronous placement approval', async () => {
    const f = await fixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
    try {
      const messages = structuredClone(f.request.messages);
      const requester = createPartitionRequester({entries:()=>[f.client],requesterId:'requester',meshId:'mesh',modelId:'model',
        modelIdentity:f.f.route.modelIdentity,planId:f.f.route.planId,maxPlacements:1,ordered:true,
        authorize:async()=>{entered.resolve();return release.promise;},newId:()=> 'immutable-input'});
      const pending = requester.generate({messages,threadId:'thread'}); await entered.promise;
      messages[0].content='changed after handoff'; release.resolve(true); await pending;
      expect(f.f.stages[0].tokenize.mock.calls[0][0].messages).toEqual(f.request.messages);
    } finally { release.resolve(true); await f.close(); }
  });
  it('does not silently renew disclosure after a delayed approval', async () => {
    const f = await fixture(); let clock;
    try {
      f.controls.requestApproval.mockImplementation(async () => {
        const later = Date.now() + 10001; clock = vi.spyOn(Date, 'now').mockReturnValue(later); return true;
      });
      await expect(f.chat.generate(f.direct, f.controls)).rejects.toThrow('expired');
      expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();
    } finally { clock?.mockRestore(); await f.close(); }
  });
  it('carries the requester deadline through entry and caps every signed stage grant to it', async () => {
    const f = await fixture(3,true), disclosureExpiresAt = Date.now()+3000;
    try {
      const requester = createPartitionRequester({entries:()=>[f.client],requesterId:'requester',meshId:'mesh',modelId:'model',
        modelIdentity:f.f.route.modelIdentity,planId:f.f.route.planId,maxPlacements:1,ordered:true,authorize:async()=>true,newId:()=> 'deadline'});
      const result = await requester.generate({messages:f.request.messages,threadId:'thread',disclosureExpiresAt});
      expect(result.content).toBe('012');
      expect(f.approvals.filter(row=>row.action==='execute').every(row=>row.input.disclosureExpiresAt===disclosureExpiresAt)).toBe(true);
      for(const stage of f.f.stages) for(const [request] of stage.executeStage.mock.calls) {
        expect(request.executionGrant.claim.expiresAt).toBeLessThanOrEqual(disclosureExpiresAt);
        expect(request.executionGrant.claim.expiresAt).toBeGreaterThan(request.executionGrant.claim.issuedAt);
      }
    } finally {await f.close();}
  });
  it('rejects an expired requester deadline before entry admission and tokenization',async()=>{
    const f=await fixture();
    try{await expect(f.client.generate({...f.request,disclosureExpiresAt:Date.now()-1})).rejects.toThrow('Invalid');
      expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();
      await expect(f.chat.generate({...f.direct,disclosureExpiresAt:Date.now()-1},f.controls)).rejects.toThrow('expired');
      expect(f.controls.requestApproval).not.toHaveBeenCalled();
    }finally{await f.close();}
  });
  it('does not replace an expired remote approval with the coordinators longer local lifetime',async()=>{
    const f=await fixture();let clock;
    try{
      const start=Date.now();f.controls.requestApproval.mockImplementation(async()=>{clock=vi.spyOn(Date,'now').mockReturnValue(start+1001);return true;});
      await expect(f.chat.generate({...f.direct,disclosureExpiresAt:start+1000},f.controls)).rejects.toThrow('expired');
      expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();
    }finally{clock?.mockRestore();await f.close();}
  });
  it('does not silently enable canonical publication or disclose before approval', async () => {
    const f = await fixture();
    try {
      await expect(f.client.generate({ ...f.request, canonical: {} })).rejects.toThrow('capability');
      f.controls.requestApproval.mockResolvedValue(false);
      await expect(f.chat.generate(f.direct, f.controls)).rejects.toThrow('declined');
      expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
  it('retains failed tokenizer cleanup and retries it when the chat owner closes', async () => {
    const f = await fixture();
    try {
      f.f.stages[0].tokenize.mockRejectedValue(Error('tokenizer failed'));
      f.f.stages[0].closeAttempt.mockRejectedValueOnce(Error('cleanup unknown'));
      await expect(f.chat.generate(f.direct, f.controls)).rejects.toThrow('opening cleanup');
      expect(f.chat.getState().unsettledInputs).toBe(1);
      await f.chat.close(); expect(f.chat.getState().unsettledInputs).toBe(0);
      expect(f.f.stages[0].closeAttempt).toHaveBeenCalledTimes(2);
    } finally { await f.close(); }
  });
  it('close aborts a pending approval, prevents dispatch and preserves borrowed residents', async () => {
    const f = await fixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
    try {
      f.controls.requestApproval.mockImplementation(async () => { entered.resolve(); return release.promise; });
      const operation = f.chat.generate(f.direct, f.controls), failed = expect(operation).rejects.toThrow();
      await entered.promise; const close = f.chat.close(); release.resolve(true); await failed; await close;
      expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();
      expect(f.f.stages.every(stage => stage.closeAttempt.mock.calls.length === 0)).toBe(true);
    } finally { release.resolve(true); await f.close(); }
  });
});

const callerGeneration = maxOutputTokens => ({schema:'reploid.partition-generation-request/v1',maxOutputTokens,usage:'raw-model-tokens/v1'});
it('binds caller output ceiling before genuine stage grants and returns actual raw token counts before text', async()=>{
  const f=await fixture(3,true),last=f.f.stages.at(-1),execute=last.executeStage.getMockImplementation(),events=[];
  last.executeStage.mockImplementation(async request=>{const output=await execute(request);return {...output,done:request.step+1===request.maxTokens,stopReason:'max-tokens'};});
  try{
    const result=await f.client.generate({...f.request,generationRequest:callerGeneration(2)}, {onUsage:usage=>events.push({usage}),onDelta:text=>events.push({text})});
    expect(events).toEqual([{usage:{schema:'raw-model-tokens/v1',inputTokens:2,outputTokens:0}},{text:'0'},{text:'1'}]);
    expect(result.usage).toEqual({schema:'raw-model-tokens/v1',inputTokens:2,outputTokens:2});
    expect(result.execution.stopReason).toBe('max-tokens');
    for(const stage of f.f.stages){expect(stage.executeStage).toHaveBeenCalledTimes(2);for(const [call]of stage.executeStage.mock.calls){expect(call.generation.maxTokens).toBe(2);expect(call.maxTokens).toBe(2);expect(call.executionGrant.claim.generationDigest).toBe(await f.f.runtime.hashPartitionGeneration(call.generation));}}
  }finally{await f.close();}
});
it('counts a sampled stop token even when its decoded visible output is empty',async()=>{
  const f=await fixture(3,true),last=f.f.stages.at(-1),execute=last.executeStage.getMockImplementation();
  last.executeStage.mockImplementation(async request=>({...await execute(request),delta:'',done:true,stopReason:'stop-token'}));
  try{const result=await f.client.generate({...f.request,generationRequest:callerGeneration(1)});expect(result.content).toBe('');expect(result.usage).toEqual({schema:'raw-model-tokens/v1',inputTokens:2,outputTokens:1});}finally{await f.close();}
});
it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1,11])('rejects malformed/over-budget caller ceiling %s before tokenization or stages',async cap=>{
  const f=await fixture();try{await expect(f.client.generate({...f.request,generationRequest:callerGeneration(cap)})).rejects.toThrow();expect(f.f.stages[0].tokenize).not.toHaveBeenCalled();expect(f.f.stages.every(stage=>stage.executeStage.mock.calls.length===0)).toBe(true);}finally{await f.close();}
});
it('caller mutation during approval cannot raise the cap, and allocation overflow rejects before numerical dispatch',async()=>{
  const f=await fixture(),entered=Promise.withResolvers(),release=Promise.withResolvers();const request={...f.direct,generationRequest:callerGeneration(2)};
  const last=f.f.stages.at(-1),execute=last.executeStage.getMockImplementation();last.executeStage.mockImplementation(async r=>({...await execute(r),done:r.step+1===r.maxTokens,stopReason:'max-tokens'}));
  try{const operation=f.chat.generate(request,{...f.controls,requestApproval:async preview=>{expect(preview.input.generationRequest.maxOutputTokens).toBe(2);entered.resolve();await release.promise;return true;}});await entered.promise;request.generationRequest.maxOutputTokens=9;release.resolve();expect((await operation).usage.outputTokens).toBe(2);
    await expect(f.chat.generate({...f.direct,attemptId:'overflow',generationRequest:callerGeneration(4)},f.controls)).rejects.toThrow('prepared generation allocation');expect(last.executeStage).toHaveBeenCalledTimes(2);
  }finally{release.resolve();await f.close();}
});
it.each(['cap','counts','attempt'])('rejects untrusted usage %s before numerical dispatch',async mutation=>{
  const f=await fixture(),send=f.pair[1].send;try{
    f.pair[1].send=function(data){if(typeof data==='string'){const value=JSON.parse(data);if(value.metadata?.operation==='usage'){
      if(mutation==='cap')value.metadata.generationRequest.maxOutputTokens++;
      if(mutation==='counts')value.metadata.usage.outputTokens=1;
      if(mutation==='attempt')value.metadata.attemptId='other';
      return send.call(this,JSON.stringify(value));
    }}return send.call(this,data);};
    await expect(f.client.generate({...f.request,generationRequest:callerGeneration(3)})).rejects.toThrow();expect(f.f.stages.every(stage=>stage.executeStage.mock.calls.length===0)).toBe(true);
  }finally{await f.close();}
});
it('cancellation while input usage is observed settles tokenizer state without sampling',async()=>{
  const f=await fixture(),controller=new AbortController();try{
    await expect(f.chat.generate({...f.direct,generationRequest:callerGeneration(2)},{...f.controls,signal:controller.signal,onUsage(){controller.abort(Error('caller stopped'));}})).rejects.toThrow();
    expect(f.f.stages.every(stage=>stage.executeStage.mock.calls.length===0)).toBe(true);expect(f.f.stages[0].closeAttempt).toHaveBeenCalled();expect(f.chat.getState().unsettledInputs).toBe(0);
  }finally{await f.close();}
});
it.each(['onUsage','onDelta'])('does not splice a fresh retry after %s is published',async callback=>{
  const f=await fixture();let replacementCalls=0;const rows=[];
  const first={id:f.client.id,refresh:()=>f.client.refresh(),generate:async(_request,controls)=>{await controls[callback](callback==='onUsage'?{schema:'raw-model-tokens/v1',inputTokens:2,outputTokens:0}:'partial');throw Error('first failed');}};
  const second={...first,id:'replacement',generate:async()=>{replacementCalls++;return {content:'incorrect retry'};}};
  try{const requester=createPartitionRequester({entries:()=>[first,second],requesterId:'requester',meshId:'mesh',modelId:'model',modelIdentity:f.request.modelIdentity,planId:f.request.planId,maxPlacements:2,ordered:true,authorize:async()=>true});
    await expect(requester.generate({threadId:'retry',messages:f.request.messages,generationRequest:callerGeneration(2)},{onUsage:value=>rows.push(value),onDelta:value=>rows.push(value)})).rejects.toThrow('first failed');expect(rows).toHaveLength(1);expect(replacementCalls).toBe(0);
  }finally{await f.close();}
});
it('rejects a second semantic usage event before sampling',async()=>{
  const f=await fixture(),generate=f.chat.generate;
  const service={...f.chat,generate:async(request,controls)=>generate(request,{...controls,onUsage:async usage=>{await controls.onUsage(usage);await controls.onUsage(usage);}})};
  // Replace the already-borrowed method through a new entry owner, never forge settlement.
  await f.client.close();await f.server.close();const pair=channels();
  const limits={maxFrameBytes:64,maxControlBytes:131072,maxPayloadBytes:4096,maxPendingBytes:16384,maxPendingRequests:8,maxRequestsPerChannel:256,maxBufferedBytes:262144,maxTransferBytes:4194304,timeoutMs:1000};
  const inputLimits={maxInputCharacters:4096,maxOutputCharacters:100,maxAttempts:20,maxConcurrentAttempts:2,descriptorTtlMs:10000};
  const server=createPartitionEntry({channel:pair[1],localParticipantId:f.client.id,remoteParticipantId:'requester',service,ordered:true,authorize:async()=>true,limits,inputLimits});
  const client=createPartitionEntry({channel:pair[0],localParticipantId:'requester',remoteParticipantId:f.client.id,ordered:true,authorize:async()=>true,limits,inputLimits});
  try{await client.refresh();await expect(client.generate({...f.request,generationRequest:callerGeneration(2)})).rejects.toThrow();expect(f.f.stages.every(stage=>stage.executeStage.mock.calls.length===0)).toBe(true);}finally{await client.close();await server.close();await f.close();}
});
it.each(['output','input','schema'])('rejects final %s usage changed in a bound response',async field=>{
  const f=await fixture(),send=f.pair[1].send;
  try{f.pair[1].send=function(data){if(typeof data==='string'){const value=JSON.parse(data);if(value.result?.usage){if(field==='output')value.result.usage.outputTokens=0;if(field==='input')value.result.usage.inputTokens++;if(field==='schema')value.result.usage.schema='visible-text/v1';return send.call(this,JSON.stringify(value));}}return send.call(this,data);};
    await expect(f.client.generate({...f.request,generationRequest:callerGeneration(3)})).rejects.toThrow('usage');
  }finally{await f.close();}
});
