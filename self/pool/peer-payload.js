/**
 * @fileoverview Assignment-bound input payload creation and validation.
 */

import { hashJson, sha256Hex } from './inference-receipt.js';
import { POOLDAY_MODEL_WORKLOADS } from './model-contract.js';
import {
  P2P_PAYLOAD_TYPES,
  createP2PPayload,
  hashP2PPayload,
  validateP2PPayload
} from './p2p-payload.js';
import {
  isSequenceWorkload,
  normalizeSequenceInput,
  validateSequenceRequest
} from './sequence-workload.js';
import { requirePeerString } from './peer-protocol.js';

export async function createPeerPromptPayload({ assignment, prompt, fromPeerId, toPeerId } = {}) {
  const resolvedPrompt = requirePeerString(prompt, 'prompt');
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.PROMPT,
    assignmentId: assignment?.assignmentId,
    jobId: assignment?.jobId,
    fromPeerId,
    toPeerId,
    body: {
      prompt: resolvedPrompt,
      inputHash: await sha256Hex(resolvedPrompt),
      generationConfigHash: assignment?.generationConfigHash || null,
      policyId: assignment?.policyId || null,
      intentHash: assignment?.intentHash || null,
      model: assignment?.model || null
    }
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

export async function createPeerSequencePayload({ assignment, sequence, fromPeerId, toPeerId } = {}) {
  const request = assignment?.sequenceRequest || assignment?.model?.requirements?.sequenceRequest || null;
  const requestValidation = validateSequenceRequest(request || {});
  if (!requestValidation.ok) throw new Error(requestValidation.reasons.join('; '));
  const resolvedSequence = normalizeSequenceInput(sequence, request.alphabet);
  const inputHash = await sha256Hex(resolvedSequence);
  if (inputHash !== request.sequenceHash || (assignment?.inputHash && inputHash !== assignment.inputHash)) {
    throw new Error('sequence inputHash mismatch');
  }
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.INPUT,
    assignmentId: assignment?.assignmentId,
    jobId: assignment?.jobId,
    fromPeerId,
    toPeerId,
    body: {
      inputKind: 'sequence',
      sequence: resolvedSequence,
      inputHash,
      sequenceRequest: request,
      generationConfigHash: assignment?.generationConfigHash || null,
      policyId: assignment?.policyId || null,
      intentHash: assignment?.intentHash || null,
      model: assignment?.model || null
    }
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

export async function validatePromptPayloadForAssignment(payload = {}, assignment = {}) {
  const reasons = [];
  const validation = validateP2PPayload(payload);
  reasons.push(...validation.reasons);
  if (payload.type !== P2P_PAYLOAD_TYPES.PROMPT) reasons.push('payload type must be prompt');
  if (payload.assignmentId !== assignment.assignmentId) reasons.push('assignmentId mismatch');
  if (payload.jobId !== assignment.jobId) reasons.push('jobId mismatch');
  if (!payload.body?.prompt) reasons.push('prompt is required');
  const promptHash = payload.body?.prompt ? await sha256Hex(payload.body.prompt) : null;
  if (payload.body?.inputHash !== promptHash) reasons.push('prompt payload inputHash mismatch');
  if (assignment.inputHash && payload.body?.inputHash !== assignment.inputHash) reasons.push('assignment inputHash mismatch');
  if (assignment.generationConfigHash && payload.body?.generationConfigHash !== assignment.generationConfigHash) {
    reasons.push('generationConfigHash mismatch');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    prompt: payload.body?.prompt || null,
    inputHash: payload.body?.inputHash || null
  };
}

export async function validateSequencePayloadForAssignment(payload = {}, assignment = {}) {
  const reasons = [];
  const validation = validateP2PPayload(payload);
  reasons.push(...validation.reasons);
  if (payload.type !== P2P_PAYLOAD_TYPES.INPUT) reasons.push('payload type must be input');
  if (payload.assignmentId !== assignment.assignmentId) reasons.push('assignmentId mismatch');
  if (payload.jobId !== assignment.jobId) reasons.push('jobId mismatch');
  if (payload.body?.inputKind !== 'sequence') reasons.push('inputKind must be sequence');
  if (!payload.body?.sequence) reasons.push('sequence is required');
  const request = assignment.sequenceRequest || assignment.model?.requirements?.sequenceRequest || null;
  const requestValidation = validateSequenceRequest(request || {});
  reasons.push(...requestValidation.reasons);
  let sequence = null;
  try {
    sequence = payload.body?.sequence ? normalizeSequenceInput(payload.body.sequence, request?.alphabet) : null;
  } catch (error) {
    reasons.push(error.message);
  }
  const inputHash = sequence ? await sha256Hex(sequence) : null;
  if (payload.body?.inputHash !== inputHash) reasons.push('sequence payload inputHash mismatch');
  if (assignment.inputHash && payload.body?.inputHash !== assignment.inputHash) reasons.push('assignment inputHash mismatch');
  if (request?.sequenceHash && payload.body?.inputHash !== request.sequenceHash) reasons.push('sequence request hash mismatch');
  if (request?.sequenceLength && sequence?.length !== request.sequenceLength) reasons.push('sequence length mismatch');
  if (await hashJson(payload.body?.sequenceRequest || null) !== await hashJson(request)) reasons.push('sequence request mismatch');
  if (assignment.generationConfigHash && payload.body?.generationConfigHash !== assignment.generationConfigHash) {
    reasons.push('generationConfigHash mismatch');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    inputKind: 'sequence',
    sequence,
    inputHash
  };
}

export async function validateInputPayloadForAssignment(payload = {}, assignment = {}) {
  const workload = assignment.workload
    || assignment.model?.workload
    || assignment.model?.requirements?.workload
    || POOLDAY_MODEL_WORKLOADS.textGeneration;
  if (isSequenceWorkload(workload)) return validateSequencePayloadForAssignment(payload, assignment);
  const result = await validatePromptPayloadForAssignment(payload, assignment);
  return {
    ...result,
    inputKind: 'prompt'
  };
}
