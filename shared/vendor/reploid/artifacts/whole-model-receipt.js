/** Measured whole-model receipt fields. Signatures bind observations; they do not
 * establish answer quality or independent correctness of the provider's GPU. */
import { hashJson, sha256Hex } from './signatures.js';
import { canonicalize } from './canonical-json.js';

const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const requireValue = (ok, message) => { if (!ok) throw Error(message); };

export function wholeModelReceiptFields(receipt) {
  requireValue(receipt.version === 2 && receipt.status === 'completed' && receipt.usage === 'raw-model-tokens/v1'
    && receipt.cleanup === 'settled' && digest(receipt.modelIdentity) && digest(receipt.inputDigest) && digest(receipt.outputDigest)
    && count(receipt.inputTokens) && count(receipt.outputTokens)
    && Array.isArray(receipt.adapterIdentities) && receipt.adapterIdentities.length <= 1 && receipt.adapterIdentities.every(digest)
    && (receipt.ownerPolicyDigest === null || digest(receipt.ownerPolicyDigest))
    && typeof receipt.stopReason === 'string' && receipt.stopReason.length > 0 && receipt.stopReason.length <= 64,
  'Invalid measured whole-model receipt');
  return { modelIdentity: receipt.modelIdentity, adapterIdentities: [...receipt.adapterIdentities],
    inputDigest: receipt.inputDigest, outputDigest: receipt.outputDigest, usage: receipt.usage,
    stopReason: receipt.stopReason, cleanup: receipt.cleanup, ownerPolicyDigest: receipt.ownerPolicyDigest };
}

/** Missing measurements stay missing. Never infer token counts from text. */
export async function measureWholeModelReceipt(messages, result) {
  const completion = result.completion ?? result.evidence?.output?.completion;
  if (!completion) return null;
  requireValue(completion.schema === 'doppler.generation-completion/v1'
    && count(completion.promptTokenCount) && count(completion.generatedTokenCount)
    && typeof result.content === 'string', 'Measured generation completion required');
  const measured = { version: 2, status: 'completed', modelIdentity: result.modelIdentity,
    adapterIdentities: result.adapterIdentities || [], inputDigest: await hashJson(messages),
    outputDigest: await sha256Hex(result.content), inputTokens: completion.promptTokenCount,
    outputTokens: completion.generatedTokenCount, usage: 'raw-model-tokens/v1',
    stopReason: completion.stopReason, cleanup: 'settled', ownerPolicyDigest: result.ownerPolicyDigest ?? null };
  wholeModelReceiptFields(measured);
  return measured;
}

export async function matchesWholeModelReceipt(receipt, messages, result) {
  const measured = await measureWholeModelReceipt(messages, result);
  return measured !== null && Object.keys(measured).every(key => canonicalize(receipt[key]) === canonicalize(measured[key]));
}
