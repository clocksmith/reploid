// @vitest-environment node
import { expect, it } from 'vitest';
import { summarizeNativePartitionState } from '../../server/native-participant.js';

it('bounds routine CLI status without visiting Capsule/source bodies or losing settlement state', () => {
  const receipt = { openingMode: 'signed-capsule', memory: { allocatedBytes: 120, maxBytes: 140 },
    preparation: { openMs: 10, acquisitionAndMaterializationMs: 8 } };
  Object.defineProperty(receipt, 'capsuleVerification', { enumerable: true, get() { throw Error('whole Capsule visited'); } });
  Object.defineProperty(receipt, 'sourceAcquisition', { enumerable: true, get() { throw Error('source body visited'); } });
  const state = { phase: 'failed', error: 'queue failed', offering: true, modelId: 'model', unsettledOwners: 1,
    progress: { stage: 'loading', message: 'piece verified', loaded: 2, total: 4 },
    placement: ['local', 'remote'], descriptor: { modelIdentity: 'sha256:model', planId: 'sha256:plan', index: 1,
      ready: true, residentWeightBytes: 42, generationDigest: 'sha256:generation', canonicalGenerationId: null },
    reservations: { active: 1, availableSlots: 0, closed: true, records: [
      { identity: { attemptId: 'a', privateInput: 'must not log' }, phase: 'settling', failure: 'queue failed', settledAt: null } ] },
    attempts: [{ attemptId: 'a', status: 'cancelled', text: 'private generated text' }], acquisition: receipt };
  const log = summarizeNativePartitionState(state);
  expect(log).toMatchObject({ event: 'partition-state', phase: 'failed', error: 'queue failed', unsettledOwners: 1,
    placement: ['local', 'remote'], descriptor: { modelIdentity: 'sha256:model', index: 1, residentWeightBytes: 42 },
    reservations: { active: 1, availableSlots: 0, closed: true, count: 1,
      records: [{ attemptId: 'a', phase: 'settling', failure: 'queue failed', settledAt: null }] } });
  expect(log.acquisition).toEqual({ openingMode: 'signed-capsule', memory: { allocatedBytes: 120, maxBytes: 140 },
    preparation: { openMs: 10, acquisitionAndMaterializationMs: 8 } });
  expect(JSON.stringify(log)).not.toMatch(/capsuleVerification|sourceAcquisition|privateInput|private generated/);
  expect(state.reservations.records[0].identity.privateInput).toBe('must not log');
});

it('has bounded strings and collections and explicitly reports omitted records', () => {
  const huge = 'x'.repeat(100_000);
  const row = { identity: { attemptId: huge }, phase: huge, failure: huge };
  const log = summarizeNativePartitionState({ phase: huge, error: huge, modelId: huge, placement: Array(1000).fill(huge),
    progress: { message: huge }, descriptor: { modelIdentity: huge, planId: huge },
    reservations: { records: Array(1000).fill(row) }, attempts: Array(1000).fill({ attemptId: huge, status: huge }) });
  expect(log.reservations.count).toBe(1000); expect(log.reservations.omitted).toBe(984);
  expect(log.attempts.count).toBe(1000); expect(log.attempts.omitted).toBe(984);
  expect(log.error.endsWith('…')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(log))).toBeLessThan(50_000);
});

it('keeps unknown cleanup state unknown and safely summarizes idle status', () => {
  const log = summarizeNativePartitionState({ phase: 'idle', offering: false, unsettledOwners: 0 });
  expect(log).toMatchObject({ phase: 'idle', offering: false, unsettledOwners: 0, descriptor: null, acquisition: null, reservations: null });
  expect(log.attempts).toEqual({ count: 0, omitted: 0, records: [] });
});
