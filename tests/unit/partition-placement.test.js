import { describe, expect, it } from 'vitest';
import { selectPartitionPlacement, selectPartitionExecution } from '../../packages/reploid/src/mesh/partitions/partition-placement.js';

const offer = { id: 'model', identity: 'sha256:' + 'a'.repeat(64) };
const capability = (participantId, index, overrides = {}) => ({ participantId, transportId: participantId,
  observedAt: 10, expiresAt: 20, available: true, reason: 'observed',
  description: { index, phase: 'ready', offer, placement: ['a', 'b'], ...overrides } });

describe('placement over partial discovery', () => {
  it('waits for the advertised A instead of loading a new A when B is discovered first', () => {
    const options = { participantId: 'c', offer, localIndex: null, previous: null };
    expect(selectPartitionPlacement({ ...options, capabilities: [capability('b', 1)] }))
      .toMatchObject({ participants: [], reason: 'await-advertised-input-owner' });
    expect(selectPartitionPlacement({ ...options, capabilities: [capability('b', 1), capability('a', 0)] }).participants)
      .toEqual(['a', 'c']);
  });

  it('permits a fresh A after B explicitly selects it following input-owner loss', () => {
    expect(selectPartitionPlacement({ participantId: 'c', offer, localIndex: null, previous: null,
      capabilities: [capability('b', 1, { placement: ['c', 'b'] })] }).participants).toEqual(['c', 'b']);
  });

  it('retains the existing pair when a replica has more free slots', () => {
    expect(selectPartitionPlacement({ participantId: 'a', offer, localIndex: 0, previous: ['a', 'b'],
      capabilities: [capability('b', 1, { capacity: { availableSlots: 0 } }), capability('c', 1)] }).participants)
      .toEqual(['a', 'b']);
  });

  it('records expired and saturated input owners without reserving or selecting them', () => {
    const model = { ...offer, availability: 'ready' };
    const expired = { ...capability('a', 0, { models: [model] }), available: false, reason: 'expired' };
    const busy = capability('b', 0, { models: [model], capacity: { availableSlots: 0, active: 1, closed: false } });
    const ready = capability('c', 0, { models: [model], capacity: { availableSlots: 1, active: 0, closed: false } });
    const result = selectPartitionExecution({ model, capabilities: [expired, busy, ready] });
    expect(result.transportId).toBe('c');
    expect(result.eligibility.map(peer => peer.reason)).toEqual(['expired', 'input-owner-at-capacity', 'reservation-required']);
  });
});
