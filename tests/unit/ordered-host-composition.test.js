// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
const ports = vi.hoisted(() => ({ identity: null, transport: null, options: null, automatic: null, networkOptions: null, networkOwner: null }));
const model = vi.hoisted(() => ({ id: 'ordered', identity: 'sha256:' + 'a'.repeat(64),
  partitionPlan: { schema: 'doppler.layer-partition-contract/v3', stageCount: 3 }, source: {files:[{role:'model-piece-index'}]} }));
vi.mock('../../self/config/doppler-local-models.js', async original => ({ ...await original(), LOCAL_DOPPLER_MODELS:[model] }));
vi.mock('../../self/identity.js', () => ({ ensureIdentityBundle: async () => ports.identity, saveIdentityBundle() {}, rotateIdentityBundle() {} }));
const meshFactory = ({ports: input}) => ({ async connect() { await input.identity.ensure({}); input.createTransport(); }, async close() {}, getSwarmSnapshot: () => ({peers:[]}) });
vi.mock('../../self/vendor/reploid/mesh/index.js', () => ({
  createLegacyGenerationMesh: (...args) => meshFactory(...args),
  createAutomaticPartitions: options => { ports.options = options; return ports.automatic; }, createPartitionNetwork(options) { ports.networkOptions = options; return ports.networkOwner; }
}));
vi.mock('../../packages/reploid/src/mesh/index.js', async original => ({ ...await original(),
  createLegacyGenerationMesh: (...args) => meshFactory(...args),
  createAutomaticPartitions: options => { ports.options = options; return ports.automatic; }
}));
vi.mock('../../self/vendor/reploid/transport/index.js', async original => ({ ...await original(), createSwarmTransport: () => ports.transport }));
vi.mock('../../packages/reploid/src/transport/index.js', async original => ({ ...await original(), createSwarmTransport: () => ports.transport }));
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';
import { createWorkSwarm } from '../../self/host/work-swarm.js';
import { getOrderedParticipation } from '../../self/host/product-context.js';
import orderedPolicy from '../../self/config/ordered-participation.json' with { type: 'json' };
import { createNativeParticipant } from '../../server/native-participant.js';
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); });
const orderedConfig = stage => ({stage, maxStages:7,maxStageOffersPerPeer:4,maxRouteBytes:8192,maxSelectionSteps:2000,maxRoutes:4});
const stage = () => ({modelId:'ordered',index:1,residentId:'resident',executionId:'execution'});
async function setup() {
  ports.identity = await createSigningIdentity({algorithm:'Ed25519'});
  ports.transport = { disconnect:vi.fn(), _getPeerId: () => 'actual-rtc', getConnectedPeers: () => [] };
  ports.automatic = { getModels: () => [], getState: () => ({phase:'idle'}), close:vi.fn(async()=>{}), stop:vi.fn(async()=>{}) };
  ports.options = null; ports.networkOptions = null; ports.networkOwner = {close:vi.fn(async()=>{})};
}
it.each([null, 'contributor'])('browser forwards explicit ordered %s and immutable actual host binding', async kind => {
  await setup(); const ordered = orderedConfig(kind ? stage() : null);
  const swarm = createWorkSwarm({ordered,storage:{getItem:()=>null,setItem(){}},service:{},
    createModelFiles: () => ({async attach(){},async close(){},getState:()=>({})}),
    networkOptions: () => ({autoConnect:true,discoveryScope:'public',config:resolveConfig({overrides:{mesh:{roomId:'mesh'}}})}) });
  cleanups.push(() => swarm.close());
  if (ordered.stage) ordered.stage.index = 2;
  await swarm.connect();
  expect(ports.options.ordered.stage).toEqual(kind ? {index:1,participantId:ports.identity.peerId,transportId:'actual-rtc',residentId:'resident',executionId:'execution'} : null);
  expect(ports.options.policy.executionChannel.timeoutMs).toBe(300000);
  expect(ports.options.policy.limits.maxStages).toBe(7);
  expect(ports.options.canonical).toBeNull();
  expect(ports.options.models).toEqual([model]);
  const routeOptions = {maxRouteBytes:8192,validateRoute:async()=>true};
  ports.options.createNetwork({label:'ordered-test',maxPeers:4,timeoutMs:1000,ordered:routeOptions,createEndpoint(){}});
  expect(ports.networkOptions.ordered).toBe(routeOptions);
  await expect(Promise.resolve().then(() => ports.options.loadProgram({...model,id:'different'},1,{}))).rejects.toThrow('assigned');
});
const operatorStorage = saved => ({ getItem: key => key === orderedPolicy.stageStorageKey ? saved : null, setItem() {} });
const browserSwarm = (storage, ordered = getOrderedParticipation(storage)) => {
  const swarm = createWorkSwarm({ordered,storage,service:{},createModelFiles: () => ({async attach(){},async close(){},getState:()=>({})}),
    networkOptions: () => ({autoConnect:true,discoveryScope:'public',config:resolveConfig({overrides:{mesh:{roomId:'mesh'}}})}) });
  cleanups.push(() => swarm.close()); return swarm;
};
it.each([null, 'operator'])('browser host context binds %s stage with versioned ordered limits', async kind => {
  await setup(); await browserSwarm(operatorStorage(kind ? JSON.stringify(stage()) : null)).connect();
  expect(ports.options.ordered).toEqual({ stage: kind ? {index:1,participantId:ports.identity.peerId,transportId:'actual-rtc',
    residentId:'resident',executionId:'execution'} : null, maxRouteBytes: orderedPolicy.limits.maxRouteBytes,
  maxSelectionSteps: orderedPolicy.limits.maxSelectionSteps, maxRoutes: orderedPolicy.limits.maxRoutes });
  expect(ports.options.policy.limits.maxStages).toBe(orderedPolicy.limits.maxStages);
  expect(ports.options.policy.maxStageOffersPerPeer).toBe(orderedPolicy.limits.maxStageOffersPerPeer);
});
it('browser binds an operator auto choice to the authenticated transport only with its orchestration policy', async () => {
  await setup();
  const storage = (stageValue, policyValue) => ({ setItem() {}, getItem: key => key === orderedPolicy.stageStorageKey ? stageValue
    : key === orderedPolicy.orchestrationStorageKey ? policyValue : null });
  const auto = JSON.stringify({ modelId: 'ordered', assignment: 'auto' }), policy = JSON.stringify({ autoStage: { dwellMs: 60000 } });
  const replicas = { queueBound: 2, bottleneckRatio: 1.5 };
  await browserSwarm(storage(auto, JSON.stringify({ autoStage: { dwellMs: 60000 }, replicas }))).connect();
  expect(ports.options.ordered.orchestration).toEqual({ autoStage: { dwellMs: 60000, transportId: 'actual-rtc' }, replicas });
  // Replicas are an automatic contributor's policy; an operator-assigned stage cannot enable them.
  expect(() => browserSwarm(storage(JSON.stringify(stage()), JSON.stringify({ replicas })))).toThrow('orchestration');
  await browserSwarm(storage(auto, policy)).connect();
  expect(ports.options.ordered).toEqual({ stage: null, maxRouteBytes: orderedPolicy.limits.maxRouteBytes,
    maxSelectionSteps: orderedPolicy.limits.maxSelectionSteps, maxRoutes: orderedPolicy.limits.maxRoutes,
    orchestration: { autoStage: { dwellMs: 60000, transportId: 'actual-rtc' } } });
  // Coordinator ranking passes through unchanged next to an explicitly assigned stage.
  const ranking = { margin: 0.1, smoothing: 0.5, maxObservations: 64, workload: { promptTokens: 24, expectedTokens: 64 } };
  await browserSwarm(storage(JSON.stringify(stage()), JSON.stringify({ routeRanking: ranking }))).connect();
  expect(ports.options.ordered.orchestration).toEqual({ routeRanking: ranking });
  expect(() => browserSwarm(storage(JSON.stringify(stage()), JSON.stringify({ routeRanking: { ...ranking, margin: 1 } })))).toThrow('orchestration');
  // A shared device budget may not exceed the existing per-executor allocation ceiling.
  const admission = { maxBytes: 1420000000, maxConcurrentAttempts: 2, attemptBytes: 300000000 };
  await browserSwarm(storage(JSON.stringify(stage()), JSON.stringify({ admission }))).connect();
  expect(ports.options.ordered.orchestration).toEqual({ admission });
  expect(() => browserSwarm(storage(JSON.stringify(stage()), JSON.stringify({ admission: { ...admission, maxBytes: 1420000001 } })))).toThrow('orchestration');
  // A queued reservation must be answered before the execution channel's 300 s request timeout.
  const queued = { ...admission, queue: { maxQueued: 4, maxQueuedPerRequester: 1, maxWaitMs: 60000 } };
  await browserSwarm(storage(JSON.stringify(stage()), JSON.stringify({ admission: queued }))).connect();
  expect(ports.options.ordered.orchestration).toEqual({ admission: queued });
  expect(() => browserSwarm(storage(JSON.stringify(stage()), JSON.stringify({ admission: { ...queued, queue: { ...queued.queue, maxWaitMs: 300000 } } })))).toThrow('orchestration');
  // The library's chosen stage still passes the host's explicit stage validation before loading.
  await expect(Promise.resolve().then(() => ports.options.loadProgram({ ...model, id: 'different' }, 1, {}))).rejects.toThrow('assigned');
  for (const [stageValue, policyValue] of [[auto, null], [JSON.stringify(stage()), policy],
    [auto, JSON.stringify({ autoStage: { dwellMs: -1 } })], [auto, JSON.stringify({ autoStage: { dwellMs: 1 }, unknown: {} })],
    [JSON.stringify({ modelId: 'ordered', assignment: 'auto', index: 2 }), policy]]) {
    expect(() => browserSwarm(storage(stageValue, policyValue))).toThrow(/orchestration|declared model plan/);
  }
});
it('browser rejects invalid or unauthenticated operator stages with descriptive errors', async () => {
  await setup();
  for (const change of [{index:3}, {modelId:'absent'}, {executionId:''}, {route:'chosen-by-link'}]) {
    expect(() => browserSwarm(operatorStorage(JSON.stringify({...stage(), ...change})))).toThrow('Ordered host stage requires a matching declared model plan and allocation identity');
  }
  const claimed = browserSwarm(operatorStorage(JSON.stringify({...stage(), participantId:'another-participant'})));
  await expect(claimed.connect()).rejects.toThrow('Ordered host identity differs from the authenticated transport');
  expect(ports.options).toBeNull();
});
it('browser host context leaves non-ordered catalogs in ordinary participation', async () => {
  await setup();
  const ordinary = getOrderedParticipation(operatorStorage(null), [{id:'two-device',partitionSplitLayer:4},{id:'whole-request'}]);
  expect(ordinary).toBeNull();
  await browserSwarm(operatorStorage(null), ordinary).connect();
  expect(ports.options.ordered).toBeNull();
  expect(ports.options.policy.limits.maxStages).toBeUndefined();
  expect(ports.options.policy.maxStageOffersPerPeer).toBeUndefined();
});
it('native forwards actual authenticated stage and preserves separate file and compute consent', async () => {
  await setup(); const gpu = vi.fn(), ordered = orderedConfig(stage());
  const selected = structuredClone(model);
  const pending = createNativeParticipant({ordered,identity:ports.identity,model:selected,modelDirectory:'/unused',nativeGpu:gpu,
    rtc:{RTCPeerConnection(){}},WebSocket(){},signalingUrl:'ws://localhost:1',roomId:'mesh',roomToken:'t'.repeat(32)});
  ordered.stage.index = 2; selected.partitionPlan = null;
  const participant = await pending; cleanups.push(() => participant.close());
  expect(ports.options.ordered.stage).toEqual({index:1,participantId:ports.identity.peerId,transportId:'actual-rtc',residentId:'resident',executionId:'execution'});
  expect(ports.options.policy.executionChannel.timeoutMs).toBe(300000);
  expect(ports.options.policy.limits.maxStages).toBe(7);
  expect(gpu).not.toHaveBeenCalled();
  expect(() => participant.shareFiles(true)).toThrow('cache directory');
});
it('native rejects unbound catalog geometry and conflicting identity without loading a GPU', async () => {
  await setup(); const gpu = vi.fn();
  const base = {identity:ports.identity,model,modelDirectory:'/unused',nativeGpu:gpu,rtc:{RTCPeerConnection(){}},WebSocket(){},signalingUrl:'ws://localhost:1',roomId:'mesh',roomToken:'t'.repeat(32)};
  await expect(createNativeParticipant({...base,model:{...model,partitionPlan:undefined},ordered:orderedConfig(stage())})).rejects.toThrow('declared');
  await expect(createNativeParticipant({...base,ordered:orderedConfig({...stage(),transportId:'claimed-rtc'})})).rejects.toThrow('authenticated');
  expect(ports.options).toBeNull(); expect(gpu).not.toHaveBeenCalled();
});

it.each(['startup','disconnect'])('retains failed %s host network ownership and refuses replacement until explicit retry', async mode => {
  await setup();
  const createPartitions = options => {
    ports.options = options;
    options.createNetwork({label:'owned',maxPeers:4,timeoutMs:1000,createEndpoint(){}});
    if (mode === 'startup') throw Error('startup failed after network allocation');
    return ports.automatic;
  };
  const swarm = createWorkSwarm({ordered:orderedConfig(null),createPartitions,storage:{getItem:()=>null,setItem(){}},service:{},
    createModelFiles: () => ({async attach(){},async close(){},getState:()=>({})}),
    networkOptions: () => ({autoConnect:true,discoveryScope:'public',config:resolveConfig({overrides:{mesh:{roomId:'mesh'}}})}) });
  cleanups.push(() => swarm.close());
  ports.networkOwner.close.mockRejectedValueOnce(Error('channel cleanup unknown'));
  if(mode === 'startup') await expect(swarm.connect()).rejects.toThrow('connection cleanup failed');
  else { await swarm.connect(); await expect(swarm.disconnect()).rejects.toThrow('settlement failed'); }
  expect(swarm.getState().unsettledOwners).toBe(1);
  await expect(swarm.connect()).rejects.toThrow('cleanup remains unsettled');
  await swarm.disconnect(); expect(swarm.getState().unsettledOwners).toBe(0);
  expect(ports.networkOwner.close).toHaveBeenCalledTimes(2);
});

it('native ordinary requester forwards approved controls to its existing automatic owner without loading a GPU', async () => {
  await setup(); const gpu=vi.fn(); ports.automatic.generate=vi.fn(async request=>({attemptId:request.attemptId}));
  const participant=await createNativeParticipant({ordered:orderedConfig(null),identity:ports.identity,model,modelDirectory:'/unused',nativeGpu:gpu,
    rtc:{RTCPeerConnection(){}},WebSocket(){},signalingUrl:'ws://localhost:1',roomId:'mesh',roomToken:'t'.repeat(32)});
  cleanups.push(()=>participant.close());
  const request={attemptId:'request'}, controls={requestApproval:async()=>true,signal:new AbortController().signal};
  expect(()=>participant.generate(request,{})).toThrow('disclosure authorization');
  expect(await participant.generate(request,controls)).toEqual({attemptId:'request'});
  expect(ports.automatic.generate).toHaveBeenCalledWith(request,controls);expect(gpu).not.toHaveBeenCalled();
  await participant.close();expect(()=>participant.generate(request,controls)).toThrow('unavailable');
});
