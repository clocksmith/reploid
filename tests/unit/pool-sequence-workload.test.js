import { describe, expect, it } from 'vitest';

import { createDopplerRuntime } from '../../self/pool/doppler-runtime.js';
import {
  buildPoolReceipt,
  createSigningKeyPair,
  hashJson,
  sha256Hex
} from '../../self/pool/inference-receipt.js';
import {
  getPoolModelExecutionMode,
  modelSupportsPoolWorkload
} from '../../self/pool/model-contract.js';
import {
  buildPeerReceiptAgreement,
  createPeerSequencePayload,
  validateSequencePayloadForAssignment
} from '../../self/pool/peer-control-plane.js';
import { createReceiptPayload } from '../../self/pool/p2p-payload.js';
import { createProviderClient } from '../../self/pool/provider-client.js';
import {
  SEQUENCE_ALPHABETS,
  SEQUENCE_EXECUTION_MODE,
  SEQUENCE_RESULT_SCHEMA,
  SEQUENCE_WORKLOADS,
  normalizeSequenceInput,
  normalizeSequenceRequest,
  validateSequenceRequest
} from '../../self/pool/sequence-workload.js';
import { verifyReceipt } from '../../server/pool/verifier.js';
import {
  buildCommitmentHash,
  revealMatchesCommitment
} from '../../server/pool/commit-reveal.js';

const sequenceModel = Object.freeze({
  modelId: 'amplify-120m-f32-sequence-test',
  modelHash: `sha256:${'1'.repeat(64)}`,
  manifestHash: `sha256:${'2'.repeat(64)}`,
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: SEQUENCE_WORKLOADS.embedding,
  workloads: [SEQUENCE_WORKLOADS.embedding, SEQUENCE_WORKLOADS.maskedLogits],
  executionModes: {
    [SEQUENCE_WORKLOADS.embedding]: SEQUENCE_EXECUTION_MODE,
    [SEQUENCE_WORKLOADS.maskedLogits]: SEQUENCE_EXECUTION_MODE
  },
  sequence: {
    alphabet: SEQUENCE_ALPHABETS.aminoAcid,
    maxSequenceLength: 2048,
    pooledEmbedding: true,
    tokenEmbeddings: true,
    logits: true
  }
});

const makeSequenceSession = () => ({
  ...sequenceModel,
  resetGenerationState() {},
  encodeSequence(sequence, options = {}) {
    const tokenCount = sequence.length;
    const vocabSize = 4;
    const logits = new Float32Array(tokenCount * vocabSize);
    for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
      for (let tokenId = 0; tokenId < vocabSize; tokenId += 1) {
        logits[tokenIndex * vocabSize + tokenId] = tokenIndex + tokenId / 10;
      }
    }
    return {
      alphabet: SEQUENCE_ALPHABETS.aminoAcid,
      tokens: Uint32Array.from({ length: tokenCount }, (_, index) => index),
      includedTokenCount: tokenCount,
      pooledEmbedding: new Float32Array([0.25, -0.5, 0.75]),
      tokenEmbeddings: options.includeTokenEmbeddings
        ? new Float32Array(tokenCount * 3).fill(0.125)
        : null,
      logits: options.includeLogits ? logits : null,
      embeddingDim: 3,
      vocabSize
    };
  }
});

const makeRequest = async (sequence, workload = SEQUENCE_WORKLOADS.embedding, overrides = {}) => (
  normalizeSequenceRequest({
    alphabet: SEQUENCE_ALPHABETS.aminoAcid,
    sensitivity: 'public',
    tokenIndices: workload === SEQUENCE_WORKLOADS.maskedLogits ? [1] : [],
    topK: 2,
    ...overrides
  }, {
    workload,
    sequenceHash: await sha256Hex(sequence),
    sequenceLength: sequence.length
  })
);

const makeAssignment = async (sequence, request) => ({
  schema: 'reploid.peer.assignment/v1',
  assignmentId: 'assignment_sequence_1',
  jobId: 'job_sequence_1',
  requesterId: 'requester_sequence_1',
  providerId: 'provider_sequence_1',
  policyId: 'fastest_receipt',
  inputHash: await sha256Hex(sequence),
  workload: request.workload,
  outputKind: request.workload,
  agreementField: 'sequenceResultHash',
  generationConfig: {},
  generationConfigHash: await hashJson({}),
  sequenceRequest: request,
  sequenceRequestHash: await hashJson(request),
  redundancyGroupSize: 1,
  requiredAgreement: 1,
  verificationLevel: 'signed_receipt',
  model: {
    id: sequenceModel.modelId,
    hash: sequenceModel.modelHash,
    manifestHash: sequenceModel.manifestHash,
    runtime: sequenceModel.runtime,
    backend: sequenceModel.backend,
    workload: request.workload,
    executionMode: SEQUENCE_EXECUTION_MODE,
    requirements: {
      ...sequenceModel,
      workload: request.workload,
      executionMode: SEQUENCE_EXECUTION_MODE,
      sequenceRequest: request
    }
  }
});

describe('Poolday biological-sequence workload', () => {
  it('normalizes and validates a public sequence without exposing it in the request contract', async () => {
    const sequence = normalizeSequenceInput(' m k t\n a ', SEQUENCE_ALPHABETS.aminoAcid);
    const request = await makeRequest(sequence);

    expect(sequence).toBe('MKTA');
    expect(validateSequenceRequest(request, { model: sequenceModel })).toEqual({ ok: true, reasons: [] });
    expect(JSON.stringify(request)).not.toContain(sequence);
    expect(request.sequenceHash).toBe(await sha256Hex(sequence));
    expect(modelSupportsPoolWorkload(sequenceModel, SEQUENCE_WORKLOADS.maskedLogits)).toBe(true);
    expect(getPoolModelExecutionMode(sequenceModel, SEQUENCE_WORKLOADS.maskedLogits)).toBe(SEQUENCE_EXECUTION_MODE);
  });

  it('accepts the nucleotide alphabet emitted by Doppler sequence manifests', () => {
    expect(normalizeSequenceInput(' acgtnry ', SEQUENCE_ALPHABETS.nucleotide)).toBe('ACGTNRY');
  });

  it('dispatches sequence embeddings through Doppler and hashes float32 bytes deterministically', async () => {
    const sequence = 'MKTA';
    const request = await makeRequest(sequence, SEQUENCE_WORKLOADS.embedding, {
      includeTokenEmbeddings: true
    });
    const runtime = createDopplerRuntime({
      model: sequenceModel,
      modelSession: makeSequenceSession(),
      runtime: { version: '0.4.11-test' }
    });

    const first = await runtime.encodeSequence({ sequence, request, assignment: { assignmentId: 'one' } });
    const second = await runtime.encodeSequence({ sequence, request, assignment: { assignmentId: 'two' } });

    expect(first.sequenceResult).toMatchObject({
      schema: SEQUENCE_RESULT_SCHEMA,
      workload: SEQUENCE_WORKLOADS.embedding,
      sequenceHash: request.sequenceHash,
      embeddingDim: 3
    });
    expect(first.sequenceResultHash).toBe(second.sequenceResultHash);
    expect(first.sequenceResult.tokenEmbeddingsHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(first.transcript)).not.toContain(sequence);
  });

  it('selects bounded masked-logit candidates without returning the full logits tensor', async () => {
    const sequence = 'MKTA';
    const request = await makeRequest(sequence, SEQUENCE_WORKLOADS.maskedLogits);
    const runtime = createDopplerRuntime({ model: sequenceModel, modelSession: makeSequenceSession() });
    const result = await runtime.encodeSequence({ sequence, request, assignment: { assignmentId: 'masked' } });

    expect(result.sequenceOutput.maskedLogits).toEqual([{
      tokenIndex: 1,
      candidates: [
        { tokenId: 3, score: Math.fround(1.3) },
        { tokenId: 2, score: Math.fround(1.2) }
      ]
    }]);
    expect(result.sequenceResult.maskedLogitsHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.sequenceResult).not.toHaveProperty('logits');
  });

  it('rejects model-alphabet and tensor-shape mismatches before receipt construction', async () => {
    const sequence = 'MKTA';
    const request = await makeRequest(sequence, SEQUENCE_WORKLOADS.embedding, {
      includeTokenEmbeddings: true
    });
    const wrongAlphabet = makeSequenceSession();
    const originalEncode = wrongAlphabet.encodeSequence;
    wrongAlphabet.encodeSequence = (...args) => ({
      ...originalEncode(...args),
      alphabet: SEQUENCE_ALPHABETS.nucleotide
    });
    await expect(createDopplerRuntime({
      model: sequenceModel,
      modelSession: wrongAlphabet
    }).encodeSequence({ sequence, request, assignment: {} })).rejects.toThrow('alphabet nucleotide does not match amino_acid');

    const wrongShape = makeSequenceSession();
    wrongShape.encodeSequence = (...args) => ({
      ...originalEncode(...args),
      tokenEmbeddings: new Float32Array([0.1])
    });
    await expect(createDopplerRuntime({
      model: sequenceModel,
      modelSession: wrongShape
    }).encodeSequence({ sequence, request, assignment: {} })).rejects.toThrow('token embeddings do not match');
  });

  it('binds private WebRTC input, Doppler result, and signed receipt without raw sequence leakage', async () => {
    const sequence = 'MKTA';
    const request = await makeRequest(sequence);
    const assignment = await makeAssignment(sequence, request);
    const inputPayload = await createPeerSequencePayload({
      assignment,
      sequence,
      fromPeerId: assignment.requesterId,
      toPeerId: assignment.providerId
    });
    expect(await validateSequencePayloadForAssignment(inputPayload, assignment)).toMatchObject({ ok: true });

    const runtime = createDopplerRuntime({ model: sequenceModel, modelSession: makeSequenceSession() });
    const provider = createProviderClient({
      providerId: assignment.providerId,
      runtime,
      keyPair: await createSigningKeyPair(),
      identity: null
    });
    const result = await provider.executePeerAssignment(assignment, { inputPayload });

    expect(result.receipt.sequence).toMatchObject({
      sequenceHash: assignment.inputHash,
      requestHash: assignment.sequenceRequestHash,
      resultHash: result.execution.sequenceResultHash
    });
    expect(result.receipt.sequenceResultHash).toBe(result.execution.sequenceResultHash);
    expect(JSON.stringify(result.receipt)).not.toContain(sequence);
    const verifierDecision = await verifyReceipt({
      store: {
        getProvider: async () => ({ publicKey: provider.getPublicKey() })
      },
      assignment,
      receipt: result.receipt,
      outputText: result.execution.outputText,
      tokenIds: result.execution.tokenIds,
      vectorHash: result.execution.vectorHash,
      sequenceResultHash: result.execution.sequenceResultHash,
      sequenceResult: result.execution.sequenceResult,
      transcript: result.execution.transcript
    });
    expect(verifierDecision).toMatchObject({ accepted: true, reasons: [] });

    const receiptPayload = await createReceiptPayload({
      assignment,
      receiptRecord: {
        ...result,
        ...result.execution,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId,
        providerPublicKey: provider.getPublicKey()
      },
      fromPeerId: assignment.providerId,
      toPeerId: assignment.requesterId
    });
    const agreement = await buildPeerReceiptAgreement({
      plan: { jobId: assignment.jobId, assignment, assignments: [assignment] },
      receiptPayloads: [receiptPayload]
    });
    expect(agreement).toMatchObject({
      accepted: true,
      agreementField: 'sequenceResultHash',
      sequenceResultHash: result.execution.sequenceResultHash
    });
  });

  it('fails receipt construction when sequence metadata does not hash to the claimed result', async () => {
    const sequence = 'MKTA';
    const request = await makeRequest(sequence);
    const assignment = await makeAssignment(sequence, request);
    await expect(buildPoolReceipt({
      assignment,
      provider: { device: {} },
      model: assignment.model,
      runtime: { runtime: 'doppler', backend: 'browser-webgpu' },
      execution: {
        outputKind: request.workload,
        sequenceResult: {
          schema: SEQUENCE_RESULT_SCHEMA,
          workload: request.workload,
          sequenceHash: assignment.inputHash
        },
        sequenceResultHash: `sha256:${'f'.repeat(64)}`
      }
    })).rejects.toThrow('sequence result hash mismatch');
  });

  it('binds sequence result identity into ring commit-reveal', () => {
    const reveal = {
      outputHash: `sha256:${'3'.repeat(64)}`,
      tokenIdsHash: `sha256:${'4'.repeat(64)}`,
      vectorHash: `sha256:${'5'.repeat(64)}`,
      sequenceResultHash: `sha256:${'6'.repeat(64)}`,
      transcriptHash: `sha256:${'7'.repeat(64)}`,
      salt: 'sequence-salt'
    };
    const commitment = {
      jobId: 'job_sequence_ring',
      assignmentId: 'assignment_sequence_ring',
      ringAttemptId: 'ring_attempt_sequence',
      providerId: 'provider_sequence_ring'
    };
    commitment.commitmentHash = buildCommitmentHash({ ...commitment, ...reveal });

    expect(revealMatchesCommitment({ commitment, reveal }).ok).toBe(true);
    expect(revealMatchesCommitment({
      commitment,
      reveal: { ...reveal, sequenceResultHash: `sha256:${'8'.repeat(64)}` }
    }).ok).toBe(false);
  });
});
