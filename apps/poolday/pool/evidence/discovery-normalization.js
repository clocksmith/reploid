/** Discovery task contracts, task approvals, and Discovery Contract checkpoint normalization. */
import {
  DISCOVERY_CHECKPOINT_VERSION,
  DISCOVERY_CONTRACT_PROJECTION_ID,
  DISCOVERY_CONTRACT_STATE_VERSION,
  LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID,
  LEGACY_DISCOVERY_CONTRACT_STATE_VERSION,
  normalizeRoomId
} from '../evidence-record-contract.js';
import {
  clone,
  compactText,
  normalizeHashList,
  requireHash,
  stableTaskId
} from './primitives.js';
import {
  DISCOVERY_ACTION_VALUE_POLICY
} from '../discovery-action-value.js';
import {
  hashJson
} from '../../../../shared/pool/inference-receipt.js';

export const projectDiscoveryTaskContract = (task = {}) => {
  const kind = compactText(task.kind || task.actionKind, 120);
  const targetHash = requireHash(task.targetHash, 'discovery task target');
  const reason = compactText(task.reason);
  const basis = compactText(task.basis, 64) || 'governance';
  const basisHashes = normalizeHashList(task.basisHashes?.length ? task.basisHashes : [targetHash], 'discovery task basis', { min: 1, max: 128 });
  if (!kind || !reason) throw new TypeError('discovery task kind and reason are required');
  if (!['question_anchor', 'governance', 'accepted_memory'].includes(basis)) {
    throw new TypeError('discovery task basis is invalid');
  }
  return {
    schema: 'poolday.discovery_task_contract/v1',
    taskId: stableTaskId(kind, targetHash),
    kind,
    targetHash,
    reason,
    basis,
    basisHashes: [...basisHashes].sort(),
    rankingPolicyId: DISCOVERY_ACTION_VALUE_POLICY.policyId,
    rankingPolicyVersion: DISCOVERY_ACTION_VALUE_POLICY.version,
    rankingMethod: DISCOVERY_ACTION_VALUE_POLICY.method,
    rankingStatus: DISCOVERY_ACTION_VALUE_POLICY.status
  };
};

export const normalizeTaskApprovalContract = (taskContract, taskId, targetHash) => {
  const normalized = projectDiscoveryTaskContract(taskContract);
  if (normalized.taskId !== taskId || normalized.targetHash !== targetHash) {
    throw new TypeError('task approval contract does not match its task or target identity');
  }
  if (taskContract?.schema !== normalized.schema
    || taskContract?.rankingPolicyId !== normalized.rankingPolicyId
    || taskContract?.rankingPolicyVersion !== normalized.rankingPolicyVersion
    || taskContract?.rankingMethod !== normalized.rankingMethod
    || taskContract?.rankingStatus !== normalized.rankingStatus) {
    throw new TypeError('task approval contract schema or ranking policy is invalid');
  }
  return normalized;
};

export const normalizeDiscoveryCheckpoint = async (checkpoint = {}, roomId) => {
  const questionHash = requireHash(checkpoint.questionHash, 'discovery checkpoint questionHash');
  const policyId = compactText(checkpoint.policyId, 240);
  if (!policyId) throw new TypeError('discovery checkpoint policyId is required');
  const projection = {
    id: compactText(checkpoint.projection?.id, 240),
    artifactHash: requireHash(checkpoint.projection?.artifactHash, 'discovery checkpoint projection artifactHash')
  };
  const stateSchemaByProjection = {
    [LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID]: LEGACY_DISCOVERY_CONTRACT_STATE_VERSION,
    [DISCOVERY_CONTRACT_PROJECTION_ID]: DISCOVERY_CONTRACT_STATE_VERSION
  };
  if (!stateSchemaByProjection[projection.id]) {
    throw new TypeError('discovery checkpoint projection id is unsupported');
  }
  const inputRecordHashes = normalizeHashList(checkpoint.inputRecordHashes, 'discovery checkpoint inputs', {
    min: 1,
    max: 1000
  });
  const activeInputRecordHashes = normalizeHashList(
    checkpoint.activeInputRecordHashes,
    'discovery checkpoint active inputs',
    { min: 1, max: 1000 }
  );
  if (!activeInputRecordHashes.every((hash) => inputRecordHashes.includes(hash))) {
    throw new TypeError('discovery checkpoint active inputs must be part of the complete input set');
  }
  if (!activeInputRecordHashes.includes(questionHash)) {
    throw new TypeError('discovery checkpoint question must remain an active input');
  }
  const parentCheckpointHashes = normalizeHashList(
    checkpoint.parentCheckpointHashes,
    'discovery checkpoint parents',
    { max: 32 }
  );
  const contractIdentity = {
    schema: 'poolday.discovery_contract_identity/v1',
    roomId: normalizeRoomId(roomId),
    questionHash,
    policyId
  };
  const contractId = await hashJson(contractIdentity);
  if (checkpoint.contractId && checkpoint.contractId !== contractId) {
    throw new TypeError('discovery checkpoint contractId does not match its question, room, and policy');
  }
  const state = clone(checkpoint.state);
  if (!state || state.schema !== stateSchemaByProjection[projection.id]
    || !['open', 'reopened'].includes(state.status)
    || state.contractId !== contractId
    || state.questionHash !== questionHash
    || state.policyId !== policyId) {
    throw new TypeError('discovery checkpoint state identity or status is invalid');
  }
  const normalized = {
    schema: DISCOVERY_CHECKPOINT_VERSION,
    contractId,
    questionHash,
    policyId,
    parentCheckpointHashes,
    projection,
    inputRecordHashes,
    inputSetHash: await hashJson(inputRecordHashes),
    activeInputRecordHashes,
    activeInputSetHash: await hashJson(activeInputRecordHashes),
    state,
    stateHash: await hashJson(state)
  };
  return normalized;
};
