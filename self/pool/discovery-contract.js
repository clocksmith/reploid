/**
 * @fileoverview Replayable Discovery Contract state and signed checkpoints.
 *
 * The projection freezes evidence state; it does not establish scientific
 * truth, approve an action, or close a question.
 */

import {
  DISCOVERY_CONTRACT_PROJECTION_ID,
  DISCOVERY_CONTRACT_STATE_VERSION,
  LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID,
  LEGACY_DISCOVERY_CONTRACT_STATE_VERSION,
  RESEARCH_RECORD_KINDS,
  activeResearchRecords,
  createSignedDiscoveryCheckpoint,
  invalidatedResearchHashes,
  rankProposedCandidateActions,
  researchRecordTargetHashes,
  validateResearchRecordLinks,
  validateResearchRecordModelAdmission,
  verifyResearchRecord
} from './evidence-network.js';
import { hashJson } from './inference-receipt.js';
import { RESEARCH_CYCLE_POLICY, projectGovernedResearchCycle } from './research-cycle.js';

export const LEGACY_DISCOVERY_CONTRACT_PROJECTION_MANIFEST = Object.freeze({
  schema: 'poolday.discovery_contract_projection_manifest/v1',
  id: LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID,
  governedCycleSchema: RESEARCH_CYCLE_POLICY.schema,
  governedCyclePolicyId: RESEARCH_CYCLE_POLICY.policyId,
  inputOrder: 'createdAt_then_recordHash',
  archivePolicy: 'complete_connected_signed_records',
  activePolicy: 'exclude_revoked_and_downstream_invalidated',
  memoryPolicy: 'named_policy_projection_only',
  reopenPolicy: 'contradiction_correction_revocation_failed_replication_or_policy_invalidation'
});
export const DISCOVERY_CONTRACT_PROJECTION_MANIFEST = Object.freeze({
  ...LEGACY_DISCOVERY_CONTRACT_PROJECTION_MANIFEST,
  schema: 'poolday.discovery_contract_projection_manifest/v2',
  id: DISCOVERY_CONTRACT_PROJECTION_ID,
  candidateActionSchema: 'poolday.discovery_candidate_action/v1',
  candidateActionRankingSchema: 'poolday.discovery_candidate_action_ranking/v1'
});

const projectionManifest = (projectionId) => {
  if (projectionId === DISCOVERY_CONTRACT_PROJECTION_ID) return DISCOVERY_CONTRACT_PROJECTION_MANIFEST;
  if (projectionId === LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID) return LEGACY_DISCOVERY_CONTRACT_PROJECTION_MANIFEST;
  throw new TypeError(`Unsupported Discovery Contract projection: ${projectionId}`);
};

const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set((values || []).filter(Boolean).map(String))];
const compareRecords = (left, right) => text(left?.createdAt).localeCompare(text(right?.createdAt))
  || text(left?.recordHash).localeCompare(text(right?.recordHash));
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const discoveryContractSourceRecords = (records, questionHash) => {
  const source = records
    .filter((record) => record?.kind !== RESEARCH_RECORD_KINDS.discoveryCheckpoint)
    .sort(compareRecords);
  const question = source.find((record) => (
    record.kind === RESEARCH_RECORD_KINDS.submission
    && record.recordHash === questionHash
  ));
  if (!question) throw new TypeError('Discovery Contract question record is missing');
  const included = new Set([question.recordHash]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of source) {
      if (included.has(record.recordHash)) continue;
      if (researchRecordTargetHashes(record).some((targetHash) => included.has(targetHash))) {
        included.add(record.recordHash);
        changed = true;
      }
    }
  }
  return source.filter((record) => included.has(record.recordHash));
};

const verifySourceRecords = async (records, roomId) => {
  for (const record of records) {
    if (record.roomId !== roomId) throw new Error(`Discovery Contract input belongs to a different room: ${record.recordHash}`);
    const verification = await verifyResearchRecord(record);
    if (!verification.ok) throw new Error(`Invalid Discovery Contract input ${record.recordHash}: ${verification.reasons.join('; ')}`);
    const admission = validateResearchRecordModelAdmission(record);
    if (!admission.ok) throw new Error(`Unadmitted Discovery Contract input ${record.recordHash}: ${admission.reasons.join('; ')}`);
  }
  const accepted = [];
  let pending = records.slice();
  while (pending.length) {
    const deferred = [];
    let progress = false;
    for (const record of pending) {
      const acceptedHashes = new Set(accepted.map((entry) => entry.recordHash));
      const missingTargets = researchRecordTargetHashes(record).filter((hash) => !acceptedHashes.has(hash));
      if (missingTargets.length) {
        deferred.push({
          record,
          reasons: missingTargets.map((hash) => `linked research record does not exist: ${hash}`)
        });
        continue;
      }
      const links = validateResearchRecordLinks(record, accepted);
      if (links.ok) {
        accepted.push(record);
        progress = true;
      } else {
        throw new Error(`Invalid Discovery Contract links ${record.recordHash}: ${links.reasons.join('; ')}`);
      }
    }
    if (!deferred.length) break;
    if (!progress) throw new Error(`Incomplete Discovery Contract inputs: ${deferred[0].reasons.join('; ')}`);
    pending = deferred.map((entry) => entry.record);
  }
};

const checkpointParents = (records, parentCheckpointHashes = []) => {
  const byHash = new Map(records.map((record) => [record.recordHash, record]));
  return unique(parentCheckpointHashes).map((hash) => {
    const parent = byHash.get(hash);
    if (parent?.kind !== RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
      throw new TypeError(`Discovery Contract parent checkpoint is missing: ${hash}`);
    }
    return parent;
  }).sort(compareRecords);
};

const contractIdentity = async ({ roomId, questionHash, policyId }) => hashJson({
  schema: 'poolday.discovery_contract_identity/v1',
  roomId,
  questionHash,
  policyId
});

const recordKindCounts = (records) => Object.fromEntries([...records.reduce((counts, record) => {
  counts.set(record.kind, (counts.get(record.kind) || 0) + 1);
  return counts;
}, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));

const reopenTriggers = ({ sourceRecords, activeInputRecordHashes, cycle, parents }) => {
  if (!parents.length) return {
    required: false,
    triggerKinds: [],
    triggerRecordHashes: [],
    invalidatedParentInputHashes: [],
    removedDecisionMemoryHashes: []
  };
  const priorInputHashes = new Set(parents.flatMap((parent) => parent.checkpoint?.inputRecordHashes || []));
  const newRecords = sourceRecords.filter((record) => !priorInputHashes.has(record.recordHash));
  const triggers = [];
  for (const record of newRecords) {
    if (record.kind === RESEARCH_RECORD_KINDS.claim && record.claim?.relation === 'contradicts') {
      triggers.push({ kind: 'contradiction', recordHash: record.recordHash });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.claim
      && (record.claim?.kind === 'correction' || record.claim?.relation === 'corrects')) {
      triggers.push({ kind: 'correction', recordHash: record.recordHash });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.revocation) {
      triggers.push({ kind: 'revocation', recordHash: record.recordHash });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.outcome
      && record.replicationOfHash
      && record.outcome?.attempt?.status === 'failed') {
      triggers.push({ kind: 'failed_replication', recordHash: record.recordHash });
    }
  }
  const active = new Set(activeInputRecordHashes);
  const invalidatedParentInputHashes = unique(parents.flatMap((parent) => (
    parent.checkpoint?.activeInputRecordHashes || []
  )).filter((hash) => !active.has(hash))).sort();
  if (invalidatedParentInputHashes.length) {
    triggers.push({ kind: 'policy_active_input_invalidated', recordHash: null });
  }
  const remembered = new Set(cycle.memory.acceptedHashes || []);
  const removedDecisionMemoryHashes = unique(parents.flatMap((parent) => (
    parent.checkpoint?.state?.decisionMemory?.acceptedHashes || []
  )).filter((hash) => !remembered.has(hash))).sort();
  if (removedDecisionMemoryHashes.length) {
    triggers.push({ kind: 'decision_memory_reopened', recordHash: null });
  }
  return {
    required: triggers.length > 0,
    triggerKinds: unique(triggers.map((entry) => entry.kind)).sort(),
    triggerRecordHashes: unique(triggers.map((entry) => entry.recordHash)).sort(),
    invalidatedParentInputHashes,
    removedDecisionMemoryHashes
  };
};

const stateFromCycle = ({ contractId, questionHash, policyId, sourceRecords, activeRecords, cycle, parents, projectionId }) => {
  const activeInputRecordHashes = activeRecords.map((record) => record.recordHash);
  const reopening = reopenTriggers({ sourceRecords, activeInputRecordHashes, cycle, parents });
  const candidateActions = rankProposedCandidateActions(sourceRecords);
  const state = {
    schema: projectionId === LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID
      ? LEGACY_DISCOVERY_CONTRACT_STATE_VERSION
      : DISCOVERY_CONTRACT_STATE_VERSION,
    contractId,
    questionHash,
    policyId,
    status: reopening.required ? 'reopened' : 'open',
    question: clone(cycle.question),
    clarity: {
      status: cycle.clarity.status,
      gaps: clone(cycle.clarity.gaps)
    },
    archive: {
      recordCount: sourceRecords.length,
      activeRecordCount: activeRecords.length,
      invalidatedRecordHashes: [...invalidatedResearchHashes(sourceRecords)].sort(),
      revocationRecordHashes: sourceRecords
        .filter((record) => record.kind === RESEARCH_RECORD_KINDS.revocation)
        .map((record) => record.recordHash)
        .sort(),
      recordKindCounts: recordKindCounts(sourceRecords)
    },
    decisionMemory: {
      policy: cycle.memory.policy,
      acceptedHashes: [...cycle.memory.acceptedHashes],
      excluded: cycle.memory.excluded.map((entry) => ({
        recordHash: entry.recordHash,
        reason: entry.reason,
        supersededByHash: entry.supersededByHash || null,
        duplicateOfHash: entry.duplicateOfHash || null
      }))
    },
    disagreement: clone(cycle.evidence.disagreements),
    nextAction: {
      status: cycle.nextQuestion.status,
      actionKind: cycle.nextQuestion.actionKind,
      targetHash: cycle.nextQuestion.targetHash || null,
      basis: cycle.nextQuestion.basis || null,
      basisHashes: [...(cycle.nextQuestion.basisHashes || [])],
      approvalRecordHashes: [...(cycle.nextQuestion.approvalRecordHashes || [])],
      executionAuthority: cycle.nextQuestion.executionAuthority
    },
    reopen: reopening
  };
  if (projectionId !== LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID) {
    state.candidateActions = clone(candidateActions);
  }
  return state;
};

export async function projectDiscoveryContractState(records = [], {
  questionHash,
  parentCheckpointHashes = [],
  verifyInputs = true,
  projectionId = DISCOVERY_CONTRACT_PROJECTION_ID
} = {}) {
  const manifest = projectionManifest(projectionId);
  const all = Array.isArray(records) ? records : [];
  const sourceRecords = discoveryContractSourceRecords(all, questionHash);
  const question = sourceRecords.find((record) => record.recordHash === questionHash);
  const roomId = question.roomId;
  if (verifyInputs) await verifySourceRecords(sourceRecords, roomId);
  const parents = checkpointParents(all, parentCheckpointHashes);
  for (const parent of parents) {
    const verification = await verifyResearchRecord(parent);
    if (!verification.ok) throw new Error(`Invalid Discovery Contract parent ${parent.recordHash}: ${verification.reasons.join('; ')}`);
    if (parent.roomId !== roomId) throw new Error(`Discovery Contract parent belongs to a different room: ${parent.recordHash}`);
    const parentReplay = await validateDiscoveryContractCheckpoint(parent, all);
    if (!parentReplay.ok) {
      throw new Error(`Discovery Contract parent replay failed ${parent.recordHash}: ${parentReplay.reasons.join('; ')}`);
    }
  }
  const activeRecords = activeResearchRecords(sourceRecords).sort(compareRecords);
  if (!activeRecords.some((record) => record.recordHash === questionHash)) {
    throw new Error('Discovery Contract question is revoked or invalidated');
  }
  const cycle = projectGovernedResearchCycle(sourceRecords, { questionHash });
  const policyId = cycle.policyId;
  const contractId = await contractIdentity({ roomId, questionHash, policyId });
  if (parents.some((parent) => parent.checkpoint?.contractId !== contractId)) {
    throw new Error('Discovery Contract parent belongs to another contract');
  }
  const inputRecordHashes = sourceRecords.map((record) => record.recordHash);
  const activeInputRecordHashes = activeRecords.map((record) => record.recordHash);
  const projection = {
    id: projectionId,
    artifactHash: await hashJson(manifest)
  };
  const state = stateFromCycle({
    contractId,
    questionHash,
    policyId,
    sourceRecords,
    activeRecords,
    cycle,
    parents,
    projectionId
  });
  return {
    contractId,
    questionHash,
    policyId,
    parentCheckpointHashes: parents.map((parent) => parent.recordHash),
    projection,
    inputRecordHashes,
    activeInputRecordHashes,
    state
  };
}

export async function createDiscoveryContractCheckpoint({
  identity,
  roomId,
  questionHash,
  records = [],
  parentCheckpointHashes = [],
  createdAt = new Date().toISOString()
} = {}) {
  const projected = await projectDiscoveryContractState(records, {
    questionHash,
    parentCheckpointHashes,
    verifyInputs: true
  });
  const question = records.find((record) => record.recordHash === questionHash);
  if (question?.roomId !== roomId) throw new Error('Discovery Contract room does not match its question');
  const checkpoint = await createSignedDiscoveryCheckpoint({
    identity,
    roomId,
    checkpoint: projected,
    createdAt
  });
  const links = validateResearchRecordLinks(checkpoint, records);
  if (!links.ok) throw new Error(`Invalid Discovery Contract checkpoint links: ${links.reasons.join('; ')}`);
  const replay = await validateDiscoveryContractCheckpoint(checkpoint, records, { requireCurrentCompleteness: true });
  if (!replay.ok) throw new Error(`Discovery Contract checkpoint replay failed: ${replay.reasons.join('; ')}`);
  return checkpoint;
}

export async function validateDiscoveryContractCheckpoint(checkpoint, records = [], {
  requireCurrentCompleteness = false
} = {}) {
  const reasons = [];
  const verification = await verifyResearchRecord(checkpoint);
  if (!verification.ok) return { ok: false, reasons: verification.reasons };
  if (checkpoint.kind !== RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    return { ok: false, reasons: ['record is not a Discovery Contract checkpoint'] };
  }
  const byHash = new Map(records.map((record) => [record.recordHash, record]));
  const declaredInputs = checkpoint.checkpoint.inputRecordHashes.map((hash) => byHash.get(hash)).filter(Boolean);
  if (declaredInputs.length !== checkpoint.checkpoint.inputRecordHashes.length) {
    reasons.push('Discovery Contract replay input is missing');
  }
  const parents = checkpoint.checkpoint.parentCheckpointHashes.map((hash) => byHash.get(hash)).filter(Boolean);
  if (parents.length !== checkpoint.checkpoint.parentCheckpointHashes.length) {
    reasons.push('Discovery Contract replay parent is missing');
  }
  if (reasons.length) return { ok: false, reasons };
  const replayRecords = [...declaredInputs, ...parents];
  try {
    const replayed = await projectDiscoveryContractState(
      requireCurrentCompleteness ? records : replayRecords,
      {
        questionHash: checkpoint.checkpoint.questionHash,
        parentCheckpointHashes: checkpoint.checkpoint.parentCheckpointHashes,
        verifyInputs: true,
        projectionId: checkpoint.checkpoint.projection.id
      }
    );
    for (const field of [
      'contractId',
      'questionHash',
      'policyId',
      'parentCheckpointHashes',
      'projection',
      'inputRecordHashes',
      'activeInputRecordHashes',
      'state'
    ]) {
      if (JSON.stringify(replayed[field]) !== JSON.stringify(checkpoint.checkpoint[field])) {
        reasons.push(`Discovery Contract replay mismatch: ${field}`);
      }
    }
    if (await hashJson(replayed.state) !== checkpoint.checkpoint.stateHash) {
      reasons.push('Discovery Contract replay mismatch: stateHash');
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  return { ok: reasons.length === 0, reasons };
}

export async function projectDiscoveryCheckpointStatus(records = [], { questionHash = null } = {}) {
  const checkpoints = records
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint)
    .filter((record) => !questionHash || record.checkpoint?.questionHash === questionHash)
    .sort(compareRecords);
  const latest = checkpoints.at(-1) || null;
  if (!latest) return {
    status: 'missing',
    latestCheckpoint: null,
    prospectiveState: null,
    reasons: []
  };
  const replay = await validateDiscoveryContractCheckpoint(latest, records);
  if (!replay.ok) return {
    status: 'invalid',
    latestCheckpoint: latest,
    prospectiveState: null,
    reasons: replay.reasons
  };
  try {
    const prospective = await projectDiscoveryContractState(records, {
      questionHash: latest.checkpoint.questionHash,
      parentCheckpointHashes: [latest.recordHash],
      verifyInputs: true
    });
    const current = prospective.projection.id === latest.checkpoint.projection?.id
      && JSON.stringify(prospective.inputRecordHashes) === JSON.stringify(latest.checkpoint.inputRecordHashes);
    return {
      status: current ? 'current' : prospective.state.status === 'reopened' ? 'reopen_required' : 'stale',
      latestCheckpoint: latest,
      prospectiveState: prospective.state,
      reasons: []
    };
  } catch (error) {
    return {
      status: 'invalid',
      latestCheckpoint: latest,
      prospectiveState: null,
      reasons: [error instanceof Error ? error.message : String(error)]
    };
  }
}

export default {
  DISCOVERY_CONTRACT_PROJECTION_MANIFEST,
  LEGACY_DISCOVERY_CONTRACT_PROJECTION_MANIFEST,
  discoveryContractSourceRecords,
  projectDiscoveryContractState,
  createDiscoveryContractCheckpoint,
  validateDiscoveryContractCheckpoint,
  projectDiscoveryCheckpointStatus
};
