import { vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { fixture as stagesFixture } from './ordered-partition-ports.js';

// A local stage-zero coordinator, remote stage 1 (`node-1`), a stage-1 replica (`node-1b`) and
// stage 2 (`node-2`). Injected discovery (the caller mocks partition-discovery.js and passes its
// owners) and injected numerical stages: proves orchestration, not GPU execution or capacity.
export async function coordinatorFixture({ discoveryOwners, cleanups, orchestration }) {
  const f = stagesFixture(3), identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  f.route.stages[0].participantId = identity.peerId; f.stages[0].id = identity.peerId;
  const model = { id: f.route.modelId, identity: f.route.modelIdentity, name: 'Synthetic' };
  const capacity = new Map();
  for (const [i, port] of f.stages.entries()) Object.assign(port, { index: i, close: vi.fn(async () => {}),
    refresh: vi.fn(async () => ({ ready: true })), subscribe: () => () => {},
    getState: () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true, index: i,
      planId: f.route.planId, stageCount: 3 }, reservations: { active: 0, availableSlots: 2, closed: false } }) });
  f.stages[0].tokenize = vi.fn(async () => ({ modelIdentity: model.identity, tokenIds: [1, 2], generation: f.request.generation }));
  const replica = { ...f.stages[1], id: 'node-1b', transportId: 'transport-1b', residentId: 'resident-1b', executionId: 'execution-1b',
    reserve: vi.fn(f.stages[1].reserve.getMockImplementation()), executeStage: vi.fn(f.stages[1].executeStage.getMockImplementation()),
    closeAttempt: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const policy = { pollMs: 3600000, maxPeers: 8, connectTimeoutMs: 1000, grantMs: 60000,
    maxStageOffersPerPeer: 4, limits: f.limits, receiver: { maxAttempts: 32, maxSteps: 10 }, inputChannel: { maxControlBytes: 131072 },
    inputLimits: { maxInputCharacters: 4096, maxOutputCharacters: 128, maxAttempts: 32, maxConcurrentAttempts: 2, descriptorTtlMs: 600000 } };
  const networks = [];
  const createNetwork = vi.fn(options => {
    const owner = { options, close: vi.fn(async () => {}), retire: vi.fn(async () => {}),
      connect: vi.fn(async (transportId, { route } = {}) => transportId === 'transport-1b' ? replica
        : f.stages[route.stages.find(row => row.transportId === transportId).index]) };
    networks.push(owner); return owner;
  });
  const loadProgram = vi.fn(async () => ({ resident: f.stages[0], runtime: f.runtime, model, plan: f.plan, planId: f.route.planId }));
  const mesh = createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], policy, peers: () => [], createNetwork, loadProgram,
    ordered: { stage: f.route.stages[0], maxRouteBytes: 32768, maxRoutes: 4, maxSelectionSteps: 256, ...(orchestration ? { orchestration } : {}) } });
  const discovery = discoveryOwners.at(-1);
  const remote = [f.stages[1], replica, f.stages[2]];
  discovery.refresh.mockImplementation(async () => {
    const now = Date.now();
    discovery.capabilities = remote.map(port => ({ participantId: port.id, transportId: port.transportId, available: true,
      observedAt: now, expiresAt: now + 600000, description: { schema: 'reploid.partition-capability/v2', participantId: port.id, phase: 'ready',
        capacity: { active: 0, availableSlots: capacity.get(port.id) ?? 2, closed: false }, models: [{ ...model, index: port.index,
          planId: f.route.planId, residentId: port.residentId, executionId: port.executionId, activation: f.route.activation, availability: 'ready' }] } }));
  });
  cleanups.push(() => mesh.close(), () => f.runner.close());
  const request = id => ({ model: mesh.getModels()[0], messages: [{ role: 'user', content: id }], threadId: id, attemptId: id });
  const stageOne = () => mesh.getState().placement?.[1] ?? null;
  return { ...f, identity, model, mesh, replica, networks, discovery, loadProgram, capacity, request, stageOne,
    generate: (id, controls = {}) => mesh.generate(request(id), { requestApproval: async () => true, ...controls }) };
}
