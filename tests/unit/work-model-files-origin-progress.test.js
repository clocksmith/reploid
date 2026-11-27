// @vitest-environment node
/**
 * Catalog-origin downloads in the host's model-file cache (apps/poolday/host/work-model-files.js `origin`): a transfer
 * fails only when no byte arrives for `originIdleTimeoutMs` (chat-files.json), never because a steady transfer is slow;
 * a transfer that fails part-way keeps its received bytes for a retry that asks only for the rest, and returns the
 * download-allowance bytes that never arrived. The origin is a fake stream the test feeds; time is fake.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../shared/vendor/reploid/artifacts/custody/exchange.js', () => ({ createCustodyExchange: vi.fn() }));
vi.mock('../../apps/poolday/infrastructure/pack-transfer-storage.js', () => ({
  openPeerPackFileCheckpoints: async () => ({ close() {}, getStats: async () => ({ storedBytes: 0 }) }) }));
vi.mock('../../apps/poolday/infrastructure/custody-supply-budget.js', () => ({
  openBrowserSupplyBudget: async ({ maxBytes }) => ({ getState: () => ({ maxBytes, reservedBytes: 0 }), reserve: async () => ({}), close() {} }),
  openBrowserAcquisitionBudget: async () => { throw Object.assign(new Error('none'), { code: 'CUSTODY_BUDGET_MISSING' }); } }));

import { createWorkModelFiles } from '../../apps/poolday/host/work-model-files.js';
import policy from '../../apps/poolday/config/chat-files.json' with { type: 'json' };
import { browserModelStorage } from '../fixtures/browser-model-storage.js';

const CHUNK = 64 * 1024, SIZE = 8 * CHUNK;
const body = new Uint8Array(SIZE).map((_, index) => (index * 7) % 251);
const hash = createHash('sha256').update(body).digest('hex');
const URL_ = 'https://replo.id/model-files/test/piece.bin';
const artifact = { path: 'piece.bin', role: 'adapter', url: URL_, sizeBytes: SIZE, hash: 'sha256:' + hash };

/** One response at a time: `push(n)` delivers the next n chunks of the requested range; nothing else arrives. */
function fakeOrigin() {
  const requests = [];
  let feed = null;
  const fetchImpl = vi.fn(async (url, { signal, headers } = {}) => {
    signal?.throwIfAborted();
    const range = headers?.Range ?? null, match = range && /bytes=(\d+)-(\d+)/.exec(range);
    const start = match ? Number(match[1]) : 0, end = match ? Number(match[2]) + 1 : SIZE;
    requests.push(range);
    let sent = start, controller;
    const stream = new ReadableStream({ start(c) { controller = c; } });
    signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    feed = count => {
      for (let i = 0; i < count && sent < end; i++) { controller.enqueue(body.slice(sent, Math.min(end, sent + CHUNK))); sent += CHUNK; }
      if (sent >= end) controller.close();
    };
    return new Response(stream, match ? { status: 206, headers: { 'content-range': `bytes ${start}-${end - 1}/${SIZE}` } } : { status: 200 });
  });
  return { fetchImpl, requests, push: count => feed(count) };
}

/** A download allowance the test reads: reserve returns the release the host gives back unreceived bytes with. */
function allowance() {
  const ledger = { reserved: 0, calls: [] };
  ledger.reserve = vi.fn(async bytes => { ledger.reserved += bytes; ledger.calls.push(['reserve', bytes]);
    return async unreceived => { ledger.reserved -= unreceived; ledger.calls.push(['release', unreceived]); }; });
  return ledger;
}

let storage;
beforeEach(() => {
  storage = browserModelStorage();
  vi.stubGlobal('navigator', storage.navigator);
  vi.stubGlobal('REPLOID_DOPPLER_STORAGE_MODULE_URL', new URL('../fixtures/doppler-storage-stub.js', import.meta.url).href);
  vi.stubGlobal('location', { href: 'https://replo.id/' });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // AbortSignal.timeout runs on the platform clock; follow the fake one so a whole-transfer deadline would show.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('signal timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const settle = async promise => {
  let outcome = null;
  promise.then(value => { outcome = { value }; }, error => { outcome = { error }; });
  return () => outcome;
};

it('a slow transfer that keeps making progress completes, however long it takes', async () => {
  const origin = fakeOrigin(), budget = allowance();
  const files = createWorkModelFiles({ getTransport: () => null, fetchImpl: origin.fetchImpl });
  const outcome = await settle(files.acquireAdapter(artifact, { reserveDownload: budget.reserve }));
  await vi.waitFor(() => expect(origin.requests.length).toBe(1));
  // One chunk every 20 s: 160 s in all, far past the no-progress limit as a whole, never idle that long.
  for (let chunk = 0; chunk < SIZE / CHUNK; chunk++) {
    await vi.advanceTimersByTimeAsync(policy.originIdleTimeoutMs * 2 / 3);
    expect(outcome()?.error).toBeUndefined();
    origin.push(1);
  }
  await vi.waitFor(() => expect(outcome()).not.toBeNull());
  expect(outcome().error).toBeUndefined();
  expect(Buffer.from(outcome().value)).toEqual(Buffer.from(body));
  expect(budget.reserved).toBe(SIZE);
  await files.close();
});

it('a transfer that stops making progress fails once no byte has arrived for the no-progress limit, with a clear error', async () => {
  const origin = fakeOrigin(), budget = allowance();
  const files = createWorkModelFiles({ getTransport: () => null, fetchImpl: origin.fetchImpl });
  const outcome = await settle(files.acquireAdapter(artifact, { reserveDownload: budget.reserve }));
  await vi.waitFor(() => expect(origin.requests.length).toBe(1));
  origin.push(3);
  await vi.advanceTimersByTimeAsync(policy.originIdleTimeoutMs - 1000);
  expect(outcome()).toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(outcome()).not.toBeNull());
  expect(outcome().error).toMatchObject({ code: 'ORIGIN_STALLED', message: `Model file download stalled: no data for ${policy.originIdleTimeoutMs / 1000} s` });
  // The allowance keeps the bytes that arrived and gets back the ones that never did.
  expect(budget.reserved).toBe(3 * CHUNK);
  await files.close();
});

it('a retry after a stall keeps the received bytes and asks the origin only for the rest, then verifies the whole file', async () => {
  const origin = fakeOrigin(), budget = allowance();
  const files = createWorkModelFiles({ getTransport: () => null, fetchImpl: origin.fetchImpl });
  const first = await settle(files.acquireAdapter(artifact, { reserveDownload: budget.reserve }));
  await vi.waitFor(() => expect(origin.requests.length).toBe(1));
  origin.push(5);
  await vi.advanceTimersByTimeAsync(policy.originIdleTimeoutMs + 1000);
  await vi.waitFor(() => expect(first()?.error).toBeDefined());

  const retry = await settle(files.acquireAdapter(artifact, { reserveDownload: budget.reserve }));
  await vi.waitFor(() => expect(origin.requests.length).toBe(2));
  expect(origin.requests[1]).toBe(`bytes=${5 * CHUNK}-${SIZE - 1}`);
  origin.push(3);
  await vi.waitFor(() => expect(retry()).not.toBeNull());
  expect(retry().error).toBeUndefined();
  expect(Buffer.from(retry().value)).toEqual(Buffer.from(body));
  // Each byte is charged once: the retry reserved only what was missing.
  expect(budget.calls).toEqual([['reserve', SIZE], ['release', 3 * CHUNK], ['reserve', 3 * CHUNK]]);
  expect(budget.reserved).toBe(SIZE);
  await files.close();
});

it('an origin fetch with no allowance (weight supply\'s piece path) also fails on a stall rather than waiting forever', async () => {
  const origin = fakeOrigin();
  const files = createWorkModelFiles({ getTransport: () => null, fetchImpl: origin.fetchImpl });
  const outcome = await settle(files.acquireAdapter(artifact, {}));
  await vi.waitFor(() => expect(origin.requests.length).toBe(1));
  origin.push(1);
  await vi.advanceTimersByTimeAsync(policy.originIdleTimeoutMs + 1000);
  await vi.waitFor(() => expect(outcome()).not.toBeNull());
  expect(outcome().error).toMatchObject({ code: 'ORIGIN_STALLED' });
  await files.close();
});

it('keeps the no-progress limit separate from the channel timeout and from Ask\'s queue window', async () => {
  const timing = (await import('../../apps/poolday/config/peer-timing.json', { with: { type: 'json' } })).default;
  expect(Number.isSafeInteger(policy.originIdleTimeoutMs) && policy.originIdleTimeoutMs > 0).toBe(true);
  expect(Object.keys(policy.channel)).not.toContain('originIdleTimeoutMs');
  expect(Object.keys(timing.generic ?? {})).not.toContain('originIdleTimeoutMs');
});

it('the download ledger returns only reserved bytes, never more than were reserved, under the same allowance', async () => {
  const { releaseCustodyBudget, reserveCustodyBudget } = await import('../../packages/reploid/src/artifacts/custody/supply-budget.js');
  const record = { schema: 'reploid.custody-acquisition-budget/v1', maxBytes: 100, reservedBytes: 0 };
  const reserved = reserveCustodyBudget(record, 60, 100, 'acquisition');
  expect(releaseCustodyBudget(reserved, 45, 100)).toMatchObject({ reservedBytes: 15 });
  expect(() => releaseCustodyBudget(reserved, 61, 100)).toThrow(/more than was reserved/);
  expect(() => releaseCustodyBudget(reserved, 10, 200)).toThrow(/renewal is not authorized/);
  expect(() => releaseCustodyBudget(reserved, -1, 100)).toThrow(/Invalid/);
});
