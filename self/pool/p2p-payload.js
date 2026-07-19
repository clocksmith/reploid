/**
 * @fileoverview Versioned payload envelopes for hybrid P2P pool transport.
 */

import { hashJson, sha256Hex } from './inference-receipt.js';

export const P2P_PAYLOAD_VERSION = 'reploid_pool_p2p_payload/v1';

export const P2P_PAYLOAD_TYPES = Object.freeze({
  PROMPT: 'prompt',
  EXECUTION_RESULT: 'execution_result',
  RECEIPT: 'receipt',
  ACCEPTANCE: 'acceptance',
  ARTIFACT_REQUEST: 'artifact_request',
  ARTIFACT_CHUNK: 'artifact_chunk',
  ARTIFACT_COMPLETE: 'artifact_complete',
  ACK: 'ack',
  ERROR: 'error'
});

export const COMMIT_REVEAL_VERSION = 'reploid_pool_commit_reveal/v1';

const PAYLOAD_TYPES = new Set(Object.values(P2P_PAYLOAD_TYPES));

const requireString = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

export function createP2PPayload({
  type,
  assignmentId,
  jobId,
  fromPeerId,
  toPeerId = null,
  body = {},
  createdAt = new Date().toISOString()
} = {}) {
  if (!PAYLOAD_TYPES.has(type)) throw new TypeError('P2P payload type is not allowed');
  return Object.freeze({
    payloadVersion: P2P_PAYLOAD_VERSION,
    type,
    assignmentId: requireString(assignmentId, 'assignmentId'),
    jobId: requireString(jobId, 'jobId'),
    fromPeerId: requireString(fromPeerId, 'fromPeerId'),
    toPeerId: toPeerId ? requireString(toPeerId, 'toPeerId') : null,
    body: body || {},
    createdAt
  });
}

export function validateP2PPayload(payload = {}) {
  const reasons = [];
  if (payload.payloadVersion !== P2P_PAYLOAD_VERSION) reasons.push('payload version mismatch');
  if (!PAYLOAD_TYPES.has(payload.type)) reasons.push('payload type is not allowed');
  for (const field of ['assignmentId', 'jobId', 'fromPeerId']) {
    if (!String(payload[field] || '').trim()) reasons.push(`${field} is required`);
  }
  if (!payload.body || typeof payload.body !== 'object' || Array.isArray(payload.body)) {
    reasons.push('body must be an object');
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

export function assertP2PPayload(payload = {}) {
  const result = validateP2PPayload(payload);
  if (!result.ok) throw new Error(result.reasons.join('; '));
  return payload;
}

export async function hashP2PPayload(payload = {}) {
  assertP2PPayload(payload);
  return hashJson(payload);
}

export async function createPromptPayload({ assignment, prompt, inputHash, generationConfigHash, fromPeerId, toPeerId } = {}) {
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.PROMPT,
    assignmentId: assignment?.assignmentId,
    jobId: assignment?.jobId,
    fromPeerId,
    toPeerId,
    body: {
      prompt,
      inputHash: inputHash || assignment?.inputHash || null,
      generationConfigHash: generationConfigHash || assignment?.generationConfigHash || null,
      policyId: assignment?.policyId || null,
      model: assignment?.model || null
    }
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

export async function createExecutionResultPayload({ assignment, execution, fromPeerId, toPeerId } = {}) {
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.EXECUTION_RESULT,
    assignmentId: assignment?.assignmentId,
    jobId: assignment?.jobId,
    fromPeerId,
    toPeerId,
    body: {
      outputText: execution?.outputText || '',
      tokenIds: Array.isArray(execution?.tokenIds) ? execution.tokenIds : [],
      outputKind: execution?.outputKind || null,
      vectorHash: execution?.vectorHash || null,
      embeddingDimensions: execution?.embeddingDimensions || null,
      embeddingStats: execution?.embeddingStats || null,
      transcript: execution?.transcript || null,
      tokenCounts: execution?.tokenCounts || null,
      timing: execution?.timing || null
    }
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

export async function createReceiptPayload({ assignment, receiptRecord, fromPeerId, toPeerId } = {}) {
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.RECEIPT,
    assignmentId: assignment?.assignmentId || receiptRecord?.assignmentId,
    jobId: assignment?.jobId || receiptRecord?.jobId,
    fromPeerId,
    toPeerId,
    body: {
      receiptHash: receiptRecord?.receiptHash || null,
      providerId: receiptRecord?.providerId || receiptRecord?.receipt?.providerId || assignment?.providerId || null,
      requesterId: receiptRecord?.requesterId || receiptRecord?.receipt?.requesterId || assignment?.requesterId || null,
      receipt: receiptRecord?.receipt || null,
      outputText: receiptRecord?.outputText || '',
      tokenIds: Array.isArray(receiptRecord?.tokenIds) ? receiptRecord.tokenIds : [],
      outputKind: receiptRecord?.outputKind || receiptRecord?.receipt?.outputKind || null,
      vectorHash: receiptRecord?.vectorHash || receiptRecord?.receipt?.vectorHash || null,
      embeddingDimensions: receiptRecord?.embeddingDimensions || receiptRecord?.receipt?.embedding?.dimensions || null,
      embeddingStats: receiptRecord?.embeddingStats || receiptRecord?.receipt?.embedding?.stats || null,
      transcript: receiptRecord?.transcript || null,
      verifierDecision: receiptRecord?.verifierDecision || null,
      providerPublicKey: receiptRecord?.providerPublicKey || null,
      peerDecision: receiptRecord?.peerDecision || null
    }
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

const randomSalt = () => {
  if (globalThis.crypto?.randomUUID) return `salt_${globalThis.crypto.randomUUID()}`;
  return `salt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

const receiptHashFor = async (receipt) => (
  receipt ? hashJson(receipt) : null
);

export async function buildAssignmentCommitmentPayload({
  assignment,
  providerId,
  execution,
  receipt,
  salt = randomSalt()
} = {}) {
  const outputText = execution?.outputText || '';
  const tokenIds = Array.isArray(execution?.tokenIds) ? execution.tokenIds : [];
  const transcript = execution?.transcript || { outputText, tokenIds };
  const receiptHash = await receiptHashFor(receipt);
  const commitmentBody = {
    schema: 'reploid.pool.commitment/v1',
    jobId: requireString(assignment?.jobId, 'jobId'),
    assignmentId: requireString(assignment?.assignmentId, 'assignmentId'),
    providerId: requireString(providerId || assignment?.providerId, 'providerId'),
    ringAttemptId: assignment?.ringAttemptId || assignment?.ring?.ringAttemptId || null,
    outputHash: receipt?.outputHash || await sha256Hex(outputText),
    tokenIdsHash: receipt?.tokenIdsHash || await hashJson(tokenIds),
    vectorHash: receipt?.vectorHash || execution?.vectorHash || null,
    transcriptHash: receipt?.transcriptHash || await hashJson(transcript),
    salt
  };
  const commitmentHash = await hashJson(commitmentBody);
  return Object.freeze({
    commitRevealVersion: COMMIT_REVEAL_VERSION,
    jobId: commitmentBody.jobId,
    assignmentId: commitmentBody.assignmentId,
    providerId: commitmentBody.providerId,
    policyId: assignment?.policyId || null,
    assignmentAttemptId: assignment?.assignmentAttemptId || null,
    ringAttemptId: commitmentBody.ringAttemptId,
    outputHash: commitmentBody.outputHash,
    tokenIdsHash: commitmentBody.tokenIdsHash,
    vectorHash: commitmentBody.vectorHash,
    transcriptHash: commitmentBody.transcriptHash,
    receiptHash,
    commitmentHash
  });
}

export async function buildAssignmentRevealPayload({
  assignment,
  providerId,
  execution,
  receipt,
  salt,
  commitmentHash
} = {}) {
  const outputText = execution?.outputText || '';
  const tokenIds = Array.isArray(execution?.tokenIds) ? execution.tokenIds : [];
  const transcript = execution?.transcript || { outputText, tokenIds };
  const receiptHash = await receiptHashFor(receipt);
  return Object.freeze({
    commitRevealVersion: COMMIT_REVEAL_VERSION,
    jobId: requireString(assignment?.jobId, 'jobId'),
    assignmentId: requireString(assignment?.assignmentId, 'assignmentId'),
    providerId: requireString(providerId || assignment?.providerId, 'providerId'),
    policyId: assignment?.policyId || null,
    assignmentAttemptId: assignment?.assignmentAttemptId || null,
    ringAttemptId: assignment?.ringAttemptId || assignment?.ring?.ringAttemptId || null,
    commitmentHash: requireString(commitmentHash, 'commitmentHash'),
    salt: requireString(salt, 'salt'),
    outputText,
    tokenIds,
    vectorHash: receipt?.vectorHash || execution?.vectorHash || null,
    transcript,
    receipt,
    receiptHash,
    outputHash: receipt?.outputHash || await sha256Hex(outputText),
    tokenIdsHash: receipt?.tokenIdsHash || await hashJson(tokenIds),
    transcriptHash: receipt?.transcriptHash || await hashJson(transcript)
  });
}

export async function createAckPayload({ assignment, type = P2P_PAYLOAD_TYPES.ACK, fromPeerId, toPeerId, body = {} } = {}) {
  const payload = createP2PPayload({
    type,
    assignmentId: assignment?.assignmentId,
    jobId: assignment?.jobId,
    fromPeerId,
    toPeerId,
    body
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

export default {
  P2P_PAYLOAD_VERSION,
  P2P_PAYLOAD_TYPES,
  COMMIT_REVEAL_VERSION,
  createP2PPayload,
  validateP2PPayload,
  assertP2PPayload,
  hashP2PPayload,
  createPromptPayload,
  createExecutionResultPayload,
  createReceiptPayload,
  buildAssignmentCommitmentPayload,
  buildAssignmentRevealPayload,
  createAckPayload
};
