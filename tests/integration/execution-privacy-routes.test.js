// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
it('executes both profiles over authenticated mesh and binds the selected offer before disclosure', async () => {
  const seen = [];
  const f = await createRecoveryMesh(cleanup, { execute: async (_messages, _update, control) => {
    seen.push(control); return { model: 'model', modelIdentity: 'sha256:' + 'a'.repeat(64), adapterIdentities: [], content: 'actual answer',
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } };
  } });
  for (const profile of ['provider-visible', 'restricted']) {
    const privacy = profile === 'restricted' ? createExecutionPolicy(profile, { placement: 'network-allowed', allowedRecipients: [f.identities[1].peerId] }) : createExecutionPolicy(profile);
    const result = await f.requesterMesh.generate(f.messages, null, { signal: new AbortController().signal, modelId: 'model',
      modelIdentity: 'sha256:' + 'a'.repeat(64), privacy, offerId: 'ordinary-generation', requestContext: { contextId: 'same-thread' } });
    expect(result.content).toBe('actual answer');
    expect(seen.at(-1).privacyBinding.policy).toEqual(privacy);
    expect(seen.at(-1).privacyBinding.route.route.offerId).toBe('ordinary-generation');
    expect(seen.at(-1).privacyBinding.route.hops.map(row => row.recipient)).toEqual([f.identities[1].peerId]);
  }
  const requests = f.wire.filter(row => row.type === 'reploid:generation-request');
  expect(requests).toHaveLength(2); expect(requests.every(row => row.payload.privacyBinding)).toBe(true);
  await f.replay({ requestId: 'tampered-policy-attempt', privacyBinding: null });
  await vi.waitFor(() => expect(f.wire.some(row => row.type === 'reploid:generation-error' && row.payload.error === 'Execution privacy binding rejected')).toBe(true));
  expect(seen).toHaveLength(2);
});
it('refuses local-only and unsupported backends before any mesh payload', async () => {
  const f = await createRecoveryMesh(cleanup);
  for (const privacy of [createExecutionPolicy('restricted'), createExecutionPolicy('cryptographic', { protocol: 'unsupported', keyContext: 'client-key' })]) {
    await expect(f.requesterMesh.generate(f.messages, null, { signal: new AbortController().signal, modelId: 'model',
      modelIdentity: 'sha256:' + 'a'.repeat(64), privacy })).rejects.toThrow();
  }
  expect(f.wire.filter(row => row.type === 'reploid:generation-request')).toEqual([]);
});
it('never serves a stronger tier through a weaker one: each unmet requirement refuses before any prompt data leaves the requester', async () => {
  const executed = [];
  const f = await createRecoveryMesh(cleanup, { execute: async (_messages, _update, control) => {
    executed.push(control); return { model: 'model', modelIdentity: 'sha256:' + 'a'.repeat(64), adapterIdentities: [], content: 'actual answer',
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } };
  } });
  const ask = (privacy, signal = new AbortController().signal) => f.requesterMesh.generate(f.messages, null, { signal, modelId: 'model',
    modelIdentity: 'sha256:' + 'a'.repeat(64), privacy, offerId: 'ordinary-generation', requestContext: { contextId: 'tier-thread' } });
  const prompt = f.messages[0].content;
  const leaked = () => f.wire.filter(row => JSON.stringify(row.payload).includes(prompt));
  // The only reachable provider is identities[1]. Each policy below asks for something it cannot give.
  const unmet = {
    'restricted, local only': createExecutionPolicy('restricted'),
    'cryptographic shares (no evaluator installed)': createExecutionPolicy('cryptographic', { protocol: 'additive-shares-two-server/v1', keyContext: 'client-key' }),
    'provider-visible with attested hardware': createExecutionPolicy('provider-visible', { attestation: 'sha256:' + 'b'.repeat(64) }),
    'provider-visible with ephemeral retention': createExecutionPolicy('provider-visible', { retention: 'ephemeral' }),
    'restricted to the provider, against all-remote collusion': createExecutionPolicy('restricted', { placement: 'network-allowed',
      allowedRecipients: [f.identities[1].peerId], collusion: 'all-remote' }),
  };
  for (const [label, privacy] of Object.entries(unmet)) {
    await expect(ask(privacy), label).rejects.toThrow();
    expect(f.wire.filter(row => row.type === 'reploid:generation-request'), label).toEqual([]);
    expect(leaked(), label).toEqual([]);
    expect(executed, label).toEqual([]);
  }
  // A restricted request whose named recipient is not present does not refuse: it waits for that recipient
  // until the caller's signal or the generation deadline ends it. It still discloses nothing. The only
  // message is the requester's identity proof, which is how peers' verified identities become known.
  const absent = createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: ['peer:someone-else'] });
  const sentBefore = f.wire.length;
  await expect(ask(absent, AbortSignal.timeout(150))).rejects.toThrow();
  expect(f.wire.slice(sentBefore).map(row => row.type).filter(type => type !== 'reploid:identity-proof')).toEqual([]);
  expect(f.wire.filter(row => row.type === 'reploid:generation-request')).toEqual([]);
  expect(leaked()).toEqual([]);
  expect(executed).toEqual([]);
  // A policy that asks to be downgraded, or that is not a complete versioned policy, is not a policy.
  expect(() => createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [f.identities[1].peerId], allowDowngrade: true })).toThrow(/downgrade/);
  expect(() => createExecutionPolicy('cryptographic', { protocol: 'additive-shares-two-server/v1' })).toThrow(/key context/);
  await expect(ask({ ...createExecutionPolicy('provider-visible'), tier: 'cryptographic' })).rejects.toThrow();
  expect(leaked()).toEqual([]);
  // The refusals changed nothing: the tier the provider can meet still runs, bound to exactly what was asked.
  const visible = createExecutionPolicy('provider-visible');
  expect((await ask(visible)).content).toBe('actual answer');
  expect(executed).toHaveLength(1);
  expect(executed[0].privacyBinding.policy).toEqual(visible);
  const restricted = createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [f.identities[1].peerId] });
  expect((await ask(restricted)).content).toBe('actual answer');
  expect(executed[1].privacyBinding.policy).toEqual(restricted);
  expect(executed[1].privacyBinding.route.hops.map(row => row.recipient)).toEqual([f.identities[1].peerId]);
});
