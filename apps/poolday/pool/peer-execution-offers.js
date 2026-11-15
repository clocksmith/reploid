/** Expand independent execution paths while retaining one authoritative capacity observation per provider. */
import { createExecutionPolicy, plaintextExecutionRoute, bindExecutionRoute } from '../../../shared/vendor/reploid/chat/execution-policy.js';
import { eligibleExecutionOffers } from '../../../shared/vendor/reploid/chat/execution-offers.js';
import { hashJson } from '../../../shared/pool/inference-receipt.js';

export async function assessExecutionOffers(providerRows, providers, requirements) {
  return (await Promise.all(providerRows.map(async row => {
    const capability = providers.get(row.providerId).capabilities;
    if (capability.executionOffers === undefined && requirements.privacy === undefined) return [row];
    const privacy = requirements.privacy ?? createExecutionPolicy();
    const request = { model: { id: requirements.modelId ?? requirements.operation.name, identity: requirements.modelIdentity,
      adapters: requirements.adapterIdentities.map(identity => ({ identity })) }, privacy, operation: requirements.operation.name };
    const offers = capability.executionOffers ?? [];
    if (!offers.length) return [{ ...row, eligible: false, reasons: [...row.reasons, 'execution-offer-unavailable'] }];
    return Promise.all(offers.map(async offer => {
      const eligible = eligibleExecutionOffers(request, [offer], [row.providerId]).length > 0;
      const permitted = requirements.offerId === undefined || requirements.offerId === offer.id;
      const reasons = [...row.reasons, ...(!eligible ? ['execution-offer-unavailable'] : []), ...(!permitted ? ['offer-not-permitted'] : [])];
      const path = { schema: 'reploid.operation-route/v1', operation: requirements.operation, providerId: row.providerId,
        offerId: offer.id, backend: offer.backend };
      const binding = requirements.privacy !== undefined && !reasons.length
        ? await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients: [row.providerId], route: path })) : null;
      return { ...row, offerId: offer.id, capacityId: row.providerId,
        selectionId: await hashJson({ providerId: row.providerId, offerId: offer.id }),
        eligible: reasons.length === 0, reasons, ...(requirements.privacy !== undefined ? { privacyBinding: binding } : {}) };
    }));
  }))).flat();
}
