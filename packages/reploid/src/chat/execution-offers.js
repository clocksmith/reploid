/** Advertised offers are untrusted inventory. Only implemented paths can become eligible. */
import { validateExecutionPolicy, assertAvailableExecutionPolicy, validateExecutionRoute, plaintextExecutionRoute } from './execution-policy.js';

const assert = (ok, message) => { if (!ok) throw new Error(`Execution offer: ${message}`); };
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

export function validateExecutionOffers(input) {
  assert(Array.isArray(input) && input.length <= 32 && new Set(input.map(row => row?.id)).size === input.length, 'bounded unique offers required');
  return input.map(inputOffer => {
    const value = structuredClone(inputOffer);
    assert(value?.schema === 'reploid.execution-offer/v1' && label(value.id) && label(value.backend)
      && ['plaintext', 'attested', 'cryptographic'].includes(value.kind), 'versioned backend offer required');
    assert(Array.isArray(value.modelIdentities) && value.modelIdentities.length > 0 && value.modelIdentities.length <= 128
      && value.modelIdentities.every(digest), 'explicit supported models required');
    assert(['generate', 'embed', 'rerank', 'encodeSequence', 'scoreChoices'].includes(value.operation) && (value.protocol === null || label(value.protocol)), 'operation and protocol required');
    assert(value.evidence === null || digest(value.evidence), 'evidence reference must be a digest; it grants no qualification');
    return value;
  });
}

/** Filter every offered path independently. A secure-looking advertisement can never upgrade Doppler plaintext. */
export function eligibleExecutionOffers(request, offers, recipients) {
  const policy = assertAvailableExecutionPolicy(validateExecutionPolicy(request.privacy));
  return validateExecutionOffers(offers).filter(offer => {
    if (offer.operation !== (request.operation ?? 'generate') || !offer.modelIdentities.includes(request.model.identity) || offer.kind !== 'plaintext' || offer.protocol !== null) return false;
    const route = plaintextExecutionRoute(request, { recipients });
    if (offer.backend !== route.backend) return false;
    try { validateExecutionRoute(policy, route); return true; } catch { return false; }
  });
}
