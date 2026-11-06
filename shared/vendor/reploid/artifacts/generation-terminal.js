/** Provider-signed cleanup evidence. It carries no invented token measurements. */
import { canonicalize } from './canonical-json.js';
import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey, getIdentitySignAlgorithm,
  encodeBytes, toBase64Url, fromBase64Url } from './identity.js';

const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const assert = (ok, message) => { if (!ok) throw Error(message); };
function payload(value) {
  assert(value?.schema === 'reploid.generation-terminal/v1' && ['cancelled', 'failed'].includes(value.status)
    && value.cleanup === 'settled' && value.usage === null && ['requestId', 'provider', 'consumer', 'model'].every(key => text(value[key]))
    && digest(value.modelIdentity) && digest(value.inputDigest) && Array.isArray(value.adapterIdentities)
    && value.adapterIdentities.length <= 1 && value.adapterIdentities.every(digest)
    && Number.isSafeInteger(value.timestamp) && value.timestamp > 0, 'Invalid generation terminal evidence');
  return { schema: value.schema, requestId: value.requestId, provider: value.provider, consumer: value.consumer,
    model: value.model, modelIdentity: value.modelIdentity, adapterIdentities: [...value.adapterIdentities],
    inputDigest: value.inputDigest, status: value.status, cleanup: value.cleanup, usage: null, timestamp: value.timestamp };
}
const bytes = value => encodeBytes(canonicalize(payload(value)));
export async function signGenerationTerminal(binding, status, identity) {
  const value = payload({ ...structuredClone(binding), schema: 'reploid.generation-terminal/v1', status,
    cleanup: 'settled', usage: null, timestamp: Date.now() });
  assert(value.provider === identity.peerId, 'Terminal signer differs from provider');
  return { ...value, publicJwk: identity.publicJwk, signature: toBase64Url(await crypto.subtle.sign(
    getIdentitySignAlgorithm(identity), await importSigningKey(identity), bytes(value))) };
}
export async function verifyGenerationTerminal(value, binding) {
  try {
    const canonical = payload(value);
    if (await createPeerIdFromPublicJwk(value.publicJwk) !== canonical.provider
      || ['requestId', 'provider', 'consumer', 'model', 'modelIdentity', 'adapterIdentities', 'inputDigest']
        .some(key => canonicalize(canonical[key]) !== canonicalize(binding[key]))) return false;
    return await crypto.subtle.verify(getIdentitySignAlgorithm(value.publicJwk), await importVerificationKey(value.publicJwk),
      fromBase64Url(value.signature), bytes(canonical));
  } catch { return false; }
}
