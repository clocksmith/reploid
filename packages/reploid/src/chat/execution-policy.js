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
/** Why requester-only is unavailable. The research protected route stays off until this review is done. */
export const CONFIDENTIAL_EXECUTION_REVIEW_REASON = 'awaiting independent security review';
/** Metadata names a caller may allow. Content itself is governed by confidentiality, never by this list. */
export const EXECUTION_METADATA = Object.freeze(['model-id', 'timing', 'length', 'access-patterns']);
const metadata = [...EXECUTION_METADATA];
const plaintextLeakage = [...metadata, 'plaintext'];
/**
 * Backends this requester can actually run, keyed by exact identity. A backend is eligible only when its
 * registered computation and protocol match the offer exactly; an advertisement cannot add a row or upgrade one.
 * `metadata` is what the backend's route exposes beyond the participants that read content.
 */
export const EXECUTION_BACKENDS = freeze({
  'doppler-plaintext/v1': { computation: 'plaintext', protocol: null, executorsReadContent: true, metadata: ['model-id', 'timing', 'length'] },
  'doppler-partition-plaintext/v1': { computation: 'plaintext', protocol: null, executorsReadContent: true, metadata: ['model-id', 'timing', 'length'] }
});
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
  assert(['local-only', 'network-allowed'].includes(value.placement) && ['none', 'all-remote'].includes(value.collusion),
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

/**
 * Compile a caller's execution requirements into the verified peer policy. `requester-only` means no executor
 * may read the content; no backend qualifies for it, so it fails closed here and is never relaxed to a readable mode.
 */
export function compileExecutionRequirements(execution) {
  if (!exact(execution, ['placement', 'participants', 'confidentiality', 'allowMetadata'])) {
    throw invalid('placement, participants, confidentiality and allowMetadata are required, with no other fields');
  }
  const { placement, participants, confidentiality, allowMetadata } = execution;
  if (!['local-only', 'network-allowed'].includes(placement)) throw invalid('placement must be local-only or network-allowed');
  if (!['requester-only', 'executor-readable'].includes(confidentiality)) throw invalid('confidentiality must be requester-only or executor-readable');
  if (!Array.isArray(allowMetadata) || new Set(allowMetadata).size !== allowMetadata.length
    || !allowMetadata.every(item => metadata.includes(item))) throw invalid(`allowMetadata must be distinct items of ${metadata.join(', ')}`);
  const kind = participants?.kind;
  const shaped = kind === 'named' ? exact(participants, ['kind', 'ids']) && participants.ids?.length > 0 && list(participants.ids)
    : ['open', 'none'].includes(kind) && exact(participants, ['kind']);
  if (!shaped) throw invalid('participants must be { kind: "open" }, { kind: "none" } or { kind: "named", ids: [unique ids] }');
  if ((placement === 'local-only') !== (kind === 'none')) throw invalid('local-only placement takes { kind: "none" } participants, and only it does');
  if (confidentiality === 'requester-only') {
    throw Object.assign(executionError('CONFIDENTIAL_EXECUTION_UNAVAILABLE',
      'No backend that keeps content from its executors is qualified. Nothing was sent; the request is not retried as readable or local.'),
    { reason: CONFIDENTIAL_EXECUTION_REVIEW_REASON });
  }
  return createExecutionPolicy({ placement, recipients: { kind, ids: kind === 'named' ? [...participants.ids] : [] },
    leakage: [...metadata.filter(item => allowMetadata.includes(item)), 'plaintext'] });
}

/**
 * The verified policy for a `requester-only` request on a protected protocol. Only the inference API calls this,
 * and only when its host enabled the unreviewed protected route explicitly; `compileExecutionRequirements` above
 * still refuses requester-only for every other caller. The shape checks are the readable compiler's own.
 */
export function compileProtectedExecutionRequirements(execution, protocol) {
  if (!exact(execution, ['placement', 'participants', 'confidentiality', 'allowMetadata']) || execution.confidentiality !== 'requester-only') {
    throw invalid('protected execution compiles requester-only requirements only');
  }
  compileExecutionRequirements({ ...execution, confidentiality: 'executor-readable' });
  if (execution.placement !== 'network-allowed') {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'Confidential execution runs on a network evaluator; local-only has no protected route. Nothing was sent.');
  }
  if (!id(protocol)) throw invalid('protected execution needs a protocol identity');
  const { participants, allowMetadata } = execution;
  return createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: participants.kind, ids: participants.kind === 'named' ? [...participants.ids] : [] },
    computation: 'cryptographic', collusion: 'all-remote', protocol, keyContext: `requester-held-key/${protocol}`,
    leakage: metadata.filter(item => allowMetadata.includes(item)) });
}

/** The caller requirements a stored policy stands for. Policies outside the API's vocabulary are refused, never widened. */
export function executionRequirementsFor(policy) {
  policy = validateExecutionPolicy(policy);
  const confidential = policy.computation !== 'plaintext' || policy.collusion !== 'none' || !policy.leakage.includes('plaintext');
  if (!confidential && (policy.retention !== 'execution-and-recovery' || policy.protocol || policy.attestation || policy.keyContext)) {
    throw invalid('this policy has requirements the inference API cannot express');
  }
  return freeze({ placement: policy.placement,
    participants: policy.recipients.kind === 'named' ? { kind: 'named', ids: [...policy.recipients.ids] } : { kind: policy.recipients.kind },
    confidentiality: confidential ? 'requester-only' : 'executor-readable',
    allowMetadata: metadata.filter(item => policy.leakage.includes(item)) });
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
  validatePlaintextHops(policy, route.hops, EXECUTION_BACKENDS[route.backend].metadata);
  return freeze(structuredClone(route));
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
export function validatePlaintextHops(policy, hops, exposed = EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata) {
  policy = assertAvailableExecutionPolicy(policy);
  assert(Array.isArray(hops) && hops.length <= 128, 'bounded disclosure hops required');
  assert(new Set(hops.map(hop => hop?.recipient)).size === hops.length, 'duplicate route recipient');
  for (const hop of hops) {
    assert(exact(hop, ['recipient', 'placement', 'disclosure']) && id(hop.recipient)
      && ['local', 'remote'].includes(hop.placement) && hop.disclosure === 'plaintext', 'unqualified route hop');
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
