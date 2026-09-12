/**
 * @fileoverview Protein investigation, modality separation, and Discovery Contract integration.
 *
 * Design Invariants:
 * 1. Strict Modality Separation: ESM-2 extracts biological representations from amino-acid
 *    sequences on WebGPU. Candidates are retrieved by representation similarity. Structured
 *    annotations and literature records are retrieved solely by accession ID. The cited
 *    document assistant explains literature records in English. Zero cross-modal embedding
 *    projection.
 * 2. Coarse-Grained Distribution: Distributed workloads allocate whole, independent sequences
 *    to peer providers. Layer-sharded execution and token coordination are rejected.
 * 3. Epistemic Uncertainty & Hypotheses: An investigation requires explicit competing
 *    hypotheses and multi-dimensional uncertainty accounting rather than false single-answer
 *    certainty.
 */

import { canonicalize } from './canonical-json.js';
import { hashJson, sha256Hex } from './inference-receipt.js';
import { PROTEIN_UNCERTAINTY_CAMPAIGN_POLICY } from './protein-uncertainty-campaign.js';

export const PROTEIN_REPRESENTATION_IDENTITY_SCHEMA = 'poolday.protein_representation_identity/v1';
export const PROTEIN_INVESTIGATION_SCHEMA = 'poolday.protein_investigation/v1';

export const STANDARD_AMINO_ACIDS = Object.freeze(
  new Set(['A', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'Y'])
);

/**
 * Validates and normalizes an amino acid sequence.
 * @param {string} raw - Raw amino acid sequence string.
 * @returns {string} Normalized uppercase sequence.
 */
export function normalizeAminoAcidSequence(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError('Amino acid sequence must be a string');
  }
  const normalized = raw.replace(/\s+/g, '').toUpperCase();
  if (!normalized.length) {
    throw new TypeError('Amino acid sequence cannot be empty');
  }
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (!STANDARD_AMINO_ACIDS.has(char)) {
      throw new TypeError(`Invalid amino acid character "${char}" at index ${i}`);
    }
  }
  return normalized;
}

/**
 * Computes a deterministic identity for a protein biological representation.
 * Binds the sequence and exact model execution contract.
 */
export async function createProteinRepresentationIdentity({
  sequence,
  modelId = 'esm2-35m',
  modelRevision = '1.0.0',
  targetPlanHash = 'default',
  precision = 'f16',
  poolingMethod = 'mean'
} = {}) {
  const normalizedSequence = normalizeAminoAcidSequence(sequence);
  const sequenceHash = await sha256Hex(normalizedSequence);

  const modelContract = Object.freeze({
    modelId: String(modelId || 'esm2-35m').trim(),
    modelRevision: String(modelRevision || '1.0.0').trim(),
    targetPlanHash: String(targetPlanHash || 'default').trim(),
    precision: String(precision || 'f16').trim(),
    poolingMethod: String(poolingMethod || 'mean').trim()
  });

  const identityPayload = {
    schema: PROTEIN_REPRESENTATION_IDENTITY_SCHEMA,
    sequenceLength: normalizedSequence.length,
    sequenceHash,
    modelContract
  };

  const representationIdentityHash = await hashJson(identityPayload);

  return Object.freeze({
    schema: PROTEIN_REPRESENTATION_IDENTITY_SCHEMA,
    sequence: normalizedSequence,
    sequenceLength: normalizedSequence.length,
    sequenceHash,
    modelContract,
    representationIdentityHash
  });
}

/**
 * Computes cosine similarity between two numerical vectors.
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) {
    throw new TypeError('Vectors must be non-empty and of matching dimension');
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const valA = Number(a[i]);
    const valB = Number(b[i]);
    if (!Number.isFinite(valA) || !Number.isFinite(valB)) {
      throw new TypeError('Vector elements must be finite numbers');
    }
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator <= 0) return 0;
  const score = dot / denominator;
  return Math.max(-1, Math.min(1, score));
}

/**
 * Ranks candidate proteins by representation similarity against a query embedding.
 * Deterministic tie-breaking by accession ascending.
 */
export function rankProteinCandidates({
  queryEmbedding,
  referenceIndex,
  metric = 'cosine',
  topK = 10,
  minScore = -1.0
} = {}) {
  if (!queryEmbedding || typeof queryEmbedding.length !== 'number' || !queryEmbedding.length) {
    throw new TypeError('Valid queryEmbedding is required');
  }
  if (!Array.isArray(referenceIndex) || !referenceIndex.length) {
    return [];
  }
  if (metric !== 'cosine') {
    throw new TypeError(`Unsupported distance metric: ${metric}`);
  }

  const scored = [];
  for (let i = 0; i < referenceIndex.length; i += 1) {
    const candidate = referenceIndex[i];
    if (!candidate || typeof candidate !== 'object') continue;
    const accession = String(candidate.accession || candidate.id || `candidate-${i + 1}`).trim();
    const candidateEmbedding = candidate.embedding;
    if (!candidateEmbedding || candidateEmbedding.length !== queryEmbedding.length) {
      continue;
    }
    const score = cosineSimilarity(queryEmbedding, candidateEmbedding);
    if (score >= minScore) {
      scored.push({
        accession,
        id: String(candidate.id || accession).trim(),
        name: String(candidate.name || candidate.title || '').trim(),
        score,
        sequence: candidate.sequence ? normalizeAminoAcidSequence(candidate.sequence) : null,
        metadata: candidate.metadata ? { ...candidate.metadata } : {}
      });
    }
  }

  scored.sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
    return left.accession.localeCompare(right.accession);
  });

  const ranked = scored.slice(0, Math.max(1, topK));
  return ranked.map((entry, index) => Object.freeze({
    rank: index + 1,
    ...entry
  }));
}

/**
 * Assembles structured UniProt/literature passages matching candidate accessions.
 * Preserves accession binding and enables cited document-answer explanation.
 * ZERO cross-modal embedding projection: Passages are retrieved ONLY by accession ID.
 */
export function assembleProteinLiteraturePassages({
  candidates = [],
  annotationStore = {}
} = {}) {
  if (!Array.isArray(candidates)) {
    throw new TypeError('candidates must be an array');
  }
  const passages = [];
  const getRecordsForAccession = (accession) => {
    if (typeof annotationStore === 'function') {
      return annotationStore(accession);
    }
    if (annotationStore instanceof Map) {
      return annotationStore.get(accession);
    }
    if (annotationStore && typeof annotationStore === 'object') {
      return annotationStore[accession];
    }
    return null;
  };

  for (const candidate of candidates) {
    const accession = candidate.accession;
    if (!accession) continue;
    const rawRecords = getRecordsForAccession(accession);
    if (!rawRecords) continue;
    const records = Array.isArray(rawRecords) ? rawRecords : [rawRecords];

    for (const record of records) {
      let text = '';
      let source = 'UniProtKB';
      let title = '';

      if (typeof record === 'string') {
        text = record.trim();
      } else if (record && typeof record === 'object') {
        source = String(record.source || 'UniProtKB').trim();
        title = String(record.title || record.section || record.feature || '').trim();
        const body = String(record.text || record.summary || record.description || record.body || '').trim();
        text = title ? `${title}: ${body}` : body;
      }

      if (text) {
        passages.push(Object.freeze({
          id: `passage-${passages.length + 1}`,
          accession,
          text: `[Accession: ${accession}] ${text}`,
          source,
          candidateScore: candidate.score ?? null
        }));
      }
    }
  }

  return Object.freeze(passages);
}

/**
 * Partitions a batch of protein sequences into coarse-grained, independent workloads.
 * Distributes entire sequences per peer rather than layer sharding or token slicing.
 */
export function partitionSequenceWorkload({ sequences = [], maxBatchSize = 1 } = {}) {
  if (!Array.isArray(sequences)) {
    throw new TypeError('sequences must be an array');
  }
  const batchSize = Math.max(1, Number(maxBatchSize) || 1);
  const batches = [];
  let current = [];

  for (const entry of sequences) {
    const seq = typeof entry === 'string' ? entry : entry?.sequence;
    const id = typeof entry === 'object' && entry?.id ? entry.id : null;
    const normalized = normalizeAminoAcidSequence(seq);
    current.push({ id, sequence: normalized, length: normalized.length });
    if (current.length >= batchSize) {
      batches.push(Object.freeze(current));
      current = [];
    }
  }
  if (current.length) {
    batches.push(Object.freeze(current));
  }
  return Object.freeze(batches);
}

/**
 * Projects a unified protein investigation state integrating biological representation,
 * candidate ranking, literature evidence, and competing hypotheses.
 */
export async function projectProteinInvestigation({
  question,
  targetSequence,
  modelContract = {},
  competingHypotheses = [],
  candidateMatches = [],
  passages = [],
  uncertaintyDimensions = [],
  candidateActions = []
} = {}) {
  if (typeof question !== 'string' || !question.trim()) {
    throw new TypeError('question must be a non-empty string');
  }
  const targetRepresentation = await createProteinRepresentationIdentity({
    sequence: targetSequence,
    ...modelContract
  });

  const normalizedHypotheses = (Array.isArray(competingHypotheses) ? competingHypotheses : [])
    .map((h, i) => Object.freeze({
      id: String(h.id || `hypothesis-${i + 1}`).trim(),
      statement: String(h.statement || h.claim || '').trim(),
      rationale: String(h.rationale || '').trim(),
      status: String(h.status || 'active').trim(),
      supportedBy: Array.isArray(h.supportedBy) ? [...h.supportedBy] : [],
      contradictedBy: Array.isArray(h.contradictedBy) ? [...h.contradictedBy] : []
    }));

  const defaultDimensions = [
    {
      dimension: 'exact_contract_embedding',
      status: 'verified',
      detail: 'Biological representation extracted under exact ESM-2 WebGPU contract.'
    },
    {
      dimension: 'public_annotation',
      status: passages.length > 0 ? 'available' : 'insufficient_evidence',
      detail: passages.length > 0
        ? `${passages.length} literature passages retrieved by accession ID.`
        : 'No accession-linked literature passages found in public store.'
    },
    {
      dimension: 'independent_reviewer',
      status: 'pending_adjudication',
      detail: 'Competing hypotheses require independent evidence verification.'
    }
  ];

  const mergedDimensions = [...defaultDimensions];
  if (Array.isArray(uncertaintyDimensions)) {
    for (const d of uncertaintyDimensions) {
      if (d && typeof d === 'object' && d.dimension) {
        const existingIdx = mergedDimensions.findIndex(m => m.dimension === d.dimension);
        if (existingIdx >= 0) {
          mergedDimensions[existingIdx] = Object.freeze({ ...mergedDimensions[existingIdx], ...d });
        } else {
          mergedDimensions.push(Object.freeze(d));
        }
      }
    }
  }

  const investigationPayload = {
    schema: PROTEIN_INVESTIGATION_SCHEMA,
    question: question.trim(),
    targetSequenceHash: targetRepresentation.sequenceHash,
    representationIdentityHash: targetRepresentation.representationIdentityHash,
    hypotheses: normalizedHypotheses,
    candidateCount: candidateMatches.length,
    candidateTopAccession: candidateMatches[0]?.accession || null,
    candidateTopScore: candidateMatches[0]?.score ?? null,
    passageCount: passages.length,
    uncertaintyDimensions: mergedDimensions,
    candidateActionCount: candidateActions.length
  };

  const investigationHash = await hashJson(investigationPayload);

  return Object.freeze({
    schema: PROTEIN_INVESTIGATION_SCHEMA,
    investigationHash,
    question: question.trim(),
    targetRepresentation,
    competingHypotheses: Object.freeze(normalizedHypotheses),
    candidateMatches: Object.freeze([...candidateMatches]),
    passages: Object.freeze([...passages]),
    uncertaintyDimensions: Object.freeze(mergedDimensions),
    candidateActions: Object.freeze([...candidateActions]),
    campaignPolicy: PROTEIN_UNCERTAINTY_CAMPAIGN_POLICY
  });
}

/**
 * Validates the invariants of a protein investigation object.
 */
export function validateProteinInvestigation(investigation) {
  const reasons = [];
  if (!investigation || typeof investigation !== 'object') {
    return { ok: false, reasons: ['investigation must be an object'] };
  }
  if (investigation.schema !== PROTEIN_INVESTIGATION_SCHEMA) {
    reasons.push(`schema must be ${PROTEIN_INVESTIGATION_SCHEMA}`);
  }
  if (typeof investigation.investigationHash !== 'string' || !investigation.investigationHash.startsWith('sha256:')) {
    reasons.push('investigationHash must be a valid sha256 prefix string');
  }
  if (!investigation.targetRepresentation || investigation.targetRepresentation.schema !== PROTEIN_REPRESENTATION_IDENTITY_SCHEMA) {
    reasons.push('targetRepresentation must be a valid protein representation identity');
  }
  if (!Array.isArray(investigation.competingHypotheses) || investigation.competingHypotheses.length < 2) {
    reasons.push('competingHypotheses must contain at least 2 competing alternatives to preserve epistemic balance');
  }
  if (!Array.isArray(investigation.candidateMatches)) {
    reasons.push('candidateMatches must be an array');
  }
  if (!Array.isArray(investigation.passages)) {
    reasons.push('passages must be an array');
  }
  return { ok: reasons.length === 0, reasons };
}
