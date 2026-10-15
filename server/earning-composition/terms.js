/**
 * @fileoverview Quote and offer terms from the operator's policy templates.
 *
 * A requester's device names a model and operation; a contributor's device
 * names a reward category and model. The service answers from the policy's
 * templates at call time, stamping absolute times from relative durations;
 * neither side authors prices, rewards or deadlines. A request no template
 * covers gets no terms, and the routes refuse it.
 */

const iso = (ms) => new Date(ms).toISOString();
const sameModel = (left, right) => left?.modelId === right?.modelId && left?.modelIdentity === right?.modelIdentity;

/**
 * The router's quoteTerms port: ({ accountId, deviceId, request }) -> { service, pricing, terms } | null.
 * `request` is { modelId, modelIdentity, operation }; anything else in it is ignored.
 */
export function createQuoteTerms({ services, clock }) {
  return async function quoteTerms({ request } = {}) {
    const template = services.find((entry) => sameModel(entry.request, request) && entry.request.operation === request?.operation);
    if (!template) return null;
    const now = Date.parse(clock());
    const { validForMs, ...terms } = structuredClone(template.terms);
    return {
      service: { ...structuredClone(template.service), deadline: iso(now + template.deadlines.completeMs),
        ...(template.deadlines.firstOutputMs ? { firstOutputDeadline: iso(now + template.deadlines.firstOutputMs) } : {}) },
      pricing: structuredClone(template.pricing),
      terms: { ...terms, validUntil: iso(now + validForMs) }
    };
  };
}

/**
 * The offer port: ({ accountId, deviceId, participantId, host, request }) -> offer input | null.
 * `request` is { category, model: { modelId, modelIdentity, planId } }; the work names the device's own participant.
 */
export function createOfferTerms({ offers, clock }) {
  return async function offerTerms({ accountId, participantId, host, request } = {}) {
    const template = offers.find((entry) => entry.category === request?.category && entry.hosts.includes(host)
      && sameModel(entry.model, request.model) && entry.model.planId === request.model?.planId);
    if (!template) return null;
    const now = Date.parse(clock());
    return {
      accountId,
      work: { category: template.category, participantId, model: structuredClone(template.model) },
      reward: structuredClone(template.reward),
      resourceBounds: structuredClone(template.resourceBounds),
      duration: { startsAt: iso(now), endsAt: iso(now + template.durationMs) },
      validUntil: iso(now + template.validForMs),
      paymentTiming: structuredClone(template.paymentTiming),
      failureCompensation: structuredClone(template.failureCompensation)
    };
  };
}

export default { createQuoteTerms, createOfferTerms };
