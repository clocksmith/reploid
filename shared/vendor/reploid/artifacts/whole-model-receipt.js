/** Measured whole-model receipt fields. Signatures bind observations; they do not
 * establish answer quality or independent correctness of the provider's GPU. */
import { hashJson, sha256Hex } from './signatures.js';
import { canonicalize } from './canonical-json.js';

const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
// What `outputTokens` counts: raw model tokens for generation, or one unit per call for a mesh operation that is not
// generation (mesh/operation-envelope.js MESH_OPERATION_UNITS). The unit is signed, so a count cannot change meaning.
const RECEIPT_USAGES = Object.freeze(['raw-model-tokens/v1', 'reploid.mesh-operation-units/v1']);

// Versioning. Version 2 is the measured text receipt and is unchanged: a request without
// generation settings signs exactly the version-2 fields, so every retained receipt still
// verifies. A request with settings signs version 3, which is version 2 plus `settingsDigest`
// (the effective-request digest) and, optionally, `constraintIdentity` (the identity of the
// compiled output constraint the provider applied). The version number is itself signed, so a
// version-3 receipt cannot be relabelled as version 2 by dropping the extra fields, a version-2
// receipt cannot carry either field, and a verifier that only knows version 2 refuses version 3
// instead of reading it as a receipt for a request without settings.
export function wholeModelReceiptFields(receipt) {
  const bound = receipt.version === 3;
  requireValue((receipt.version === 2 || bound) && receipt.status === 'completed' && RECEIPT_USAGES.includes(receipt.usage)
    && receipt.cleanup === 'settled' && digest(receipt.modelIdentity) && digest(receipt.inputDigest) && digest(receipt.outputDigest)
    && count(receipt.inputTokens) && count(receipt.outputTokens)
    && Array.isArray(receipt.adapterIdentities) && receipt.adapterIdentities.length <= 1 && receipt.adapterIdentities.every(digest)
    && (receipt.ownerPolicyDigest === null || digest(receipt.ownerPolicyDigest))
    && typeof receipt.stopReason === 'string' && receipt.stopReason.length > 0 && receipt.stopReason.length <= 64
    && (bound ? digest(receipt.settingsDigest) && (receipt.constraintIdentity === undefined || digest(receipt.constraintIdentity))
      : receipt.settingsDigest === undefined && receipt.constraintIdentity === undefined),
  'Invalid measured whole-model receipt');
  return { modelIdentity: receipt.modelIdentity, adapterIdentities: [...receipt.adapterIdentities],
    inputDigest: receipt.inputDigest, outputDigest: receipt.outputDigest, usage: receipt.usage,
    stopReason: receipt.stopReason, cleanup: receipt.cleanup, ownerPolicyDigest: receipt.ownerPolicyDigest,
    ...(bound ? { settingsDigest: receipt.settingsDigest,
      ...(receipt.constraintIdentity === undefined ? {} : { constraintIdentity: receipt.constraintIdentity }) } : {}) };
}

/** Missing measurements stay missing. Never infer token counts from text.
 * `bound.settingsDigest` makes this a version-3 measurement for a request with generation
 * settings; `bound.constraintIdentity`, when not null, is signed with it. */
export async function measureWholeModelReceipt(messages, result, bound = undefined) {
  const completion = result.completion ?? result.evidence?.output?.completion;
  if (!completion) return null;
  requireValue(completion.schema === 'doppler.generation-completion/v1'
    && count(completion.promptTokenCount) && count(completion.generatedTokenCount)
    && typeof result.content === 'string', 'Measured generation completion required');
  const settingsDigest = bound?.settingsDigest ?? null, constraintIdentity = bound?.constraintIdentity ?? null;
  requireValue(settingsDigest !== null || constraintIdentity === null, 'A constraint identity requires generation settings');
  const measured = { version: settingsDigest === null ? 2 : 3, status: 'completed', modelIdentity: result.modelIdentity,
    adapterIdentities: result.adapterIdentities || [], inputDigest: await hashJson(messages),
    outputDigest: await sha256Hex(result.content), inputTokens: completion.promptTokenCount,
    outputTokens: completion.generatedTokenCount, usage: 'raw-model-tokens/v1',
    stopReason: completion.stopReason, cleanup: 'settled', ownerPolicyDigest: result.ownerPolicyDigest ?? null,
    ...(settingsDigest === null ? {} : { settingsDigest, ...(constraintIdentity === null ? {} : { constraintIdentity }) }) };
  wholeModelReceiptFields(measured);
  return measured;
}

/** `bound` is what the verifier expects: its own effective-request digest, and the constraint
 * identity it expects when it has an expectation (null leaves the signed identity unchecked). */
export async function matchesWholeModelReceipt(receipt, messages, result, bound = undefined) {
  const measured = await measureWholeModelReceipt(messages, result, bound);
  return measured !== null && Object.keys(measured).every(key => receipt[key] !== undefined
    && canonicalize(receipt[key]) === canonicalize(measured[key]));
}
