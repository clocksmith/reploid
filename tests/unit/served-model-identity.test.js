// @vitest-environment node
// The model that answers is the model that was asked (docs/first-visit-journeys.md): between two meshes joined in
// memory, a provider's reply that names another model, by id or by weights identity, is refused before anything is
// returned or countersigned, also when the provider signs a valid receipt for what it claims to have run. Provider
// execution is a function; this checks the requester's binding, not which weights a real provider loaded.
import { afterEach, expect, it } from 'vitest';
import { createReceiptDraft, signReceiptDraft, verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const other = 'sha256:' + 'b'.repeat(64);
const sent = (f, type) => f.wire.filter(item => item.type === type).map(item => item.payload);
/** A fixture whose provider result is replaced in transit by `alter(f, payload)`. */
const replying = async alter => {
  let f;
  f = await createRecoveryMesh(cleanup, { intercept: (kind, payload) => kind === 'reploid:generation-result' ? alter(f, payload) : undefined });
  return f;
};
const resign = async (f, payload) => {
  payload.receipt = await signReceiptDraft(await createReceiptDraft({ provider: f.identities[1].peerId, consumer: f.identities[0].peerId,
    jobHash: payload.receipt.jobHash, model: payload.response.model, ...await measureWholeModelReceipt(f.messages, payload.response) }), f.identities[1]);
  expect((await verifyReceipt(payload.receipt)).providerValid).toBe(true);
};

it('returns the asked model with a provider-signed receipt that names its identity', async () => {
  const f = await createRecoveryMesh(cleanup);
  const result = await f.run();
  expect(result.modelIdentity).toBe(f.response.modelIdentity);
  expect(result.executionReceipt).toMatchObject({ provider: f.identities[1].peerId, model: f.response.model, modelIdentity: f.response.modelIdentity });
  expect(await verifyReceipt(result.executionReceipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
});

it.each([
  ['other weights under the asked name', payload => { payload.response.modelIdentity = other; }],
  ['another model id', payload => { payload.response.model = 'another-model'; }]
])('refuses a reply that names %s, unsigned or with a valid receipt for it', async (_name, substitute) => {
  const unsigned = await replying((_f, payload) => { substitute(payload); delete payload.receipt; });
  await expect(unsigned.run()).rejects.toThrow('Remote response substituted the requested model');
  const signed = await replying(async (f, payload) => { substitute(payload); await resign(f, payload); });
  await expect(signed.run()).rejects.toThrow('Remote response substituted the requested model');
  // Nothing was countersigned for either.
  expect([...sent(unsigned, 'reploid:receipt'), ...sent(signed, 'reploid:receipt')]).toEqual([]);
});

it('refuses a receipt that names another model identity than the reply it comes with', async () => {
  const f = await replying(async (fixture, payload) => {
    const claimed = { ...payload.response, modelIdentity: other };
    payload.receipt = await signReceiptDraft(await createReceiptDraft({ provider: fixture.identities[1].peerId, consumer: fixture.identities[0].peerId,
      jobHash: payload.receipt.jobHash, model: claimed.model, ...await measureWholeModelReceipt(fixture.messages, claimed) }), fixture.identities[1]);
  });
  await expect(f.run()).rejects.toThrow('Measured receipt differs from the admitted request or provider output');
  expect(sent(f, 'reploid:receipt')).toEqual([]);
});
