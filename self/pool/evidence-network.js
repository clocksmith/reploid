/**
 * @fileoverview Signed, immutable evidence records and local discovery for Poolday.
 */

import {
  SIGNATURE_DOMAINS,
  exportPublicKey,
  hashJson,
  sha256Hex,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';
import {
  MAX_PUBLIC_PROTEIN_SEQUENCE_LENGTH,
  SEQUENCE_ALPHABETS,
  normalizeSequenceInput
} from './sequence-workload.js';

export const RESEARCH_RECORD_VERSION = 'poolday.research_evidence/v1';
export const RESEARCH_RECORD_KINDS = Object.freeze({
  submission: 'research_submission',
  result: 'research_result',
  claim: 'human_claim'
});
export const RESEARCH_INTENT_KINDS = Object.freeze([
  'question',
  'hypothesis',
  'label',
  'task_context'
]);
export const HUMAN_CLAIM_KINDS = Object.freeze([
  'annotation',
  'evidence_link',
  'correction',
  'experiment_context',
  'follow_up',
  'review_decision',
  'task_approval'
]);
export const EVIDENCE_RELATIONS = Object.freeze([
  'supports',
  'contradicts',
  'corrects',
  'reviews',
  'derived_from',
  'proposes',
  'approves'
]);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_TEXT_LENGTH = 8000;
const MAX_EMBEDDING_DIMENSIONS = 4096;
const DOMAIN_BY_KIND = Object.freeze({
  [RESEARCH_RECORD_KINDS.submission]: SIGNATURE_DOMAINS.researchSubmission,
  [RESEARCH_RECORD_KINDS.result]: SIGNATURE_DOMAINS.researchResult,
  [RESEARCH_RECORD_KINDS.claim]: SIGNATURE_DOMAINS.humanClaim
});

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
};
const compactText = (value, max = MAX_TEXT_LENGTH) => String(value || '').trim().slice(0, max);
const unique = (values) => [...new Set(values.filter(Boolean))];
const stableTaskId = (kind, targetHash) => `task:${kind}:${targetHash}`;
const withoutSignature = (record = {}) => {
  const { signature, ...payload } = record;
  return payload;
};
const withoutIdentity = (record = {}) => {
  const { recordHash, signature, ...payload } = record;
  return payload;
};

const normalizeRoomId = (roomId) => {
  const normalized = compactText(roomId, 160).replace(/[^a-z0-9_.:-]/gi, '_');
  if (!normalized) throw new TypeError('roomId is required');
  return normalized;
};

const normalizeIntent = (intent = {}) => {
  const kind = compactText(intent.kind, 32).toLowerCase();
  if (!RESEARCH_INTENT_KINDS.includes(kind)) throw new TypeError('requester intent kind is not supported');
  const text = compactText(intent.text);
  const label = compactText(intent.label, 240);
  const context = compactText(intent.context);
  if (!text && !label && !context) throw new TypeError('requester intent content is required');
  return { kind, text, label, context };
};

const normalizeConsent = (consent = {}) => {
  if (consent.publicSequence !== true) throw new TypeError('public sequence consent is required');
  if (consent.publicEvidenceNetwork !== true) throw new TypeError('public evidence-network consent is required');
  return {
    scope: 'public_protein_evidence_network',
    publicSequence: true,
    publicEvidenceNetwork: true,
    publishEmbedding: consent.publishEmbedding === true,
    acknowledgedAt: compactText(consent.acknowledgedAt, 64) || new Date().toISOString()
  };
};

const normalizeModelContract = (model = {}) => {
  const contract = {
    id: compactText(model.id || model.modelId, 240),
    hash: compactText(model.hash || model.modelHash, 160),
    manifestHash: compactText(model.manifestHash, 160),
    runtime: compactText(model.runtime, 120),
    backend: compactText(model.backend, 120),
    workload: compactText(model.workload || model.requirements?.workload, 120),
    executionMode: compactText(model.executionMode || model.requirements?.executionMode, 120),
    dimensions: Number(model.dimensions || model.embeddingDimensions || model.requirements?.embeddingDimensions || 0) || null,
    artifactIdentity: clone(model.artifactIdentity || model.requirements?.artifactIdentity || null)
  };
  if (!contract.id || !contract.hash || !contract.manifestHash || !contract.runtime || !contract.workload) {
    throw new TypeError('exact model id, hash, manifest hash, runtime, and workload are required');
  }
  return contract;
};

const createAuthor = async (identity, expectedRoles = []) => {
  if (!identity?.resolve || !identity?.getSigningKeyPair) throw new TypeError('signing identity is required');
  const [resolved, keyPair] = await Promise.all([identity.resolve(), identity.getSigningKeyPair()]);
  if (expectedRoles.length > 0 && !expectedRoles.includes(resolved.kind)) {
    throw new TypeError(`identity role must be one of: ${expectedRoles.join(', ')}`);
  }
  return {
    author: {
      role: resolved.kind,
      roleId: resolved.roleId,
      userId: resolved.userId,
      deviceId: resolved.deviceId,
      identityRootId: resolved.identityRootId,
      publicKey: await exportPublicKey(keyPair.publicKey)
    },
    privateKey: keyPair.privateKey
  };
};

const signRecord = async (payload, privateKey, domain) => {
  const recordHash = await hashJson(payload);
  const record = { ...payload, recordHash };
  return deepFreeze({
    ...record,
    signature: await signCanonical(record, privateKey, { domain })
  });
};

export async function createSignedResearchSubmission({
  identity,
  roomId,
  sequence,
  intent,
  consent,
  modelContract,
  policyId,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedSequence = normalizeSequenceInput(sequence, SEQUENCE_ALPHABETS.aminoAcid);
  if (normalizedSequence.length > MAX_PUBLIC_PROTEIN_SEQUENCE_LENGTH) {
    throw new TypeError(`sequence exceeds the maximum public protein length (${MAX_PUBLIC_PROTEIN_SEQUENCE_LENGTH})`);
  }
  const { author, privateKey } = await createAuthor(identity, ['requester', 'researcher']);
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.submission,
    signatureDomain: SIGNATURE_DOMAINS.researchSubmission,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    sequence: {
      alphabet: SEQUENCE_ALPHABETS.aminoAcid,
      value: normalizedSequence,
      length: normalizedSequence.length,
      hash: await sha256Hex(normalizedSequence)
    },
    consent: normalizeConsent(consent),
    requesterIntent: normalizeIntent(intent),
    modelContract: normalizeModelContract(modelContract),
    policyId: compactText(policyId, 160)
  };
  if (!payload.policyId) throw new TypeError('policyId is required');
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchSubmission);
}

export async function createSignedResearchResult({
  identity,
  roomId,
  submission,
  receiptRecord,
  agreement = null,
  routeDecision = null,
  embedding = null,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['requester', 'researcher']);
  if (submission?.kind !== RESEARCH_RECORD_KINDS.submission || !SHA256_PATTERN.test(String(submission.recordHash || ''))) {
    throw new TypeError('signed research submission is required');
  }
  const receipt = receiptRecord?.receipt || receiptRecord || {};
  const receiptHash = receiptRecord?.receiptHash || await hashJson(receipt);
  if (!SHA256_PATTERN.test(String(receiptHash || ''))) throw new TypeError('accepted receipt hash is required');
  const accepted = receiptRecord?.requesterAcceptance || receipt.requesterAcceptance || null;
  const verified = receiptRecord?.verifierDecision?.accepted !== false;
  if (!verified) throw new TypeError('rejected compute receipts cannot become research results');
  const vector = Array.isArray(embedding) ? embedding.map(Number) : null;
  if (vector && (!submission.consent.publishEmbedding || vector.length === 0 || vector.length > MAX_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value)))) {
    throw new TypeError('embedding publication is not consented or is invalid');
  }
  const receiptModelContract = normalizeModelContract(receipt.model || submission.modelContract);
  const requiredModelFields = ['id', 'hash', 'manifestHash', 'runtime', 'backend', 'workload', 'executionMode'];
  for (const field of requiredModelFields) {
    if (receiptModelContract[field] !== submission.modelContract[field]) {
      throw new TypeError(`compute receipt ${field} does not match the submitted exact model contract`);
    }
  }
  const modelContract = clone(submission.modelContract);
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.result,
    signatureDomain: SIGNATURE_DOMAINS.researchResult,
    roomId: normalizeRoomId(roomId || submission.roomId),
    createdAt,
    author,
    submissionHash: submission.recordHash,
    sequenceHash: submission.sequence.hash,
    modelContract,
    compute: {
      receiptHash,
      receiptHashes: unique(agreement?.receiptHashes || [receiptHash]),
      requesterAcceptanceHash: accepted?.acceptanceHash || accepted?.receiptHash || null,
      agreementHash: agreement ? await hashJson(agreement) : null,
      agreement: clone(agreement),
      routeDecisionHash: receipt.routeDecisionHash || (routeDecision ? await hashJson(routeDecision) : null),
      assignmentId: receipt.assignmentId || receiptRecord?.assignmentId || null,
      jobId: receipt.jobId || receiptRecord?.jobId || null,
      providerId: receipt.providerId || receiptRecord?.providerId || null,
      runtimeProfileHash: receipt.verification?.runtimeProfileHash || receipt.runtime?.runtimeProfileHash || null,
      outputKind: receipt.outputKind || null,
      sequenceResultHash: receipt.sequenceResultHash || receiptRecord?.sequenceResultHash || null,
      vectorHash: receipt.vectorHash || receipt.sequence?.vectorHash || receiptRecord?.vectorHash || null
    },
    embedding: vector ? {
      dimensions: vector.length,
      values: vector,
      vectorHash: receipt.vectorHash || await hashJson(vector)
    } : null
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchResult);
}

export async function createSignedHumanClaim({
  identity,
  roomId,
  targetHash,
  claimKind,
  relation,
  text,
  confidence,
  evidenceLinks = [],
  decision = null,
  taskId = null,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['reviewer', 'verifier', 'researcher']);
  const kind = compactText(claimKind, 40).toLowerCase();
  const edge = compactText(relation, 40).toLowerCase();
  if (!HUMAN_CLAIM_KINDS.includes(kind)) throw new TypeError('human claim kind is not supported');
  if (!EVIDENCE_RELATIONS.includes(edge)) throw new TypeError('evidence relation is not supported');
  if (!SHA256_PATTERN.test(String(targetHash || ''))) throw new TypeError('targetHash must be a SHA-256 record identity');
  const normalizedText = compactText(text);
  if (!normalizedText) throw new TypeError('human claim text is required');
  const normalizedConfidence = Number(confidence);
  if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
    throw new TypeError('confidence must be between 0 and 1');
  }
  const links = evidenceLinks.map((link) => {
    const url = new URL(typeof link === 'string' ? link : link.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('evidence links must use http or https');
    return { url: url.href, label: compactText(link.label, 240) };
  }).slice(0, 24);
  const normalizedDecision = decision ? compactText(decision, 32).toLowerCase() : null;
  if (kind === 'review_decision' && !['accepted', 'rejected', 'needs_revision'].includes(normalizedDecision)) {
    throw new TypeError('review decision must be accepted, rejected, or needs_revision');
  }
  if (kind === 'task_approval' && normalizedDecision !== 'approved') {
    throw new TypeError('task approval decision must be approved');
  }
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.claim,
    signatureDomain: SIGNATURE_DOMAINS.humanClaim,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    targetHash,
    claim: {
      kind,
      relation: edge,
      text: normalizedText,
      confidence: normalizedConfidence,
      evidenceLinks: links,
      decision: normalizedDecision,
      taskId: compactText(taskId, 240) || null
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.humanClaim);
}

export async function verifyResearchRecord(record = {}) {
  const reasons = [];
  const domain = DOMAIN_BY_KIND[record.kind];
  if (record.version !== RESEARCH_RECORD_VERSION) reasons.push('research record version mismatch');
  if (!domain) reasons.push('research record kind is not supported');
  if (domain && record.signatureDomain !== domain) reasons.push('research signature domain mismatch');
  if (!record.author?.roleId || !record.author?.publicKey) reasons.push('attributable author is required');
  if (!SHA256_PATTERN.test(String(record.recordHash || ''))) reasons.push('recordHash must be a SHA-256 identity');
  if (record.recordHash && await hashJson(withoutIdentity(record)) !== record.recordHash) reasons.push('record hash mismatch');
  if (!record.signature) reasons.push('record signature is required');
  if (domain && record.signature && record.author?.publicKey) {
    try {
      const ok = await verifyCanonicalSignature(
        withoutSignature(record),
        record.author.publicKey,
        record.signature,
        { domain }
      );
      if (!ok) reasons.push('record signature invalid');
    } catch (error) {
      reasons.push(`record signature verification failed: ${error.message}`);
    }
  }
  if (!record.roomId) reasons.push('roomId is required');
  if (!record.createdAt || !Number.isFinite(Date.parse(record.createdAt))) reasons.push('createdAt must be an ISO timestamp');
  if (record.kind === RESEARCH_RECORD_KINDS.submission) {
    if (!['requester', 'researcher'].includes(record.author?.role)) reasons.push('submission author role is invalid');
    try {
      const normalized = normalizeSequenceInput(record.sequence?.value, record.sequence?.alphabet);
      if (normalized.length !== record.sequence?.length) reasons.push('sequence length mismatch');
      if (normalized.length > MAX_PUBLIC_PROTEIN_SEQUENCE_LENGTH) reasons.push('sequence exceeds the maximum public protein length');
      if (await sha256Hex(normalized) !== record.sequence?.hash) reasons.push('sequence hash mismatch');
      normalizeIntent(record.requesterIntent);
      normalizeConsent(record.consent);
      normalizeModelContract(record.modelContract);
    } catch (error) {
      reasons.push(error.message);
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.result) {
    if (!['requester', 'researcher'].includes(record.author?.role)) reasons.push('result author role is invalid');
    if (!SHA256_PATTERN.test(String(record.submissionHash || ''))) reasons.push('result submissionHash is invalid');
    if (!SHA256_PATTERN.test(String(record.sequenceHash || ''))) reasons.push('result sequenceHash is invalid');
    if (!SHA256_PATTERN.test(String(record.compute?.receiptHash || ''))) reasons.push('result receiptHash is invalid');
    if (!Array.isArray(record.compute?.receiptHashes) || record.compute.receiptHashes.some((hash) => !SHA256_PATTERN.test(String(hash || '')))) {
      reasons.push('result receiptHashes are invalid');
    }
    try {
      normalizeModelContract(record.modelContract);
    } catch (error) {
      reasons.push(error.message);
    }
    if (record.embedding) {
      const values = record.embedding.values;
      if (!Array.isArray(values) || values.length !== record.embedding.dimensions || values.length > MAX_EMBEDDING_DIMENSIONS || values.some((value) => !Number.isFinite(value))) {
        reasons.push('published embedding is invalid');
      }
      if (!SHA256_PATTERN.test(String(record.embedding.vectorHash || ''))) reasons.push('embedding vectorHash is invalid');
      if (record.modelContract?.dimensions && record.modelContract.dimensions !== record.embedding.dimensions) reasons.push('embedding dimensions do not match the exact model contract');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.claim) {
    if (!['reviewer', 'verifier', 'researcher'].includes(record.author?.role)) reasons.push('human claim author role is invalid');
    if (!SHA256_PATTERN.test(String(record.targetHash || ''))) reasons.push('claim targetHash is invalid');
    if (!HUMAN_CLAIM_KINDS.includes(record.claim?.kind)) reasons.push('human claim kind is invalid');
    if (!EVIDENCE_RELATIONS.includes(record.claim?.relation)) reasons.push('human claim relation is invalid');
    if (!record.claim?.text) reasons.push('human claim text is required');
    if (!Number.isFinite(record.claim?.confidence) || record.claim.confidence < 0 || record.claim.confidence > 1) reasons.push('human claim confidence is invalid');
    if (!Array.isArray(record.claim?.evidenceLinks)) reasons.push('human claim evidenceLinks must be an array');
    for (const link of record.claim?.evidenceLinks || []) {
      try {
        const url = new URL(link?.url);
        if (!['http:', 'https:'].includes(url.protocol)) reasons.push('human claim evidence link protocol is invalid');
      } catch {
        reasons.push('human claim evidence link is invalid');
      }
    }
    if (record.claim?.kind === 'review_decision'
      && (!['accepted', 'rejected', 'needs_revision'].includes(record.claim?.decision) || record.claim?.relation !== 'reviews')) {
      reasons.push('human review decision is invalid');
    }
    if (record.claim?.kind === 'task_approval'
      && (record.claim?.decision !== 'approved' || record.claim?.relation !== 'approves' || !record.claim?.taskId)) {
      reasons.push('human task approval is invalid');
    }
  }
  return { ok: reasons.length === 0, reasons, recordHash: record.recordHash || null };
}

export function buildEvidenceGraph(records = []) {
  const nodes = records.map((record) => ({
    id: record.recordHash,
    kind: record.kind,
    label: record.kind === RESEARCH_RECORD_KINDS.submission
      ? record.requesterIntent?.label || record.requesterIntent?.text || record.sequence?.hash
      : record.kind === RESEARCH_RECORD_KINDS.result
        ? record.modelContract?.id
        : record.claim?.text,
    record
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const addNode = (node) => {
    if (!node?.id || nodeIds.has(node.id)) return;
    nodes.push(node);
    nodeIds.add(node.id);
  };
  for (const record of records) {
    if (record.author?.roleId) {
      const authorNodeId = `identity:${record.author.roleId}`;
      addNode({
        id: authorNodeId,
        kind: 'participant_identity',
        label: record.author.roleId,
        author: record.author
      });
      edges.push({ from: record.recordHash, to: authorNodeId, relation: 'authored_by' });
    }
    const contract = record.modelContract;
    if (contract?.hash && contract?.manifestHash) {
      const modelNodeId = `model:${contract.hash}:${contract.manifestHash}`;
      addNode({
        id: modelNodeId,
        kind: 'model_artifact',
        label: contract.id,
        modelContract: contract
      });
      edges.push({
        from: record.recordHash,
        to: modelNodeId,
        relation: record.kind === RESEARCH_RECORD_KINDS.submission ? 'requests' : 'generated_by'
      });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.submission && record.sequence?.hash) {
      const sequenceNodeId = `sequence:${record.sequence.hash}`;
      addNode({
        id: sequenceNodeId,
        kind: 'protein_sequence',
        label: record.sequence.hash,
        sequenceHash: record.sequence.hash,
        sequence: record.sequence.value
      });
      edges.push({ from: record.recordHash, to: sequenceNodeId, relation: 'describes' });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.result && nodeIds.has(record.submissionHash)) {
      edges.push({ from: record.recordHash, to: record.submissionHash, relation: 'derived_from' });
      for (const receiptHash of unique(record.compute?.receiptHashes || [record.compute?.receiptHash])) {
        const receiptNodeId = `receipt:${receiptHash}`;
        addNode({ id: receiptNodeId, kind: 'compute_receipt', label: receiptHash, receiptHash });
        edges.push({ from: record.recordHash, to: receiptNodeId, relation: 'backed_by' });
      }
      if (record.compute?.providerId) {
        const providerNodeId = `provider:${record.compute.providerId}`;
        addNode({ id: providerNodeId, kind: 'compute_provider', label: record.compute.providerId });
        edges.push({ from: record.recordHash, to: providerNodeId, relation: 'produced_by' });
      }
      if (record.compute?.routeDecisionHash) {
        const routeNodeId = `route:${record.compute.routeDecisionHash}`;
        addNode({ id: routeNodeId, kind: 'route_decision', label: record.compute.routeDecisionHash });
        edges.push({ from: record.recordHash, to: routeNodeId, relation: 'routed_by' });
      }
      if (record.compute?.runtimeProfileHash) {
        const runtimeNodeId = `runtime:${record.compute.runtimeProfileHash}`;
        addNode({ id: runtimeNodeId, kind: 'runtime_profile', label: record.compute.runtimeProfileHash });
        edges.push({ from: record.recordHash, to: runtimeNodeId, relation: 'ran_on' });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.claim && nodeIds.has(record.targetHash)) {
      edges.push({ from: record.recordHash, to: record.targetHash, relation: record.claim.relation });
    }
    for (const source of record.claim?.evidenceLinks || []) {
      const sourceNodeId = `source:${source.url}`;
      addNode({
        id: sourceNodeId,
        kind: 'evidence_source',
        label: source.label || source.url,
        url: source.url
      });
      edges.push({ from: record.recordHash, to: sourceNodeId, relation: 'cites' });
    }
  }
  return { nodes, edges };
}

const modelCompatibilityKey = (record = {}) => {
  const model = record.modelContract || {};
  const dimensions = record.embedding?.dimensions || model.dimensions || 0;
  return [model.id, model.hash, model.manifestHash, model.runtime, model.backend, model.workload, model.executionMode, dimensions].join('|');
};

export const embeddingsAreCompatible = (left, right) => Boolean(
  left?.embedding?.values && right?.embedding?.values
  && left.embedding.dimensions === right.embedding.dimensions
  && modelCompatibilityKey(left) === modelCompatibilityKey(right)
);

export function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : null;
}

const acceptedClaimHashes = (records) => {
  const recordsByHash = new Map(records.map((record) => [record.recordHash, record]));
  return new Set(records
    .filter((record) => {
      if (record.kind !== RESEARCH_RECORD_KINDS.claim
        || record.claim.kind !== 'review_decision'
        || record.claim.decision !== 'accepted') return false;
      const target = recordsByHash.get(record.targetHash);
      return target && target.author?.identityRootId !== record.author?.identityRootId;
    })
    .map((record) => record.targetHash));
};

const claimsForTarget = (records, targetHash) => records.filter((record) => (
  record.kind === RESEARCH_RECORD_KINDS.claim && record.targetHash === targetHash
));

export function searchEvidence(records = [], query = '') {
  const needle = compactText(query).toLowerCase();
  if (!needle) return records.slice();
  return records.filter((record) => JSON.stringify({
    sequence: record.sequence?.value,
    intent: record.requesterIntent,
    model: record.modelContract?.id,
    claim: record.claim,
    author: record.author?.roleId
  }).toLowerCase().includes(needle));
}

export function findSimilarSequences(records = [], targetHash, { limit = 12 } = {}) {
  const target = records.find((record) => record.recordHash === targetHash && record.embedding);
  if (!target) return [];
  const accepted = acceptedClaimHashes(records);
  return records
    .filter((record) => record.recordHash !== targetHash && embeddingsAreCompatible(target, record))
    .map((record) => {
      const annotations = [
        ...claimsForTarget(records, record.recordHash),
        ...claimsForTarget(records, record.submissionHash)
      ]
        .filter((claim) => claim.claim.kind !== 'review_decision');
      const acceptedAnnotations = annotations.filter((claim) => accepted.has(claim.recordHash));
      const score = cosineSimilarity(target.embedding.values, record.embedding.values);
      const evidenceBoost = acceptedAnnotations.reduce((sum, claim) => sum + claim.claim.confidence, 0) * 0.002;
      return {
        record,
        similarity: score,
        score: Math.min(1, score + evidenceBoost),
        supportingAnnotations: acceptedAnnotations,
        provenance: record.compute
      };
    })
    .filter((entry) => entry.similarity !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function clusterCompatibleResults(records = [], { threshold = 0.8 } = {}) {
  const results = records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result && record.embedding?.values);
  const remaining = new Set(results.map((record) => record.recordHash));
  const byHash = new Map(results.map((record) => [record.recordHash, record]));
  const clusters = [];
  while (remaining.size) {
    const seedHash = remaining.values().next().value;
    const queue = [seedHash];
    const members = [];
    remaining.delete(seedHash);
    while (queue.length) {
      const current = byHash.get(queue.shift());
      members.push(current);
      for (const candidateHash of [...remaining]) {
        const candidate = byHash.get(candidateHash);
        if (!embeddingsAreCompatible(current, candidate)) continue;
        if ((cosineSimilarity(current.embedding.values, candidate.embedding.values) || -1) < threshold) continue;
        remaining.delete(candidateHash);
        queue.push(candidateHash);
      }
    }
    clusters.push({
      clusterId: `cluster:${modelCompatibilityKey(members[0])}:${clusters.length + 1}`,
      modelCompatibilityKey: modelCompatibilityKey(members[0]),
      members
    });
  }
  return clusters.sort((left, right) => right.members.length - left.members.length);
}

export function proposeDiscoveryTasks(records = []) {
  const tasks = [];
  const results = records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result);
  const claims = records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const approvals = new Set(claims.filter((record) => record.claim.kind === 'task_approval').map((record) => record.claim.taskId));
  for (const submission of records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)) {
    const linkedResults = results.filter((record) => record.submissionHash === submission.recordHash);
    if (linkedResults.length === 0) tasks.push({ kind: 'compute', targetHash: submission.recordHash, reason: 'No receipt-backed result exists.' });
    for (const result of linkedResults) {
      const resultClaims = claimsForTarget(records, result.recordHash);
      const independentReviews = resultClaims.filter((claim) => claim.claim.kind === 'review_decision'
        && claim.author.identityRootId !== result.author.identityRootId);
      if (independentReviews.length === 0) tasks.push({ kind: 'independent_review', targetHash: result.recordHash, reason: 'No independent reviewer decision exists.' });
      if ((result.compute?.receiptHashes || []).length < 2) tasks.push({ kind: 'reproduce', targetHash: result.recordHash, reason: 'Only one compute receipt backs this result.' });
    }
  }
  for (const claim of claims) {
    if (claim.claim.kind === 'follow_up') tasks.push({ kind: 'follow_up', targetHash: claim.recordHash, reason: claim.claim.text });
    if (claim.claim.confidence < 0.5 && claim.claim.kind !== 'task_approval') tasks.push({ kind: 'resolve_uncertainty', targetHash: claim.recordHash, reason: 'The contributor marked this claim low confidence.' });
    if (claim.claim.relation === 'contradicts') tasks.push({ kind: 'adjudicate_contradiction', targetHash: claim.recordHash, reason: 'A signed claim contradicts prior evidence.' });
  }
  return tasks.map((task) => {
    const taskId = stableTaskId(task.kind, task.targetHash);
    return { ...task, taskId, status: approvals.has(taskId) ? 'approved' : 'proposed' };
  });
}

export function projectResearchRewards(records = []) {
  const claims = records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const accepted = acceptedClaimHashes(records);
  const contradicted = new Set(claims.filter((record) => ['contradicts', 'corrects'].includes(record.claim.relation)).map((record) => record.targetHash));
  const state = new Map();
  const ensure = (author = {}) => {
    const id = author.roleId || 'unknown';
    if (!state.has(id)) state.set(id, {
      authorId: id,
      verifiedCompute: 0,
      acceptedEvidence: 0,
      durableEvidence: 0,
      acceptedReviews: 0,
      durableReviews: 0,
      points: 0
    });
    return state.get(id);
  };
  for (const result of records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result)) {
    const contributor = ensure({ roleId: result.compute?.providerId });
    const receiptCount = unique(result.compute?.receiptHashes || [result.compute?.receiptHash]).length;
    contributor.verifiedCompute += receiptCount;
    contributor.points += receiptCount * 2;
  }
  for (const claim of claims.filter((record) => !['review_decision', 'task_approval'].includes(record.claim.kind))) {
    if (!accepted.has(claim.recordHash)) continue;
    const contributor = ensure(claim.author);
    contributor.acceptedEvidence += 1;
    contributor.points += 5;
    if (!contradicted.has(claim.recordHash)) {
      contributor.durableEvidence += 1;
      contributor.points += 3;
    }
  }
  const recordsByHash = new Map(records.map((record) => [record.recordHash, record]));
  for (const review of claims.filter((record) => record.claim.kind === 'review_decision' && record.claim.decision === 'accepted')) {
    const target = recordsByHash.get(review.targetHash);
    if (!target || target.author?.identityRootId === review.author?.identityRootId) continue;
    const reviewer = ensure(review.author);
    reviewer.acceptedReviews += 1;
    reviewer.points += 2;
    if (!contradicted.has(review.recordHash) && !contradicted.has(review.targetHash)) {
      reviewer.durableReviews += 1;
      reviewer.points += 1;
    }
  }
  return [...state.values()].map((entry) => ({
    ...entry,
    quality: (entry.acceptedEvidence + entry.acceptedReviews)
      ? (entry.durableEvidence + entry.durableReviews) / (entry.acceptedEvidence + entry.acceptedReviews)
      : 0
  })).sort((left, right) => right.points - left.points);
}

export default {
  createSignedResearchSubmission,
  createSignedResearchResult,
  createSignedHumanClaim,
  verifyResearchRecord,
  buildEvidenceGraph,
  searchEvidence,
  findSimilarSequences,
  clusterCompatibleResults,
  proposeDiscoveryTasks,
  projectResearchRewards
};
