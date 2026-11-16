/** Requester-owned requirements. Advertisements and signed receipts confer no privacy qualification. */
import presets from './execution-policy.json' with { type: 'json' };
import { canonicalPartitionJson } from '../contracts/partition.js';
import { hashJson } from '../artifacts/signatures.js';

const assert = (ok, message) => { if (!ok) throw Object.assign(new Error(`Execution privacy: ${message}`), { code: 'PRIVACY_POLICY_REJECTED' }); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const list = values => Array.isArray(values) && values.length <= 128 && values.every(id) && new Set(values).size === values.length;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Presets are independent requirements, never provider ranks. Missing old settings migrate to plaintext only. */
export function createExecutionPolicy(profile = 'provider-visible', overrides = {}) {
  const preset = presets.presets[profile];
  assert(preset, 'unknown profile');
  return validateExecutionPolicy({ schema: 'reploid.execution-policy/v1', profile, ...structuredClone(preset),
    allowedRecipients: [], protocol: null, attestation: null, keyContext: null,
    retention: 'execution-and-recovery', publication: false, reuse: false, allowDowngrade: false, ...overrides });
}

export function validateExecutionPolicy(input) {
  const value = structuredClone(input);
  const keys = ['schema', 'profile', 'placement', 'collusion', 'leakage', 'allowedRecipients', 'protocol',
    'attestation', 'keyContext', 'retention', 'publication', 'reuse', 'allowDowngrade'];
  assert(value && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'exact versioned policy required');
  assert(value.schema === 'reploid.execution-policy/v1' && Object.hasOwn(presets.presets, value.profile), 'unsupported policy');
  assert(['local-only', 'network-allowed'].includes(value.placement) && ['none', 'all-remote'].includes(value.collusion), 'invalid placement or collusion model');
  assert(list(value.allowedRecipients) && list(value.leakage) && value.leakage.every(item =>
    ['model-id', 'timing', 'length', 'access-patterns', 'plaintext'].includes(item)), 'invalid recipient or leakage set');
  assert(value.protocol === null || id(value.protocol), 'explicit protocol identity required');
  assert(value.attestation === null || hash(value.attestation), 'attestation policy digest required');
  assert(value.keyContext === null || id(value.keyContext), 'key context identity required');
  assert(['execution-and-recovery', 'ephemeral'].includes(value.retention) && value.publication === false
    && value.reuse === false && value.allowDowngrade === false, 'publication, reuse and downgrade are never implicitly authorized');
  assert(value.profile !== 'restricted' || value.placement === 'local-only' || value.allowedRecipients.length > 0, 'restricted network execution needs named recipients');
  assert(value.profile !== 'cryptographic' || value.protocol !== null && value.keyContext !== null
    && !value.leakage.includes('plaintext'), 'cryptographic execution needs protocol, key context and no plaintext leakage');
  return freeze(value);
}

export function requestExecutionPolicy(request) {
  if (request.privacy !== undefined && request.privacy !== null) return validateExecutionPolicy(request.privacy);
  const local = request.permissions?.executionLocation === 'local' || request.permissions?.sharingScope === 'local';
  return createExecutionPolicy(local ? 'restricted' : 'provider-visible');
}

/** No built-in attestation verifier or encrypted evaluator exists. Flags can never enable one. */
export function assertAvailableExecutionPolicy(policy) {
  policy = validateExecutionPolicy(policy);
  assert(policy.profile !== 'cryptographic' && policy.protocol === null && policy.keyContext === null
    && policy.collusion === 'none', 'cryptographic backend unavailable for this model and protocol');
  assert(policy.attestation === null, 'attested backend unavailable; verified hardware and session evidence required');
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
  assert(route?.schema === 'reploid.execution-route/v1' && presets.plaintextBackends.includes(route.backend)
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
  return freeze({ schema: 'reploid.execution-binding/v1', policy, route,
    policyId: await hashJson(policy), routeId: await hashJson(route) });
}

/** A receipt of requester validation, not proof of an honest provider, integrity, availability or erasure. */
export function executionPrivacyReceipt(binding) {
  return { schema: 'reploid.privacy-receipt/v1', policyId: binding.policyId, routeId: binding.routeId,
    profile: binding.policy.profile, backend: binding.route.backend, protocol: binding.route.protocol,
    recipients: binding.route.hops.filter(hop => hop.placement === 'remote').map(hop => hop.recipient),
    permittedLeakage: [...binding.policy.leakage], collusion: binding.policy.collusion, retention: binding.policy.retention,
    evidence: 'requester-policy-validation', attestation: 'unavailable', cryptographic: 'unavailable',
    publicationAuthorized: false, reuseAuthorized: false };
}

export function sameExecutionBinding(a, b) {
  return canonicalPartitionJson(a) === canonicalPartitionJson(b);
}

export async function partitionPrivacyBinding(request, recipients, route) {
  if (!request.privacy) return null;
  const selected = request.privacyBinding?.route ?? plaintextExecutionRoute(request, { recipients, route });
  assert(recipients.every(recipient => selected.hops.some(hop => hop.recipient === recipient)), 'partition binding omitted an execution recipient');
  assert(canonicalPartitionJson(selected.route) === canonicalPartitionJson(route), 'partition route changed');
  const binding = await bindExecutionRoute(request, selected);
  assert(!request.privacyBinding || sameExecutionBinding(binding, request.privacyBinding), 'partition privacy binding changed');
  return binding;
}

/** Shared plaintext disclosure requirements for inference and auxiliary operations. */
export function validatePlaintextHops(policy, hops) {
  policy = assertAvailableExecutionPolicy(policy);
  assert(Array.isArray(hops) && hops.length <= 128, 'bounded disclosure hops required');
  for (const hop of hops) {
    assert(id(hop.recipient) && ['local', 'remote'].includes(hop.placement) && hop.disclosure === 'plaintext', 'unqualified route hop');
    if (hop.placement === 'local') continue;
    assert(policy.placement !== 'local-only', 'local-only policy excludes remote hops');
    assert(!policy.allowedRecipients.length || policy.allowedRecipients.includes(hop.recipient), 'route contains an unauthorized recipient');
    assert(policy.leakage.includes('plaintext') && ['model-id', 'timing', 'length', 'access-patterns'].every(item => policy.leakage.includes(item)),
      'plaintext backend exceeds permitted leakage');
  }
  return freeze(structuredClone(hops));
}

/** Host-installed retrieval paths are distinct from untrusted network advertisements. */
export async function bindAuxiliaryDisclosure(policy, detail, declared = null, { allowUnqualifiedLegacy = false } = {}) {
  policy = assertAvailableExecutionPolicy(policy);
  assert(['search', 'extract', 'check'].includes(detail.operation) && id(detail.id) && id(detail.version), 'identified auxiliary operation required');
  let hops;
  if (declared !== null) {
    assert(declared.schema === 'reploid.auxiliary-path/v1' && declared.id === detail.id && declared.version === detail.version,
      'auxiliary path does not cover the selected implementation');
    hops = validatePlaintextHops(policy, declared.hops);
  } else {
    assert(allowUnqualifiedLegacy && policy.profile === 'provider-visible' && !policy.allowedRecipients.length && policy.placement !== 'local-only',
      'auxiliary path is unqualified for restricted execution');
    hops = validatePlaintextHops(policy, [{ recipient: detail.id, placement: 'remote', disclosure: 'plaintext' }]);
  }
  if (detail.resourceOrigin !== undefined) assert(id(detail.resourceOrigin), 'resource origin required');
  if (detail.requestId !== undefined) assert(id(detail.requestId), 'auxiliary request identity required');
  const path = { ...(detail.resourceOrigin !== undefined ? { resourceOrigin: detail.resourceOrigin } : {}),
    ...(detail.requestId !== undefined ? { requestId: detail.requestId } : {}), schema: 'reploid.auxiliary-path/v1', operation: detail.operation, id: detail.id, version: detail.version,
    complete: declared !== null, hops };
  return freeze({ schema: 'reploid.auxiliary-binding/v1', policy, policyId: await hashJson(policy), pathId: await hashJson(path), path });
}
