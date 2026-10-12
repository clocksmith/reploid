/** Shared orchestration bindings. Tensor semantics remain supplied by Doppler. */
export const partitionIdentityKeys = Object.freeze(['modelId', 'modelIdentity', 'planId', 'threadId', 'attemptId', 'participantA', 'participantB']);
export const partitionActions = Object.freeze(['mesh.execute_partition_a', 'mesh.execute_partition_b',
  'mesh.transfer_intermediate_activation', 'mesh.transfer_token_context', 'mesh.transfer_partition_output']);
export const assertPartition = (value, message) => { if (!value) throw new Error(message); };
export const samePartitionIdentity = (actual, expected) => actual && [...partitionIdentityKeys, 'requesterId', 'placementGeneration'].every(key => actual[key] === expected[key]);
/** Ask the injected provider for tensor layout; retain the accepted v1 adapter. */
export function partitionActivationContract(runtime, plan) {
  if (runtime.getPartitionActivationContract) {
    assertPartition(typeof runtime.validateActivationFrameForPlan === 'function', 'Doppler activation validator required');
    return Object.freeze({ ...runtime.getPartitionActivationContract(plan) });
  }
  assertPartition(plan?.schema === runtime.LAYER_PARTITION_SCHEMA
    && plan.activationPrecision === undefined && plan.activationComponents === undefined
    && plan.activationElementStrideBytes === undefined, 'Unsupported Doppler partition activation contract');
  return Object.freeze({ schema: runtime.ACTIVATION_TENSOR_SCHEMA, dtype: plan.activationDtype,
    hiddenSize: plan.hiddenSize, precision: plan.activationDtype, components: 1,
    elementStrideBytes: plan.activationDtype === 'f16' ? 2 : 4 });
}
export function matchingPartitionActivation(value, contract, frame = false) {
  if (frame && contract.components === 1) {
    return value?.dtype === contract.dtype && ['precision', 'components', 'elementStrideBytes']
      .every(key => value[key] === undefined);
  }
  return value?.dtype === contract.dtype && ['precision', 'components', 'elementStrideBytes']
    .every(key => value[key] === contract[key] || contract.components === 1 && value[key] === undefined);
}
export function validatePartitionIdentity(identity) {
  assertPartition(identity && typeof identity === 'object' && !Array.isArray(identity) && partitionIdentityKeys.every(key => typeof identity[key] === 'string'
    && identity[key].length > 0 && identity[key].length <= 256)
    && /^sha256:[a-f0-9]{64}$/.test(identity.modelIdentity)
    && identity.participantA !== identity.participantB, 'Invalid partition identity');
  if (identity.requesterId !== undefined || identity.placementGeneration !== undefined) {
    assertPartition(typeof identity.requesterId === 'string' && identity.requesterId.length > 0 && identity.requesterId.length <= 256
      && Number.isSafeInteger(identity.placementGeneration) && identity.placementGeneration >= 0, 'Invalid requester placement binding');
  }
}
/** Snapshot the complete validated identity; optional placement fields travel as a pair. */
export function canonicalPartitionBinding(identity) {
  validatePartitionIdentity(identity);
  const keys = identity.requesterId === undefined ? partitionIdentityKeys
    : [...partitionIdentityKeys, 'requesterId', 'placementGeneration'];
  return Object.freeze(Object.fromEntries(keys.map(key => [key, identity[key]])));
}
export function canonicalPartitionJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalPartitionJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalPartitionJson(value[key])).join(',') + '}';
  assertPartition(value === null || ['string', 'boolean'].includes(typeof value)
    || typeof value === 'number' && Number.isFinite(value), 'Partition metadata must be finite JSON');
  return JSON.stringify(value);
}
export async function partitionFingerprint(metadata, bytes = new Uint8Array()) {
  const header = new TextEncoder().encode(canonicalPartitionJson(metadata));
  const input = new Uint8Array(4 + header.length + bytes.length);
  new DataView(input.buffer).setUint32(0, header.length);
  input.set(header, 4); input.set(bytes, 4 + header.length);
  const hash = await crypto.subtle.digest('SHA-256', input);
  return 'sha256:' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
