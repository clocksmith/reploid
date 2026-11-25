/** Requester-owned requirements. Advertisements and signed receipts confer no privacy qualification. */
import { canonicalPartitionJson } from '../contracts/partition.js';
import { hashJson } from '../artifacts/signatures.js';

const assert = (ok, message) => { if (!ok) throw Object.assign(new Error(`Execution privacy: ${message}`), { code: 'PRIVACY_POLICY_REJECTED' }); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && value === value.trim() && !/[\x00-\x1f\x7f]/u.test(value);
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const list = values => Array.isArray(values) && values.length <= 128 && values.every(id) && new Set(values).size === values.length;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export const EXECUTION_POLICY_SCHEMA = 'reploid.execution-policy/v2';
export const EXECUTION_BINDING_SCHEMA = 'reploid.execution-binding/v2';
/** Stable refusal codes shared by the inference API, its HTTP adapters and the CLI. */
export const EXECUTION_ERROR_CODES = Object.freeze({
  CONFIDENTIAL_EXECUTION_UNAVAILABLE: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE',
  LEAKAGE_NOT_ALLOWED: 'LEAKAGE_NOT_ALLOWED',
  EXECUTION_PLAN_EXPIRED: 'EXECUTION_PLAN_EXPIRED',
  EXECUTION_PLAN_CHANGED: 'EXECUTION_PLAN_CHANGED',
  RESULT_UNVERIFIED: 'RESULT_UNVERIFIED',
  EXECUTION_REQUEST_INVALID: 'EXECUTION_REQUEST_INVALID',
  EXECUTION_ROUTE_UNAVAILABLE: 'EXECUTION_ROUTE_UNAVAILABLE'
});
export const executionError = (code, message) => {
  if (!Object.hasOwn(EXECUTION_ERROR_CODES, code)) throw new Error(`Unknown execution error code ${code}`);
  return Object.assign(new Error(message), { code });
};
/** Why `homomorphic` is unavailable. The research protected route stays off until this review is done. */
export const CONFIDENTIAL_EXECUTION_REVIEW_REASON = 'awaiting independent security review';
/** Metadata names a caller may allow. Content itself is governed by `protection`, never by this list. */
export const EXECUTION_METADATA = Object.freeze(['model-id', 'timing', 'length', 'access-patterns']);
const metadata = [...EXECUTION_METADATA];
const plaintextLeakage = [...metadata, 'plaintext'];
/**
 * Backends this requester can actually run, keyed by exact identity. A backend is eligible only when its
 * registered computation and protocol match the offer exactly; an advertisement cannot add a row or upgrade one.
 * `metadata` is the metadata the backend's route discloses. An executor that reads content in plaintext also observes
 * its access patterns, so every plaintext backend lists all four; the rest also reach coordinators, ledgers and relays.
 * Providers on earlier releases require all four in a plaintext policy, so a narrower default would be refused.
 */
const PLAINTEXT_METADATA = ['model-id', 'timing', 'length', 'access-patterns'];
/**
 * `doppler-partition-edges/v1` is an ordered split whose first stage (embedding and the first layers, and the
 * coordinator that tokenizes) and last stage (the last layers, final norm and LM head, which samples and detokenizes)
 * run on the requester's own devices. Only those two stages receive prompt and answer tokens or text; every other stage
 * receives plaintext intermediate activations and token counts, never token IDs. Activations can leak content to the
 * operator that reads them (inversion), so this is a narrower disclosure, not confidential execution.
 */
export const EDGES_BACKEND = 'doppler-partition-edges/v1';
export const EXECUTION_BACKENDS = freeze({
  'doppler-plaintext/v1': { computation: 'plaintext', protocol: null, executorsReadContent: true, metadata: [...PLAINTEXT_METADATA] },
  'doppler-partition-plaintext/v1': { computation: 'plaintext', protocol: null, executorsReadContent: true, metadata: [...PLAINTEXT_METADATA] },
  [EDGES_BACKEND]: { computation: 'plaintext', protocol: null, executorsReadContent: false, executorsReadActivations: true,
    metadata: [...PLAINTEXT_METADATA] }
});
/**
 * How data is processed (`execution.protection`). `plaintext` always compiles; `secret-sharing` and `homomorphic` fail
 * closed unless a host enables their unreviewed routes (inference/secret-shared.js, inference/protected.js); `attested`
 * is reserved and always refused: its route is parked and no verified hardware is qualified in this build.
 */
export const PROTECTIONS = Object.freeze(['plaintext', 'secret-sharing', 'homomorphic', 'attested']);
/**
 * Where and how the model runs (`execution.route`), typed per protection so an invalid pair cannot be written:
 *  - `local`: this device runs the whole model (plaintext only; the request has no participants);
 *  - `remote`: one other computer runs the whole model;
 *  - `split`: several computers run it in stages, with any eligible computers at the edges;
 *  - `split-local-edges`: several computers, with two devices bound to the requester holding the first and last stage
 *    (plaintext only; both edges must be bound to the requester, otherwise refused);
 *  - `auto`: any route this protection allows. Under plaintext that includes `local` when the model is on this device,
 *    and it can choose a split, which widens who reads the message; the plan states the chosen route and its readers
 *    before anything is sent. `auto` never chooses weaker protection.
 */
export const ROUTE_KINDS = Object.freeze(['local', 'remote', 'split', 'split-local-edges']);
export const EXECUTION_ROUTES = Object.freeze([...ROUTE_KINDS, 'auto']);
export const PROTECTION_ROUTES = Object.freeze({
  plaintext: Object.freeze(['local', 'remote', 'split', 'split-local-edges', 'auto']),
  'secret-sharing': Object.freeze(['split', 'auto']),
  homomorphic: Object.freeze(['remote', 'auto']),
  attested: Object.freeze(['remote', 'auto'])
});
/** The concrete routes `auto` may choose under each protection. */
export const AUTO_ROUTES = Object.freeze({
  plaintext: Object.freeze(['local', 'remote', 'split']),
  'secret-sharing': Object.freeze(['split']),
  homomorphic: Object.freeze(['remote']),
  attested: Object.freeze(['remote'])
});
export const SECRET_SHARED_PROTOCOL = 'reploid.secret-shared-2party/v1';
export const SECRET_SHARED_COLLUSION = 'non-colluding-share-pairs';
export const SECRET_SHARED_REVIEW_REASON = 'secret-shared execution is unreviewed and off by default';
/** Why `attested` is refused. The attested route is parked; nothing in this build verifies hardware or its software. */
export const ATTESTED_UNAVAILABLE_REASON = 'no attested route is enabled in this build, so no hardware or its software is verified';
export const executionBackend = backend => Object.hasOwn(EXECUTION_BACKENDS, backend) ? EXECUTION_BACKENDS[backend] : null;
const plaintextBackends = Object.keys(EXECUTION_BACKENDS);
const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));

/** Explicit initialization only. Wire inputs must pass strict validation, never this constructor. */
export function createExecutionPolicy(overrides = {}) {
  assert(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'explicit layered requirements required');
  const computation = overrides.computation ?? 'plaintext';
  return validateExecutionPolicy({ schema: EXECUTION_POLICY_SCHEMA, placement: 'local-only',
    recipients: { kind: 'none', ids: [] }, computation, collusion: 'none',
    leakage: computation === 'plaintext' ? plaintextLeakage : metadata,
    protocol: null, attestation: null, keyContext: null, retention: 'execution-and-recovery',
    publication: false, reuse: false, allowDowngrade: false, ...overrides });
}

export function validateExecutionPolicy(input) {
  const value = structuredClone(input);
  const keys = ['schema', 'placement', 'recipients', 'computation', 'collusion', 'leakage',
    'protocol', 'attestation', 'keyContext', 'retention', 'publication', 'reuse', 'allowDowngrade'];
  assert(exact(value, keys) && value.schema === EXECUTION_POLICY_SCHEMA,
    'current layered policy required; review execution settings before sending');
  assert(['local-only', 'network-allowed'].includes(value.placement) && ['none', 'all-remote', SECRET_SHARED_COLLUSION].includes(value.collusion),
    'invalid placement or collusion model');
  assert(exact(value.recipients, ['kind', 'ids']) && ['none', 'named', 'open'].includes(value.recipients.kind)
    && list(value.recipients.ids) && (value.recipients.kind === 'named' ? value.recipients.ids.length > 0 : value.recipients.ids.length === 0),
  'invalid recipient authorization; named recipients require a nonempty, unique list');
  assert(value.placement !== 'local-only' || value.recipients.kind === 'none', 'local placement excludes network recipients');
  assert(['plaintext', 'cryptographic', 'attested'].includes(value.computation)
    && list(value.leakage) && value.leakage.every(item => plaintextLeakage.includes(item)), 'invalid computation or leakage set');
  assert(value.protocol === null || id(value.protocol), 'explicit protocol identity required');
  assert(value.attestation === null || hash(value.attestation), 'attestation policy digest required');
  assert(value.keyContext === null || id(value.keyContext), 'key context identity required');
  assert(['execution-and-recovery', 'ephemeral'].includes(value.retention) && value.publication === false
    && value.reuse === false && value.allowDowngrade === false, 'publication, reuse and downgrade are never implicitly authorized');
  assert(value.computation !== 'cryptographic' || value.protocol !== null && value.keyContext !== null
    && !value.leakage.includes('plaintext'), 'cryptographic execution needs protocol, key context and no plaintext leakage');
  assert(value.computation !== 'attested' || value.attestation !== null
    && !value.leakage.includes('plaintext'), 'attested execution needs an attestation policy and no plaintext leakage');
  return freeze(value);
}

export const requestExecutionPolicy = request => validateExecutionPolicy(request?.privacy);

/** No built-in attestation verifier or encrypted evaluator exists. Flags can never enable one. */
export function assertAvailableExecutionPolicy(policy) {
  policy = validateExecutionPolicy(policy);
  assert(policy.computation !== 'attested' && policy.attestation === null,
    'attested backend unavailable; verified hardware and session evidence required');
  assert(policy.computation === 'plaintext' && policy.protocol === null && policy.keyContext === null
    && policy.collusion === 'none', 'cryptographic backend unavailable for this model and protocol');
  assert(policy.retention === 'execution-and-recovery', 'ephemeral remote state and recovery erasure are not qualified');
  return policy;
}

const invalid = message => executionError('EXECUTION_REQUEST_INVALID', `Execution requirements: ${message}`);
const unavailable = (message, reason) => Object.assign(executionError('CONFIDENTIAL_EXECUTION_UNAVAILABLE', message), { reason });
/** True when the route is a split whose first and last stages run on two devices bound to the requester. */
export const requesterEdges = execution => execution?.route === 'split-local-edges';

/**
 * Shape checks shared by every compiler. JSON cannot be type-checked, so anything outside the per-protection union is
 * refused here with EXECUTION_REQUEST_INVALID, naming the routes that protection allows.
 */
function checkRequirements(execution) {
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) throw invalid('execution must be { protection, route, participants?, allowMetadata }');
  const { protection, route, participants, allowMetadata } = execution;
  if (!PROTECTIONS.includes(protection)) throw invalid(`protection must be one of ${PROTECTIONS.join(', ')}`);
  const routes = PROTECTION_ROUTES[protection];
  if (!routes.includes(route)) throw invalid(`protection ${protection} takes route ${routes.join(', ')}`);
  const local = route === 'local';
  const keys = local ? ['protection', 'route', 'allowMetadata'] : ['protection', 'route', 'participants', 'allowMetadata'];
  if (!exact(execution, keys)) {
    throw invalid(local ? 'route local takes protection, route and allowMetadata only: a local request has no participants'
      : `route ${route} takes ${keys.join(', ')}, with no other fields`);
  }
  if (!Array.isArray(allowMetadata) || new Set(allowMetadata).size !== allowMetadata.length
    || !allowMetadata.every(item => metadata.includes(item))) throw invalid(`allowMetadata must be distinct items of ${metadata.join(', ')}`);
  if (local) return { kind: 'none', placement: 'local-only' };
  const kind = participants?.kind;
  const shaped = kind === 'named' ? exact(participants, ['kind', 'ids']) && participants.ids?.length > 0 && list(participants.ids)
    : kind === 'open' && exact(participants, ['kind']);
  if (!shaped) throw invalid('participants must be { kind: "open" } or { kind: "named", ids: [unique ids] }');
  return { kind, placement: 'network-allowed' };
}

/**
 * Compile a caller's execution requirements into the verified peer policy. Only `plaintext` compiles here; every other
 * protection fails closed with CONFIDENTIAL_EXECUTION_UNAVAILABLE and is never relaxed to plaintext or made local.
 */
export function compileExecutionRequirements(execution) {
  const { kind, placement } = checkRequirements(execution);
  const { protection, participants, allowMetadata } = execution;
  if (protection === 'attested') {
    throw unavailable('Verified hardware is unavailable. Nothing was sent; the request is not retried with another protection.', ATTESTED_UNAVAILABLE_REASON);
  }
  if (protection === 'homomorphic') {
    throw unavailable('Computing on encrypted data is off unless this host enables its unreviewed route. Nothing was sent; the request is not retried as plaintext or local.',
      CONFIDENTIAL_EXECUTION_REVIEW_REASON);
  }
  if (protection === 'secret-sharing') {
    throw unavailable('Secret sharing is off unless this host enables its unreviewed route. Nothing was sent; the request is not retried as plaintext.',
      SECRET_SHARED_REVIEW_REASON);
  }
  // Requester-held edges compile to the plaintext layered policy: the middle stages do read plaintext activations. What
  // narrows disclosure is the route (EDGES_BACKEND), which the inference API requires for this route and never relaxes.
  return createExecutionPolicy({ placement, recipients: { kind, ids: kind === 'named' ? [...participants.ids] : [] },
    leakage: [...metadata.filter(item => allowMetadata.includes(item)), 'plaintext'] });
}

/**
 * The verified policy for a `homomorphic` request on a protected protocol. Only the inference API calls this, and only
 * when its host enabled the unreviewed protected route explicitly; `compileExecutionRequirements` above still refuses
 * `homomorphic` for every other caller. The protected route evaluates the whole model on one evaluator: route
 * `remote` or `auto`.
 */
export function compileProtectedExecutionRequirements(execution, protocol) {
  if (execution?.protection !== 'homomorphic') throw invalid('protected execution compiles homomorphic requirements only');
  const { kind } = checkRequirements(execution);
  if (!id(protocol)) throw invalid('protected execution needs a protocol identity');
  const { participants, allowMetadata } = execution;
  return createExecutionPolicy({ placement: 'network-allowed', recipients: { kind, ids: kind === 'named' ? [...participants.ids] : [] },
    computation: 'cryptographic', collusion: 'all-remote', protocol, keyContext: `requester-held-key/${protocol}`,
    leakage: metadata.filter(item => allowMetadata.includes(item)) });
}

/**
 * The verified policy for a `secret-sharing` request. Only the inference API calls this, and only when its host
 * enabled the unreviewed secret-shared route explicitly; `compileExecutionRequirements` refuses the value otherwise.
 * No executor reads plaintext, so `plaintext` is not in the leakage set; non-collusion of each stage's two share
 * operators is the stated trust assumption. The route is a split: `split` or `auto`.
 */
export function compileSecretSharedExecutionRequirements(execution) {
  if (execution?.protection !== 'secret-sharing') throw invalid('secret-shared execution compiles secret-sharing requirements only');
  const { kind } = checkRequirements(execution);
  const { participants, allowMetadata } = execution;
  return createExecutionPolicy({ placement: 'network-allowed', recipients: { kind, ids: kind === 'named' ? [...participants.ids] : [] },
    computation: 'cryptographic', collusion: SECRET_SHARED_COLLUSION, protocol: SECRET_SHARED_PROTOCOL,
    keyContext: `requester-held-shares/${SECRET_SHARED_PROTOCOL}`, leakage: metadata.filter(item => allowMetadata.includes(item)) });
}

/**
 * The caller requirements a stored policy stands for: `local` for a local-only policy, otherwise `auto` over its
 * recipients. Policies outside the API's vocabulary are refused, never widened.
 */
export function executionRequirementsFor(policy) {
  policy = validateExecutionPolicy(policy);
  const confidential = policy.computation !== 'plaintext' || policy.collusion !== 'none' || !policy.leakage.includes('plaintext');
  if (!confidential && (policy.retention !== 'execution-and-recovery' || policy.protocol || policy.attestation || policy.keyContext)) {
    throw invalid('this policy has requirements the inference API cannot express');
  }
  // A secret-shared policy stands for its own value: it trusts non-collusion, so it never reads as homomorphic.
  const protection = policy.computation === 'attested' ? 'attested'
    : policy.collusion === SECRET_SHARED_COLLUSION && policy.protocol === SECRET_SHARED_PROTOCOL ? 'secret-sharing'
      : confidential ? 'homomorphic' : 'plaintext';
  const allowMetadata = metadata.filter(item => policy.leakage.includes(item));
  if (policy.placement === 'local-only') {
    if (protection !== 'plaintext') throw invalid('only plaintext runs on this device');
    return freeze({ protection, route: 'local', allowMetadata });
  }
  if (policy.recipients.kind === 'none') throw invalid('a network policy with no recipients has no route');
  return freeze({ protection, route: 'auto',
    participants: policy.recipients.kind === 'named' ? { kind: 'named', ids: [...policy.recipients.ids] } : { kind: 'open' }, allowMetadata });
}

/** True when `narrowed` grants no recipient, leakage or mode that `base` does not. Used to accept operator narrowing. */
export function narrowsExecutionPolicy(base, narrowed) {
  try { base = validateExecutionPolicy(base); narrowed = validateExecutionPolicy(narrowed); } catch { return false; }
  const recipients = base.recipients.kind === 'open' ? narrowed.recipients.kind !== 'none' || narrowed.placement === 'local-only'
    : base.recipients.kind === 'named' ? narrowed.recipients.kind === 'named' && narrowed.recipients.ids.every(item => base.recipients.ids.includes(item))
      : narrowed.recipients.kind === 'none';
  return recipients && (base.placement === 'network-allowed' || narrowed.placement === 'local-only')
    && ['computation', 'collusion', 'protocol', 'attestation', 'keyContext', 'retention'].every(key => base[key] === narrowed[key])
    && narrowed.leakage.every(item => base.leakage.includes(item));
}

/** Complete explicit route, including requester-visible coordinators. Never use provider claims to construct it. */
export function plaintextExecutionRoute(request, { recipients = [], local = false, route = null } = {}) {
  assert(id(request.model?.id) && hash(request.model?.identity), 'exact model identity required');
  assert(list(recipients) && (local || recipients.length > 0), 'complete verified recipients required');
  const adapters = (request.model.adapters || []).map(adapter => adapter.identity);
  assert(adapters.every(hash), 'exact adapter identities required');
  return freeze({ schema: 'reploid.execution-route/v1', modelId: request.model.id, modelIdentity: request.model.identity,
    adapterIdentities: adapters, backend: request.model.partition ? 'doppler-partition-plaintext/v1' : 'doppler-plaintext/v1',
    protocol: null, route: structuredClone(route), hops: recipients.map(recipient => ({ recipient, placement: local ? 'local' : 'remote',
      disclosure: 'plaintext' })) });
}

export function validateExecutionRoute(policy, route) {
  policy = assertAvailableExecutionPolicy(policy);
  assert(exact(route, ['schema', 'modelId', 'modelIdentity', 'adapterIdentities', 'backend', 'protocol', 'route', 'hops'])
    && route.schema === 'reploid.execution-route/v1' && plaintextBackends.includes(route.backend)
    && route.protocol === null && Array.isArray(route.hops) && route.hops.length <= 128, 'unsupported execution route');
  if (route.backend === EDGES_BACKEND) validateEdgeHops(route);
  validatePlaintextHops(policy, route.hops, EXECUTION_BACKENDS[route.backend].metadata, { activations: route.backend === EDGES_BACKEND });
  return freeze(structuredClone(route));
}

/**
 * An edges route lists one remote hop per ordered stage, in stage order: the first and last stage read plaintext
 * (`disclosure: 'plaintext'`), and every stage between them reads activations only (`disclosure: 'activations'`).
 * There must be at least one such middle stage, and the two edge stages must be distinct participants.
 */
function validateEdgeHops(route) {
  const stages = route.route?.stages;
  assert(Array.isArray(stages) && stages.length >= 3 && stages.length === route.hops.length
    && stages.every((stage, index) => stage?.index === index && route.hops[index]?.recipient === stage.participantId
      && route.hops[index].placement === 'remote'
      && route.hops[index].disclosure === (index === 0 || index === stages.length - 1 ? 'plaintext' : 'activations')),
  'an edges route needs one hop per stage: plaintext at the first and last stage, activations only in between');
}

/** Builds the edges route for a partition request: the requester names the ordered route whose ends it runs itself. */
export function edgesExecutionRoute(request, { route }) {
  assert(id(request.model?.id) && hash(request.model?.identity), 'exact model identity required');
  const stages = route?.stages;
  assert(Array.isArray(stages) && stages.length >= 3, 'an edges route needs at least one stage between its two edges');
  const adapters = (request.model.adapters || []).map(adapter => adapter.identity);
  assert(adapters.every(hash), 'exact adapter identities required');
  return freeze({ schema: 'reploid.execution-route/v1', modelId: request.model.id, modelIdentity: request.model.identity,
    adapterIdentities: adapters, backend: EDGES_BACKEND, protocol: null, route: structuredClone(route),
    hops: stages.map((stage, index) => ({ recipient: stage.participantId, placement: 'remote',
      disclosure: index === 0 || index === stages.length - 1 ? 'plaintext' : 'activations' })) });
}

/**
 * The stage indexes that may receive token IDs under a bound route: every stage for a plaintext split, only the
 * first and last for an edges route. Null when the binding names no ordered route.
 */
export function tokenContextStages(binding) {
  const stages = binding?.route?.route?.stages;
  if (!Array.isArray(stages)) return null;
  if (binding.route.backend !== EDGES_BACKEND) return stages.map((_, index) => index);
  validateEdgeHops(binding.route);
  return [0, stages.length - 1];
}

export async function bindExecutionRoute(request, route) {
  const policy = requestExecutionPolicy(request);
  route = validateExecutionRoute(policy, route);
  assert(route.modelId === request.model.id && route.modelIdentity === request.model.identity
    && canonicalPartitionJson(route.adapterIdentities) === canonicalPartitionJson((request.model.adapters || []).map(adapter => adapter.identity)),
    'execution route substituted the requested model or adapters');
  return freeze({ schema: EXECUTION_BINDING_SCHEMA, policy, route,
    policyId: await hashJson(policy), routeId: await hashJson(route) });
}

export function sameExecutionBinding(a, b) {
  return canonicalPartitionJson(a) === canonicalPartitionJson(b);
}

export async function partitionPrivacyBinding(request, recipients, route) {
  const selected = request.privacyBinding?.route ?? plaintextExecutionRoute(request, { recipients, route });
  assert(recipients.every(recipient => selected.hops.some(hop => hop.placement === 'remote' && hop.recipient === recipient)),
    'partition binding omitted a remote execution recipient');
  assert(canonicalPartitionJson(selected.route) === canonicalPartitionJson(route), 'partition route changed');
  const binding = await bindExecutionRoute(request, selected);
  assert(!request.privacyBinding || sameExecutionBinding(binding, request.privacyBinding), 'partition privacy binding changed');
  return binding;
}

/** Shared plaintext disclosure requirements for inference and auxiliary operations. */
export function validatePlaintextHops(policy, hops, exposed = EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata, { activations = false } = {}) {
  policy = assertAvailableExecutionPolicy(policy);
  assert(Array.isArray(hops) && hops.length <= 128, 'bounded disclosure hops required');
  assert(new Set(hops.map(hop => hop?.recipient)).size === hops.length, 'duplicate route recipient');
  for (const hop of hops) {
    assert(exact(hop, ['recipient', 'placement', 'disclosure']) && id(hop.recipient)
      && ['local', 'remote'].includes(hop.placement) && (hop.disclosure === 'plaintext'
        || activations && hop.disclosure === 'activations' && hop.placement === 'remote'), 'unqualified route hop');
    if (hop.placement === 'local') continue;
    assert(policy.placement !== 'local-only', 'local-only policy excludes remote hops');
    assert(policy.recipients.kind === 'open' || policy.recipients.kind === 'named'
      && policy.recipients.ids.includes(hop.recipient), 'route contains an unauthorized recipient');
    assert(policy.leakage.includes('plaintext') && exposed.every(item => policy.leakage.includes(item)),
      'plaintext backend exceeds permitted leakage');
  }
  return freeze(structuredClone(hops));
}

/** Host-installed retrieval paths are distinct from untrusted network advertisements. */
export async function bindAuxiliaryDisclosure(policy, detail, declared) {
  policy = assertAvailableExecutionPolicy(policy);
  assert(['search', 'extract', 'check'].includes(detail.operation) && id(detail.id) && id(detail.version), 'identified auxiliary operation required');
  assert(declared?.schema === 'reploid.auxiliary-path/v1' && declared.id === detail.id && declared.version === detail.version,
    'qualified auxiliary path does not cover the selected implementation');
  const hops = validatePlaintextHops(policy, declared.hops);
  if (detail.resourceOrigin !== undefined) assert(id(detail.resourceOrigin), 'resource origin required');
  if (detail.requestId !== undefined) assert(id(detail.requestId), 'auxiliary request identity required');
  const path = { ...(detail.resourceOrigin !== undefined ? { resourceOrigin: detail.resourceOrigin } : {}),
    ...(detail.requestId !== undefined ? { requestId: detail.requestId } : {}), schema: 'reploid.auxiliary-path/v1', operation: detail.operation, id: detail.id, version: detail.version,
    complete: true, hops };
  return freeze({ schema: 'reploid.auxiliary-binding/v2', policy, policyId: await hashJson(policy), pathId: await hashJson(path), path });
}
