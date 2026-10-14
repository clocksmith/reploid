import { describe, expect, it } from 'vitest';
import { planStageAssignment, stageDemand, STAGE_ASSIGNMENT_SCHEMA, STAGE_COSTS_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-stage-assignment.js';

const model = { id: 'model', identity: 'sha256:' + 'a'.repeat(64) };
const now = 1000;
// Observed discovery rows: a ready stage offer, an auto claim while preparing, or an unassigned auto joiner.
function peer(participantId, { ready = [], claim, phase = ready.length ? 'ready' : 'waiting', expiresAt = now + 10 } = {}) {
  return { participantId, transportId: 't-' + participantId, available: true, observedAt: now, expiresAt,
    description: { schema: 'reploid.partition-capability/v2', participantId, phase,
      capacity: { active: 0, availableSlots: 2, closed: false },
      models: ready.map(index => ({ ...model, index, planId: 'plan', residentId: 'r', executionId: 'e', availability: 'ready' })),
      ...(claim === undefined ? {} : { assignment: { schema: STAGE_ASSIGNMENT_SCHEMA, modelId: model.id, modelIdentity: model.identity, index: claim } }) } };
}
const plan = (participantId, capabilities, current = null) => planStageAssignment({ participantId, model, stageCount: 3,
  capabilities, now, current, maxOffersPerPeer: 4 });

describe('autonomous cold stage assignment policy', () => {
  it('picks the least-supplied stage from observed ready offers', () => {
    expect(plan('m', [peer('coordinator', { ready: [0] }), peer('b', { ready: [1] })])).toMatchObject({
      index: 2, reason: 'cold-least-supplied', move: false, supply: [1, 1, 0] });
    // Expired, unavailable or other-model offers supply nothing.
    const other = peer('x', { ready: [2] }); other.description.models[0].identity = 'sha256:' + 'b'.repeat(64);
    expect(plan('m', [peer('c', { ready: [0] }), peer('d', { ready: [1], expiresAt: now }), other]).index).toBe(1);
  });

  it('counts a peer still preparing its claimed stage as supply', () => {
    expect(plan('m', [peer('c', { ready: [0] }), peer('b', { claim: 1, phase: 'loading' })])).toMatchObject({ index: 2, supply: [1, 1, 0] });
  });

  it('spreads simultaneous joiners deterministically by participant-id rank', () => {
    const ids = ['p-a', 'p-b', 'p-c'], coordinator = peer('coordinator', { ready: [0] });
    const chosen = ids.map(id => plan(id, [coordinator, ...ids.filter(other => other !== id).map(other => peer(other, { claim: null }))]).index);
    expect(chosen).toEqual([1, 2, 0]);
    // Without a coordinator the three still cover every stage.
    expect(ids.map(id => plan(id, ids.filter(other => other !== id).map(other => peer(other, { claim: null }))).index).sort()).toEqual([0, 1, 2]);
  });

  it('re-evaluates with hysteresis: retains unless two more contributors share this stage and it has the highest id', () => {
    const base = [peer('c', { ready: [0] }), peer('b', { ready: [1] })];
    // One other contributor on stage 1 and none on stage 2: the gap is two, but only the highest id moves.
    expect(plan('z', base, 1)).toMatchObject({ index: 2, move: true, reason: 'rebalance' });
    expect(plan('a', base, 1)).toMatchObject({ index: 1, move: false, reason: 'retain' });
    // A gap of one is within hysteresis.
    expect(plan('z', [...base, peer('d', { ready: [2] })], 1)).toMatchObject({ move: false, reason: 'retain' });
    // A joiner about to fill the empty stage keeps incumbents where they are.
    expect(plan('z', [...base, peer('j', { claim: null })], 1)).toMatchObject({ move: false, reason: 'retain' });
  });

  it('ignores malformed claims and offers outside the plan', () => {
    const bad = peer('x', { ready: [7] }); bad.description.assignment = { schema: 'other', index: 2 };
    const malformed = peer('y', { claim: 2 }); malformed.description.capacity = null;
    expect(plan('m', [peer('c', { ready: [0] }), bad, malformed])).toMatchObject({ index: 1, supply: [1, 0, 0] });
    expect(() => plan('m', [], 3)).toThrow('Explicit stage assignment input required');
  });
});

describe('useful replica demand (opt-in)', () => {
  const demand = (capabilities, bounds = {}) => stageDemand({ model, stageCount: 3, capabilities, now, maxOffersPerPeer: 4,
    queueBound: 1, bottleneckRatio: 2, ...bounds });
  const queued = (participantId, index, waiting) => { const row = peer(participantId, { ready: [index] });
    row.description.capacity = { active: 2, availableSlots: 0, closed: false, queued: waiting, maxQueued: 8 }; return row; };
  // Placement A decode per stage as measured on 2026-10-14 (artifacts/phase-timing-20261014): mac, amd, intel with the head.
  const coordinator = (decodeMs = [559, 394, 2344]) => { const row = peer('coordinator', { ready: [0] });
    row.description.stageCosts = { schema: STAGE_COSTS_SCHEMA, modelId: model.id, modelIdentity: model.identity, planId: 'plan', decodeMs }; return row; };

  it('finds a stage whose advertised queue exceeds the bound, else the measured bottleneck', () => {
    expect(demand([coordinator(), queued('b', 1, 3), peer('c', { ready: [2] })])).toMatchObject({ index: 1, reason: 'queue' });
    expect(demand([coordinator(), queued('b', 1, 1), peer('c', { ready: [2] })])).toMatchObject({ index: 2, reason: 'bottleneck' });
    expect(demand([coordinator([559, 394, 900]), peer('b', { ready: [1] })])).toMatchObject({ index: null });
    expect(demand([coordinator([559, null, 2344])])).toMatchObject({ index: null }); // an unmeasured stage is not evidence
  });

  it('completes a missing stage before replicating, then sends the first joiner to the demanded stage', () => {
    const wanted = { index: 2, reason: 'bottleneck' };
    const full = [peer('coordinator', { ready: [0] }), peer('b', { ready: [1] }), peer('c', { ready: [2] })];
    expect(plan('m', full)).toMatchObject({ index: 0, reason: 'cold-least-supplied' });
    expect(planStageAssignment({ participantId: 'm', model, stageCount: 3, capabilities: full, now, maxOffersPerPeer: 4, demand: wanted }))
      .toMatchObject({ index: 2, reason: 'replicate-bottleneck' });
    const missing = [peer('coordinator', { ready: [0] }), peer('c', { ready: [2] })];
    expect(planStageAssignment({ participantId: 'm', model, stageCount: 3, capabilities: missing, now, maxOffersPerPeer: 4, demand: wanted }))
      .toMatchObject({ index: 1, reason: 'cold-least-supplied' });
  });

  it('moves an idle contributor to the demanded stage only while its own stage stays supplied', () => {
    const wanted = { index: 2, reason: 'queue' }, decide = (participantId, capabilities) => planStageAssignment({ participantId, model,
      stageCount: 3, capabilities, now, current: 1, maxOffersPerPeer: 4, demand: wanted });
    const shared = [peer('coordinator', { ready: [0] }), peer('b', { ready: [1] }), peer('c', { ready: [2] })];
    expect(decide('z', shared)).toMatchObject({ index: 2, move: true, reason: 'replicate-queue' });
    expect(decide('a', shared)).toMatchObject({ index: 1, move: false }); // only the highest id leaves
    expect(decide('z', [peer('coordinator', { ready: [0] }), peer('c', { ready: [2] })])).toMatchObject({ index: 1, move: false });
  });
});
