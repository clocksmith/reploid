import { expect, it } from 'vitest';
import { createWorkPeerOffers } from '../../self/host/work-peer-offers.js';

const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
};
const locks = () => {
  const held = new Set();
  return { request(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (held.has(name) && options.ifAvailable) return Promise.resolve(callback(null));
    // Registry operations are synchronous in this fixture, as localStorage reads/writes are.
    if (!options.ifAvailable) return Promise.resolve(callback({ name }));
    held.add(name);
    return Promise.resolve(callback({ name })).finally(() => held.delete(name));
  } };
};

it('connects concurrent and duplicated tabs with distinct identities, preserving reconnect and journal ownership', async () => {
  const shared = storage(), lease = locks(), firstTab = storage(), secondTab = storage();
  const make = tabStorage => createWorkPeerOffers({ storage: shared, tabStorage, locks: lease,
    roomId: 'test-room', evolution: {}, getTransport: () => ({ getConnectedPeers: () => [], onMessage() {} }) });
  const first = make(firstTab);
  const primary = await first.acquire();
  for (const [key, value] of firstTab.data) secondTab.setItem(key, value); // Browser Duplicate Tab.
  const second = make(secondTab);
  const secondary = await second.acquire();
  expect(secondary).not.toBe(primary);
  expect(await second.acquire()).toBe(secondary);
  await first.attach(); await second.attach();
  second.close(); await Promise.resolve();
  const reloaded = make(secondTab);
  expect(await reloaded.acquire()).toBe(secondary);
  expect(await first.acquire()).toBe(primary);
  reloaded.close(); first.close();
});

it('does not retain a lease when closed during acquisition', async () => {
  const shared = storage(), tabStorage = storage(), lease = locks();
  const make = () => createWorkPeerOffers({ storage: shared, tabStorage, locks: lease,
    roomId: 'test-room', evolution: {}, getTransport: () => null });
  const first = make(), opening = first.acquire(); first.close();
  await expect(opening).rejects.toThrow('Peer connection stopped');
  const second = make();
  expect(await second.acquire()).toBe([...shared.data.values()][0]);
  second.close();
});
