// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createJourneyNetwork } from '../helpers/journey-network.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

// Real requester, mesh, provider admission, journal and credit ledger; the transport and the generator are test-owned.
it('after the named provider is lost mid-answer, a retry under the same policy discloses nothing to another ready provider', async () => {
  const fixture = await createJourneyNetwork({ providers: [
    { name: 'named', tokensPerSecond: 40, holdsModel: true },
    { name: 'other', tokensPerSecond: 40, holdsModel: true }
  ] });
  cleanup.push(() => fixture.close());
  const { hub, model, requester, credits } = fixture;
  const named = fixture.seatOf('named'), other = fixture.seatOf('other');
  const messages = [{ role: 'user', content: 'Public fixture for privacy after provider loss.' }];
  const restricted = createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [named.identity.peerId] });
  const held = () => credits.snapshot().accounts.find(row => row.id === 'computer-requester').held;
  // Everything the transport carries to the provider that is not named, from the first message on.
  const toOther = [];
  cleanup.push(hub.lose((entry, payload) => {
    if (entry.to === other.run.id) toOther.push({ type: entry.type, carriesPrompt: JSON.stringify(payload).includes(messages[0].content) });
    return false;
  }));
  await fixture.expectReady(2);
  const attempt = (attemptId, privacy, timeoutMs, extra = {}) => requester.generate(
    { model, messages, threadId: 'privacy-after-loss', attemptId, privacy },
    { signal: AbortSignal.timeout(timeoutMs), requestApproval: async () => true, ...extra })
    .then(result => ({ completed: true, charge: result.serviceCredit?.charge ?? null }),
      error => ({ completed: false, error: error.message, charge: error.serviceCredit?.charge ?? null }));

  let stopping, reservationId, route, deltas = 0;
  const interrupted = await attempt('interrupted', restricted, 5000, {
    onReservation: id => { reservationId = id; },
    onRoute: value => { route = value; },
    onDelta() { deltas += 1; stopping ??= fixture.stop('named'); }
  });
  await stopping;
  expect(interrupted.completed).toBe(false);
  expect(route.providerIdentity).toBe(named.identity.peerId);
  expect(deltas).toBeGreaterThanOrEqual(1);
  expect(held()).toBeGreaterThan(0);
  expect(other.executions).toBe(0);

  // The other provider is ready and holds the model. The policy still names only the lost one.
  expect(fixture.readyPeers()).toHaveLength(1);
  const retry = await attempt('restricted-retry', restricted, 1200);
  expect(retry.completed).toBe(false);
  expect(toOther.filter(row => row.type === 'reploid:generation-request')).toEqual([]);
  expect(toOther.filter(row => row.carriesPrompt)).toEqual([]);
  expect(other.executions).toBe(0);

  // Control: the same provider serves the same prompt once a policy names it, so the refusal above was the policy.
  const control = await attempt('separately-authorized', createExecutionPolicy('restricted', {
    placement: 'network-allowed', allowedRecipients: [other.identity.peerId] }), 5000);
  expect(control.completed).toBe(true);
  expect(other.executions).toBe(1);
  expect(control.charge).toBeGreaterThan(0);
  // The same observer does see the request once it is allowed, so the empty lists above were not a blind spot.
  expect(toOther.filter(row => row.type === 'reploid:generation-request' && row.carriesPrompt)).toHaveLength(1);

  // The interrupted attempt's hold is released uncharged once the claim window has passed.
  const heldBeforeExpiry = held();
  fixture.passClaimWindow();
  const recovered = await requester.recover({ reservationId, messages }, { signal: AbortSignal.timeout(5000) });
  expect(recovered.serviceCredit?.charge).toBe(0);
  expect(held()).toBeLessThan(heldBeforeExpiry);
  expect(held()).toBe(0);
}, 30000);

// Known limit, pinned so that a change is deliberate: the requester decides who may receive a request, and
// the provider decides whether to run it only after the request has arrived. A named recipient that refuses
// has therefore received the prompt. It runs nothing, and the request went to nobody else.
it('a named recipient that refuses to run a request has received it, has executed nothing, and is the only recipient', async () => {
  const refused = Promise.withResolvers(), cancel = new AbortController();
  const f = await createRecoveryMesh(cleanup, { authorize: async input => {
    if (input.action !== 'mesh.execute') return true;
    refused.resolve(input.request.messages);
    return false;
  } });
  const privacy = createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [f.identities[1].peerId] });
  const attempt = f.requesterMesh.generate(f.messages, null, { modelId: 'model', modelIdentity: 'sha256:' + 'a'.repeat(64), privacy, signal: cancel.signal });
  const rejected = expect(attempt).rejects.toThrow('fixture cancelled');
  try {
    expect(await refused.promise).toEqual(f.messages);
    const requests = f.wire.filter(row => row.type === 'reploid:generation-request');
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.privacyBinding.route.hops.map(row => row.recipient)).toEqual([f.identities[1].peerId]);
    expect(f.executions).toBe(0);
  } finally {
    cancel.abort(Error('fixture cancelled'));
    await rejected;
  }
});
