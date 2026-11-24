// @vitest-environment node
// One pinned model, two providers that can serve the request and one that cannot. Real: identities, mesh, admission,
// journal and the credit ledger. Test-owned: the transport and a generator with a fixed answer. Not physical peers.
import { afterEach, expect, it } from 'vitest';
import { createJourneyNetwork, JOURNEY_ANSWER, waitFor } from '../helpers/journey-network.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const messages = [{ role: 'user', content: 'Public fixture for the whole-model request order.' }];
const LIMIT = 5;

async function network() {
  const fixture = await createJourneyNetwork({ providers: [
    { name: 'fastest-without-limit', tokensPerSecond: 400, holdsModel: true },
    { name: 'faster', tokensPerSecond: 200, holdsModel: true, appliesOutputLimit: true },
    { name: 'slower', tokensPerSecond: 40, holdsModel: true, appliesOutputLimit: true }
  ] });
  cleanup.push(() => fixture.close());
  const account = id => fixture.credits.snapshot().accounts.find(row => row.id === id);
  const send = (attemptId, controls) => fixture.requester.generate({ model: fixture.model, messages, threadId: 'order', attemptId,
    settings: normalizeGenerationSettings({ maxOutputTokens: LIMIT }),
    privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }) }, controls);
  await fixture.rank(messages, true);
  return { ...fixture, account, send, executions: () => fixture.seats.map(seat => seat.executions) };
}

it('filters, ranks, quotes, holds, streams and settles once, in that order', async () => {
  const f = await network();
  const steps = [];
  const result = await f.send('complete', {
    signal: AbortSignal.timeout(5000),
    requestApproval: async preview => {
      steps.push('quote');
      expect(preview.recipientIdentity).toBe(f.seatOf('faster').identity.peerId);
      expect(preview.serviceCreditQuote).toMatchObject({ maxOutputTokens: LIMIT, maximum: LIMIT, creditsPerOutputToken: 1 });
      expect(f.account('computer-requester').held).toBe(0);
      expect(f.executions()).toEqual([0, 0, 0]);
      return true;
    },
    onReservation: () => { steps.push('hold'); expect(f.account('computer-requester').held).toBe(LIMIT); },
    onRoute: route => { steps.push('route'); expect(route.placement.candidates).toHaveLength(2); },
    onDelta: () => { if (!steps.includes('stream')) steps.push('stream'); expect(f.account('computer-requester').held).toBe(LIMIT); }
  });
  steps.push('settled');
  expect(steps).toEqual(['quote', 'hold', 'route', 'stream', 'settled']);
  expect(result.content).toBe(JOURNEY_ANSWER.slice(0, LIMIT).join(''));
  expect(result.usage.outputTokens).toBe(LIMIT);
  expect(result.serviceCredit).toMatchObject({ charge: LIMIT, outputTokens: LIMIT });
  expect(f.executions()).toEqual([0, 1, 0]);
  expect(f.account('computer-requester')).toMatchObject({ balance: -LIMIT, held: 0 });
  expect(f.account('computer-faster').balance).toBe(LIMIT);
  expect(f.outcomes.filter(outcome => outcome.attemptId === 'complete')).toHaveLength(1);
  // Asking again for a settled reservation reports the same settlement and moves nothing.
  const again = await f.requester.recover({ reservationId: result.serviceCredit.id, messages, settings: normalizeGenerationSettings({ maxOutputTokens: LIMIT }) },
    { signal: AbortSignal.timeout(5000) });
  expect(again.serviceCredit.charge).toBe(LIMIT);
  expect(f.account('computer-requester')).toMatchObject({ balance: -LIMIT, held: 0 });
}, 30000);

it('a declined quote holds nothing and sends nothing', async () => {
  const f = await network();
  await expect(f.send('declined', { signal: AbortSignal.timeout(5000), requestApproval: async () => false })).rejects.toThrow();
  expect(f.account('computer-requester')).toMatchObject({ balance: 0, held: 0 });
  expect(f.executions()).toEqual([0, 0, 0]);
}, 30000);

it('cancelling while streaming releases the hold without a charge or another provider', async () => {
  const f = await network();
  const stop = new AbortController();
  await expect(f.send('cancelled', { signal: stop.signal, requestApproval: async () => true,
    onDelta: () => stop.abort(Error('Stopped by the person')) })).rejects.toThrow();
  await waitFor(() => f.account('computer-requester').held === 0, { label: 'hold release after cancel' });
  expect(f.account('computer-requester').balance).toBe(0);
  expect(f.account('computer-faster').balance).toBe(0);
  expect(f.executions()).toEqual([0, 1, 0]);
}, 30000);

it('a provider lost while streaming is not replaced, and its hold is released without a charge', async () => {
  const f = await network();
  let reservationId, stopping;
  await expect(f.send('dropped', { signal: AbortSignal.timeout(5000), requestApproval: async () => true,
    onReservation: id => { reservationId = id; }, onDelta: () => { stopping ??= f.stop('faster'); } })).rejects.toThrow();
  await stopping;
  expect(f.executions()).toEqual([0, 1, 0]);
  expect(f.account('computer-requester').held).toBe(LIMIT);
  f.passClaimWindow();
  const closed = await f.requester.recover({ reservationId, messages, settings: normalizeGenerationSettings({ maxOutputTokens: LIMIT }) },
    { signal: AbortSignal.timeout(5000) });
  expect(closed.serviceCredit?.charge).toBe(0);
  expect(f.account('computer-requester')).toMatchObject({ balance: 0, held: 0 });
  expect(f.account('computer-faster').balance).toBe(0);
}, 30000);

it('a provider that stops answering ends the request once, keeps its text, clears the hold and gets no new work', async () => {
  const f = await network();
  let partial = '', providerId = null, reported = false;
  await expect(f.send('silent', { signal: AbortSignal.timeout(5000), requestApproval: async () => true,
    onRoute: route => { providerId = route.providerId; },
    onDelta: delta => { partial += delta.text; if (!reported) { reported = true; f.requesterBus.emit('swarm:peer-unresponsive', { peerId: providerId }); } }
  })).rejects.toThrow('Execution peer disconnected');
  expect(partial).not.toBe('');
  expect(f.outcomes.filter(outcome => outcome.attemptId === 'silent')).toHaveLength(1);
  await waitFor(() => f.account('computer-requester').held === 0, { label: 'hold release after the provider went silent' });
  expect(f.account('computer-requester').balance).toBe(0);
  expect(f.account('computer-faster').balance).toBe(0);
  expect(f.executions()).toEqual([0, 1, 0]);
  // Its next request goes to the other eligible computer, and an answer from the silent one restores it.
  const next = await f.send('after-silence', { signal: AbortSignal.timeout(5000), requestApproval: async preview => {
    expect(preview.recipientIdentity).toBe(f.seatOf('slower').identity.peerId); return true; } });
  expect(next.usage.outputTokens).toBe(LIMIT);
  f.requesterBus.emit('swarm:peer-responsive', { peerId: providerId });
  expect(f.requesterMesh.getSwarmSnapshot().peers.find(peer => peer.peerId === providerId).unresponsive).toBeUndefined();
}, 30000);
