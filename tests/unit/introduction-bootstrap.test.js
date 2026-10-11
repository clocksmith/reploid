import { it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { bootstrapIntroductions, createWebSocketIntroductionRoute } from '../../packages/reploid/src/transport/introduction-bootstrap.js';
import { createContact } from '../../packages/reploid/src/transport/introduction-records.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import policy from '../../packages/reploid/src/transport/introduction-policy.json' with { type: 'json' };
vi.stubGlobal('crypto', webcrypto);
async function fixture() {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const record = (await createContact({ identity, peerId: 'remote', roomId: 'room', sequence: 1, policy })).record;
  const introductions = { exportContact: () => ({ body: { roomId: 'room' } }), connect: vi.fn(), receive: vi.fn() };
  return { record, introductions };
}
it('tries retained routes then independent alternatives, records failures, saves only verified public contacts and closes sessions', async () => {
  const { record, introductions } = await fixture(), tried = [], close = vi.fn();
  const store = { load: async () => [{ routeId: 'offline', contact: record }], save: vi.fn() };
  const result = await bootstrapIntroductions({ introductions, store, isConnected: () => true, routes: [
    { id: 'working', open: async () => { tried.push('working'); return { contact: record, publish() {}, close }; } },
    { id: 'offline', open: async () => { tried.push('offline'); throw new Error('unreachable'); } }
  ] });
  expect(tried).toEqual(['offline', 'working']);
  expect(result).toMatchObject({ routeId: 'working', peerId: 'remote', failures: [{ routeId: 'offline', message: 'unreachable' }] });
  expect(close).toHaveBeenCalledOnce(); expect(store.save).toHaveBeenCalledOnce();
  expect(JSON.stringify(store.save.mock.calls)).not.toContain('private');
});
it('rejects changed pinned identities and malformed contacts without negotiating', async () => {
  const { record, introductions } = await fixture(), other = await fixture();
  const close = vi.fn();
  await expect(bootstrapIntroductions({ introductions, isConnected: () => true,
    store: { load: async () => [{ routeId: 'pinned', contact: record }], save() {} },
    routes: [{ id: 'pinned', open: async () => ({ contact: other.record, publish() {}, close }) }]
  })).rejects.toThrow('No introduction route');
  expect(introductions.connect).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});
it('aborts pending opening and closes a late session without saving or negotiating', async () => {
  const { record, introductions } = await fixture(), controller = new AbortController(), close = vi.fn();
  let release;
  const result = bootstrapIntroductions({ introductions, signal: controller.signal, isConnected: () => false,
    routes: [{ id: 'pending', open: () => new Promise(resolve => { release = resolve; }) }] });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  controller.abort(new Error('Stopped'));
  await expect(result).rejects.toThrow('Stopped');
  release({ contact: record, publish() {}, close });
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(introductions.connect).not.toHaveBeenCalled();
});
it('requires secure or loopback participant endpoints and explicit pinned identities', () => {
  expect(() => createWebSocketIntroductionRoute({ id: 'test', url: 'ws://public.example', expectedParticipantId: 'peer:test' })).toThrow('WSS');
  expect(() => createWebSocketIntroductionRoute({ id: 'test', url: 'wss://public.example' })).toThrow('Pinned');
});

it('cancels a blocked contact store before opening any route', async () => {
  const { introductions } = await fixture(), controller = new AbortController(), open = vi.fn();
  const result = bootstrapIntroductions({ introductions, signal: controller.signal, isConnected: () => false,
    store: { load: () => new Promise(() => {}), save() {} }, routes: [{ id: 'route', open }] });
  controller.abort(new Error('Stopped storage'));
  await expect(result).rejects.toThrow('Stopped storage'); expect(open).not.toHaveBeenCalled();
});

it('bounds a stalled route and attempts the next route', async () => {
  const { record, introductions } = await fixture(), close = vi.fn();
  const deadlines = [], stalled = vi.fn(() => new Promise(() => {}));
  // Drive expiry explicitly; contact signature verification need not race a real 10ms clock.
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const controller = new AbortController(); deadlines.push(controller); return controller.signal;
  });
  try {
    const pending = bootstrapIntroductions({ introductions, isConnected: () => true,
      policy: { ...policy, messageTtlMs: 10 }, routes: [
        { id: 'stalled', open: stalled },
        { id: 'next', open: async () => ({ contact: record, publish() {}, close }) }
      ] });
    await vi.waitFor(() => expect(stalled).toHaveBeenCalledOnce());
    deadlines[1].abort(new DOMException('Route deadline expired', 'TimeoutError'));
    const result = await pending;
    expect(result.routeId).toBe('next');
    expect(result.failures).toEqual([{ routeId: 'stalled', message: 'Route deadline expired' }]);
    expect(timeout.mock.calls).toEqual([[10], [10], [10]]);
    expect(close).toHaveBeenCalledOnce();
  } finally { timeout.mockRestore(); }
});
