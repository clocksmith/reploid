/** Provider-signed cleanup evidence. It carries no invented token measurements.
 * Versioning follows the whole-model receipt: `reploid.generation-terminal/v1` is unchanged and
 * is what a request without generation settings signs. A request with settings signs
 * `reploid.generation-terminal/v2`, which is v1 plus `settingsDigest`. The schema is signed, so
 * neither form can be relabelled as the other, and a v1-only verifier refuses v2. */
import { canonicalize } from './canonical-json.js';
import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey, getIdentitySignAlgorithm,
  encodeBytes, toBase64Url, fromBase64Url } from './identity.js';

const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const assert = (ok, message) => { if (!ok) throw Error(message); };
export const GENERATION_TERMINAL_SCHEMAS = Object.freeze(['reploid.generation-terminal/v1', 'reploid.generation-terminal/v2']);
function payload(value) {
  const bound = value?.schema === GENERATION_TERMINAL_SCHEMAS[1];
  assert((value?.schema === GENERATION_TERMINAL_SCHEMAS[0] || bound) && ['cancelled', 'failed'].includes(value.status)
    && (bound ? digest(value.settingsDigest) : value.settingsDigest === undefined)
    && value.cleanup === 'settled' && value.usage === null && ['requestId', 'provider', 'consumer', 'model'].every(key => text(value[key]))
    && digest(value.modelIdentity) && digest(value.inputDigest) && Array.isArray(value.adapterIdentities)
    && value.adapterIdentities.length <= 1 && value.adapterIdentities.every(digest)
    && Number.isSafeInteger(value.timestamp) && value.timestamp > 0, 'Invalid generation terminal evidence');
  return { schema: value.schema, requestId: value.requestId, provider: value.provider, consumer: value.consumer,
    model: value.model, modelIdentity: value.modelIdentity, adapterIdentities: [...value.adapterIdentities],
    inputDigest: value.inputDigest, ...(bound ? { settingsDigest: value.settingsDigest } : {}),
    status: value.status, cleanup: value.cleanup, usage: null, timestamp: value.timestamp };
}
const bytes = value => encodeBytes(canonicalize(payload(value)));
export async function signGenerationTerminal(binding, status, identity) {
  const value = payload({ ...structuredClone(binding), schema: GENERATION_TERMINAL_SCHEMAS[binding.settingsDigest === undefined ? 0 : 1], status,
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
        .some(key => canonicalize(canonical[key]) !== canonicalize(binding[key]))
      // Both absent, or equal: a terminal for other settings is not this request's cleanup.
      || (canonical.settingsDigest ?? null) !== (binding.settingsDigest ?? null)) return false;
    return await crypto.subtle.verify(getIdentitySignAlgorithm(value.publicJwk), await importVerificationKey(value.publicJwk),
      fromBase64Url(value.signature), bytes(canonical));
  } catch { return false; }
}
