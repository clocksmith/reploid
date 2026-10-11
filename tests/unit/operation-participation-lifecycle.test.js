import { expect, it, vi } from 'vitest';
import { createOperationParticipation } from '../../self/pool/operation-participation.js';
import { createDocumentPackFixture } from '../fixtures/document-packs.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
async function fixture({ start = async () => {}, close = async () => {} } = {}) {
  const { configuration } = await createDocumentPackFixture();
  const executors = [], providers = [];
  const participation = createOperationParticipation({ networkOptions: () => ({}),
    executorFactory: () => {
      const executor = { close: vi.fn(async () => {}), getState: () => ({ active: false }) };
      executors.push(executor); return executor;
    },
    createProvider: options => {
      const provider = { start: vi.fn(start), close: vi.fn(close), getState: () => ({}), options };
      providers.push(provider); return provider;
    } });
  return { participation, executors, providers,
    start: () => participation.start({ model: configuration.embedding, approved: true }) };
}

it('coalesces overlapping stop calls and blocks replacement until owned cleanup settles', async () => {
  const cleanup = deferred();
  const { participation, providers, executors, start } = await fixture({ close: () => cleanup.promise });
  await start();
  const job = { body: { intent: { adapterSet: [] } } };
  expect(providers[0].options.authorize(job)).toBe(true);
  const first = participation.stop(), second = participation.stop();
  try {
    expect(providers[0].options.authorize(job)).toBe(false);
    await flush();
    expect(participation.getState().phase).toBe('stopping');
    await expect(start()).rejects.toThrow('Stop sharing');
  } finally { cleanup.resolve(); await Promise.allSettled([first, second]); }
  expect(providers[0].close).toHaveBeenCalledOnce();
  expect(executors[0].close).toHaveBeenCalledOnce();
  await start();
  expect(executors[1].close).not.toHaveBeenCalled();
  expect(participation.getState().phase).toBe('sharing');
  await participation.stop();
});

it('waits for an opening provider before reporting stop complete', async () => {
  const opening = deferred();
  const { participation, providers, start } = await fixture({ start: () => opening.promise });
  const starting = start();
  const rejected = expect(starting).rejects.toThrow('Sharing cancelled');
  await vi.waitFor(() => expect(providers).toHaveLength(1));
  let settled = false;
  const stopping = participation.stop().then(() => { settled = true; });
  try {
    await vi.waitFor(() => expect(providers[0].close).toHaveBeenCalled());
    await flush();
    expect(settled).toBe(false);
    expect(participation.getState().phase).toBe('stopping');
  } finally { opening.resolve(); await stopping; await rejected; }
  expect(participation.getState().phase).toBe('idle');
});

it('attempts executor cleanup after provider close fails and retains failed ownership for retry', async () => {
  const { participation, providers, executors, start } = await fixture();
  await start();
  providers[0].close.mockRejectedValueOnce(new Error('provider cleanup failed'));
  await expect(participation.stop()).rejects.toThrow();
  expect(executors[0].close).toHaveBeenCalledOnce();
  expect(participation.getState()).toMatchObject({ phase: 'failed' });
  await expect(start()).rejects.toThrow('Stop sharing');
  await participation.stop();
  expect(participation.getState()).toMatchObject({ phase: 'idle', modelId: null });
  await start();
  expect(executors[1].close).not.toHaveBeenCalled();
  await participation.stop();
});

it('keeps failed executor cleanup retryable instead of advertising idle capacity', async () => {
  const { participation, executors, start } = await fixture();
  await start();
  executors[0].close.mockRejectedValueOnce(new Error('owned allocation is still live'));
  await expect(participation.stop()).rejects.toThrow('Sharing cleanup failed');
  expect(participation.getState().phase).toBe('failed');
  await expect(start()).rejects.toThrow('Stop sharing');
  await participation.stop();
  expect(executors[0].close).toHaveBeenCalledTimes(2);
  expect(participation.getState().phase).toBe('idle');
});

it('cleans up a rejected provider start without deadlocking on its own opening', async () => {
  const { participation, providers, executors, start } = await fixture({ start: async () => { throw new Error('connection rejected'); } });
  await expect(start()).rejects.toThrow('connection rejected');
  expect(providers[0].close).toHaveBeenCalledOnce();
  expect(executors[0].close).toHaveBeenCalledOnce();
  expect(participation.getState()).toMatchObject({ phase: 'idle', error: 'connection rejected' });
});

it('stopping immediately after start prevents provider and executor creation', async () => {
  const { participation, providers, executors, start } = await fixture();
  const opening = start();
  const rejected = expect(opening).rejects.toThrow('Sharing cancelled');
  await participation.stop();
  await rejected;
  expect(providers).toHaveLength(0);
  expect(executors).toHaveLength(0);
  expect(participation.getState().phase).toBe('idle');
});
