import { vi } from 'vitest';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createPartitionNetwork } from '../../packages/reploid/src/mesh/partitions/partition-network.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { fixture as stageFixture } from './ordered-partition-ports.js';

// Real protocol owners, synthetic channels/certificate observations and numerical
// state. These responses are test data, never evidence of model task quality.
export const tasks = [
  { prompt: 'Write a Python function double(x) that returns twice x.', chunks: ['def double(x):\n', '    return x * 2', '\n'] },
  { prompt: 'Explain what a closure retains in one sentence.', chunks: ['A closure ', 'retains access to variables ', 'from its enclosing scope.'] }
];
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, {
    readyState: 'open', ordered: true, maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1-index].readyState === 'open') pair[1-index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1-index].close()); }
  }));
  return pair;
}
// modelFields adds catalog metadata, such as provider, that host composition requires.
export async function automaticOrderedMesh({ modelFields = {} } = {}) {
  const base = stageFixture(3), identities = await Promise.all(Array.from({ length: 8 }, () => createSigningIdentity({ algorithm: 'ECDSA' })));
  base.plan.partitions.forEach((stage,index)=>{stage.layerRange=[index*2,index*2+1];});
  // Two coordinators and middle-stage replicas share a final-stage resident.
  // Slots5/6 are weightless requesters;7 is the initially absent replacement.
  const indices = [0,1,2,0,1,null,null,1];
  const visible = [[1,2,5,7],[0,2],[0,1,3,4,7],[2,4,6],[2,3],[0],[3],[0,2]];
  const listeners = identities.map(() => new Map()), opens = [], traffic = [], meshes = [], loads = [], states = [], gates = [];
  const model = { id: base.route.modelId, identity: base.route.modelIdentity, name: 'Injected task fixture', ...modelFields };
  const channelPolicy = { maxFrameBytes: 64, maxControlBytes: 131072, maxPayloadBytes: 8192, maxPendingBytes: 32768,
    maxPendingRequests: 16, maxRequestsPerChannel: 4096, maxBufferedBytes: 262144, maxTransferBytes: 16777216, timeoutMs: 3000 };
  const policy = { pollMs: 25, maxPeers: 16, connectTimeoutMs: 3000, grantMs: 60000, maxStageOffersPerPeer: 4, limits: { ...base.limits, maxOutputCharacters: 256 },
    receiver: { maxAttempts: 64, maxSteps: 10 }, inputChannel: channelPolicy, executionChannel: channelPolicy, controlChannel: channelPolicy,
    inputLimits: { maxInputCharacters: 4096, maxOutputCharacters: 256, maxAttempts: 64, maxConcurrentAttempts: 2, descriptorTtlMs: 60000 } };
  const wait = async (slot, args) => {
    const gate = gates.find(row => row.slot === slot && row.threadId === args.identity.threadId && row.step === args.step && !row.used);
    if (!gate) return;
    gate.used = true; gate.enter();
    let abort;
    try {
      await Promise.race([gate.promise, new Promise((_, reject) => {
        abort = () => reject(args.signal.reason);
        if (args.signal.aborted) return abort();
        args.signal.addEventListener('abort', abort, { once: true });
      })]);
    } finally { args.signal.removeEventListener('abort', abort); }
  };
  for (let slot=0; slot<indices.length; slot++) {
    const index = indices[slot], stage = index === null ? null : { index, participantId: identities[slot].peerId,
      transportId: `transport-${slot}`, residentId: `resident-${slot}`, executionId: `execution-${slot}` };
    const attempts = new Map(), received = [], closedAttempts = [], state = { stage, attempts, received, closedAttempts, closed: false };
    const resident = stage && { ...stage, id: stage.participantId, canAccept: () => !state.closed,
      subscribe: () => () => {}, getState: () => ({ ready: !state.closed,
        descriptor: { schema: 'doppler.resident-partition/v2', ready: !state.closed, index, stageCount: 3, modelId: model.id,
          modelIdentity: model.identity, planId: base.route.planId, layerRange: [index*2,index*2+1] },
        reservations: { active: attempts.size, availableSlots: 4-attempts.size, closed: state.closed } }),
      tokenize: vi.fn(async ({ messages }) => {
        const task = tasks.findIndex(row => row.prompt === messages.at(-1)?.content);
        if (task < 0) throw Error('Unexpected fixture task');
        received.push(structuredClone(messages));
        return { modelIdentity: model.identity, tokenIds: [task+1,9], generation: base.request.generation };
      }),
      reserve: vi.fn(async ({ identity, partitionIndex }) => {
        if (state.closed || attempts.size >= 4) throw Error('Fixture capacity unavailable');
        attempts.set(identity.attemptId, { identity, task: null });
        return { identity, partitionIndex, status: 'reserved' };
      }),
      executeStage: vi.fn(async args => {
        const { identity, partitionIndex, step, tokenPosition, inputTokenIds } = args;
        const owned = attempts.get(identity.attemptId); if (!owned || state.closed) throw Error('Fixture state unavailable');
        if (step === 0) owned.task = inputTokenIds[0]-1;
        await wait(slot, args); args.signal.throwIfAborted();
        const result = { identity, partitionIndex, step, tokenPosition, continuation: { step } };
        if (index === 2) return { ...result, tokenId: 20+owned.task*3+step, delta: tasks[owned.task].chunks[step], done: step === 2, stopReason: 'eos' };
        return { ...result, activationTensor: { shape: [1,inputTokenIds.length,8], dtype: 'f32',
          data: new Float32Array(inputTokenIds.length*8).fill(index+step), seqOffset: tokenPosition, step } };
      }),
      closeAttempt: vi.fn(async ({ identity }) => { attempts.delete(identity.attemptId); closedAttempts.push(identity); }),
      close: vi.fn(async () => { if (attempts.size) throw Error('Unsettled fixture attempts'); state.closed = true; })
    };
    state.resident = resident; states.push(state);
    const transport = { getPeerBinding: peer => ({ local: `cert-${slot}`, remote: `cert-${peer}` }),
      onDataChannel(label, handler) { listeners[slot].set(label, handler); return () => listeners[slot].delete(label); },
      openDataChannel(peer, label) {
        const target = Number(peer.split('-').at(-1)); if (slot === target) throw Error('Unexpected self connection');
        const receive = listeners[target].get(label); if (!receive) throw Error('Endpoint unavailable');
        const pair = channels(); opens.push({ from: slot, to: target, label });
        // Every frame either side transmits, so tests can prove what left a participant and when.
        for (const [side, from, to] of [[0, slot, target], [1, target, slot]]) {
          const send = pair[side].send;
          pair[side].send = data => { traffic.push({ from, to, label, data }); return send.call(pair[side], data); };
        }
        receive(`transport-${slot}`, pair[1]); return pair[0];
      } };
    const loadProgram = vi.fn(async () => ({ model, runtime: base.runtime, plan: base.plan, planId: base.route.planId, resident }));
    loads.push(loadProgram);
    meshes.push(createAutomaticPartitions({ identity: identities[slot], meshId: 'mesh', models: [model], policy,
      ordered: { stage, maxRouteBytes: 32768, maxSelectionSteps: 256, maxRoutes: 4 },
      peers: () => visible[slot].map(i => ({ id: `transport-${i}`, localTransportId: `transport-${slot}` })),
      createNetwork: options => createPartitionNetwork({ ...options, transport, verifyPeer: async peer => identities[Number(peer.split('-').at(-1))].peerId }), loadProgram }));
  }
  // runtime is the injected numerical runtime every loaded stage shares.
  return { model, meshes, states, loads, opens, traffic, identities, runtime: base.runtime,
    async prepare() { for (const i of [1,2,4,0,3]) await meshes[i].contribute(model.id, true); },
    select(requester, coordinator) { return meshes[requester].getModels().find(row => row.partition?.route.stages[0].participantId === identities[coordinator].peerId); },
    gate(slot, threadId, step=1) {
      let release, enter; const promise = new Promise(done => { release = done; }), entered = new Promise(done => { enter = done; });
      const value = { slot, threadId, step, promise, entered, release, enter, used: false }; gates.push(value); return value;
    },
    async close() {
      gates.forEach(gate => gate.release());
      const results = await Promise.allSettled([0,3].map(slot => meshes[slot].close()));
      results.push(...await Promise.allSettled(meshes.filter((_,slot)=>slot!==0&&slot!==3).map(mesh=>mesh.close()))); await base.runner.close();
      const failures = results.filter(row => row.status === 'rejected'); if (failures.length) throw new AggregateError(failures.map(row => row.reason), 'Fixture cleanup failed');
    }
  };
}
