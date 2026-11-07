// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createChatPeerLifecycle } from '../fixtures/chat-peer-lifecycle.js';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';

const options = { authorizeDisclosure: () => true };
const newThread = f => f.app.createThread({ model: f.model, permissions: { sharingScope: 'mesh', executionLocation: 'network' } });
const thread = (f, id) => f.app.getState().threads.find(value => value.id === id);
const requests = f => f.wire.filter(row => row.type === 'reploid:generation-request');

it('retains exact adapter, reported hardware and follow-up context through completed answers and reload', async () => {
  const f = await createChatPeerLifecycle();
  try {
    const id = newThread(f);
    const first = await f.app.send(id, 'First question', options);
    expect(first.status, first.error).toBe('completed');
    expect(first.execution).toMatchObject({ placement: 'peer-whole-request', modelIdentity: f.model.identity,
      adapterIdentities: [f.adapter.identity], hardware: { vendor: 'Fixture', description: 'Reported GPU ' + f.calls[0].index } });
    const recorded = structuredClone(first.execution);
    expect(await verifyReceipt(f.results[0].executionReceipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
    await f.advertise(f.calls[0].index, { hardware: { vendor: 'Fixture', description: 'Different current GPU' } });
    expect(thread(f, id).attempts[0].execution).toEqual(recorded);
    await f.reload();
    expect(f.calls).toHaveLength(1);
    expect(thread(f, id).attempts[0].execution).toEqual(recorded);
    expect((await f.app.send(id, 'Follow-up', options)).status).toBe('completed');
    expect(f.calls[1].messages).toEqual([{ role: 'user', content: 'First question' },
      { role: 'assistant', content: 'answer' }, { role: 'user', content: 'Follow-up' }]);
    expect(f.calls.every(call => call.controls.adapterIdentities[0] === f.adapter.identity)).toBe(true);
    expect(f.service.open).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

it('retains partial output on provider loss and requires an explicit newly authorized retry on the remaining peer', async () => {
  const f = await createChatPeerLifecycle(), release = Promise.withResolvers();
  try {
    f.setRun(async call => { call.update('partial'); await release.promise; return 'stale answer'; });
    const id = newThread(f), approval = vi.fn(() => true);
    const first = f.app.send(id, 'Original question', { authorizeDisclosure: approval });
    await vi.waitFor(() => expect(thread(f, id).messages.at(-1).content).toBe('partial'));
    const lost = f.calls[0].index;
    f.lose(lost);
    const failed = await first;
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringMatching(/disconnected/) });
    expect(thread(f, id).messages.at(-1).content).toBe('partial');
    expect(f.calls).toHaveLength(1);
    expect(approval).toHaveBeenCalledTimes(1);
    release.resolve();
    f.setRun(async call => { call.update('replacement answer'); return 'replacement answer'; });
    const retried = await f.app.retry(id, failed.id, { authorizeDisclosure: approval });
    expect(retried, retried.error).toMatchObject({ status: 'completed', retryOf: failed.id });
    expect(retried.id).not.toBe(failed.id);
    expect(f.calls[1].index).not.toBe(lost);
    expect(f.calls[1].messages).toEqual([{ role: 'user', content: 'Original question' }]);
    expect(approval).toHaveBeenCalledTimes(2);
    expect(retried.authorization.recipientIdentity).not.toBe(failed.authorization.recipientIdentity);
    expect(thread(f, id).attempts[0]).toMatchObject({ status: 'failed' });
    expect(retried.execution.adapterIdentities).toEqual([f.adapter.identity]);
    expect(thread(f, id).messages.at(-1).content).toBe('replacement answer');
    expect(f.errors).toEqual([]);
  } finally { release.resolve(); await f.close(); }
});

it('cancels one concurrent conversation, ignores late output and lets the other finish', async () => {
  const f = await createChatPeerLifecycle(), release = Promise.withResolvers();
  try {
    f.setRun(async call => { call.update('partial'); await release.promise; call.update('late'); return 'partiallate'; });
    const a = newThread(f), b = newThread(f);
    const first = f.app.send(a, 'Stop me', options), second = f.app.send(b, 'Keep me', options);
    await vi.waitFor(() => expect(f.calls).toHaveLength(2));
    await vi.waitFor(() => expect(thread(f, a).messages.at(-1).content).toBe('partial'));
    const cancelling = f.app.cancel(a);
    await vi.waitFor(() => expect(f.calls.find(call => call.messages[0].content === 'Stop me').controls.signal.aborted).toBe(true));
    expect(f.calls.find(call => call.messages[0].content === 'Keep me').controls.signal.aborted).toBe(false);
    release.resolve(); await cancelling;
    expect((await first).status).toBe('cancelled');
    const completed = await second;
    expect(completed.status, completed.error).toBe('completed');
    expect(thread(f, a).messages.at(-1).content).toBe('partial');
    expect(thread(f, b).messages.at(-1).content).toBe('partiallate');
    expect(f.errors).toEqual([]);
  } finally { release.resolve(); await f.close(); }
});

it.each(['modelIdentity', 'adapterIdentities'])('rejects a provider that changes %s during execution', async field => {
  const f = await createChatPeerLifecycle();
  try {
    f.setRun(async call => {
      f.endpoints[call.index].state[field] = field === 'modelIdentity' ? 'sha256:' + 'd'.repeat(64) : [];
      return 'unrequested variant';
    });
    const id = newThread(f), attempt = await f.app.send(id, 'Keep this variant', options);
    expect(attempt).toMatchObject({ status: 'failed', error: expect.stringMatching(/identity|changed/) });
    expect(f.calls).toHaveLength(1);
    expect(thread(f, id).messages.at(-1).content).toBe('');
    expect(f.results).toHaveLength(0);
    expect(f.service.open).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

it.each(['modelIdentity', 'adapterIdentities'])('rejects changed %s during authorization without dispatch or silent fallback', async field => {
  const f = await createChatPeerLifecycle();
  try {
    f.setBeforeApproval(async request => {
      const index = f.endpoints.findIndex(endpoint => endpoint.id === request.peerId);
      await f.advertise(index, { [field]: field === 'modelIdentity' ? 'sha256:' + 'c'.repeat(64) : [] });
    });
    const attempt = await f.app.send(newThread(f), 'Exact variant only', options);
    expect(attempt).toMatchObject({ status: 'failed', error: expect.stringMatching(/no longer ready|changed/) });
    expect(requests(f)).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    expect(f.service.open).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

it('leaves an unavailable adapter unavailable even when base-model peers are ready', async () => {
  const f = await createChatPeerLifecycle();
  try {
    await f.advertise(1, { adapterIdentities: [] }); await f.advertise(2, { adapterIdentities: [] });
    const attempt = await f.app.send(newThread(f), 'Specialist only', options);
    expect(attempt).toMatchObject({ status: 'failed', error: expect.stringMatching(/adapter/) });
    expect(f.calls).toHaveLength(0);
    expect(f.service.open).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

it('refuses a replacement recipient when the explicit retry is not authorized', async () => {
  const f = await createChatPeerLifecycle(), release = Promise.withResolvers();
  try {
    f.setRun(async call => { call.update('partial'); await release.promise; return 'partial'; });
    const id = newThread(f), first = f.app.send(id, 'Private prompt', options);
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    f.lose(f.calls[0].index);
    const failed = await first;
    expect(failed.status).toBe('failed');
    release.resolve();
    const decline = vi.fn(() => false);
    const retried = await f.app.retry(id, failed.id, { authorizeDisclosure: decline });
    expect(decline).toHaveBeenCalledTimes(1);
    expect(retried.status).not.toBe('completed');
    expect(f.calls).toHaveLength(1);
    expect(requests(f)).toHaveLength(1);
    expect(f.service.open).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  } finally { release.resolve(); await f.close(); }
});
