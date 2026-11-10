/** Signed adjudication experiments and evaluations, candidate actions, checkpoints, sequence links and revocations. */
import {
  ADJUDICATION_EVALUATION_VERSION,
  ADJUDICATION_EXPERIMENT_VERSION,
  RESEARCH_RECORD_KINDS,
  SEQUENCE_LINK_COORDINATE_SYSTEMS,
  SEQUENCE_LINK_STRANDS,
  TRANSLATION_READING_FRAMES,
  normalizeRoomId
} from '../evidence-record-contract.js';
import {
  clone,
  compactText,
  isSha256,
  requireHash,
  requiredInteger,
  sameStringSet,
  withContentHash
} from './primitives.js';
import {
  adjudicationMetricResult,
  assessAdjudicationExperiment,
  normalizeAdjudicationExperimentContract
} from './adjudication-normalization.js';
import {
  normalizeDiscoveryCheckpoint
} from './discovery-normalization.js';
import {
  normalizeReferenceIdentity
} from './scientific-normalization.js';
import {
  createAuthor,
  signResearchRecord
} from './record-signing.js';
import {
  normalizeAdjudicationNorthStarEvidence
} from '../adjudication-north-star.js';
import {
  normalizeDiscoveryCandidateAction
} from '../discovery-candidate-action.js';

export async function createSignedAdjudicationExperiment({
  identity,
  roomId,
  target,
  baseline,
  candidate,
  cohort,
  outcomeBoundary,
  comparison,
  evaluator,
  metrics,
  measurementPlan,
  northStarPolicy,
  successPolicy,
  resolution,
  frozenAt = new Date().toISOString(),
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.adjudicationExperiment);
  if (createdAt !== frozenAt) {
    throw new TypeError('adjudication experiment record creation and policy freeze timestamps must match');
  }
  const experiment = await normalizeAdjudicationExperimentContract({
    schema: ADJUDICATION_EXPERIMENT_VERSION,
    target,
    baseline,
    candidate,
    cohort,
    outcomeBoundary,
    comparison,
    evaluator,
    metrics,
    measurementPlan,
    northStarPolicy,
    successPolicy,
    resolution,
    frozenAt
  });
  return signResearchRecord(RESEARCH_RECORD_KINDS.adjudicationExperiment, { roomId, createdAt, author, privateKey }, async () => ({
    experiment
  }));
}

export async function createSignedAdjudicationEvaluation({
  identity,
  roomId,
  experiment,
  resultManifest,
  metricResults,
  northStarEvidence,
  regressionCount = 0,
  missingCaseCount = 0,
  disagreementSummary,
  failureAnalysis,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.adjudicationEvaluation);
  if (experiment?.kind !== RESEARCH_RECORD_KINDS.adjudicationExperiment
    || !isSha256(experiment.recordHash)) {
    throw new TypeError('adjudication evaluation requires a signed experiment contract');
  }
  if (experiment.experiment?.schema !== ADJUDICATION_EXPERIMENT_VERSION) {
    throw new TypeError('adjudication evaluation requires the current baseline-policy freeze contract');
  }
  if (author.identityRootId !== experiment.experiment?.evaluator?.identityRootId) {
    throw new TypeError('adjudication evaluation signer does not match the frozen evaluator identity root');
  }
  if (Date.parse(createdAt) < Date.parse(experiment.experiment?.frozenAt || '')) {
    throw new TypeError('adjudication evaluation cannot predate its frozen experiment');
  }
  const definitions = new Map(experiment.experiment?.metrics?.map((metric) => [metric.id, metric]) || []);
  const provided = (Array.isArray(metricResults) ? metricResults : []).slice(0, 32);
  if (!sameStringSet(provided.map((metric) => metric.metricId), [...definitions.keys()])) {
    throw new TypeError('adjudication evaluation must report every frozen metric exactly once');
  }
  const normalizedMetrics = provided.map((result, index) => {
    const definition = definitions.get(compactText(result.metricId, 120));
    if (!definition) throw new TypeError(`adjudication metric result ${index + 1} is outside the frozen contract`);
    return adjudicationMetricResult(definition, result, index);
  });
  if (new Set(normalizedMetrics.map((metric) => metric.pairedSampleCount)).size !== 1) {
    throw new TypeError('adjudication metrics must use the same paired sample count');
  }
  const normalizedManifest = normalizeReferenceIdentity(resultManifest, 'adjudication result manifest');
  if (!normalizedManifest.contentHash) throw new TypeError('adjudication result manifest requires a content hash');
  if (experiment.experiment?.outcomeBoundary?.mode === 'historical_hidden'
    && normalizedManifest.contentHash !== experiment.experiment.outcomeBoundary.outcomeManifestCommitmentHash) {
    throw new TypeError('historical adjudication result manifest does not match the frozen outcome commitment');
  }
  const regressions = requiredInteger(regressionCount, 'adjudication regression count');
  const missingCases = requiredInteger(missingCaseCount, 'adjudication missing case count');
  if (regressions < 0 || missingCases < 0) throw new TypeError('adjudication regression and missing case counts cannot be negative');
  const pairedSampleCount = normalizedMetrics[0].pairedSampleCount;
  if (pairedSampleCount + missingCases !== experiment.experiment.cohort.caseCount) {
    throw new TypeError('adjudication paired and missing case counts must account for the frozen cohort');
  }
  if (regressions > pairedSampleCount) throw new TypeError('adjudication regressions cannot exceed paired cases');
  const disagreement = compactText(disagreementSummary, 4000);
  const failures = compactText(failureAnalysis, 4000);
  if (!disagreement || !failures) throw new TypeError('adjudication evaluation requires disagreement and failure analysis');
  const normalizedNorthStarEvidence = await normalizeAdjudicationNorthStarEvidence(northStarEvidence, {
    policy: experiment.experiment.northStarPolicy,
    pairedSampleCount,
    cohortCaseCount: experiment.experiment.cohort.caseCount,
    missingCaseCount: missingCases
  });
  return signResearchRecord(RESEARCH_RECORD_KINDS.adjudicationEvaluation, { roomId, createdAt, author, privateKey }, async () => ({
    experimentHash: experiment.recordHash,
    evaluation: {
      schema: ADJUDICATION_EVALUATION_VERSION,
      resultManifest: normalizedManifest,
      metricResults: normalizedMetrics,
      northStarEvidence: normalizedNorthStarEvidence,
      assessment: assessAdjudicationExperiment(
        experiment.experiment,
        normalizedMetrics,
        normalizedNorthStarEvidence
      ),
      regressionCount: regressions,
      missingCaseCount: missingCases,
      disagreementSummary: disagreement,
      failureAnalysis: failures,
      evaluator: clone(experiment.experiment.evaluator)
    }
  }));
}

export async function createSignedCandidateAction({
  identity,
  roomId,
  questionHash,
  action,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.candidateAction);
  const normalizedAction = await normalizeDiscoveryCandidateAction({
    ...(action || {}),
    questionHash
  });
  return signResearchRecord(RESEARCH_RECORD_KINDS.candidateAction, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: normalizedAction.questionHash,
    action: normalizedAction
  }));
}

export async function createSignedDiscoveryCheckpoint({
  identity,
  roomId,
  checkpoint,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.discoveryCheckpoint);
  const normalizedRoomId = normalizeRoomId(roomId);
  const normalizedCheckpoint = await normalizeDiscoveryCheckpoint(checkpoint, normalizedRoomId);
  return signResearchRecord(RESEARCH_RECORD_KINDS.discoveryCheckpoint, { roomId: normalizedRoomId, createdAt, author, privateKey }, async () => ({
    checkpoint: normalizedCheckpoint
  }));
}

export async function createSignedSequenceEvidenceLink({
  identity,
  roomId,
  nucleotideSubmissionHash,
  proteinSubmissionHash,
  reference,
  coordinates,
  transcript,
  translation,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.sequenceLink);
  const coordinateSystem = compactText(coordinates?.coordinateSystem, 80).toLowerCase();
  const strand = compactText(coordinates?.strand, 20).toLowerCase();
  const start = Number(coordinates?.start);
  const end = Number(coordinates?.end);
  if (!SEQUENCE_LINK_COORDINATE_SYSTEMS.includes(coordinateSystem)) {
    throw new TypeError('DNA-to-protein linkage requires an explicit coordinate system');
  }
  if (!SEQUENCE_LINK_STRANDS.includes(strand)) {
    throw new TypeError('DNA-to-protein linkage strand must be forward or reverse');
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    throw new TypeError('DNA-to-protein linkage coordinates are invalid');
  }
  const readingFrame = Number(translation?.readingFrame);
  if (!TRANSLATION_READING_FRAMES.includes(readingFrame)) throw new TypeError('translation reading frame must be 0, 1, or 2');
  const normalizedReference = {
    assemblyAccession: compactText(reference?.assemblyAccession, 240),
    assemblyVersion: compactText(reference?.assemblyVersion, 120),
    assemblyHash: requireHash(reference?.assemblyHash, 'assemblyHash'),
    sequenceAccession: compactText(reference?.sequenceAccession, 240),
    sequenceVersion: compactText(reference?.sequenceVersion, 120),
    referenceHash: requireHash(reference?.referenceHash, 'referenceHash')
  };
  if (!normalizedReference.assemblyAccession || !normalizedReference.assemblyVersion
    || !normalizedReference.sequenceAccession || !normalizedReference.sequenceVersion) {
    throw new TypeError('assembly and reference accession versions are required');
  }
  const normalizedTranscript = {
    accession: compactText(transcript?.accession, 240),
    version: compactText(transcript?.version, 120),
    transcriptHash: requireHash(transcript?.transcriptHash, 'transcriptHash')
  };
  if (!normalizedTranscript.accession || !normalizedTranscript.version) {
    throw new TypeError('transcript accession and version are required');
  }
  const normalizedTranslation = {
    readingFrame,
    geneticCode: compactText(translation?.geneticCode, 120),
    methodId: compactText(translation?.methodId, 240),
    methodVersion: compactText(translation?.methodVersion, 120),
    nucleotideSequenceHash: requireHash(translation?.nucleotideSequenceHash, 'nucleotideSequenceHash'),
    proteinSequenceHash: requireHash(translation?.proteinSequenceHash, 'proteinSequenceHash'),
    translationHash: requireHash(translation?.translationHash, 'translationHash')
  };
  if (!normalizedTranslation.geneticCode || !normalizedTranslation.methodId || !normalizedTranslation.methodVersion) {
    throw new TypeError('translation genetic code, method id, and method version are required');
  }
  const link = {
    nucleotideSubmissionHash: requireHash(nucleotideSubmissionHash, 'nucleotideSubmissionHash'),
    proteinSubmissionHash: requireHash(proteinSubmissionHash, 'proteinSubmissionHash'),
    reference: normalizedReference,
    coordinates: {
      coordinateSystem,
      start,
      end,
      strand
    },
    transcript: normalizedTranscript,
    translation: normalizedTranslation
  };
  return signResearchRecord(RESEARCH_RECORD_KINDS.sequenceLink, { roomId, createdAt, author, privateKey }, async () => ({
    link: await withContentHash(link, 'linkHash')
  }));
}

export async function createSignedResearchRevocation({
  identity,
  roomId,
  targetHash,
  reason,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.revocation);
  const normalizedReason = compactText(reason, 2000);
  if (!normalizedReason) throw new TypeError('revocation reason is required');
  return signResearchRecord(RESEARCH_RECORD_KINDS.revocation, { roomId, createdAt, author, privateKey }, async () => ({
    targetHash: requireHash(targetHash, 'targetHash'),
    revocation: {
      scope: 'future_use',
      reason: normalizedReason,
      effectiveAt: createdAt
    }
  }));
}
