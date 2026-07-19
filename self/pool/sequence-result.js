/**
 * @fileoverview Fail-closed reduction of Doppler biological-sequence outputs.
 */

import { hashJson, sha256Hex } from './inference-receipt.js';
import {
  SEQUENCE_RESULT_SCHEMA,
  SEQUENCE_WORKLOADS
} from './sequence-workload.js';

export const sequenceMethodName = (candidate) => (
  candidate && typeof candidate.encodeSequence === 'function'
    ? 'encodeSequence'
    : null
);

const normalizeFloat32Values = (value) => {
  if (!(ArrayBuffer.isView(value) || Array.isArray(value))) return [];
  return Array.from(value, (item) => Math.fround(Number(item)));
};

const assertFiniteValues = (values, label) => {
  const badIndex = values.findIndex((value) => !Number.isFinite(value));
  if (badIndex >= 0) throw new Error(`${label} contains a non-finite value at index ${badIndex}`);
};

const summarizeValues = (values) => {
  let sumSquares = 0;
  for (const value of values) sumSquares += value * value;
  return {
    dimensions: values.length,
    nonFiniteCount: 0,
    l2Norm: Number(Math.sqrt(sumSquares).toFixed(6))
  };
};

const canonicalFloat32Bytes = (values) => {
  const output = new Uint8Array(values.length * 4);
  const view = new DataView(output.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * 4, values[index], true);
  }
  return output;
};

const hashFloat32Values = (values) => sha256Hex(canonicalFloat32Bytes(values));

const lessLogit = (left, right) => (
  left.score < right.score || (left.score === right.score && left.tokenId > right.tokenId)
);

const siftUp = (heap, startIndex) => {
  let index = startIndex;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!lessLogit(heap[index], heap[parent])) return;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
};

const siftDown = (heap) => {
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && lessLogit(heap[left], heap[smallest])) smallest = left;
    if (right < heap.length && lessLogit(heap[right], heap[smallest])) smallest = right;
    if (smallest === index) return;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
};

const topKLogits = (logits, tokenIndex, vocabSize, topK) => {
  const offset = tokenIndex * vocabSize;
  if (offset < 0 || offset + vocabSize > logits.length) {
    throw new Error(`sequence token index ${tokenIndex} is outside the logits tensor`);
  }
  const heap = [];
  for (let tokenId = 0; tokenId < vocabSize; tokenId += 1) {
    const score = Math.fround(Number(logits[offset + tokenId]));
    if (!Number.isFinite(score)) {
      throw new Error(`sequence logits contain a non-finite value at token ${tokenIndex}`);
    }
    const candidate = { tokenId, score };
    if (heap.length < topK) {
      heap.push(candidate);
      siftUp(heap, heap.length - 1);
    } else if (lessLogit(heap[0], candidate)) {
      heap[0] = candidate;
      siftDown(heap);
    }
  }
  return heap.sort((left, right) => right.score - left.score || left.tokenId - right.tokenId);
};

const normalizeTokens = (value, vocabSize) => {
  if (!(ArrayBuffer.isView(value) || Array.isArray(value))) {
    throw new Error('Doppler sequence result did not include tokens');
  }
  const tokens = Array.from(value, Number);
  if (tokens.length === 0) throw new Error('Doppler sequence result included no tokens');
  const invalidIndex = tokens.findIndex((token) => (
    !Number.isInteger(token) || token < 0 || token >= vocabSize
  ));
  if (invalidIndex >= 0) throw new Error(`Doppler sequence result contains an invalid token at index ${invalidIndex}`);
  return tokens;
};

const positiveInteger = (value, label) => {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`Doppler sequence result ${label} must be a positive integer`);
  }
  return normalized;
};

export async function callDopplerSequence(session, sequence, request, assignment) {
  if (!sequenceMethodName(session)) {
    throw new Error('Doppler public handle does not expose encodeSequence');
  }
  return session.encodeSequence(sequence, {
    assignment,
    includeTokenEmbeddings: request.includeTokenEmbeddings,
    includeLogits: request.workload === SEQUENCE_WORKLOADS.maskedLogits
  });
}

export async function reduceDopplerSequenceResult(result, request) {
  if (!result || typeof result !== 'object') throw new Error('Doppler sequence result is required');
  if (result.alphabet !== request.alphabet) {
    throw new Error(`Doppler sequence result alphabet ${result.alphabet || 'missing'} does not match ${request.alphabet}`);
  }

  const embeddingDim = positiveInteger(result.embeddingDim, 'embeddingDim');
  const vocabSize = positiveInteger(result.vocabSize, 'vocabSize');
  const tokens = normalizeTokens(result.tokens, vocabSize);
  const includedTokenCount = Number(result.includedTokenCount);
  if (!Number.isInteger(includedTokenCount) || includedTokenCount < 0 || includedTokenCount > tokens.length) {
    throw new Error('Doppler sequence result includedTokenCount is outside the token range');
  }

  const pooledEmbedding = normalizeFloat32Values(result.pooledEmbedding);
  if (pooledEmbedding.length !== embeddingDim) {
    throw new Error(`Doppler sequence pooled embedding length ${pooledEmbedding.length} does not match embeddingDim ${embeddingDim}`);
  }
  assertFiniteValues(pooledEmbedding, 'Doppler sequence pooled embedding');

  const tokenEmbeddings = request.includeTokenEmbeddings
    ? normalizeFloat32Values(result.tokenEmbeddings)
    : [];
  if (request.includeTokenEmbeddings && tokenEmbeddings.length !== tokens.length * embeddingDim) {
    throw new Error('Doppler sequence token embeddings do not match token count and embeddingDim');
  }
  assertFiniteValues(tokenEmbeddings, 'Doppler sequence token embeddings');

  let maskedLogits = [];
  if (request.workload === SEQUENCE_WORKLOADS.maskedLogits) {
    if (!(ArrayBuffer.isView(result.logits) || Array.isArray(result.logits))) {
      throw new Error('Doppler sequence result did not include requested logits');
    }
    if (result.logits.length !== tokens.length * vocabSize) {
      throw new Error('Doppler sequence logits do not match token count and vocabSize');
    }
    maskedLogits = request.tokenIndices.map((tokenIndex) => ({
      tokenIndex,
      candidates: topKLogits(result.logits, tokenIndex, vocabSize, request.topK)
    }));
  }

  const pooledEmbeddingHash = await hashFloat32Values(pooledEmbedding);
  const tokenEmbeddingsHash = tokenEmbeddings.length > 0
    ? await hashFloat32Values(tokenEmbeddings)
    : null;
  const maskedLogitsHash = maskedLogits.length > 0 ? await hashJson(maskedLogits) : null;
  const sequenceResult = {
    schema: SEQUENCE_RESULT_SCHEMA,
    workload: request.workload,
    alphabet: request.alphabet,
    sequenceHash: request.sequenceHash,
    sequenceLength: request.sequenceLength,
    tokenCount: tokens.length,
    tokensHash: await hashJson(tokens),
    includedTokenCount,
    embeddingDim,
    vocabSize,
    pooledEmbeddingHash,
    tokenEmbeddingsHash,
    maskedLogitsHash,
    tokenIndices: request.tokenIndices,
    topK: request.topK
  };
  return {
    tokens,
    pooledEmbedding,
    tokenEmbeddings,
    maskedLogits,
    pooledEmbeddingHash,
    pooledStats: summarizeValues(pooledEmbedding),
    sequenceResult,
    sequenceResultHash: await hashJson(sequenceResult)
  };
}

export default {
  sequenceMethodName,
  callDopplerSequence,
  reduceDopplerSequenceResult
};
