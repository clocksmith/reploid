/** Capability observations and assignment policy. No discovery, execution or model-family rules. */
import { freezeOperationPolicy as snapshot } from './pack-operation-policy.js';
const assert = (ok, message) => { if (!ok) throw new Error(`Peer capabilities: ${message}`); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const unique = values => Array.isArray(values) && new Set(values).size === values.length;

export function resolveProviderCapabilitySchema(input) {
  const schema = snapshot(input);
  assert(schema?.schema === 'reploid.pool.capability-policy/v1' && schema.version === 1, 'supported capability policy required');
  assert(schema.observationSchema === 'reploid.peer.capabilities/v1', 'supported observation schema required');
  assert(unique(schema.availabilityStates) && schema.availabilityStates.length === 3
    && ['resident', 'cached', 'fetchable'].every(state => schema.availabilityStates.includes(state)), 'availability states required');
  for (const name of ['maxModels', 'maxAdapters', 'maxExperts', 'maxOperations', 'maxInputClasses', 'maxIdentityCharacters', 'maxObservationAgeMs', 'maxClockSkewMs']) {
    assert(integer(schema[name]) && schema[name] > 0, `${name} required`);
  }
  return schema;
}

export function resolvePeerAssignmentPolicy(input, capabilitySchema) {
  const policy = snapshot(input), schema = resolveProviderCapabilitySchema(capabilitySchema);
  assert(policy?.schema === 'reploid.pool.assignment-policy/v1' && policy.version === 1
    && typeof policy.policyId === 'string' && policy.policyId.length > 0, 'versioned assignment policy required');
  for (const key of ['modelAvailabilityOrder', 'adapterAvailabilityOrder']) assert(unique(policy[key]) && policy[key].length > 0
    && policy[key].every(state => schema.availabilityStates.includes(state)), `${key} required`);
  for (const key of ['allowModelFetching', 'allowAdapterFetching', 'requireAvailableSlot']) assert(typeof policy[key] === 'boolean', `${key} required`);
  for (const key of ['minimumFreeGpuBytes', 'minimumFreeStorageBytes', 'minimumBandwidthBytesPerSecond']) assert(integer(policy[key]), `${key} required`);
  assert(integer(policy.maxObservationAgeMs) && policy.maxObservationAgeMs > 0 && policy.maxObservationAgeMs <= schema.maxObservationAgeMs, 'observation age required');
  assert(integer(policy.maxCandidates) && policy.maxCandidates > 0, 'bounded candidate count required');
  assert(['reject', 'budget-only'].includes(policy.unknownFreeMemory), 'unknown memory policy required');
  assert(policy.duplicateProviders === 'newest-observation-then-message-hash' && policy.invalidAdvertisement === 'reject', 'supported advertisement handling required');
  assert(policy.history?.enabled === false, 'history routing requires separate qualified policy');
  const metrics = ['modelAvailability', 'adapterAvailability', 'activeJobs', 'queuedJobs', 'gpuBudgetBytes', 'bandwidthBytesPerSecond', 'providerId'];
  assert(Array.isArray(policy.ranking) && policy.ranking.length > 0 && unique(policy.ranking.map(row => row.metric))
    && policy.ranking.every(row => metrics.includes(row.metric) && ['asc', 'desc'].includes(row.order))
    && policy.ranking.at(-1).metric === 'providerId', 'deterministic ranking and identity tie-break required');
  return policy;
}

export function validateProviderCapabilities(input, { schema: schemaInput, now }) {
  const schema = resolveProviderCapabilitySchema(schemaInput), value = snapshot(input);
  assert(value?.schema === schema.observationSchema && Number.isSafeInteger(now), 'versioned observations and explicit time required');
  assert(Number.isSafeInteger(value.observedAt) && value.observedAt <= now + schema.maxClockSkewMs
    && now - value.observedAt <= schema.maxObservationAgeMs, 'stale or future observations');
  for (const [key, max] of [['models', schema.maxModels], ['adapters', schema.maxAdapters], ['experts', schema.maxExperts]]) {
    assert(Array.isArray(value[key]) && value[key].length <= max && unique(value[key].map(row => row.identity)), `bounded unique ${key} required`);
    for (const item of value[key]) {
      assert(digest(item.identity) && schema.availabilityStates.includes(item.availability), `invalid ${key} observation`);
      if (key === 'experts') assert(digest(item.modelIdentity) && integer(item.layer) && integer(item.expert), 'exact expert coordinate required');
    }
  }
  assert(value.models.length > 0 && Array.isArray(value.operations) && value.operations.length > 0
    && value.operations.length <= schema.maxOperations && unique(value.operations.map(row => `${row.name}/${row.version}`)), 'bounded unique operations required');
  for (const operation of value.operations) assert(typeof operation.name === 'string' && operation.name.length > 0
    && operation.name.length <= schema.maxIdentityCharacters && integer(operation.version) && operation.version > 0, 'invalid operation identity');
  assert(unique(value.inputClasses) && value.inputClasses.length > 0 && value.inputClasses.length <= schema.maxInputClasses
    && value.inputClasses.every(name => typeof name === 'string' && name.length > 0 && name.length <= schema.maxIdentityCharacters), 'input classes required');
  assert(value.gpuIdentity === null || (value.gpuIdentity && ['vendor', 'architecture', 'device', 'description'].every(key =>
    typeof value.gpuIdentity[key] === 'string' && value.gpuIdentity[key].length <= schema.maxIdentityCharacters)), 'GPU identity or explicit unknown required');
  const resources = value.resources;
  for (const field of ['gpuBudgetBytes', 'storageBudgetBytes', 'bandwidthBytesPerSecond', 'concurrency', 'activeJobs', 'queuedJobs']) {
    assert(integer(resources?.[field]), `resources.${field} required`);
  }
  for (const field of ['gpuFreeBytes', 'storageFreeBytes']) assert(resources[field] === null || integer(resources[field]), `resources.${field} observation or explicit unknown required`);
  assert(resources.concurrency > 0 && resources.activeJobs <= resources.concurrency, 'inconsistent concurrency observation');
  return value;
}

export function validateWorkRequirements(input) {
  const value = snapshot(input);
  assert(value?.schema === 'reploid.pool.work-requirements/v1' && digest(value.modelIdentity), 'exact work identity required');
  assert(typeof value.operation?.name === 'string' && value.operation.name.length > 0
    && integer(value.operation.version) && value.operation.version > 0, 'exact operation required');
  for (const field of ['adapterIdentities', 'expertIdentities', 'providerIds']) assert(unique(value[field]) && value[field].every(digest), `exact ${field} required`);
  assert(value.providerIds.length > 0 && typeof value.inputClass === 'string' && value.inputClass.length > 0, 'permission boundary required');
  for (const field of ['gpuBytes', 'storageBytes', 'bandwidthBytesPerSecond']) assert(integer(value.resources?.[field]), `resources.${field} required`);
  for (const field of ['maxInputBytes', 'maxOutputBytes', 'maxStreamBytes', 'maxEvents', 'maxJobMs']) assert(integer(value.limits?.[field]) && value.limits[field] > 0, `limits.${field} required`);
  return value;
}
