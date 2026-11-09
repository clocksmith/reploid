import { it, expect, vi } from 'vitest';
import { identifyComputer, participantLabel } from '../../packages/reploid/src/mesh/computer-identity.js';

const participant = 'peer:' + 'a'.repeat(24);
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

it('persists a local name by verified key across new connection IDs and never by GPU description', async () => {
  const store = storage(), verifyPeer = vi.fn(async () => participant);
  const first = await identifyComputer('wire-a', { verifyPeer, storage: store, ownerLabel: 'Jupiter', hardware: { description: 'AMD', hostname: 'private' } });
  expect(first).toMatchObject({ participantId: participant, label: 'Jupiter', hardware: { description: 'AMD' }, identityBasis: 'signing-key' });
  expect((await identifyComputer('wire-b', { verifyPeer, storage: store })).label).toBe('Jupiter');
  const other = 'peer:' + 'b'.repeat(24);
  expect((await identifyComputer('wire-a', { verifyPeer: async () => other, storage: store, hardware: first.hardware })).label).toBe(participantLabel(other));
  expect((await identifyComputer('wire-a', { verifyPeer, storage: store, ownerLabel: '' })).label).toBe(participantLabel(participant));
});

it('does not write a label without verified identity or after cancellation', async () => {
  const store = { getItem: vi.fn(), setItem: vi.fn() }, abort = new AbortController();
  await expect(identifyComputer('wire', { verifyPeer: async () => null, storage: store, ownerLabel: 'Fake' })).rejects.toThrow('could not be verified');
  await expect(identifyComputer('wire', { verifyPeer: async () => { abort.abort(); return participant; },
    signal: abort.signal, storage: store, ownerLabel: 'Stopped' })).rejects.toThrow();
  expect(store.setItem).not.toHaveBeenCalled();
});

it('reports unavailable storage without losing a verified identity', async () => {
  const result = await identifyComputer('wire', { verifyPeer: async () => participant,
    storage: { getItem() { throw Error('blocked'); }, setItem() {} } });
  expect(result).toMatchObject({ participantId: participant, persistence: 'unavailable', label: participantLabel(participant) });
});
