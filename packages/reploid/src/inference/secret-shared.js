/**
 * Secret-shared split execution (`confidentiality: "secret-shared-2party"`) for `reploid/inference`. UNAVAILABLE BY
 * DEFAULT: a host must pass both a secret-shared execution port and `unreviewedSecretSharedExecution: true` to
 * `createInference`. Without both, the value stays CONFIDENTIAL_EXECUTION_UNAVAILABLE and nothing is sent.
 *
 * The protocol (Doppler `tools/secret-shared/`): each stage's projections run on two-party additive shares in Z_2^64.
 * The requester encodes each projection input in fixed point, splits it into two fresh random shares and sends one to
 * each of the stage's two operators, which return W x_b for the public weights W. The requester reconstructs and
 * evaluates every nonlinear function itself. The trust assumption is that a stage's two operators do not collude:
 * together they would read that stage's hidden states. It is not requester-only secrecy and never satisfies it.
 *
 * Host port (createSecretSharedExecution):
 *   resolve(request, { signal })  -> { route, maxCharge, pinned }   describes the stages and share operators; sends nothing
 *   execute({ plan, pinned, requestId, attemptId, messages, generation, signal, onAdmitted, onDelta })
 *                                 -> { text, stopReason, usage, settlement, evidence }
 */
import { executionError, SECRET_SHARED_PROTOCOL, SECRET_SHARED_COLLUSION, SECRET_SHARED_REVIEW_REASON } from '../chat/execution-policy.js';
import { SECRET_SHARED_BACKEND } from './contract.js';

export { SECRET_SHARED_PROTOCOL, SECRET_SHARED_BACKEND };
export const SECRET_SHARED_EXECUTION_KIND = 'reploid.secret-shared-execution/v1';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
/** Never `available: true` in this build. */
export const SECRET_SHARED_STATUS = freeze({ available: false, reason: SECRET_SHARED_REVIEW_REASON });
/** What a secret-shared route exposes beyond the requester. */
export const SECRET_SHARED_METADATA = freeze(['model-id', 'timing', 'length']);

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const unavailable = message => executionError('EXECUTION_ROUTE_UNAVAILABLE', `${message}. Nothing was sent.`);

/**
 * A secret-shared route: an ordered list of stages, each with exactly two distinct share operators. An operator may
 * hold one share of several stages (fresh shares never combine across stages), never both shares of one stage.
 */
export function validateSecretSharedRoute(route) {
  if (!object(route) || route.backend !== SECRET_SHARED_BACKEND || route.protocol !== SECRET_SHARED_PROTOCOL
    || route.shape !== 'split' || route.selection !== 'all' || !id(route.id) || !object(route.model)) throw unavailable('The secret-shared route is malformed');
  const stages = route.secretShared?.stages;
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 64) throw unavailable('The secret-shared route names no stages');
  const holders = new Set();
  stages.forEach((stage, index) => {
    if (!object(stage) || stage.index !== index || !Array.isArray(stage.shares) || stage.shares.length !== 2 || !stage.shares.every(id)
      || stage.shares[0] === stage.shares[1]) throw unavailable(`Stage ${index} needs two distinct share operators`);
    if (!Array.isArray(stage.layers) || stage.layers.length !== 2 || !stage.layers.every(Number.isSafeInteger) || stage.layers[0] > stage.layers[1]) {
      throw unavailable(`Stage ${index} needs a layer range`);
    }
    stage.shares.forEach(holder => holders.add(holder));
  });
  const participants = [...holders].sort();
  if (!Array.isArray(route.participants) || [...route.participants].sort().join('\n') !== participants.join('\n')) {
    throw unavailable('The route participants differ from its share operators');
  }
  return route;
}

/**
 * Disclosures for a secret-shared route. They state only what holds: each operator receives fresh random shares,
 * which alone reveal nothing about the content, and the stated assumption is that a stage's two operators do not
 * collude. "Nobody can read it" remains a target: the protocol is unreviewed.
 */
export function secretSharedDisclosures(route) {
  const stages = route.secretShared.stages;
  return freeze({
    contentReadableBy: { requesterDevice: true, participants: [], selection: 'all', target: true },
    executorsReadContent: false,
    executorsReadActivations: false,
    sharesHeldBy: stages.map(stage => ({ stage: stage.index, layers: [...stage.layers], shareA: stage.shares[0], shareB: stage.shares[1] })),
    collusion: {
      assumption: SECRET_SHARED_COLLUSION,
      ifBroken: stages.map(stage => ({ together: [...stage.shares], read: `the hidden states, projections and MLP activations of layers ${stage.layers[0]}-${stage.layers[1]}, from which the prompt and answer can be reconstructed` })),
      otherCoalitions: 'Operators of different stages, the ledger and the signaling server learn nothing more by pooling what they hold: every round uses fresh shares and share traffic never passes through the ledger or the signaling server.'
    },
    metadata: [...SECRET_SHARED_METADATA],
    leaks: ['model and stage plan', 'prompt length (prefill width) and generated token count (decode rounds)', 'timing of each round', 'message sizes'],
    review: { ...SECRET_SHARED_STATUS },
    statement: 'Research route, unreviewed. Each stage of the model runs on two operators, and each receives only fresh random shares of the values it computes on: '
      + 'alone, an operator learns nothing about your prompt or answer beyond its length, the number of generated tokens, timing and sizes. '
      + 'This rests on one assumption: the two operators of a stage do not collude. If they pool their shares, together they read that stage\'s hidden states, '
      + 'from which the prompt and the answer can be reconstructed. Your device evaluates every nonlinear step itself and is the only party that ever holds the plaintext. '
      + `"Nobody can read it" remains a target, not an established property: ${SECRET_SHARED_REVIEW_REASON}, with no independent security review and no protection against an operator that returns wrong results.`
  });
}

/** What the requester bound and checked on a secret-shared run. */
export function secretSharedEvidence({ plan, admitted, evidence = null, error = null }) {
  const details = evidence ?? error?.secretShared ?? null;
  return {
    confidentiality: {
      mode: 'secret-shared-2party',
      assumption: SECRET_SHARED_COLLUSION,
      contentReadBy: admitted ? { requesterDevice: true, participants: [], target: true } : null,
      sharesHeldBy: admitted ? structuredClone(plan.disclosures.sharesHeldBy) : null,
      verified: admitted ? [
        { claim: 'share-recipients', by: 'requester', method: 'route-binding-before-disclosure', value: structuredClone(plan.disclosures.sharesHeldBy) },
        ...(details?.freshness ? [{ claim: 'fresh-shares-every-round', by: 'requester',
          method: 'distinct-share-b-digests-and-strictly-increasing-prg-counters', value: structuredClone(details.freshness) }] : [])
      ] : [],
      transport: details?.transport ?? null,
      notVerified: ['non-collusion', 'independent-security-review', 'recipient-conduct', 'side-channels', 'traffic-analysis', 'transport-endpoint-identity'],
      review: { ...SECRET_SHARED_STATUS }
    },
    integrity: {
      verified: details ? [{ claim: 'model-identity', by: 'requester', method: 'pinned-plan-tensor-digests', value: plan.route.model.identity }] : [],
      cost: details?.cost ?? null,
      notVerified: ['correct-computation', 'operator-returned-shares', 'reported-token-counts']
    }
  };
}

/** Wraps a host's secret-shared port: its route is checked and its disclosures are this module's, never the host's. */
export function createSecretSharedExecution({ resolve, execute }) {
  if (typeof resolve !== 'function' || typeof execute !== 'function') throw new Error('Secret-shared execution requires resolve and execute ports');
  return Object.freeze({
    kind: SECRET_SHARED_EXECUTION_KIND,
    async resolve(request, { signal } = {}) {
      const resolved = await resolve(request, { signal });
      const route = validateSecretSharedRoute(resolved?.route);
      if (route.model.id !== request.model.id || route.model.identity !== request.model.identity) throw unavailable('The secret-shared route serves another model');
      return { route, maxCharge: resolved.maxCharge ?? null, disclosures: secretSharedDisclosures(route), pinned: resolved.pinned ?? null };
    },
    execute
  });
}
