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
  nucleotide: 'nucleotide'
});

export const SEQUENCE_DISCLOSURE = 'selected_providers_only';
export const SEQUENCE_PUBLIC_SENSITIVITY = 'public';
export const MAX_PUBLIC_PROTEIN_SEQUENCE_LENGTH = 1024;
export const MAX_PUBLIC_NUCLEOTIDE_SEQUENCE_LENGTH = 2048;
export const MAX_SEQUENCE_POSITIONS = 64;

export const SEQUENCE_ALPHABET_POLICIES = Object.freeze({
  [SEQUENCE_ALPHABETS.aminoAcid]: Object.freeze({
    alphabet: SEQUENCE_ALPHABETS.aminoAcid,
    label: 'protein',
    canonicalSymbols: 'ACDEFGHIKLMNPQRSTVWY',
    ambiguitySymbols: Object.freeze([]),
    maxPublicSequenceLength: MAX_PUBLIC_PROTEIN_SEQUENCE_LENGTH,
    normalization: 'remove_ascii_whitespace_and_uppercase',
    ambiguityPolicy: 'reject'
  }),
  [SEQUENCE_ALPHABETS.nucleotide]: Object.freeze({
    alphabet: SEQUENCE_ALPHABETS.nucleotide,
    label: 'DNA',
    canonicalSymbols: 'ACGT',
    ambiguitySymbols: Object.freeze(['N']),
    maxPublicSequenceLength: MAX_PUBLIC_NUCLEOTIDE_SEQUENCE_LENGTH,
    normalization: 'remove_ascii_whitespace_and_uppercase',
    ambiguityPolicy: 'preserve_n_without_imputation'
  })
});

const SEQUENCE_WORKLOAD_SET = new Set(Object.values(SEQUENCE_WORKLOADS));
const SEQUENCE_ALPHABET_SET = new Set(Object.values(SEQUENCE_ALPHABETS));
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CANONICAL_AMINO_ACID_PATTERN = /^[ACDEFGHIKLMNPQRSTVWY]+$/;
const ADMITTED_NUCLEOTIDE_PATTERN = /^[ACGTN]+$/;

export const isSequenceWorkload = (workload) => SEQUENCE_WORKLOAD_SET.has(workload);
export const isSequenceAlphabet = (alphabet) => SEQUENCE_ALPHABET_SET.has(alphabet);

export const getSequenceAlphabetPolicy = (alphabet) => (
  SEQUENCE_ALPHABET_POLICIES[String(alphabet || '').trim()] || null
);

export const getMaxPublicSequenceLength = (alphabet) => (
  getSequenceAlphabetPolicy(alphabet)?.maxPublicSequenceLength || null
);

export function normalizeSequenceInput(sequence, alphabet) {
  const normalizedAlphabet = String(alphabet || '').trim();
  if (!SEQUENCE_ALPHABET_SET.has(normalizedAlphabet)) {
    throw new TypeError(`Unsupported sequence alphabet: ${normalizedAlphabet || 'missing'}`);
  }
  const normalized = String(sequence || '').replace(/\s+/g, '').toUpperCase();
  if (!normalized) throw new TypeError('sequence is required');
  if (normalizedAlphabet === SEQUENCE_ALPHABETS.aminoAcid
    && !CANONICAL_AMINO_ACID_PATTERN.test(normalized)) {
    throw new TypeError('sequence contains non-canonical amino-acid residues');
  }
  if (normalizedAlphabet === SEQUENCE_ALPHABETS.nucleotide
    && !ADMITTED_NUCLEOTIDE_PATTERN.test(normalized)) {
    throw new TypeError('sequence contains nucleotide symbols outside A, C, G, T, and N');
  }
  return normalized;
}

const normalizeTokenIndices = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((index) => Number.isInteger(index) && index >= 0))].sort((a, b) => a - b);
};

const sequenceCoordinateContract = (model = {}) => (
  model.sequence?.coordinates || model.requirements?.sequence?.coordinates || {}
);

const normalizeSequencePositions = (request = {}, model = null) => {
  const coordinates = sequenceCoordinateContract(model || {});
  const prefixTokens = Number(coordinates.prefixTokens || 0);
  const oneTokenPerSymbol = coordinates.mapping === 'one_token_per_sequence_symbol';
  const requestedSequenceIndices = normalizeTokenIndices(request.sequenceIndices || request.residueIndices);
  const requestedTokenIndices = normalizeTokenIndices(request.tokenIndices);
  const sequenceIndices = requestedSequenceIndices.length > 0
    ? requestedSequenceIndices
    : (oneTokenPerSymbol
        ? requestedTokenIndices
          .map((index) => index - prefixTokens)
          .filter((index) => index >= 0)
        : []);
  const tokenIndices = requestedSequenceIndices.length > 0 && oneTokenPerSymbol
    ? requestedSequenceIndices.map((index) => index + prefixTokens)
    : requestedTokenIndices;
  return {
    coordinateSystem: oneTokenPerSymbol
      ? 'zero_based_sequence_index'
      : 'model_token_index',
    sequenceIndices: sequenceIndices.slice(0, MAX_SEQUENCE_POSITIONS),
    tokenIndices: tokenIndices.slice(0, MAX_SEQUENCE_POSITIONS)
  };
};

export function normalizeSequenceRequest(request = {}, {
  workload = request.workload,
  sequenceHash = request.sequenceHash,
  sequenceLength = request.sequenceLength,
  model = null
} = {}) {
  const resolvedWorkload = String(workload || '').trim();
  const maskedLogits = resolvedWorkload === SEQUENCE_WORKLOADS.maskedLogits;
  const positions = normalizeSequencePositions(request, model);
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
    coordinateSystem: positions.coordinateSystem,
    sequenceIndices: Object.freeze(positions.sequenceIndices),
    tokenIndices: Object.freeze(positions.tokenIndices),
    topK: maskedLogits ? Number(request.topK || 8) : null
  });
}

export function validateSequenceRequest(request = {}, { model = null } = {}) {
  const reasons = [];
  if (request.schema !== SEQUENCE_REQUEST_SCHEMA) reasons.push('sequence request schema mismatch');
  if (!isSequenceWorkload(request.workload)) reasons.push('sequence workload is not supported');
  if (!isSequenceAlphabet(request.alphabet)) reasons.push('sequence alphabet is not supported');
  if (!SHA256_PATTERN.test(String(request.sequenceHash || ''))) reasons.push('sequenceHash must be a SHA-256 identity');
  if (!Number.isInteger(request.sequenceLength) || request.sequenceLength <= 0) reasons.push('sequenceLength must be a positive integer');
  const alphabetPolicy = getSequenceAlphabetPolicy(request.alphabet);
  if (alphabetPolicy && request.sequenceLength > alphabetPolicy.maxPublicSequenceLength) {
    reasons.push(`sequence exceeds the maximum public ${alphabetPolicy.label} length (${alphabetPolicy.maxPublicSequenceLength})`);
  }
  if (request.disclosure !== SEQUENCE_DISCLOSURE) reasons.push(`sequence disclosure must be ${SEQUENCE_DISCLOSURE}`);
  if (request.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY) {
    reasons.push('public Poolday providers accept only sequences explicitly classified as public');
  }
  if (typeof request.includeTokenEmbeddings !== 'boolean') reasons.push('includeTokenEmbeddings must be boolean');
  if (!['zero_based_sequence_index', 'model_token_index'].includes(request.coordinateSystem)) {
    reasons.push('sequence coordinate system is not supported');
  }
  if (!Array.isArray(request.sequenceIndices)
    || request.sequenceIndices.length > MAX_SEQUENCE_POSITIONS
    || request.sequenceIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= request.sequenceLength)) {
    reasons.push(`sequenceIndices must contain at most ${MAX_SEQUENCE_POSITIONS} in-range sequence positions`);
  }
  if (!Array.isArray(request.tokenIndices)
    || request.tokenIndices.length > MAX_SEQUENCE_POSITIONS
    || request.tokenIndices.some((index) => !Number.isInteger(index) || index < 0)) {
    reasons.push(`tokenIndices must contain at most ${MAX_SEQUENCE_POSITIONS} non-negative model-token positions`);
  }
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
    const coordinates = sequence.coordinates || {};
    if (request.coordinateSystem === 'zero_based_sequence_index'
      && coordinates.mapping !== 'one_token_per_sequence_symbol') {
      reasons.push('selected model does not declare one-token-per-sequence-symbol coordinates');
    }
    if (request.sequenceIndices.length !== request.tokenIndices.length
      && request.coordinateSystem === 'zero_based_sequence_index') {
      reasons.push('sequence and model-token position counts do not match');
    }
    const configuredLimits = [
      Number(sequence.maxSequenceLength || 0),
      Number(model.contextLength || model.requirements?.contextLength || 0)
    ].filter((limit) => Number.isInteger(limit) && limit > 0);
    const maximumSequenceLength = configuredLimits.length > 0 ? Math.min(...configuredLimits) : null;
    if (maximumSequenceLength && request.sequenceLength > maximumSequenceLength) {
      reasons.push(`sequence exceeds the selected model maximum length (${maximumSequenceLength})`);
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
  MAX_PUBLIC_PROTEIN_SEQUENCE_LENGTH,
  MAX_PUBLIC_NUCLEOTIDE_SEQUENCE_LENGTH,
  MAX_SEQUENCE_POSITIONS,
  SEQUENCE_ALPHABET_POLICIES,
  isSequenceWorkload,
  isSequenceAlphabet,
  getSequenceAlphabetPolicy,
  getMaxPublicSequenceLength,
  normalizeSequenceInput,
  normalizeSequenceRequest,
  validateSequenceRequest,
  agreementFieldForWorkload
};
