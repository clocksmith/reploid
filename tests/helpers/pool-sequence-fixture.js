/**
 * @fileoverview Canonical public-protein fixtures for Poolday contract tests.
 *
 * These helpers deliberately build receipt metadata through the same reducer
 * used by browser execution, so test receipts cannot drift back to the retired
 * prompt/token-only contract.
 */

import { hashJson, sha256Hex } from '../../self/pool/inference-receipt.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { resolveDopplerExecutionContract } from '../../self/config/doppler-execution-contracts.js';
import { reduceDopplerSequenceResult } from '../../self/pool/sequence-result.js';
import {
  SEQUENCE_ALPHABETS,
  SEQUENCE_WORKLOADS,
  normalizeSequenceRequest
} from '../../self/pool/sequence-workload.js';

export const TEST_PUBLIC_PROTEIN_SEQUENCE = 'MKTAYIAKQRQISFVKSHFSRQ';

// Synthetic execution evidence for protocol tests, never model qualification.
export async function makeSyntheticSequenceReceipt({ assignment, sequence, output }) {
  const binding = assignment?.model?.requirements?.executablePack || assignment?.model?.executablePack;
  if (!binding) return null;
  const contract = resolveDopplerExecutionContract(binding.schema);
  const payload = {
    schema: contract.sequenceReceiptSchema,
    [contract.receiptIdentity]: Object.fromEntries(contract.identityFields.map(key => [key, binding[key]])),
    targetPlanDigest: binding.acceptedTargetPlanDigests[0], operation: 'encodeSequence',
    artifactReceipts: binding.artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })),
    assignmentHash: await hashDopplerEvidence(assignment),
    inputHash: await hashDopplerEvidence({ sequence, options: { assignment,
      includeTokenEmbeddings: assignment.sequenceRequest?.includeTokenEmbeddings === true, includeLogits: false } }),
    outputHash: await hashDopplerEvidence(output)
  };
  return { ...payload, receiptDigest: await hashDopplerEvidence(payload) };
}

export async function makePublicProteinRequest(sequence = TEST_PUBLIC_PROTEIN_SEQUENCE, overrides = {}) {
  return normalizeSequenceRequest({
    alphabet: SEQUENCE_ALPHABETS.aminoAcid,
    sensitivity: 'public',
    includeTokenEmbeddings: false,
    includeLogits: false,
    ...overrides
  }, {
    workload: overrides.workload || SEQUENCE_WORKLOADS.embedding,
    sequenceHash: await sha256Hex(sequence),
    sequenceLength: sequence.length
  });
}

export async function makePublicProteinJobFields(sequence = TEST_PUBLIC_PROTEIN_SEQUENCE, overrides = {}) {
  const sequenceRequest = await makePublicProteinRequest(sequence, overrides);
  return {
    inputHash: sequenceRequest.sequenceHash,
    sequenceRequest,
    sequenceRequestHash: await hashJson(sequenceRequest)
  };
}

export async function makeSequenceExecution({
  assignment,
  sequence = TEST_PUBLIC_PROTEIN_SEQUENCE,
  pooledEmbedding = [0.25, -0.5, 0.75],
  timing = {}
} = {}) {
  const request = assignment?.sequenceRequest;
  if (!request) throw new Error('assignment sequenceRequest is required');
  const reduced = await reduceDopplerSequenceResult({
    alphabet: request.alphabet,
    tokens: Uint32Array.from({ length: sequence.length }, (_, index) => index % 33),
    includedTokenCount: sequence.length,
    pooledEmbedding: Float32Array.from(pooledEmbedding),
    tokenEmbeddings: null,
    logits: null,
    embeddingDim: pooledEmbedding.length,
    vocabSize: 33
  }, request);
  return {
    dopplerProviderReceipt: await makeSyntheticSequenceReceipt({ assignment, sequence, output: reduced.sequenceResult }),
    outputKind: request.workload,
    outputText: '',
    tokenIds: [],
    vectorHash: reduced.pooledEmbeddingHash,
    sequenceResultHash: reduced.sequenceResultHash,
    sequenceResult: reduced.sequenceResult,
    sequenceOutput: {
      pooledEmbedding: reduced.pooledEmbedding,
      tokenEmbeddings: null,
      maskedLogits: reduced.maskedLogits
    },
    embeddingDimensions: reduced.pooledEmbedding.length,
    embeddingStats: reduced.pooledStats,
    transcript: {
      outputKind: request.workload,
      sequenceResultHash: reduced.sequenceResultHash,
      sequenceResult: reduced.sequenceResult
    },
    tokenCounts: {
      input: sequence.length,
      output: 0
    },
    timing,
    status: 'completed'
  };
}
