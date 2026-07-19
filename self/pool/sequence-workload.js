/**
 * @fileoverview Poolday contracts for privacy-bounded biological sequence work.
 */

export const SEQUENCE_REQUEST_SCHEMA = 'reploid.pool.sequence_request/v1';
export const SEQUENCE_RESULT_SCHEMA = 'reploid.pool.sequence_result/v1';

export const SEQUENCE_WORKLOADS = Object.freeze({
  embedding: 'sequence.embedding.v1',
  maskedLogits: 'sequence.masked_logits.v1'
});

export const SEQUENCE_EXECUTION_MODE = 'full_model_browser_sequence';

export const SEQUENCE_ALPHABETS = Object.freeze({
  aminoAcid: 'amino_acid',
  nucleotide: 'nucleotide',
  dna: 'dna',
  rna: 'rna'
});

export const SEQUENCE_DISCLOSURE = 'selected_providers_only';
export const SEQUENCE_PUBLIC_SENSITIVITY = 'public';

const SEQUENCE_WORKLOAD_SET = new Set(Object.values(SEQUENCE_WORKLOADS));
const SEQUENCE_ALPHABET_SET = new Set(Object.values(SEQUENCE_ALPHABETS));
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const isSequenceWorkload = (workload) => SEQUENCE_WORKLOAD_SET.has(workload);

export function normalizeSequenceInput(sequence, alphabet) {
  const normalizedAlphabet = String(alphabet || '').trim();
  if (!SEQUENCE_ALPHABET_SET.has(normalizedAlphabet)) {
    throw new TypeError(`Unsupported sequence alphabet: ${normalizedAlphabet || 'missing'}`);
  }
  const normalized = String(sequence || '').replace(/\s+/g, '').toUpperCase();
  if (!normalized) throw new TypeError('sequence is required');
  const allowed = normalizedAlphabet === SEQUENCE_ALPHABETS.aminoAcid
    ? /^[A-Z*.-]+$/
    : normalizedAlphabet === SEQUENCE_ALPHABETS.dna
      ? /^[ACGTNRYKMSWBDHVX.-]+$/
      : normalizedAlphabet === SEQUENCE_ALPHABETS.rna
        ? /^[ACGUNRYKMSWBDHVX.-]+$/
        : /^[ACGTUNRYKMSWBDHVX.-]+$/;
  if (!allowed.test(normalized)) {
    throw new TypeError(`sequence contains symbols outside the ${normalizedAlphabet} alphabet`);
  }
  return normalized;
}

const normalizeTokenIndices = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((index) => Number.isInteger(index) && index >= 0))].sort((a, b) => a - b);
};

export function normalizeSequenceRequest(request = {}, {
  workload = request.workload,
  sequenceHash = request.sequenceHash,
  sequenceLength = request.sequenceLength
} = {}) {
  const resolvedWorkload = String(workload || '').trim();
  const maskedLogits = resolvedWorkload === SEQUENCE_WORKLOADS.maskedLogits;
  const tokenIndices = normalizeTokenIndices(request.tokenIndices);
  return Object.freeze({
    schema: SEQUENCE_REQUEST_SCHEMA,
    workload: resolvedWorkload,
    alphabet: String(request.alphabet || '').trim(),
    sequenceHash: String(sequenceHash || '').trim(),
    sequenceLength: Number(sequenceLength || 0),
    disclosure: String(request.disclosure || SEQUENCE_DISCLOSURE).trim(),
    sensitivity: String(request.sensitivity || '').trim(),
    includeTokenEmbeddings: request.includeTokenEmbeddings === true,
    includeLogits: maskedLogits,
    tokenIndices,
    topK: maskedLogits ? Number(request.topK || 8) : null
  });
}

export function validateSequenceRequest(request = {}, { model = null } = {}) {
  const reasons = [];
  if (request.schema !== SEQUENCE_REQUEST_SCHEMA) reasons.push('sequence request schema mismatch');
  if (!isSequenceWorkload(request.workload)) reasons.push('sequence workload is not supported');
  if (!SEQUENCE_ALPHABET_SET.has(request.alphabet)) reasons.push('sequence alphabet is not supported');
  if (!SHA256_PATTERN.test(String(request.sequenceHash || ''))) reasons.push('sequenceHash must be a SHA-256 identity');
  if (!Number.isInteger(request.sequenceLength) || request.sequenceLength <= 0) reasons.push('sequenceLength must be a positive integer');
  if (request.disclosure !== SEQUENCE_DISCLOSURE) reasons.push(`sequence disclosure must be ${SEQUENCE_DISCLOSURE}`);
  if (request.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY) {
    reasons.push('public Poolday providers accept only sequences explicitly classified as public');
  }
  if (typeof request.includeTokenEmbeddings !== 'boolean') reasons.push('includeTokenEmbeddings must be boolean');
  if (request.workload === SEQUENCE_WORKLOADS.embedding && request.includeLogits !== false) {
    reasons.push('sequence embedding requests cannot include logits');
  }
  if (request.workload === SEQUENCE_WORKLOADS.maskedLogits) {
    if (request.includeLogits !== true) reasons.push('masked-logits requests must include logits');
    if (!Array.isArray(request.tokenIndices) || request.tokenIndices.length === 0) {
      reasons.push('masked-logits requests require tokenIndices');
    }
    if (!Number.isInteger(request.topK) || request.topK < 1 || request.topK > 64) {
      reasons.push('masked-logits topK must be an integer from 1 through 64');
    }
  }
  if (model) {
    const sequence = model.sequence || model.requirements?.sequence || {};
    if (sequence.alphabet && sequence.alphabet !== request.alphabet) reasons.push('sequence alphabet does not match the selected model');
    if (Number(sequence.maxSequenceLength || 0) > 0 && request.sequenceLength > Number(sequence.maxSequenceLength)) {
      reasons.push('sequence exceeds the selected model maximum length');
    }
    if (request.includeTokenEmbeddings && sequence.tokenEmbeddings !== true) {
      reasons.push('selected model does not expose token embeddings');
    }
    if (request.includeLogits && sequence.logits !== true) reasons.push('selected model does not expose sequence logits');
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

export function agreementFieldForWorkload(workload) {
  if (workload === 'embedding') return 'vectorHash';
  if (isSequenceWorkload(workload)) return 'sequenceResultHash';
  return 'tokenIdsHash';
}

export default {
  SEQUENCE_REQUEST_SCHEMA,
  SEQUENCE_RESULT_SCHEMA,
  SEQUENCE_WORKLOADS,
  SEQUENCE_EXECUTION_MODE,
  SEQUENCE_ALPHABETS,
  SEQUENCE_DISCLOSURE,
  SEQUENCE_PUBLIC_SENSITIVITY,
  isSequenceWorkload,
  normalizeSequenceInput,
  normalizeSequenceRequest,
  validateSequenceRequest,
  agreementFieldForWorkload
};
