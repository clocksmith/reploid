/** Shared orchestration bindings. Tensor semantics remain supplied by Doppler. */
export const partitionIdentityKeys = Object.freeze(['modelId', 'modelIdentity', 'planId', 'threadId', 'attemptId', 'participantA', 'participantB']);
export const partitionActions = Object.freeze(['mesh.execute_partition_a', 'mesh.execute_partition_b',
  'mesh.transfer_intermediate_activation', 'mesh.transfer_partition_output']);
export const assertPartition = (value, message) => { if (!value) throw new Error(message); };
export const samePartitionIdentity = (actual, expected) => actual && partitionIdentityKeys.every(key => actual[key] === expected[key]);
export function validatePartitionIdentity(identity) {
  assertPartition(identity && partitionIdentityKeys.every(key => typeof identity[key] === 'string'
    && identity[key].length > 0 && identity[key].length <= 256)
    && /^sha256:[a-f0-9]{64}$/.test(identity.modelIdentity)
    && identity.participantA !== identity.participantB, 'Invalid partition identity');
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
