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
