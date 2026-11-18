// @vitest-environment node
import { expect, it } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt, verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt, matchesWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';

const messages = [{ role: 'user', content: 'A long-looking prompt whose tokenizer reports seven tokens.' }];
const result = { model: 'fixture', modelIdentity: 'sha256:' + 'a'.repeat(64), adapterIdentities: [], content: 'A short answer',
  completion: { schema: 'doppler.generation-completion/v1', stopReason: 'eos-token', promptTokenCount: 7, generatedTokenCount: 3 } };
async function receipt() {
  const provider = await createSigningIdentity({ algorithm: 'Ed25519' });
  const consumer = await createSigningIdentity({ algorithm: 'Ed25519' });
  const measured = await measureWholeModelReceipt(messages, result);
  const draft = await createReceiptDraft({ ...measured, provider: provider.peerId, consumer: consumer.peerId, jobHash: 'request:fixture', model: result.model });
  return { provider, consumer, signed: await countersignReceipt(await signReceiptDraft(draft, provider), consumer) };
}
it('binds actual tokenizer and sampler counts, model, adapters, input and output to both signing identities', async () => {
  const { signed } = await receipt();
  expect(signed).toMatchObject({ version: 2, inputTokens: 7, outputTokens: 3, cleanup: 'settled' });
  expect(await verifyReceipt(signed)).toEqual({ valid: true, providerValid: true, consumerValid: true });
  expect(await matchesWholeModelReceipt(signed, messages, result)).toBe(true);
  expect(await matchesWholeModelReceipt(signed, [{ role: 'user', content: 'different' }], result)).toBe(false);
  expect(await matchesWholeModelReceipt(signed, messages, { ...result, content: 'substituted' })).toBe(false);
});
it.each(['inputTokens', 'outputTokens', 'modelIdentity', 'inputDigest', 'outputDigest', 'stopReason', 'provider', 'consumer'])('rejects changed signed %s', async field => {
  const { signed } = await receipt();
  const value = field.endsWith('Tokens') ? signed[field] + 1 : field.endsWith('Digest') || field === 'modelIdentity'
    ? 'sha256:' + 'b'.repeat(64) : signed[field] + '-changed';
  expect((await verifyReceipt({ ...signed, [field]: value })).valid).toBe(false);
});
it('countersigns only the signed payload: unsigned fields on the provider receipt are not carried', async () => {
  const { provider, consumer, signed } = await receipt();
  const { consumerSignature: _signature, consumerKey: _key, ...fromProvider } = signed;
  const countersigned = await countersignReceipt({ ...fromProvider, maxOutputTokens: 9999, note: 'unsigned' }, consumer);
  expect(countersigned).toEqual(signed);
  expect(Object.keys(countersigned).sort()).toEqual(Object.keys(signed).sort());
  expect(await verifyReceipt(countersigned)).toEqual({ valid: true, providerValid: true, consumerValid: true });
  // An unmetered version 1 receipt signs no whole-model field, so none can ride along either.
  const legacy = await signReceiptDraft(await createReceiptDraft({ provider: provider.peerId, consumer: consumer.peerId,
    jobHash: 'request:legacy', model: result.model, status: 'unmetered' }), provider);
  const accepted = await countersignReceipt({ ...legacy, settingsDigest: 'sha256:' + 'e'.repeat(64), outputDigest: 'sha256:' + 'f'.repeat(64) }, consumer);
  expect(Object.keys(accepted).sort()).toEqual([...Object.keys(legacy), 'consumerKey', 'consumerSignature'].sort());
  expect(await verifyReceipt(accepted)).toEqual({ valid: true, providerValid: true, consumerValid: true });
});
it('leaves missing usage unmetered and refuses malformed measured counts', async () => {
  expect(await measureWholeModelReceipt(messages, { ...result, completion: null })).toBeNull();
  await expect(measureWholeModelReceipt(messages, { ...result, completion: { ...result.completion, generatedTokenCount: -1 } })).rejects.toThrow('Measured generation');
});
