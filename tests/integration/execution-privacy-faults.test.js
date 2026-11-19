// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createJourneyNetwork } from '../helpers/journey-network.js';
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

it('a provider checks the requester\'s credit from the commitment, and declines before the prompt when the ledger refuses', async () => {
  const fixture = await createJourneyNetwork({ providers: [{ name: 'named', tokensPerSecond: 40, holdsModel: true }] });
  cleanup.push(() => fixture.close());
  const { hub, model, requester, credits } = fixture;
  const named = fixture.seatOf('named');
  const messages = [{ role: 'user', content: 'Public fixture for credit before disclosure.' }];
  const restricted = createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [named.identity.peerId] });
  // Everything the transport carries to the provider. While `forge` is set, the commitment in the admission
  // question is changed in transit, so the provider asks the ledger about a commitment nobody reserved.
  const toProvider = [];
  let forge = false;
  cleanup.push(hub.lose((entry, payload) => {
    if (entry.to !== named.run.id) return false;
    if (forge && entry.type === 'reploid:generation-admit') payload.promptCommitment = 'sha256:' + 'f'.repeat(64);
    toProvider.push({ type: entry.type, commitment: payload?.promptCommitment ?? null, carriesPrompt: JSON.stringify(payload).includes(messages[0].content) });
    return false;
  }));
  await fixture.expectReady(1);
  const attempt = attemptId => {
    let reservationId = null;
    return requester.generate({ model, messages, threadId: 'credit-before-disclosure', attemptId, privacy: restricted },
      { signal: AbortSignal.timeout(5000), requestApproval: async () => true, onReservation: id => { reservationId = id; } })
      .then(result => ({ completed: true, reservationId, charge: result.serviceCredit?.charge ?? null }),
        error => ({ completed: false, reservationId, error: error.message }));
  };

  // Served: the reservation binds the very commitment the provider was asked to admit.
  const served = await attempt('served');
  expect(served.completed).toBe(true);
  const admitted = toProvider.find(row => row.type === 'reploid:generation-admit');
  const binding = credits.request(served.reservationId).binding;
  expect(binding.admissionVersion).toBe(2);
  expect(binding.admission).toEqual({ schema: 'reploid.credit-preadmission/v1', commitment: admitted.commitment });
  expect(toProvider.map(row => row.type).filter(type => type.startsWith('reploid:generation-')).slice(0, 2))
    .toEqual(['reploid:generation-admit', 'reploid:generation-request']);
  expect(named.executions).toBe(1);

  // Refused by the ledger: the provider declines, and no message carrying the prompt reaches it.
  const mark = toProvider.length;
  forge = true;
  const refused = await attempt('refused');
  expect(refused.completed).toBe(false);
  expect(refused.error).toBe('The provider declined this request. The prompt was not sent.');
  const after = toProvider.slice(mark);
  expect(after.filter(row => row.type === 'reploid:generation-admit')).toHaveLength(1);
  expect(after.filter(row => row.type === 'reploid:generation-request')).toEqual([]);
  expect(after.filter(row => row.carriesPrompt)).toEqual([]);
  expect(named.executions).toBe(1);
}, 30000);
