/** Versioned disclosure authority for direct complete operations. Intentionally public input uses a separate consent contract. */
import { assertAvailableExecutionPolicy, bindExecutionRoute, plaintextExecutionRoute, sameExecutionBinding, executionPrivacyReceipt } from '../../chat/execution-policy.js';
const assert = (ok, message) => { if (!ok) throw new Error(`Operation privacy: ${message}`); };
export const OPERATION_CONSENT_SCHEMA = 'reploid.peer.execution_consent/v3';
export function operationConsentRequirements(consent) {
  if (consent?.schema !== OPERATION_CONSENT_SCHEMA) {
    assert(consent?.schema === 'reploid.peer.public_operation_consent/v1' && consent.publicInput === true, 'explicit public consent or versioned private execution consent required');
    return {};
  }
  const binding = consent.privacyBinding;
  assert(consent.publicInput === false && consent.providerIds?.length === 1 && typeof consent.offerId === 'string'
    && consent.offerId.length > 0 && binding?.schema === 'reploid.execution-binding/v2', 'single selected provider, offer and privacy binding required');
  assertAvailableExecutionPolicy(binding.policy);
  assert(binding.route?.route?.providerId === consent.providerIds[0] && binding.route.route.offerId === consent.offerId,
    'selected route differs from consent');
  return { modelId: binding.route.modelId, offerId: consent.offerId, privacy: binding.policy };
}
export async function verifyOperationConsent(consent, { modelId, modelIdentity, adapterIdentities, operation, providerId }) {
  const requirements = operationConsentRequirements(consent);
  if (!requirements.privacy) return null;
  const request = { privacy: requirements.privacy, model: { id: modelId, identity: modelIdentity,
    adapters: adapterIdentities.map(identity => ({ identity })) } };
  const route = plaintextExecutionRoute(request, { recipients: [providerId], route: { schema: 'reploid.operation-route/v1',
    operation, providerId, offerId: consent.offerId, backend: 'doppler-plaintext/v1' } });
  const binding = await bindExecutionRoute(request, route);
  assert(sameExecutionBinding(binding, consent.privacyBinding), 'policy, model, participant, operation or offer changed');
  return binding;
}
/** Build safe observer evidence before invoking observers; signed payloads remain requester/provider local. */
export function operationObserverEvidence({ stage, operation, modelId, providerId, offerId, binding, attemptId }) {
  return { schema: 'reploid.operation-observer/v1', stage, attemptId, operation, modelId, providerId, offerId,
    privacy: executionPrivacyReceipt(binding), evidence: 'requester-policy-validation; execution identity only' };
}
