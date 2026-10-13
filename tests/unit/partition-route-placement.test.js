import { describe, expect, it } from 'vitest';
import { canonicalRouteAttemptBinding, sameRouteAttemptIdentity, validatePartitionRoute } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { selectPartitionRoute } from '../../packages/reploid/src/mesh/partitions/partition-placement.js';
import { createPartitionReservations } from '../../packages/reploid/src/mesh/partitions/partition-reservations.js';

const sha = value => 'sha256:' + value.repeat(64);
const model = { id: 'model', identity: sha('a') };
const activation = { schema: 'doppler.activation-tensor/v2', dtype: 'f32', hiddenSize: 16,
  precision: 'two-f32', components: 2, elementStrideBytes: 8 };
const runtime = { hashLayerPartitionPlan: async () => sha('b'), getPartitionActivationContract: () => activation,
  validateActivationFrameForPlan() {} };
const limits = { maxStages: 100, maxPeers: 100, maxOffersPerPeer: 100, maxSelectionSteps: 100000 };
function plan(count) { return { schema: 'doppler.layer-partition-contract/v3', modelId: model.id, stageCount: count,
  partitions: Array.from({ length: count }, (_, index) => ({ index })) }; }
function peer(id, indices, overrides = {}) {
  return { participantId: id, transportId: 'transport-' + id, observedAt: 5, expiresAt: 15, available: true,
    description: { schema: 'reploid.partition-capability/v2', participantId: id, phase: 'ready',
      capacity: { active: 0, availableSlots: 5, closed: false }, models: indices.map(index => ({
        ...model, availability: 'ready', planId: sha('b'), index, residentId: 'resident-' + id + '-' + index,
        executionId: sha('c'), activation: structuredClone(activation) })) }, ...overrides };
}
const choose = (count, capabilities, options = {}) => selectPartitionRoute({ runtime, plan: plan(count), model,
  capabilities, limits, now: 10, ...options });
const identity = route => ({ schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'attempt',
  requesterId: 'requester', placementGeneration: 0, route });

describe('ordered stage placement and immutable route binding', () => {
  for (const count of [2, 3, 4, 7]) it(`selects all ${count} stages independently of replica inventory order`, async () => {
    const peers = Array.from({ length: count * 4 }, (_, index) => peer('p' + String(index).padStart(3, '0'), [Math.floor(index / 4)]));
    const a = await choose(count, peers), b = await choose(count, peers.reverse());
    expect(a.route).toEqual(b.route);
    expect(a.route.stages.map(stage => stage.index)).toEqual(Array.from({ length: count }, (_, index) => index));
    expect(new Set(a.route.stages.map(stage => stage.participantId)).size).toBe(count);
    expect(a.reason).toBe('reservation-required');
    expect(Object.isFrozen(a.route.stages[0])).toBe(true);
  });
  it('finds a complete route where greedy first-peer selection would miss the only middle owner', async () => {
    const result = await choose(3, [peer('a', [0, 1]), peer('b', [0]), peer('c', [2])]);
    expect(result.route.stages.map(stage => stage.participantId)).toEqual(['b', 'a', 'c']);
  });
  it('filters ineligible replicas before matching and reports a missing middle stage', async () => {
    const bad = peer('bad', [1]); bad.description.models[0].identity = sha('d');
    const busy = peer('busy', [1]); busy.description.capacity.availableSlots = 0;
    const missingCapacity = peer('unknown', [1]); delete missingCapacity.description.capacity;
    const expired = peer('expired', [1], { expiresAt: 10 });
    const result = await choose(3, [peer('a', [0]), bad, busy, expired, missingCapacity, peer('c', [2])]);
    expect(result.route).toBeNull();
    expect(result.eligibility.filter(row => row.eligible)).toHaveLength(2);
    expect(result.reason).toBe('missing-eligible-stage');
  });
  it('bounds matching on 100 multi-model peers without enumerating Cartesian routes', async () => {
    const peers = Array.from({ length: 100 }, (_, index) => peer('p' + String(index).padStart(3, '0'), [index % 7]));
    peers.forEach(value => value.description.models.push({ ...value.description.models[0], id: 'other', identity: sha('e') }));
    const result = await choose(7, peers);
    expect(result.route.stages).toHaveLength(7);
    expect(result.selectionSteps).toBeLessThan(500);
    await expect(choose(7, peers, { limits: { ...limits, maxPeers: 99 } })).rejects.toThrow(/limit/);
    const stopped = await choose(7, peers, { limits: { ...limits, maxSelectionSteps: 1 } });
    expect(stopped.route).toBeNull(); expect(stopped.reason).toBe('selection-work-limit');
  });
  it('does not invent capacity or select duplicate logical owners through different transports', async () => {
    const repeated = peer('a', [1]); repeated.transportId = 'another-transport';
    await expect(choose(2, [peer('a', [0]), repeated])).rejects.toThrow(/Duplicate/);
    const result = await choose(2, [peer('a', [0, 1])]);
    expect(result.route).toBeNull(); expect(result.reason).toBe('insufficient-distinct-participants');
  });
  it('snapshots input before awaited provider hashing and rejects plan or layout substitutions', async () => {
    const route = (await choose(2, [peer('a', [0]), peer('b', [1])])).route;
    const mutable = structuredClone(route);
    let release;
    const pending = validatePartitionRoute({ ...runtime, hashLayerPartitionPlan: () => new Promise(resolve => { release = resolve; }) }, plan(2), mutable);
    mutable.stages[0].participantId = 'mutated'; release(sha('b'));
    expect((await pending).stages[0].participantId).toBe('a');
    await expect(validatePartitionRoute({ ...runtime, hashLayerPartitionPlan: () => sha('f') }, plan(2), route)).rejects.toThrow(/plan/);
    await expect(validatePartitionRoute({ ...runtime, getPartitionActivationContract: () => ({ ...activation, hiddenSize: 32 }) }, plan(2), route)).rejects.toThrow(/activation/);
  });
  it('rejects malformed complete attempt identities without a runtime port', async () => {
    const route = (await choose(3, [peer('a', [0]), peer('b', [1]), peer('c', [2])])).route;
    const original = identity(route), saved = canonicalRouteAttemptBinding(original);
    expect(sameRouteAttemptIdentity(saved, original)).toBe(true);
    for (const mutate of [v => v.route.stages.reverse(), v => v.route.stages.splice(1, 1),
      v => v.route.stages[1].participantId = v.route.stages[0].participantId,
      v => v.route.activation.elementStrideBytes = 4, v => v.route.extra = true,
      v => v.route.stages[1].executionId = '', v => v.placementGeneration = -1]) {
      const changed = structuredClone(original); mutate(changed);
      expect(() => canonicalRouteAttemptBinding(changed)).toThrow();
      expect(sameRouteAttemptIdentity(saved, changed)).toBe(false);
    }
    const changed = structuredClone(original); changed.route.stages[1].residentId = 'new-resident';
    expect(sameRouteAttemptIdentity(saved, changed)).toBe(false);
  });
  it('places twenty attempts over twelve replicas using actual five-slot reservations', async () => {
    const peers = Array.from({ length: 12 }, (_, index) => peer('p' + String(index).padStart(2, '0'), [Math.floor(index / 4)]));
    const owners = new Map(peers.map(value => [value.participantId, createPartitionReservations({
      participantId: value.participantId, index: value.description.models[0].index,
      limits: { maxAttempts: 40, maxConcurrentAttempts: 5 } })]));
    const admissions = [];
    for (let index = 0; index < 20; index++) {
      for (const value of peers) value.description.capacity = owners.get(value.participantId).getState();
      const { route } = await choose(3, peers);
      const attempt = canonicalRouteAttemptBinding({ ...identity(route), attemptId: 'attempt-' + index });
      for (const stage of route.stages) owners.get(stage.participantId).reserve(attempt);
      admissions.push(attempt);
    }
    expect([...owners.values()].map(owner => owner.getState().active)).toEqual(Array(12).fill(5));
    for (const value of peers) value.description.capacity = owners.get(value.participantId).getState();
    expect((await choose(3, peers)).route).toBeNull();
    const retained = structuredClone(admissions[0]);
    for (const stage of admissions[0].route.stages) owners.get(stage.participantId).settled(admissions[0]);
    for (const value of peers) value.description.capacity = owners.get(value.participantId).getState();
    expect((await choose(3, peers)).route).not.toBeNull();
    expect(admissions[0]).toEqual(retained);
    // Slots alone prove admission bookkeeping, not that sixty states fit physical GPUs.
  });
  it('actual reservations keep failed cleanup charged and reject changed route identities', async () => {
    const route = (await choose(3, [peer('a', [0]), peer('b', [1]), peer('c', [2])])).route;
    const attempt = canonicalRouteAttemptBinding(identity(route));
    const owner = createPartitionReservations({ limits: { maxAttempts: 20, maxConcurrentAttempts: 1 }, participantId: 'b', index: 1 });
    owner.reserve(attempt); owner.settling(attempt); owner.fail(attempt, Error('unsettled'));
    expect(owner.getState().availableSlots).toBe(0);
    const changed = structuredClone(attempt); changed.route.stages[1].executionId = 'new-execution';
    expect(() => owner.reserve(changed)).toThrow(/identity/);
    owner.settled(attempt); expect(owner.getState().availableSlots).toBe(1);
  });
});
