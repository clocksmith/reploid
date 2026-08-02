/**
 * @fileoverview Pure, identity-only cross-model evidence projection for Poolday.
 *
 * The caller supplies active, already retained research records. This module does
 * not sign, validate, persist, or route them; it only derives a displayable view
 * while keeping model vectors and tokenizer-local values out of cross-model logic.
 */

import { exactModelContractKey } from './model-contract.js';

const unique = (values) => [...new Set(values.filter(Boolean))];
const sortedNumbers = (values) => [...new Set(values.filter(Number.isInteger))].sort((left, right) => left - right);
const stableTaskId = (kind, targetHash) => `task:${kind}:${targetHash}`;

const summarizeModelEvidenceSource = (result) => {
  const evidence = result.sequenceEvidence || {};
  const coordinateSystem = evidence.coordinateSystem || null;
  const residueEmbeddings = Array.isArray(evidence.residueEmbeddings) ? evidence.residueEmbeddings : [];
  const maskedResidueProposals = Array.isArray(evidence.maskedResidueProposals) ? evidence.maskedResidueProposals : [];
  const sequencePositions = coordinateSystem === 'zero_based_sequence_index'
    ? sortedNumbers([
      ...(Array.isArray(evidence.sequenceIndices) ? evidence.sequenceIndices : []),
      ...residueEmbeddings.map((entry) => entry.sequenceIndex),
      ...maskedResidueProposals.map((entry) => entry.sequenceIndex)
    ])
    : [];
  const model = result.modelContract || {};
  return {
    resultHash: result.recordHash,
    receiptHash: result.compute?.receiptHash || null,
    providerId: result.compute?.providerId || null,
    exactModelContractKey: exactModelContractKey(model),
    model: {
      id: model.id || null,
      hash: model.hash || null,
      manifestHash: model.manifestHash || null,
      tokenizerHash: model.tokenizerHash || null,
      runtime: model.runtime || null,
      backend: model.backend || null,
      workload: model.workload || null,
      dimensions: model.dimensions || null
    },
    output: {
      publishedEmbedding: Boolean(result.embedding?.vectorHash),
      sequenceResultHash: evidence.sequenceResultHash || result.compute?.sequenceResultHash || null,
      coordinateSystem,
      residuePositions: sequencePositions,
      residueEmbeddingCount: residueEmbeddings.length,
      maskedResidueProposalCount: maskedResidueProposals.length,
      modelTokenOnlyEvidence: coordinateSystem === 'model_token_index'
    },
    claimBoundary: evidence.claimBoundary
      || 'Representations are model-specific and are not directly comparable across model contracts.'
  };
};

/**
 * Join exact-model evidence through a signed submission, sequence hash, and
 * protein residue positions only. `activeRecords` must already exclude revoked
 * and downstream-invalidated records.
 */
export function buildExactModelEvidenceView(activeRecords = [], submissionHash) {
  const submission = activeRecords.find((record) => (
    record.kind === 'research_submission' && record.recordHash === submissionHash
  ));
  if (!submission) return null;
  const sourcesByContract = new Map();
  for (const result of activeRecords) {
    if (result.kind !== 'research_result'
      || result.submissionHash !== submission.recordHash
      || result.sequenceHash !== submission.sequence?.hash
      || (result.modelContract?.sequence?.alphabet
        && result.modelContract.sequence.alphabet !== submission.sequence?.alphabet)) continue;
    const source = summarizeModelEvidenceSource(result);
    const existing = sourcesByContract.get(source.exactModelContractKey) || {
      exactModelContractKey: source.exactModelContractKey,
      model: source.model,
      resultHashes: [],
      receiptHashes: [],
      providerIds: [],
      outputs: [],
      claimBoundaries: []
    };
    existing.resultHashes.push(source.resultHash);
    if (source.receiptHash) existing.receiptHashes.push(source.receiptHash);
    if (source.providerId) existing.providerIds.push(source.providerId);
    existing.outputs.push(source.output);
    existing.claimBoundaries.push(source.claimBoundary);
    sourcesByContract.set(source.exactModelContractKey, existing);
  }
  const sources = [...sourcesByContract.values()]
    .map((source) => ({
      ...source,
      resultHashes: unique(source.resultHashes).sort(),
      receiptHashes: unique(source.receiptHashes).sort(),
      providerIds: unique(source.providerIds).sort(),
      claimBoundaries: unique(source.claimBoundaries),
      residuePositions: sortedNumbers(source.outputs.flatMap((output) => output.residuePositions)),
      residueEmbeddingCount: source.outputs.reduce((count, output) => count + output.residueEmbeddingCount, 0),
      maskedResidueProposalCount: source.outputs.reduce((count, output) => count + output.maskedResidueProposalCount, 0),
      modelTokenOnlyEvidence: source.outputs.some((output) => output.modelTokenOnlyEvidence)
    }))
    .sort((left, right) => left.exactModelContractKey.localeCompare(right.exactModelContractKey));
  const sharedResiduePositions = [...new Set(sources.flatMap((source) => source.residuePositions))]
    .map((sequenceIndex) => ({
      sequenceIndex,
      sourceCount: sources.filter((source) => source.residuePositions.includes(sequenceIndex)).length
    }))
    .filter((position) => position.sourceCount > 1)
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  const independentModelCount = sources.length;
  const hasResidueEvidence = sources.some((source) => (
    source.residueEmbeddingCount > 0 || source.maskedResidueProposalCount > 0
  ));
  const agreementStatus = independentModelCount < 2
    ? 'insufficient_independent_model_sources'
    : 'not_assessed_without_shared_semantic_observation';
  const disagreementStatus = independentModelCount < 2
    ? 'insufficient_independent_model_sources'
    : 'not_assessed_without_shared_semantic_observation';
  let nextAction;
  if (sources.length === 0) {
    nextAction = {
      actionId: stableTaskId('receipt_backed_compute', submission.recordHash),
      kind: 'receipt_backed_compute',
      targetHash: submission.recordHash,
      status: 'proposed',
      reason: 'No receipt-backed model output is linked to this bounded question.'
    };
  } else if (hasResidueEvidence) {
    nextAction = {
      actionId: stableTaskId('independent_residue_review', submission.recordHash),
      kind: 'independent_residue_review',
      targetHash: submission.recordHash,
      status: 'proposed',
      reason: 'Review the selected protein residue coordinates against the bounded question; masked-token logits remain plausibility evidence, not mutation fitness.'
    };
  } else {
    nextAction = {
      actionId: stableTaskId('independent_model_evidence_review', submission.recordHash),
      kind: 'independent_model_evidence_review',
      targetHash: submission.recordHash,
      status: 'proposed',
      reason: 'Obtain an independent review of the exact-model result before assigning biological meaning to its representation.'
    };
  }
  const uncertainty = [
    ...(independentModelCount < 2 ? [{
      kind: 'independent_model_evidence_missing',
      detail: 'Fewer than two exact model contracts have receipt-backed evidence for this sequence and question.'
    }] : []),
    {
      kind: 'cross_model_vector_comparison_not_permitted',
      detail: 'Embedding vectors and tokenizer-local masked-token IDs remain in separate exact-model coordinate systems.'
    },
    ...(hasResidueEvidence ? [{
      kind: 'masked_residue_plausibility_not_fitness',
      detail: 'Masked-token proposals are model-specific residue plausibility evidence and do not establish mutation fitness.'
    }] : [{
      kind: 'residue_evidence_missing',
      detail: 'No bounded residue evidence is linked to the current model outputs.'
    }])
  ];
  return {
    schema: 'poolday.model_evidence_view/v1',
    submissionHash: submission.recordHash,
    sequenceHash: submission.sequence.hash,
    alphabet: submission.sequence.alphabet,
    modelSources: sources,
    sharedResiduePositions,
    agreement: {
      status: agreementStatus,
      detail: agreementStatus === 'insufficient_independent_model_sources'
        ? 'No cross-model agreement is asserted because only one or no exact model contract has published evidence.'
        : 'No cross-model agreement is asserted: shared residue coordinates do not make vectors or tokenizer-local logits semantically comparable.'
    },
    disagreement: {
      status: disagreementStatus,
      detail: disagreementStatus === 'insufficient_independent_model_sources'
        ? 'No cross-model disagreement is asserted because independent model evidence is incomplete.'
        : 'No cross-model disagreement is asserted without signed, shared semantic observations or adjudicated outcomes.'
    },
    uncertainty,
    nextAction
  };
}

export default { buildExactModelEvidenceView };
