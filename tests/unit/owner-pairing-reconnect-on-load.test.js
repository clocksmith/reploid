import { expect, it, vi } from 'vitest';
import { createChatSession } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const memoryStorage = entries => {
  const map = new Map(Object.entries(entries));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
};

it('reconnects a previously paired phone to its desktop room when the session opens', async () => {
  const roomId = 'reploid-swarm-owner-cd5dbb69addd22030a3ebd51d41b208c6148';
  const storage = memoryStorage({ 'reploid.owner-paired-desktop:v1': JSON.stringify({
    hostParticipantId: `peer:${'a'.repeat(24)}`, hostLabel: 'Studio', roomId, pairedAt: 1 }) });
  const connect = vi.fn(async () => {});
  const session = createChatSession({ storage, service: createChatTestService(),
    swarm: { getState: () => ({ consumer: { peers: [] } }), connect, getOwnerPairingChannel: () => null } });
  await vi.waitFor(() => expect(connect).toHaveBeenCalledWith(expect.objectContaining({ roomId })));
  await session.close();
});

it('does not connect anywhere on load when no desktop is paired', async () => {
  const connect = vi.fn(async () => {});
  const session = createChatSession({ storage: memoryStorage({}), service: createChatTestService(),
    swarm: { getState: () => ({ consumer: { peers: [] } }), connect, getOwnerPairingChannel: () => null } });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(connect).not.toHaveBeenCalledWith(expect.objectContaining({ roomId: expect.anything() }));
  await session.close();
});
