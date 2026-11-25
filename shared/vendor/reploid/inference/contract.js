/**
 * The `reploid/inference` contract: request shapes, route descriptions, disclosures, refusals and the
 * execution receipt. Pure validation and record building; `index.js` owns plans, runs and events.
 *
 * A receipt records what this requester checked. It never states that an executor behaved honestly,
 * computed correctly, erased its input or ran attested hardware.
 */
import { hashJson } from '../artifacts/signatures.js';
import { canonicalPartitionJson } from '../contracts/partition.js';
import {
  EXECUTION_ERROR_CODES, EXECUTION_METADATA, executionError, executionBackend, EDGES_BACKEND, AUTO_ROUTES,
  compileExecutionRequirements, compileProtectedExecutionRequirements, compileSecretSharedExecutionRequirements, narrowsExecutionPolicy
} from '../chat/execution-policy.js';
import { PROTECTED_BACKEND } from '../mesh/protected-generation.js';

/** The secret-shared split backend: two-party additive shares per stage (inference/secret-shared.js). */
export const SECRET_SHARED_BACKEND = 'doppler-secret-shared-2party/v1';

export { EXECUTION_ERROR_CODES, executionError };
export const INFERENCE_API_VERSION = 'reploid.inference/v2';
export const EXECUTION_ROUTE_SCHEMA = 'reploid.inference-route/v1';
export const EXECUTION_RECEIPT_SCHEMA = 'reploid.execution-receipt/v2';
/** Disclosure sections: each names who can read it, under which assumptions, and whether that reader set is checked. */
export const DISCLOSURE_SECTIONS = Object.freeze(['prompt', 'intermediate', 'answer', 'metadata']);
export const REVIEW_STATES = Object.freeze(['not-applicable', 'not-reviewed', 'reviewed']);
/** Who can read: fixed role codes. Display text lives in inference/protections.js, never here. */
export const READER_ROLES = Object.freeze(['requester-device', 'requester-edge-device', 'answering-computer', 'stage-operator', 'share-holder',
  'evaluator', 'carrier', 'signaling', 'network-observer']);
/** Under which assumptions: fixed codes, translated to text only in the display layer. */
export const ASSUMPTIONS = Object.freeze(['recipient-conduct-unchecked', 'named-device-ownership-unchecked', 'edge-devices-bound-to-requester',
  'activations-may-reveal-content', 'share-holders-do-not-collude', 'requester-recombines-intermediates', 'semi-honest-operators',
  'not-independently-reviewed', 'parameters-not-estimated', 'insecure-development-parameters', 'requester-key-holder-unchecked',
  'traps-detect-blind-tampering-only', 'trap-oracle-does-not-collude', 'hardware-vendor-trusted']);
/** What a receipt says the requester checked: fixed claim codes. */
export const EVIDENCE_CLAIMS = Object.freeze(['content-stayed-on-requester-device', 'content-recipients', 'edge-devices-bound-to-requester',
  'activation-only-recipients', 'share-recipients', 'fresh-shares-every-round', 'evaluator-session-binding', 'no-evaluator-requests-answered',
  'model-identity', 'adapter-identities', 'stream-matches-answer', 'known-answer-traps', 'frame-binding']);
/** The one time format of the API, matching the settlement records: `YYYY-MM-DDTHH:MM:SS.sssZ`. */
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const isoTime = ms => new Date(ms).toISOString();
export const FREE = Object.freeze({ kind: 'free' });
export const INFERENCE_EVENT_TYPES = Object.freeze(['admitted', 'output.delta', 'completed', 'cancelled', 'failed']);
export const ROUTE_SHAPES = Object.freeze(['local', 'remote', 'split']);
/** all: every participant reads content. one-of: exactly one named participant will. any-eligible: one provider chosen at admission. */
export const ROUTE_SELECTIONS = Object.freeze(['all', 'one-of', 'any-eligible']);

const invalid = message => executionError('EXECUTION_REQUEST_INVALID', message);
const changed = message => executionError('EXECUTION_PLAN_CHANGED', `${message}. Nothing was sent.`);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim();
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
export const freezeDeep = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
};
const onlyKeys = (value, allowed, name) => {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw invalid(`${name} does not accept ${extra.join(', ')}`);
};

/** A pinned artifact: exact model identity and the exact adapters, in order. */
export function validateModelPin(model) {
  if (!object(model)) throw invalid('model must be { id, identity, adapterIdentities? }');
  onlyKeys(model, ['id', 'identity', 'adapterIdentities'], 'model');
  const adapterIdentities = model.adapterIdentities ?? [];
  if (!label(model.id) || !digest(model.identity) || !Array.isArray(adapterIdentities) || adapterIdentities.length > 8
    || !adapterIdentities.every(digest) || new Set(adapterIdentities).size !== adapterIdentities.length) {
    throw invalid('model needs an id, a sha256 identity and distinct sha256 adapter identities');
  }
  return { id: model.id, identity: model.identity, adapterIdentities: [...adapterIdentities] };
}

/** prepare() input. It takes no prompts, tools or prompt hashes: only the pin, limits and requirements. */
export function validatePrepareRequest(input, { protectedProtocol = null, secretShared = false } = {}) {
  if (!object(input)) throw invalid('prepare needs { model, generation?, execution }');
  onlyKeys(input, ['model', 'generation', 'execution'], 'prepare (it takes no prompts, tools or prompt hashes)');
  const model = validateModelPin(input.model);
  let generation = { maxOutputTokens: null };
  if (input.generation !== undefined) {
    if (!object(input.generation)) throw invalid('generation must be an object');
    onlyKeys(input.generation, ['maxOutputTokens'], 'generation');
    const limit = input.generation.maxOutputTokens;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw invalid('generation.maxOutputTokens must be a positive integer');
    generation = { maxOutputTokens: limit ?? null };
  }
  if (!object(input.execution)) throw invalid('execution requirements are required');
  const execution = structuredClone(input.execution);
  // Only a host that enabled the unreviewed protected route passes `protectedProtocol`; then homomorphic compiles
  // to the protected policy. Every other refusal (CONFIDENTIAL_EXECUTION_UNAVAILABLE, EXECUTION_REQUEST_INVALID)
  // comes from the one compiler.
  if (protectedProtocol !== null && execution.protection === 'homomorphic') {
    return freezeDeep({ model, generation, execution, policy: compileProtectedExecutionRequirements(execution, protectedProtocol), protected: true });
  }
  // Only a host that enabled the unreviewed secret-shared route passes `secretShared`; otherwise the one compiler refuses it.
  if (secretShared === true && execution.protection === 'secret-sharing') {
    return freezeDeep({ model, generation, execution, policy: compileSecretSharedExecutionRequirements(execution), secretShared: true });
  }
  const policy = compileExecutionRequirements(execution);
  return freezeDeep({ model, generation, execution, policy });
}

/** run() input: a prepared plan, the caller's idempotency key, and the content. */
export function validateRunRequest(input) {
  if (!object(input)) throw invalid('run needs { planId, requestId, input: { messages } }');
  onlyKeys(input, ['planId', 'requestId', 'input'], 'run');
  if (!label(input.planId)) throw invalid('planId is required');
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw invalid('requestId must be 1 to 128 letters, digits, dots, colons, underscores or hyphens');
  }
  if (!object(input.input)) throw invalid('input must be { messages }');
  onlyKeys(input.input, ['messages'], 'input');
  const { messages } = input.input;
  if (!Array.isArray(messages) || !messages.length || messages.length > 256
    || !messages.every(message => object(message) && typeof message.role === 'string' && typeof message.content === 'string')) {
    throw invalid('input.messages must be 1 to 256 messages with a role and text content');
  }
  return { planId: input.planId, requestId: input.requestId, messages: structuredClone(messages) };
}

/** The resolver's candidate route, checked and given an identity. Nothing has been sent at this point. */
export async function describeRoute(candidate, model) {
  if (!object(candidate)) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'No route can run this request. Nothing was sent.');
  const backend = executionBackend(candidate.backend);
  const participants = candidate.participants ?? [];
  const selection = candidate.selection ?? 'all';
  if (!backend) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', `Backend ${candidate.backend} is not qualified here. Nothing was sent.`);
  const listed = Array.isArray(participants) && participants.length <= 128 && participants.every(label)
    && new Set(participants).size === participants.length;
  const complete = candidate.shape === 'local' ? participants.length === 0 && selection === 'all'
    : selection === 'any-eligible' ? candidate.shape === 'remote' && participants.length === 0 : participants.length > 0;
  if (!ROUTE_SHAPES.includes(candidate.shape) || !ROUTE_SELECTIONS.includes(selection) || !listed || !complete) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The resolved route is incomplete. Nothing was sent.');
  }
  const maxCharge = chargeCeiling(candidate.maxCharge, candidate.shape);
  const planIdentity = candidate.planIdentity ?? null;
  if (planIdentity !== null && (!label(planIdentity) || candidate.shape !== 'split')) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'Only a split route has a partition plan identity. Nothing was sent.');
  }
  // An edges route names, among its participants, the two requester-held stages that read content; the rest read activations.
  const edges = candidate.backend === EDGES_BACKEND;
  const edgeParticipants = candidate.edgeParticipants ?? null;
  if (edges ? !(candidate.shape === 'split' && selection === 'all' && Array.isArray(edgeParticipants) && edgeParticipants.length === 2
      && new Set(edgeParticipants).size === 2 && edgeParticipants.every(id => participants.includes(id)) && participants.length >= 3)
    : edgeParticipants !== null) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The resolved edges route is incomplete. Nothing was sent.');
  }
  const route = { schema: EXECUTION_ROUTE_SCHEMA, shape: candidate.shape, selection, participants: [...participants].sort(),
    backend: candidate.backend, protocol: backend.protocol, model: structuredClone(model), planIdentity,
    ...(edges ? { edgeParticipants: [...edgeParticipants].sort() } : {}) };
  return { route: freezeDeep({ id: await hashJson(route), ...route }), maxCharge };
}

/**
 * A plan's charge is `{ kind: 'capped', maximum, unit }` or `{ kind: 'free' }`, never unknown. A network route that
 * does not state its cap is refused: nothing is planned that could charge without a ceiling. A local route is free.
 */
export function chargeCeiling(value, shape) {
  if (value === undefined || value === null) {
    if (shape === 'local') return FREE;
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The charge for this route cannot be capped, so it is not planned. Nothing was sent.');
  }
  if (object(value) && value.kind === 'free' && Object.keys(value).length === 1) return FREE;
  const capped = object(value) && (value.kind === 'capped' || value.kind === undefined) && Number.isSafeInteger(value.maximum) && value.maximum >= 0 && label(value.unit);
  if (!capped) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The resolved route has an invalid charge ceiling. Nothing was sent.');
  return freezeDeep({ kind: 'capped', maximum: value.maximum, unit: value.unit });
}

/** True when `current` charges no more than `planned`: free stays free, a cap never rises or changes unit. */
export function chargeWithin(current, planned) {
  if (planned.kind === 'free') return current.kind === 'free';
  return current.kind === 'free' || (current.unit === planned.unit && current.maximum <= planned.maximum);
}

export const REQUESTER_DEVICE = Object.freeze({ role: 'requester-device' });
/** Coordinators, credit ledgers and relays that carry a request: they see its metadata, never its content. */
export const CARRIER = Object.freeze({ role: 'carrier' });
const NOT_REVIEWED = Object.freeze({ state: 'not-reviewed' });
const NOT_APPLICABLE = Object.freeze({ state: 'not-applicable' });
export { NOT_REVIEWED, NOT_APPLICABLE };

/** The concrete route a resolved route is: never `auto`. */
export function routeKindOf(route) {
  return route.shape === 'split' ? (route.backend === EDGES_BACKEND ? 'split-local-edges' : 'split') : route.shape;
}

/**
 * Who can read the prompt, intermediate state, answer and metadata on a plaintext route, and what its backend exposes.
 * Describes the backend, not the permission. Every reader list names at least the requester's own device.
 */
export function routeDisclosure(route, execution) {
  const backend = executionBackend(route.backend);
  if (route.backend === EDGES_BACKEND) return edgesDisclosure(route, backend);
  const local = route.shape === 'local';
  const named = execution.participants?.kind === 'named';
  const executors = route.shape === 'split' ? { role: 'stage-operator', selection: 'all', ids: [...route.participants] }
    : route.selection === 'any-eligible' ? { role: 'answering-computer', selection: 'any-eligible', ids: [] }
      : { role: 'answering-computer', selection: route.selection, ids: [...route.participants] };
  const readers = local ? [REQUESTER_DEVICE] : [REQUESTER_DEVICE, executors];
  const assumptions = local ? [] : ['recipient-conduct-unchecked', ...(named ? ['named-device-ownership-unchecked'] : [])];
  const content = () => ({ readers: structuredClone(readers), assumptions: [...assumptions], verified: true,
    check: local ? 'local-route' : 'route-binding-before-release' });
  return freezeDeep({
    prompt: content(), intermediate: content(), answer: content(),
    metadata: { items: local ? [] : [...backend.metadata], readers: local ? [REQUESTER_DEVICE] : [REQUESTER_DEVICE, executors, CARRIER],
      assumptions: [], verified: false, check: null },
    trustAssumptions: [...assumptions],
    review: NOT_APPLICABLE
  });
}

/**
 * Requester-held edges, a plaintext split: the prompt and answer (as text or token IDs) reach only the two edge stages,
 * which run on devices bound to the requester. Every other stage reads plaintext activations, which an operator may
 * invert into the prompt and the answer.
 */
function edgesDisclosure(route, backend) {
  const middle = route.participants.filter(id => !route.edgeParticipants.includes(id));
  const edges = { role: 'requester-edge-device', ids: [...route.edgeParticipants] };
  const operators = { role: 'stage-operator', selection: 'all', ids: middle };
  const content = () => ({ readers: [REQUESTER_DEVICE, structuredClone(edges)], assumptions: ['edge-devices-bound-to-requester'],
    verified: true, check: 'route-binding-before-release' });
  return freezeDeep({
    prompt: content(),
    intermediate: { readers: [REQUESTER_DEVICE, structuredClone(edges), structuredClone(operators)],
      assumptions: ['activations-may-reveal-content', 'recipient-conduct-unchecked'], verified: true, check: 'route-binding-before-release' },
    answer: content(),
    metadata: { items: [...backend.metadata], readers: [REQUESTER_DEVICE, structuredClone(edges), structuredClone(operators), CARRIER],
      assumptions: [], verified: false, check: null },
    trustAssumptions: ['edge-devices-bound-to-requester', 'activations-may-reveal-content', 'recipient-conduct-unchecked'],
    review: NOT_APPLICABLE
  });
}

const reviewValid = review => object(review) && (review.state === 'reviewed'
  ? Object.keys(review).length === 4 && label(review.by) && typeof review.at === 'string' && ISO_TIME.test(review.at) && label(review.reference)
  : ['not-applicable', 'not-reviewed'].includes(review.state) && Object.keys(review).length === 1);
const readerValid = reader => object(reader) && READER_ROLES.includes(reader.role)
  && (reader.ids === undefined || (Array.isArray(reader.ids) && reader.ids.every(label)))
  && (reader.when === undefined || (object(reader.when?.collusion) && reader.when.collusion.sameStage === true
    && Number.isSafeInteger(reader.when.collusion.count) && reader.when.collusion.count >= 2));

/**
 * Every disclosure, whatever its backend, names readers for each section: a non-empty list of roles, or "unknown".
 * An empty list would read as "nobody" with no condition, which no route can promise.
 */
export function assertDisclosureComplete(disclosure) {
  const complete = disclosure && typeof disclosure === 'object' && DISCLOSURE_SECTIONS.every(name => {
    const section = disclosure[name];
    return object(section) && (section.readers === 'unknown' || (Array.isArray(section.readers) && section.readers.length > 0
      && section.readers.every(readerValid)))
      && Array.isArray(section.assumptions) && section.assumptions.every(code => ASSUMPTIONS.includes(code)) && typeof section.verified === 'boolean';
  }) && Array.isArray(disclosure.metadata.items) && Array.isArray(disclosure.trustAssumptions)
    && disclosure.trustAssumptions.every(code => ASSUMPTIONS.includes(code)) && reviewValid(disclosure.review);
  if (!complete) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The route has no complete disclosure. Nothing was sent.');
  return disclosure;
}


export function assertLeakageAllowed(disclosure, allowMetadata) {
  const missing = disclosure.metadata.items.filter(item => !allowMetadata.includes(item));
  if (missing.length) throw executionError('LEAKAGE_NOT_ALLOWED', `This route exposes ${missing.join(', ')}, which the request does not allow. Nothing was sent.`);
}

/** The prepared route must stay within the caller's route, participants and protection. */
export function assertRouteWithinRequirements(route, execution) {
  const { protection, participants } = execution;
  const kind = routeKindOf(route);
  if (execution.route === 'local' && kind !== 'local') throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'This device has no route for this model. Nothing was sent.');
  if (participants?.kind === 'named' && !route.participants.every(id => participants.ids.includes(id))) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The only available route includes a participant that was not named. Nothing was sent.');
  }
  // Each protection runs only on its own backend: never a weaker one, and no other request runs on a protected route.
  const ownBackend = protection === 'secret-sharing' ? route.backend === SECRET_SHARED_BACKEND
    : protection === 'homomorphic' ? route.backend === PROTECTED_BACKEND
      : protection === 'plaintext' && executionBackend(route.backend) !== null;
  if (!ownBackend) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', protection === 'plaintext'
      ? 'This route is reserved for a protection the request did not ask for. Nothing was sent.'
      : `No ${protection} route is available. Nothing was sent; the request is not retried with weaker protection.`);
  }
  // `auto` chooses among the routes this protection allows (never requester-held edges, which must be asked for); an
  // explicit route is held exactly.
  if (execution.route === 'auto' ? !AUTO_ROUTES[protection].includes(kind) : execution.route !== kind) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', execution.route === 'split-local-edges'
      ? 'No split keeps the prompt and answer on your own edge devices. Nothing was sent; the request is not retried as an ordinary split.'
      : kind === 'split-local-edges' ? 'This route is reserved for requester-held edges. Nothing was sent.'
        : `No ${execution.route} route is available. Nothing was sent.`);
  }
}

/**
 * Check a disclosure preview against the plan before the caller's approval is asked and before content leaves.
 * Returns the admitted route; any substitution of backend, model, adapters or participants is EXECUTION_PLAN_CHANGED.
 */
export function admitRoute(plan, policy, binding) {
  const { route } = plan;
  if (!object(binding) || !object(binding.route) || !Array.isArray(binding.route.hops)) throw changed('The route has no execution binding');
  if (binding.route.backend !== route.backend || binding.route.protocol !== route.protocol) throw changed('The backend changed');
  if (binding.route.modelId !== route.model.id || binding.route.modelIdentity !== route.model.identity
    || !same(binding.route.adapterIdentities, route.model.adapterIdentities)) throw changed('The model or adapters changed');
  if (!narrowsExecutionPolicy(policy, binding.policy)) throw changed('The route policy is broader than the request');
  const remote = binding.route.hops.filter(hop => hop.placement === 'remote').map(hop => hop.recipient);
  const local = binding.route.hops.length - remote.length;
  const fits = route.shape === 'local' ? remote.length === 0 && local > 0
    : local === 0 && (route.selection === 'all' ? same([...remote].sort(), route.participants)
      : route.selection === 'one-of' ? remote.length === 1 && route.participants.includes(remote[0])
        : remote.length === 1);
  if (!fits) throw changed('The participants differ from the prepared route');
  if (route.backend === EDGES_BACKEND) {
    const readers = binding.route.hops.filter(hop => hop.disclosure === 'plaintext').map(hop => hop.recipient).sort();
    if (!same(readers, route.edgeParticipants)) throw changed('The stages that read content differ from the prepared edges');
  }
  return freezeDeep({ id: binding.routeId, planRouteId: route.id, policyId: binding.policyId, shape: route.shape,
    participants: [...remote].sort(), backend: route.backend, protocol: route.protocol });
}

/** A local route never asks for disclosure approval; its admission is the plan itself. */
export function admitLocalRoute(plan) {
  return freezeDeep({ id: null, planRouteId: plan.route.id, policyId: null, shape: 'local', participants: [],
    backend: plan.route.backend, protocol: plan.route.protocol });
}

const STOP_REASONS = ['length', 'max-tokens', 'stop', 'eos', 'eos-token', 'stop-token', 'stop-sequence', 'context-limit'];

/** Check an executor's answer against the plan. Anything unexpected is RESULT_UNVERIFIED, never a success. */
export function readExecutorResult(plan, raw, streamed) {
  const unverified = message => executionError('RESULT_UNVERIFIED', message);
  if (!object(raw) || typeof raw.content !== 'string') throw unverified('The executor returned no text answer');
  const { model } = plan.route;
  if (raw.modelIdentity !== model.identity || (raw.modelId ?? raw.model) !== model.id) throw unverified('The answer names a different model');
  if (!same(raw.adapterIdentities ?? [], model.adapterIdentities)) throw unverified('The answer names different adapters');
  if (streamed !== null && streamed !== raw.content) throw unverified('The final answer differs from its streamed text');
  // A provider that predates completion metadata reports no reason: the answer is whole, its reason unknown.
  const stopReason = raw.execution?.stopReason ?? raw.execution?.completion?.stopReason ?? null;
  if (stopReason !== null && !STOP_REASONS.includes(stopReason)) throw unverified('The answer has an unrecognized termination reason');
  const completion = raw.execution?.completion;
  const usage = Number.isSafeInteger(raw.usage?.inputTokens) && Number.isSafeInteger(raw.usage?.outputTokens)
    ? { inputTokens: raw.usage.inputTokens, outputTokens: raw.usage.outputTokens }
    : Number.isSafeInteger(completion?.promptTokenCount) && Number.isSafeInteger(completion?.generatedTokenCount)
      ? { inputTokens: completion.promptTokenCount, outputTokens: completion.generatedTokenCount } : null;
  const limit = plan.generation.maxOutputTokens;
  if (limit !== null && usage && usage.outputTokens > limit) throw unverified('The answer exceeds the output limit');
  return {
    output: { text: raw.content, stopReason,
      finishReason: stopReason === null ? 'unknown' : ['length', 'max-tokens', 'context-limit'].includes(stopReason) ? 'length' : 'stop' },
    usage,
    settlement: raw.serviceCredit ?? raw.execution?.serviceCredit ?? null,
    providerReceipt: raw.execution?.executionReceipt ?? raw.execution?.receipt ?? null,
    timeline: deliveryTimeline(raw.execution?.delivery)
  };
}

const DELIVERY_EVENTS = ['sent', 'resent', 'received', 'path-opened', 'path-failed', 'ice-restart', 'ice-restarted', 'ice-restart-failed'];
const DELIVERY_STAGES = ['admit', 'request'];
/** This requester's own record of how its request frames reached the recipient: each send, each re-send to
 * the same recipient, each acknowledgement and (protocol 2) each change of path on the same connection, in
 * milliseconds from the first frame. Null when none was kept. */
export function deliveryTimeline(delivery) {
  if (!object(delivery) || ![1, 2].includes(delivery.protocol) || !Array.isArray(delivery.timeline) || delivery.timeline.length > 64) return null;
  const rows = delivery.timeline.filter(row => object(row) && DELIVERY_EVENTS.includes(row.event) && DELIVERY_STAGES.includes(row.stage)
    && Number.isSafeInteger(row.attempt) && row.attempt > 0 && Number.isFinite(row.at) && row.at >= 0)
    .map(({ event, stage, attempt, at, path }) => ({ event, stage, attempt, at, ...(Number.isSafeInteger(path) && path >= 0 && path <= 8 ? { path } : {}) }));
  return rows.length ? rows : null;
}

const NOT_VERIFIED_PLAINTEXT = ['recipient-conduct', 'erasure', 'hardware-attestation'];
const NOT_VERIFIED_EDGES = [...NOT_VERIFIED_PLAINTEXT, 'activation-inversion-resistance'];

/** What the requester bound before release on a plaintext route: who read content and, on edges, who read activations only. */
export function plaintextPrivacyEvidence(plan, admitted) {
  const local = admitted?.shape === 'local';
  const routeKind = routeKindOf(plan.route);
  if (plan.route.backend === EDGES_BACKEND) {
    const readers = [...plan.route.edgeParticipants];
    const middle = admitted ? admitted.participants.filter(id => !readers.includes(id)) : [];
    return {
      protection: 'plaintext', routeKind,
      contentReadBy: admitted ? { requesterDevice: true, participants: readers } : null,
      intermediateReadBy: admitted ? { participants: [...readers, ...middle].sort() } : null,
      checks: admitted ? [
        { claim: 'edge-devices-bound-to-requester', by: 'requester', method: 'requester-device-binding-before-release', value: readers },
        { claim: 'content-recipients', by: 'requester', method: 'route-binding-before-release', value: readers },
        { claim: 'activation-only-recipients', by: 'requester', method: 'route-binding-before-release', value: middle }
      ] : [],
      notVerified: NOT_VERIFIED_EDGES
    };
  }
  return {
    protection: 'plaintext', routeKind,
    contentReadBy: admitted ? { requesterDevice: true, participants: [...admitted.participants] } : null,
    intermediateReadBy: admitted ? { participants: [...admitted.participants] } : null,
    checks: admitted ? [{ claim: local ? 'content-stayed-on-requester-device' : 'content-recipients', by: 'requester',
      method: local ? 'local-route' : 'route-binding-before-release', value: [...admitted.participants] }] : [],
    notVerified: NOT_VERIFIED_PLAINTEXT
  };
}

const CREDIT_TEXT = ['id', 'reservationId', 'status', 'unit', 'settledAt'];
const CREDIT_COUNTS = ['charge', 'charged', 'released', 'outputTokens'];
/**
 * Credits charged or released, as the executor or ledger reported them, as a typed service-credit record. Unknown
 * fields are dropped from the record and kept only in its digest. A signed bill is not proof of confidentiality.
 */
export async function creditEvidence(settlement) {
  const record = object(settlement) ? { kind: 'service-credit',
    ...Object.fromEntries(CREDIT_TEXT.filter(key => typeof settlement[key] === 'string').map(key => [key, settlement[key]])),
    ...Object.fromEntries(CREDIT_COUNTS.filter(key => Number.isSafeInteger(settlement[key])).map(key => [key, settlement[key]])) } : null;
  return { record, digest: object(settlement) ? await hashJson(settlement) : null, checkedHere: false,
    notVerified: ['charge-amount', 'confidentiality-from-billing'] };
}

/**
 * The receipt, on completion, cancellation and failure: the requested requirements, the concrete route and parties that
 * actually ran, and three separate records: privacy checks and their limits, answer integrity, and credits.
 */
export async function executionReceipt({ plan, requestId, attemptId, status, admitted, read = null, timeline = null, settlement = null,
  privacy = null, integrity = null, routeExtensions = null, at = Date.now() }) {
  timeline = read?.timeline ?? timeline;
  settlement = read?.settlement ?? settlement;
  return freezeDeep({
    schema: EXECUTION_RECEIPT_SCHEMA, api: INFERENCE_API_VERSION, requestId, attemptId, planId: plan.id, status, issuedAt: isoTime(at),
    protection: plan.execution.protection, routeKind: routeKindOf(plan.route),
    // Observed by this requester and not signed by the provider: milliseconds from the first frame. Present only when kept.
    ...(timeline ? { timeline: structuredClone(timeline) } : {}),
    requested: { model: structuredClone(plan.route.model), execution: structuredClone(plan.execution), policyId: plan.policyId },
    route: admitted ? { planRouteId: plan.route.id, admittedRouteId: admitted.id, policyId: admitted.policyId, shape: admitted.shape,
      participants: [...admitted.participants], backend: admitted.backend, protocol: admitted.protocol, planIdentity: plan.route.planIdentity,
      ...(routeExtensions ? { extensions: structuredClone(routeExtensions) } : {}) } : null,
    disclosure: structuredClone(plan.disclosure),
    evidence: {
      privacy: privacy ?? plaintextPrivacyEvidence(plan, admitted),
      integrity: integrity ?? {
        checks: read ? [
          { claim: 'model-identity', by: 'requester', method: 'answer-identity', value: plan.route.model.identity },
          { claim: 'adapter-identities', by: 'requester', method: 'answer-identity', value: [...plan.route.model.adapterIdentities] },
          { claim: 'stream-matches-answer', by: 'requester', method: 'text-comparison' }
        ] : [],
        providerReceipt: read?.providerReceipt ? { digest: await hashJson(read.providerReceipt), checkedHere: false } : null,
        notVerified: ['correct-computation', 'reported-token-counts', ...(read?.output?.stopReason === null ? ['termination-reason'] : [])]
      },
      credits: await creditEvidence(settlement)
    }
  });
}

export const metadataNames = () => [...EXECUTION_METADATA];
