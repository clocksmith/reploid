// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openNativeGenerationJournal } from '../../server/native-generation-journal.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const fixture = options => createRecoveryMesh(cleanup, options);

it('recovers a lost completion after provider restart, verifies it, and never executes the replay', async () => {
  const f = await fixture(); f.drop(); const controller = new AbortController();
  const running = f.run(controller.signal); const rejected = expect(running).rejects.toThrow('disconnected');
  await vi.waitFor(() => expect(f.wire.some(item => item.type === 'reploid:generation-result')).toBe(true));
  controller.abort(Error('disconnected')); await rejected;
  await f.restartProvider();
  const recovered = await f.recover();
  expect(recovered).toMatchObject({ status: 'completed', response: { content: 'actual answer', executionReceipt: { version: 2, inputTokens: 7, outputTokens: 3 } } });
  await f.replay(); expect(f.executions).toBe(1); expect(f.errors).toEqual([]);
  await f.replay({ recoverable: false }); expect(f.executions).toBe(1);
  f.tamper(); await expect(f.recover()).rejects.toThrow('Unverified recovered completion');
});
it('bounds retained result bodies while keeping durable admission fences and immutable terminal outcomes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-retention-'));
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'journal.sqlite');
  let journal = await openNativeGenerationJournal({ file, maxResults: 1, maxResultBytes: 256 });
  cleanup.push(() => journal.close());
  const a = { provider: 'provider', consumer: 'consumer', requestId: 'a' }, b = { ...a, requestId: 'b' };
  expect(await journal.claim(a)).toBe(true); await journal.finish(a, { content: 'first' });
  expect(await journal.claim(b)).toBe(true); await journal.finish(b, { content: 'second' });
  journal.close(); journal = await openNativeGenerationJournal({ file, maxResults: 1, maxResultBytes: 256 });
  expect((await journal.get(a)).outcome).toBeNull(); expect(await journal.claim(a)).toBe(false);
  await expect(journal.finish(a, { content: 'changed' })).rejects.toThrow('already finished');
  expect((await journal.get(b)).outcome).toEqual({ content: 'second' });
  const c = { ...a, requestId: 'c' }; await journal.claim(c);
  await expect(journal.finish(c, { content: 'x'.repeat(300) })).rejects.toThrow('byte limit');
  expect((await journal.get(c)).outcome).toBeNull();
});
it('does not acknowledge cancellation before the executor drains and cleanup confirms settlement', async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let confirmed = 0;
  const f = await fixture({ execute: async (_messages, _update, controls) => { entered.resolve(); await release.promise; controls.signal.throwIfAborted(); },
    settle: async () => { confirmed++; return true; } });
  const controller = new AbortController(), running = f.run(controller.signal);
  const rejected = expect(running).rejects.toThrow('cancel'); await entered.promise; controller.abort(Error('cancel')); await rejected;
  expect(await f.recover()).toEqual({ status: 'unresolved' }); expect(confirmed).toBe(0);
  release.resolve();
  await vi.waitFor(() => expect(f.wire.some(item => item.payload.terminal)).toBe(true));
  await f.restartProvider();
  expect(await f.recover()).toMatchObject({ status: 'cancelled', terminal: { cleanup: 'settled', usage: null } });
  expect(f.executions).toBe(1);
});
it('retains uncertainty when the owning host cannot confirm cleanup', async () => {
  const f = await fixture({ execute: async () => { throw Error('runtime and cleanup failed'); }, settle: async () => { throw Error('still draining'); } });
  await expect(f.run()).rejects.toThrow('runtime and cleanup failed');
  await f.restartProvider(); expect(await f.recover()).toEqual({ status: 'unresolved' });
  await f.replay(); expect(f.executions).toBe(1);
});
