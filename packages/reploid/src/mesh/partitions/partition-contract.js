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

export const PARTITION_ROUTE_SCHEMA = 'reploid.partition-route/v1';
export const ROUTE_ATTEMPT_SCHEMA = 'reploid.partition-attempt/v2';
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const exactFields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const freezeRouteJson = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeRouteJson); Object.freeze(value); }
  return value;
};
/** Structural checks also apply when comparing a received identity without a runtime. */
export function canonicalPartitionRoute(route) {
  assertPartition(exactFields(route, ['schema', 'modelId', 'modelIdentity', 'planId', 'stages', 'activation'])
    && route.schema === PARTITION_ROUTE_SCHEMA && identifier(route.modelId) && /^sha256:[a-f0-9]{64}$/.test(route.planId)
    && /^sha256:[a-f0-9]{64}$/.test(route.modelIdentity)
    && Array.isArray(route.stages) && route.stages.length >= 2, 'Invalid partition route');
  const participants = new Set(), transports = new Set();
  route.stages.forEach((stage, index) => {
    assertPartition(exactFields(stage, ['index', 'participantId', 'transportId', 'residentId', 'executionId'])
      && stage.index === index && ['participantId', 'transportId', 'residentId', 'executionId'].every(key => identifier(stage[key]))
      && !participants.has(stage.participantId) && !transports.has(stage.transportId), 'Invalid or duplicate route stage');
    participants.add(stage.participantId); transports.add(stage.transportId);
  });
  const layout = route.activation;
  assertPartition(exactFields(layout, ['schema', 'dtype', 'hiddenSize', 'precision', 'components', 'elementStrideBytes'])
    && layout.schema === (layout.precision === 'two-f32' ? 'doppler.activation-tensor/v2' : 'doppler.activation-tensor/v1')
    && Number.isSafeInteger(layout.hiddenSize) && layout.hiddenSize > 0
    && (layout.precision === 'two-f32' ? layout.dtype === 'f32' && layout.components === 2 && layout.elementStrideBytes === 8
      : ['f32', 'f16'].includes(layout.dtype) && layout.precision === layout.dtype && layout.components === 1
        && layout.elementStrideBytes === (layout.dtype === 'f16' ? 2 : 4)), 'Invalid route activation layout');
  return freezeRouteJson(structuredClone(route));
}
/** Provider hashing validates its plan geometry; host admission separately binds the selected manifest. */
export async function validatePartitionRoute(runtime, plan, route) {
  const snapshot = canonicalPartitionRoute(route), planSnapshot = structuredClone(plan);
  assertPartition(typeof runtime?.hashLayerPartitionPlan === 'function'
    && typeof runtime.getPartitionActivationContract === 'function', 'Ordered Doppler contracts required');
  assertPartition(planSnapshot?.schema === 'doppler.layer-partition-contract/v3'
    && planSnapshot.modelId === snapshot.modelId && planSnapshot.stageCount === snapshot.stages.length
    && Array.isArray(planSnapshot.partitions) && planSnapshot.partitions.length === snapshot.stages.length
    && planSnapshot.partitions.every((part, index) => part.index === index), 'Route plan stage mismatch');
  const layout = partitionActivationContract(runtime, planSnapshot);
  assertPartition(canonicalPartitionJson(layout) === canonicalPartitionJson(snapshot.activation), 'Route activation mismatch');
  assertPartition(await runtime.hashLayerPartitionPlan(planSnapshot) === snapshot.planId, 'Route plan identity mismatch');
  return snapshot;
}
export function canonicalRouteAttemptBinding(identity) {
  assertPartition(exactFields(identity, ['schema', 'threadId', 'attemptId', 'requesterId', 'placementGeneration', 'route'])
    && identity.schema === ROUTE_ATTEMPT_SCHEMA && ['threadId', 'attemptId', 'requesterId'].every(key => identifier(identity[key]))
    && Number.isSafeInteger(identity.placementGeneration) && identity.placementGeneration >= 0, 'Invalid route attempt identity');
  return Object.freeze({ schema: identity.schema, threadId: identity.threadId, attemptId: identity.attemptId,
    requesterId: identity.requesterId, placementGeneration: identity.placementGeneration, route: canonicalPartitionRoute(identity.route) });
}
export function sameRouteAttemptIdentity(actual, expected) {
  try { return canonicalPartitionJson(canonicalRouteAttemptBinding(actual)) === canonicalPartitionJson(canonicalRouteAttemptBinding(expected)); }
  catch { return false; }
}

/** A ready stage is inventory, not a complete chat path. This checks advertised
 * binding only; entry refresh, grants and reservations remain authoritative. */
export function isOrderedPartitionEntryModel(model, peer) {
  try {
    const selection = model?.partition;
    if (peer.description?.schema !== 'reploid.partition-capability/v2' || model.index !== 0
      || selection?.schema !== 'reploid.partition-selection/v2') return false;
    const route = canonicalPartitionRoute(selection.route), first = route.stages[0];
    return model.id === route.modelId && model.identity === route.modelIdentity
      && model.planId === route.planId && selection.planId === route.planId
      && selection.coordinatorId === first.participantId && first.participantId === peer.participantId
      && first.transportId === peer.transportId && first.residentId === model.residentId
      && first.executionId === model.executionId
      && canonicalPartitionJson(route.activation) === canonicalPartitionJson(model.activation);
  } catch { return false; }
}

/** One observed inventory version, bounded by host policy. These hints never authorize execution. */
export function validateOrderedPartitionCapability(description, participantId, maxOffersPerPeer) {
  assertPartition(Number.isSafeInteger(maxOffersPerPeer) && maxOffersPerPeer > 0, 'Explicit stage offer limit required');
  assertPartition(description?.schema === 'reploid.partition-capability/v2' && description.participantId === participantId
    && ['idle', 'waiting', 'loading', 'ready', 'stopping', 'failed'].includes(description.phase)
    && Array.isArray(description.models) && description.models.length <= maxOffersPerPeer,
  'Ordered partition capability identity or inventory mismatch');
  const capacity = description.capacity;
  assertPartition(capacity && typeof capacity.closed === 'boolean' && Number.isSafeInteger(capacity.active) && capacity.active >= 0
    && Number.isSafeInteger(capacity.availableSlots) && capacity.availableSlots >= 0, 'Ordered partition capacity required');
  for (const model of description.models) {
    assertPartition(model && typeof model.id === 'string' && model.id.length > 0 && model.id.length <= 256
      && /^sha256:[a-f0-9]{64}$/.test(model.identity) && Number.isSafeInteger(model.index) && model.index >= 0
      && ['planId', 'residentId', 'executionId'].every(key => typeof model[key] === 'string' && model[key].length > 0 && model[key].length <= 256)
      && ['ready', 'unavailable'].includes(model.availability), 'Invalid ordered partition offer');
  }
}
