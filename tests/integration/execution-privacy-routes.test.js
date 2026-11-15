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
