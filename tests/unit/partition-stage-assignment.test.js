import { describe, expect, it } from 'vitest';
import { planStageAssignment, STAGE_ASSIGNMENT_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-stage-assignment.js';

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
