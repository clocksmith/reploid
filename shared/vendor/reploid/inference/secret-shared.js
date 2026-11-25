/**
 * Secret-shared split execution (`protection: "secret-sharing"`) for `reploid/inference`. UNAVAILABLE BY
 * DEFAULT: a host must pass both a secret-shared execution port and `unreviewedSecretSharedExecution: true` to
 * `createInference`. Without both, the value stays CONFIDENTIAL_EXECUTION_UNAVAILABLE and nothing is sent.
 *
 * The protocol (Doppler `tools/secret-shared/`): each stage's projections run on two-party additive shares in Z_2^64.
 * The requester encodes each projection input in fixed point, splits it into two fresh random shares and sends one to
 * each of the stage's two operators, which return W x_b for the public weights W. The requester reconstructs and
 * evaluates every nonlinear function itself. The trust assumption is that a stage's two operators do not collude:
 * together they would read that stage's hidden states. It never satisfies `homomorphic`. The protocol is pinned in the
 * plan (SECRET_SHARED_PROTOCOL); callers choose no share count.
 *
 * Host port (createSecretSharedExecution):
 *   resolve(request, { signal })  -> { route, maxCharge, pinned }   describes the stages and share operators; sends nothing
 *   execute({ plan, pinned, requestId, attemptId, messages, generation, signal, onAdmitted, onDelta })
 *                                 -> { text, stopReason, usage, settlement, evidence }
 */
import { executionError, SECRET_SHARED_PROTOCOL, SECRET_SHARED_COLLUSION, SECRET_SHARED_REVIEW_REASON } from '../chat/execution-policy.js';
import { SECRET_SHARED_BACKEND, REQUESTER_DEVICE, CARRIER, NOT_REVIEWED, chargeCeiling } from './contract.js';

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
 * The disclosure for a secret-shared route. It states only what holds: each operator receives one fresh random share
 * of each value it computes on, which alone reveals nothing about the content; the stated assumption is that a stage's
 * two operators do not combine their shares. Every share holder is a participant even though it cannot read the value.
 * This device recombines every intermediate result and evaluates every nonlinear step itself.
 */
export function secretSharedDisclosure(route) {
  const stages = route.secretShared.stages;
  // Two operators of the same stage, if they combine their shares, can read that stage's intermediate data and from it
  // reconstruct the prompt and the answer: a conditional reader, never "nobody".
  const pair = { role: 'share-holder', ids: [...route.participants], when: { collusion: { sameStage: true, count: 2 } },
    stages: stages.map(stage => ({ stage: stage.index, layers: [...stage.layers], ids: [...stage.shares] })) };
  const content = () => ({ readers: [REQUESTER_DEVICE, structuredClone(pair)], assumptions: ['share-holders-do-not-collude', 'not-independently-reviewed'],
    verified: false, check: null });
  return freeze({
    prompt: content(),
    intermediate: { readers: [REQUESTER_DEVICE, structuredClone(pair)],
      assumptions: ['requester-recombines-intermediates', 'share-holders-do-not-collude', 'not-independently-reviewed'], verified: false, check: null },
    answer: content(),
    metadata: { items: [...SECRET_SHARED_METADATA], readers: [REQUESTER_DEVICE, { role: 'share-holder', selection: 'all', ids: [...route.participants] }, CARRIER],
      assumptions: [], verified: false, check: null },
    trustAssumptions: ['share-holders-do-not-collude', 'requester-recombines-intermediates', 'semi-honest-operators', 'not-independently-reviewed'],
    review: NOT_REVIEWED,
    extensions: { secretSharing: {
      protocol: SECRET_SHARED_PROTOCOL, collusion: SECRET_SHARED_COLLUSION,
      sharesHeldBy: stages.map(stage => ({ stage: stage.index, layers: [...stage.layers], shareA: stage.shares[0], shareB: stage.shares[1] }))
    } }
  });
}

/** What the requester bound and checked on a secret-shared run. */
export function secretSharedEvidence({ plan, admitted, evidence = null, error = null }) {
  const details = evidence ?? error?.secretShared ?? null;
  const sharesHeldBy = plan.disclosure.extensions.secretSharing.sharesHeldBy;
  return {
    privacy: {
      protection: 'secret-sharing', routeKind: 'split',
      contentReadBy: admitted ? { requesterDevice: true, participants: [] } : null,
      checks: admitted ? [
        { claim: 'share-recipients', by: 'requester', method: 'route-binding-before-release', value: structuredClone(sharesHeldBy) },
        ...(details?.freshness ? [{ claim: 'fresh-shares-every-round', by: 'requester',
          method: 'distinct-share-b-digests-and-strictly-increasing-prg-counters', value: structuredClone(details.freshness) }] : [])
      ] : [],
      notVerified: ['non-collusion', 'independent-security-review', 'recipient-conduct', 'side-channels', 'traffic-analysis', 'transport-endpoint-identity'],
      review: NOT_REVIEWED,
      extensions: { secretSharing: { collusion: SECRET_SHARED_COLLUSION, sharesHeldBy: admitted ? structuredClone(sharesHeldBy) : null,
        transport: details?.transport ?? null } }
    },
    integrity: {
      checks: details ? [{ claim: 'model-identity', by: 'requester', method: 'pinned-plan-tensor-digests', value: plan.route.model.identity }] : [],
      providerReceipt: null,
      notVerified: ['correct-computation', 'operator-returned-shares', 'reported-token-counts'],
      extensions: { secretSharing: { cost: details?.cost ?? null } }
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
      return { route, maxCharge: chargeCeiling(resolved.maxCharge, 'split'), disclosure: secretSharedDisclosure(route), pinned: resolved.pinned ?? null };
    },
    execute
  });
}
