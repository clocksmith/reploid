import { afterEach, expect, it, vi } from 'vitest';
import { createRemoteGenerationRequests } from '../../packages/reploid/src/mesh/remote-generation-requests.js';
afterEach(() => vi.useRealTimers());
const fixture = () => { const sendCancel = vi.fn(); return { sendCancel,
  requests: createRemoteGenerationRequests({ timeoutMs: 1000, maxPending: 1, sendCancel }) }; };
it('settles a throwing send even when cancellation transport also throws', async () => {
  vi.useFakeTimers(); const { requests, sendCancel } = fixture(); sendCancel.mockImplementation(() => { throw new Error('closed transport'); });
  await expect(requests.start({ requestId: 'a', providerPeerId: 'peer' }, () => { throw new Error('send failed'); })).rejects.toThrow('send failed');
  expect(requests.size).toBe(0); expect(vi.getTimerCount()).toBe(0); expect(sendCancel).toHaveBeenCalledOnce();
});
it('removes listeners and deadlines after a single settlement despite abort and duplicate completion', async () => {
  vi.useFakeTimers(); const { requests, sendCancel } = fixture(), controller = new AbortController();
  const result = requests.start({ requestId: 'a', providerPeerId: 'peer', signal: controller.signal }, () => true);
  const entry = requests.get('a', 'peer'); expect(requests.get('a', 'different-peer')).toBe(null);
  expect(requests.settle(entry, { response: 'first' })).toBe(true);
  expect(requests.settle(entry, { response: 'second' })).toBe(false); controller.abort();
  expect(await result).toBe('first'); expect(sendCancel).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('rejects null abort reasons, enforces admission and closes only outstanding requests', async () => {
  vi.useFakeTimers(); const { requests, sendCancel } = fixture(), controller = new AbortController();
  const first = requests.start({ requestId: 'a', providerPeerId: 'peer', signal: controller.signal }, () => true);
  const rejected = expect(first).rejects.toThrow('cancelled');
  await expect(requests.start({ requestId: 'b', providerPeerId: 'peer' }, () => true)).rejects.toThrow('limit');
  controller.abort(null); await rejected;
  const next = requests.start({ requestId: 'b', providerPeerId: 'peer' }, () => true);
  const closed = expect(next).rejects.toThrow('closed'); requests.close(); requests.close(); await closed;
  expect(sendCancel).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
