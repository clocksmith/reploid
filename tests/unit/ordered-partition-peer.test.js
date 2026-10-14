import { describe, it, expect } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority, orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createPartitionPeer } from '../../packages/reploid/src/mesh/partitions/partition-peer.js';
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';
import { fixture as routeFixture } from '../fixtures/ordered-partition-ports.js';
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true,
    maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1-index].readyState === 'open') pair[1-index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1-index].close()); } }));
  return pair;
}
async function fixture() {
  const f = routeFixture(3), identities = await Promise.all([0,1,2].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
  for (let index=0;index<3;index++) { f.route.stages[index].participantId = identities[index].peerId;
    f.stages[index].id = identities[index].peerId; f.plan.partitions[index].layerRange = [index*2,index*2+1]; }
  const authorities = identities.map(identity => createPartitionGrantAuthority({ identity, meshId: 'mesh', maxGrants: 10, maxTtlMs: 10000 }));
  const limits = { maxFrameBytes: 64, maxControlBytes: 131072, maxPayloadBytes: 4096, maxPendingBytes: 16384,
    maxPendingRequests: 8, maxRequestsPerChannel: 256, maxBufferedBytes: 262144, maxTransferBytes: 4194304, timeoutMs: 1000 };
  const peers = [], pairs = [];
  for (let index=1;index<3;index++) {
    const pair = channels(), contributor = Object.assign(f.stages[index], { index, canAccept: () => true,
      getState: () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true, index, stageCount: 3,
        modelId: f.route.modelId, modelIdentity: f.route.modelIdentity, planId: f.route.planId, layerRange: f.plan.partitions[index].layerRange } }) });
    const common = { runtime: f.runtime, plan: f.plan, planId: f.route.planId, modelIdentity: f.route.modelIdentity,
      limits, receiverLimits: { maxAttempts: 10, maxSteps: 10 }, ordered: { route: f.route, partitionIndex: index } };
    const server = createPartitionPeer({ ...common, channel: pair[1], localParticipantId: identities[index].peerId,
      remoteParticipantId: identities[0].peerId, authority: authorities[index], contributor });
    const client = createPartitionPeer({ ...common, channel: pair[0], localParticipantId: identities[0].peerId,
      remoteParticipantId: identities[index].peerId, authority: authorities[0] });
    await client.refresh(); peers.push({ server, client }); pairs.push(pair);
  }
  const grant = await authorities[0].issueOrdered(f.request.identity, f.limits, { approved: true, ttlMs: 10000,
    generationDigest: await f.runtime.hashPartitionGeneration(f.request.generation), disclosure: orderedPartitionDisclosure(f.request.identity) });
  const runner = createLayerPartitionRunner({ ...f, stages: [f.stages[0], ...peers.map(p => p.client)],
    authorize: request => authorities[0].verify(request.grant, request) });
  const request = { ...f.request, grants: { execution: Array(3).fill(grant), tokenContext: Array(3).fill(grant), activation: Array(2).fill(grant), output: grant } };
  return { f, peers, pairs, authorities, runner, request, grant, async close() { await Promise.allSettled([runner.close(), ...peers.flatMap(p=>[p.client.close(),p.server.close()])]); authorities.forEach(a=>a.close()); } };
}
describe('ordered authenticated peer (in-process channels, injected computation)', () => {
  it('traverses a remote middle activation and final token via bounded duplex binary requests under genuine grants', async () => {
    const f = await fixture();
    try {
      const result = await f.runner.execute(f.request);
      expect(result.content).toBe('012'); expect(f.f.stages[1].executeStage).toHaveBeenCalledTimes(3);
      expect(f.f.stages[2].executeStage).toHaveBeenCalledTimes(3);
      expect(f.peers.every(p=>p.client.getState().unsettled === 0 && p.server.getState().unsettled === 0)).toBe(true);
      expect(f.peers[0].server.getState().receipt.completedRequests).toBeGreaterThan(0);
    } finally { await f.close(); }
  });
});

async function directStep(f, signal) {
  const runtime = f.f.runtime, generationDigest = await runtime.hashPartitionGeneration(f.request.generation);
  const request = { identity: f.request.identity, partitionIndex: 1, generation: f.request.generation, generationDigest,
    inputTokenCount: 2, maxTokens: 3, executionGrant: f.grant };
  await f.peers[0].client.reserve(request);
  const frame = runtime.serializeActivationFrame({ shape: [1,2,8], dtype: 'f32', data: new Float32Array(16), step: 0, seqOffset: 0 });
  return { ...request, step: 0, tokenPosition: 0, inputTokenIds: [1,2], activation: runtime.deserializeActivationFrame(frame),
    tokenContextGrant: f.grant, incomingActivationGrant: f.grant, outgoingActivationGrant: f.grant, signal };
}
it('replays an identical output without recomputation and rejects different activation bytes', async () => {
  const f = await fixture();
  try {
    const request = await directStep(f), a = await f.peers[0].client.executeStage(request), b = await f.peers[0].client.executeStage(request);
    expect(a.activationTensor).toEqual(b.activationTensor); expect(f.f.stages[1].executeStage).toHaveBeenCalledTimes(1);
    request.activation.tensorData[0] = 99;
    await expect(f.peers[0].client.executeStage(request)).rejects.toThrow();
    expect(f.f.stages[1].executeStage).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
});
it('rejects a changed message version before remote execution', async () => {
  const f = await fixture();
  try {
    const request = await directStep(f), channel = f.pairs[0][0], send = channel.send;
    channel.send = function(data) { if (typeof data === 'string') { const value = JSON.parse(data);
      if (value.type === 'request' && value.metadata?.operation === 'step') { value.metadata.schema = 'unknown'; data = JSON.stringify(value); } }
      return send.call(this, data); };
    await expect(f.peers[0].client.executeStage(request)).rejects.toThrow();
    expect(f.f.stages[1].executeStage).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
it('rejects reverse binary corruption instead of returning a fabricated activation', async () => {
  const f = await fixture();
  try {
    const request = await directStep(f), channel = f.pairs[0][1], send = channel.send;
    channel.send = function(data) { if (data instanceof ArrayBuffer) { data = data.slice(0); const bytes = new Uint8Array(data); bytes[bytes.length-1] ^= 1; }
      return send.call(this, data); };
    await expect(f.peers[0].client.executeStage(request)).rejects.toThrow();
    expect(f.f.stages[1].executeStage).toHaveBeenCalledTimes(1);
    expect(f.peers[0].client.getState().unsettled).toBe(1);
  } finally { await f.close(); }
});
it('cancels after reverse output and before final acknowledgment without rerunning computation', async () => {
  const f = await fixture(), controller = new AbortController();
  try {
    const request = await directStep(f, controller.signal), channel = f.pairs[0][0], send = channel.send;
    let cancelled = false;
    channel.send = function(data) { if (typeof data === 'string') { const value = JSON.parse(data);
      if (value.type === 'result' && value.result?.outputDigest) { cancelled = true; controller.abort(Error('cancel after binary')); } }
      return send.call(this, data); };
    await expect(f.peers[0].client.executeStage(request)).rejects.toThrow();
    expect(cancelled).toBe(true); expect(f.f.stages[1].executeStage).toHaveBeenCalledTimes(1);
    await f.peers[0].client.closeAttempt({ identity: f.request.identity });
    expect(f.peers[0].client.getState().unsettled).toBe(0);
  } finally { await f.close(); }
});
it('retains unknown ownership after channel loss and rejects stale cleanup identities', async () => {
  const f = await fixture();
  try {
    await directStep(f);
    const changed = structuredClone(f.request.identity); changed.route.stages[1].residentId = 'other';
    await expect(f.peers[0].client.closeAttempt({ identity: changed })).rejects.toThrow('identity collision');
    f.pairs[0][0].close();
    await expect(f.peers[0].client.closeAttempt({ identity: f.request.identity })).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    expect(f.peers[0].client.getState().unsettled).toBe(1);
    // Closing the dead port completes; it can never confirm, so the owner stays counted.
    await f.peers[0].client.close();
    expect(f.peers[0].client.getState()).toMatchObject({ ready: false, unsettled: 1 });
  } finally { await f.close(); }
});
it('does not advertise a descriptor without actual stage capability', async () => {
  const f = await fixture();
  try {
    delete f.f.stages[1].executeStage;
    expect((await f.peers[0].client.refresh()).ready).toBe(false);
  } finally { await f.close(); }
});
it('retries explicit failed remote cleanup without clearing debt or recomputing', async () => {
  const f = await fixture();
  try {
    const request = await directStep(f); await f.peers[0].client.executeStage(request);
    f.f.stages[1].closeAttempt.mockRejectedValue(Error('cleanup unsettled'));
    await expect(f.peers[0].client.closeAttempt({ identity: f.request.identity })).rejects.toThrow();
    expect(f.peers[0].client.getState().unsettled).toBe(1);
    expect(f.peers[0].server.getState().unsettled).toBe(1);
    f.f.stages[1].closeAttempt.mockResolvedValue();
    await f.peers[0].client.closeAttempt({ identity: f.request.identity });
    expect(f.peers[0].client.getState()).toMatchObject({ unsettled: 0, retainedOutputBytes: 0 });
    expect(f.peers[0].server.getState().unsettled).toBe(0);
    expect(f.f.stages[1].executeStage).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
});
it('a cancelled blocked middle stage preserves an unrelated remote conversation', async () => {
  const f = await fixture(), controller = new AbortController();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  try {
    const run = f.f.stages[1].executeStage.getMockImplementation();
    f.f.stages[1].executeStage.mockImplementation(async request => {
      if (request.identity.attemptId === 'attempt') { entered.resolve(); await release.promise; }
      return run(request);
    });
    const pending = f.runner.execute({ ...f.request, signal: controller.signal });
    const failed = expect(pending).rejects.toThrow(); await entered.promise;
    const identity = { ...f.request.identity, attemptId: 'survivor', threadId: 'survivor' };
    const grant = await f.authorities[0].issueOrdered(identity, f.f.limits, { approved: true, ttlMs: 10000,
      generationDigest: await f.f.runtime.hashPartitionGeneration(f.request.generation), disclosure: orderedPartitionDisclosure(identity) });
    const survivor = f.runner.execute({ ...f.request, identity, grants: { execution: Array(3).fill(grant), tokenContext: Array(3).fill(grant), activation: Array(2).fill(grant), output: grant } });
    controller.abort(Error('cancel selected')); release.resolve(); await failed;
    expect((await survivor).content).toBe('012');
    expect(f.peers.every(peer => peer.client.getState().unsettled === 0)).toBe(true);
  } finally { release.resolve(); await f.close(); }
});
it('rejects a reservation whose generation length exceeds its signed admission bound', async () => {
  const f = await fixture();
  try {
    await expect(f.peers[0].client.reserve({ identity: f.request.identity, partitionIndex: 1,
      generation: f.request.generation, generationDigest: await f.f.runtime.hashPartitionGeneration(f.request.generation),
      inputTokenCount: 2, maxTokens: 100, executionGrant: f.grant })).rejects.toThrow();
    expect(f.f.stages[1].reserve).not.toHaveBeenCalled();
    expect(f.f.stages[1].executeStage).not.toHaveBeenCalled();
    expect(f.peers[0].client.getState().unsettled).toBe(1);
    await f.peers[0].client.closeAttempt({ identity: f.request.identity });
    expect(f.peers[0].client.getState().unsettled).toBe(0);
  } finally { await f.close(); }
});
it('waits for pending execution before invoking its one resident cleanup owner', async () => {
  const f = await fixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
  try {
    const request = await directStep(f), execute = f.f.stages[1].executeStage.getMockImplementation();
    f.f.stages[1].executeStage.mockImplementation(async input => { entered.resolve(); await release.promise; return execute(input); });
    const pending = f.peers[0].client.executeStage(request); const failure = expect(pending).rejects.toThrow();
    await entered.promise;
    const cleanup = f.peers[0].client.closeAttempt({ identity: request.identity });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.f.stages[1].closeAttempt).not.toHaveBeenCalled();
    release.resolve(); await failure; await cleanup;
    expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
  } finally { release.resolve(); await f.close(); }
});
it('duplicate settlement shares one cleanup and a late reservation cannot reopen the retired attempt', async () => {
  const f = await fixture();
  try {
    const request = await directStep(f);
    await Promise.all([f.peers[0].client.closeAttempt({ identity: request.identity }), f.peers[0].client.closeAttempt({ identity: request.identity })]);
    expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
    await expect(f.peers[0].client.reserve(request)).rejects.toThrow();
    await f.peers[0].client.closeAttempt({ identity: request.identity });
    expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
    expect(f.peers[0].server.getState().unsettled).toBe(0);
  } finally { await f.close(); }
});
it('graceful serving retirement confirms exact remote settlement before channel closure', async () => {
  const f = await fixture();
  try {
    const request = await directStep(f);
    await f.peers[0].server.close();
    expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
    expect(f.peers[0].client.getState().unsettled).toBe(0);
    await f.peers[0].client.closeAttempt({identity:request.identity});
    await f.peers[0].client.close();
    expect(f.peers[1].client.getState().ready).toBe(true);
  } finally { await f.close(); }
});
it('failed serving retirement keeps its channel and cleanup debt for explicit retry', async () => {
  const f = await fixture();
  try {
    await directStep(f); f.f.stages[1].closeAttempt.mockRejectedValueOnce(Error('unknown cleanup'));
    await expect(f.peers[0].server.close()).rejects.toThrow();
    expect(f.pairs[0][1].readyState).toBe('open');
    expect(f.peers[0].server.getState().unsettled).toBe(1);
    expect(f.peers[0].client.getState().unsettled).toBe(1);
    await f.peers[0].server.close();
    expect(f.peers[0].client.getState().unsettled).toBe(0);
  } finally { await f.close(); }
});
it.each(['attempt', 'generation', 'signature'])('rejects changed %s retirement evidence and retains ownership', async kind => {
  const f = await fixture();
  try {
    await directStep(f); const channel=f.pairs[0][1], send=channel.send;
    channel.send=function(data) {
      if(typeof data==='string') { const value=JSON.parse(data);
        if(value.type==='request' && value.metadata?.operation==='retired') {
          if(kind==='attempt') value.metadata.identity.attemptId='unrelated';
          if(kind==='generation') value.metadata.generationDigest='sha256:'+'0'.repeat(64);
          if(kind==='signature') value.metadata.executionGrant.signature='changed';
          data=JSON.stringify(value);
        }
      }
      return send.call(this,data);
    };
    await expect(f.peers[0].server.close()).rejects.toThrow();
    expect(f.peers[0].client.getState().unsettled).toBe(1);
    expect(f.peers[0].server.getState().unsettled).toBe(1);
  } finally { await f.close(); }
});
it('lost retirement acknowledgment remains charged and exact duplicate receipt settles on retry', async () => {
  const f = await fixture();
  try {
    await directStep(f); const channel=f.pairs[0][0], send=channel.send; let dropped=false;
    channel.send=function(data) {
      if(typeof data==='string') { const value=JSON.parse(data);
        if(!dropped && value.type==='result' && value.result?.settled && value.result?.partitionIndex===1) { dropped=true;return; }
      }
      return send.call(this,data);
    };
    await expect(f.peers[0].server.close()).rejects.toThrow();
    expect(dropped).toBe(true);
    expect(f.peers[0].client.getState().unsettled).toBe(0);
    expect(f.peers[0].server.getState().unsettled).toBe(1);
    expect(f.pairs[0][1].readyState).toBe('open');
    await f.peers[0].server.close();
    expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
    expect(f.peers[0].server.getState().unsettled).toBe(0);
  } finally { await f.close(); }
});
it('coordinator close waits for the retiring owner to receive its pending acknowledgment', async () => {
  const f=await fixture(), held=Promise.withResolvers(); let deliver, closing;
  try {
    await directStep(f); const channel=f.pairs[0][0], send=channel.send;
    channel.send=function(data) {
      if(typeof data==='string') { const value=JSON.parse(data);
        if(!deliver && value.type==='result' && value.result?.settled && value.result?.partitionIndex===1) {
          deliver=()=>send.call(this,data); held.resolve(); return;
        }
      }
      return send.call(this,data);
    };
    const supplier=f.peers[0].server.close(); await held.promise;
    closing=f.peers[0].client.close();
    await Promise.resolve(); expect(channel.readyState).toBe('open');
    deliver(); await supplier; await closing;
    expect(f.peers[0].server.getState().unsettled).toBe(0);
    expect(f.peers[0].client.getState().unsettled).toBe(0);
  } finally { deliver?.(); await closing?.catch(()=>{}); await f.close(); }
});

it('retirement covers a locally completed cleanup whose ordinary reply has not reached its coordinator', async () => {
  const f = await fixture(), held = Promise.withResolvers(); let deliver, cleanup;
  try {
    const request = await directStep(f), channel = f.pairs[0][1], send = channel.send;
    channel.send = function(data) {
      if (typeof data === 'string') { const value = JSON.parse(data);
        if (!deliver && value.type === 'result' && value.result?.settled === true && value.result.partitionIndex == null) {
          deliver = () => send.call(this, data); held.resolve(); return;
        }
      }
      return send.call(this, data);
    };
    cleanup = f.peers[0].client.closeAttempt({ identity: request.identity }); cleanup.catch(() => {});
    await held.promise;
    await f.peers[0].server.close();
    await cleanup;
    expect(f.peers[0].client.getState().unsettled).toBe(0);
    expect(f.peers[0].server.getState().unsettled).toBe(0);
    expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
  } finally { deliver?.(); await cleanup?.catch(() => {}); await f.close(); }
});

it.each(['lost', 'signature'])('retains unacknowledged ordinary settlement after %s receipt and retries without closing twice', async kind => {
  const f = await fixture();
  try {
    const request = await directStep(f), channel = f.pairs[0][kind === 'lost' ? 1 : 0], send = channel.send;
    let altered = false;
    channel.send = function(data) {
      if (typeof data === 'string') { const value = JSON.parse(data);
        if (!altered && kind === 'lost' && value.type === 'result' && value.result?.accepted) { altered = true; return; }
        if (!altered && value.type === 'request' && value.metadata?.operation === 'settle-accepted') {
          altered = true;
          value.metadata.executionGrant.signature = 'changed'; data = JSON.stringify(value);
        }
      }
      return send.call(this, data);
    };
    await expect(f.peers[0].client.closeAttempt({ identity: request.identity })).rejects.toThrow();
    expect(altered).toBe(true);
    expect(f.peers[0].client.getState().unsettled).toBe(1);
    expect(f.peers[0].server.getState().unsettled).toBe(kind === 'lost' ? 0 : 1);
    expect(channel.readyState).toBe('open');
    await f.peers[0].client.closeAttempt({ identity: request.identity });
    expect(f.peers[0].client.getState().unsettled).toBe(0);
    expect(f.peers[0].server.getState().unsettled).toBe(0);
    expect(f.f.stages[1].closeAttempt).toHaveBeenCalledTimes(1);
  } finally { await f.close(); }
});
