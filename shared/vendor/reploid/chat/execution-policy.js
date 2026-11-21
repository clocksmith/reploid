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
const metadata = ['model-id', 'timing', 'length', 'access-patterns'];
const plaintextLeakage = [...metadata, 'plaintext'];
const plaintextBackends = ['doppler-plaintext/v1', 'doppler-partition-plaintext/v1'];
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
  validatePlaintextHops(policy, route.hops);
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

/** A receipt of requester validation, not proof of an honest provider, integrity, availability or erasure. */
export function executionPrivacyReceipt(binding) {
  return { schema: 'reploid.privacy-receipt/v2', policyId: binding.policyId, routeId: binding.routeId,
    computation: binding.policy.computation, placement: binding.policy.placement, recipientAuthorization: binding.policy.recipients.kind, backend: binding.route.backend, protocol: binding.route.protocol,
    recipients: binding.route.hops.filter(hop => hop.placement === 'remote').map(hop => hop.recipient),
    permittedLeakage: [...binding.policy.leakage], collusion: binding.policy.collusion, retention: binding.policy.retention,
    evidence: 'requester-policy-validation', attestation: 'unavailable', cryptographic: 'unavailable',
    publicationAuthorized: false, reuseAuthorized: false };
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
export function validatePlaintextHops(policy, hops) {
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
    assert(policy.leakage.includes('plaintext') && ['model-id', 'timing', 'length', 'access-patterns'].every(item => policy.leakage.includes(item)),
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
