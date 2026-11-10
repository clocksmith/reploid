/** Exact-contract embedding similarity, accepted-evidence reranking and deterministic clustering. */
import {
  RESEARCH_RECORD_KINDS
} from '../evidence-record-contract.js';
import {
  EVIDENCE_POLICY
} from './primitives.js';
import {
  acceptedReviewHashes,
  activeResearchRecords
} from './review-state.js';
import {
  exactModelContractKey
} from '../../../../shared/pool/model-contract.js';

const SIMILARITY = EVIDENCE_POLICY.similarity;

const modelCompatibilityKey = (record = {}) => {
  const model = record.modelContract || {};
  // Vectors have meaning only within the complete model contract. A model id,
  // manifest, and dimension match is insufficient when tokenizer, artifacts,
  // execution graph, runtime policy, license, or claim boundary differs.
  return exactModelContractKey(model);
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

const claimsForTarget = (records, targetHash) => records.filter((record) => (
  record.kind === RESEARCH_RECORD_KINDS.claim && record.targetHash === targetHash
));

export function findSimilarSequences(records = [], targetHash, { limit = SIMILARITY.defaultLimit } = {}) {
  const active = activeResearchRecords(records);
  const target = active.find((record) => record.recordHash === targetHash && record.embedding);
  if (!target) return [];
  const accepted = acceptedReviewHashes(records);
  return active
    .filter((record) => record.recordHash !== targetHash && embeddingsAreCompatible(target, record))
    .map((record) => {
      const annotations = [
        ...claimsForTarget(records, record.recordHash),
        ...claimsForTarget(records, record.submissionHash)
      ]
        .filter((claim) => claim.claim.kind !== 'review_decision');
      const acceptedAnnotations = annotations.filter((claim) => accepted.has(claim.recordHash));
      const score = cosineSimilarity(target.embedding.values, record.embedding.values);
      const evidenceBoost = acceptedAnnotations.reduce((sum, claim) => sum + claim.claim.confidence, 0)
        * SIMILARITY.acceptedClaimConfidenceBoost;
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

export function clusterCompatibleResults(records = [], { threshold = SIMILARITY.clusterThreshold } = {}) {
  const results = activeResearchRecords(records).filter((record) => record.kind === RESEARCH_RECORD_KINDS.result && record.embedding?.values);
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
