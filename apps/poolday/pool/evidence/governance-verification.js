/** Field verification for adjudication experiments and evaluations, checkpoints, sequence links and revocations. */
import {
  ADJUDICATION_EVALUATION_VERSION,
  ADJUDICATION_EXPERIMENT_VERSION,
  BASELINE_FREEZE_ADJUDICATION_EVALUATION_VERSION,
  LEGACY_ADJUDICATION_EVALUATION_VERSION,
  METRIC_DIRECTIONS,
  RESEARCH_RECORD_KINDS,
  SEQUENCE_LINK_COORDINATE_SYSTEMS,
  SEQUENCE_LINK_STRANDS,
  TRANSLATION_READING_FRAMES
} from '../evidence-record-contract.js';
import {
  contentHashReason,
  isSha256,
  sameJson
} from './primitives.js';
import {
  normalizeAdjudicationExperimentContract
} from './adjudication-normalization.js';
import {
  normalizeDiscoveryCheckpoint
} from './discovery-normalization.js';
import {
  normalizeReferenceIdentity
} from './scientific-normalization.js';
import {
  checkCanonical
} from './verification-checks.js';
import {
  ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION
} from '../adjudication-north-star.js';

const verifyAdjudicationExperimentFields = async (record, reasons) => {
  const normalizedExperiment = await checkCanonical(reasons, 'adjudication experiment contract', record.experiment,
    () => normalizeAdjudicationExperimentContract(record.experiment));
  if (normalizedExperiment && record.experiment?.schema === ADJUDICATION_EXPERIMENT_VERSION
    && record.createdAt !== record.experiment.frozenAt) {
    reasons.push('adjudication experiment creation and policy freeze timestamps do not match');
  }
};

const verifyAdjudicationEvaluationFields = async (record, reasons) => {
  if (!isSha256(record.experimentHash)) reasons.push('adjudication evaluation experimentHash is invalid');
  if (![
    LEGACY_ADJUDICATION_EVALUATION_VERSION,
    BASELINE_FREEZE_ADJUDICATION_EVALUATION_VERSION,
    ADJUDICATION_EVALUATION_VERSION
  ]
    .includes(record.evaluation?.schema)) reasons.push('adjudication evaluation schema is invalid');
  try {
    const manifest = normalizeReferenceIdentity(record.evaluation?.resultManifest, 'adjudication result manifest');
    if (!manifest.contentHash) reasons.push('adjudication result manifest requires a content hash');
    if (!sameJson(manifest, record.evaluation?.resultManifest)) {
      reasons.push('adjudication result manifest is not canonical');
    }
  } catch (error) {
    reasons.push(error.message);
  }
  if (!Array.isArray(record.evaluation?.metricResults) || record.evaluation.metricResults.length < 2
    || record.evaluation.metricResults.some((metric) => !metric.metricId
      || !METRIC_DIRECTIONS.includes(metric.direction)
      || !Number.isFinite(metric.baselineValue)
      || !Number.isFinite(metric.candidateValue)
      || !Number.isFinite(metric.orientedEffect)
      || !Number.isFinite(metric.effectInterval?.lower)
      || !Number.isFinite(metric.effectInterval?.upper)
      || metric.effectInterval.lower > metric.effectInterval.upper
      || !Number.isInteger(metric.pairedSampleCount)
      || !Number.isInteger(metric.minimumSampleSize)
      || !Number.isFinite(metric.confidenceLevel)
      || metric.confidenceLevel <= 0
      || metric.confidenceLevel > 1
      || typeof metric.sampleAdequate !== 'boolean')) {
    reasons.push('adjudication evaluation metric results are invalid');
  }
  if (!['passes', 'fails', 'inconclusive'].includes(record.evaluation?.assessment?.conclusion)
    || record.evaluation?.assessment?.mode !== 'quality_or_effort') {
    reasons.push('adjudication evaluation assessment is invalid');
  }
  if (record.evaluation?.schema === ADJUDICATION_EVALUATION_VERSION) {
    const northStarEvidence = record.evaluation?.northStarEvidence || {};
    const northStarHashes = [
      northStarEvidence.policyHash,
      northStarEvidence.evidenceHash,
      northStarEvidence.caseEvidenceManifestHash,
      northStarEvidence.rawCostObservationManifestHash,
      northStarEvidence.conclusionAuditManifestHash,
      northStarEvidence.independenceAuditManifestHash,
      northStarEvidence.conversionAuditArtifactHash
    ];
    if (northStarEvidence.schema !== ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION
      || northStarHashes.some((hash) => !isSha256(hash))
      || !['reportable', 'incomplete'].includes(northStarEvidence.reportingStatus)
      || !['signed_evaluator_report_not_biological_truth', 'north_star_improvement_claim_prohibited']
        .includes(northStarEvidence.reportingBoundary)
      || !Number.isInteger(northStarEvidence.baseline?.observedCaseCount)
      || !Number.isInteger(northStarEvidence.baseline?.independentlyReplicatedConclusionCount)
      || !Number.isInteger(northStarEvidence.candidate?.observedCaseCount)
      || !Number.isInteger(northStarEvidence.candidate?.independentlyReplicatedConclusionCount)
      || record.evaluation?.assessment?.operationalMetricsAffectSuccess !== false) {
      reasons.push('adjudication north-star evidence or assessment is invalid');
    }
  }
  if (!Number.isInteger(record.evaluation?.regressionCount) || record.evaluation.regressionCount < 0
    || !Number.isInteger(record.evaluation?.missingCaseCount) || record.evaluation.missingCaseCount < 0) {
    reasons.push('adjudication evaluation case accounting is invalid');
  }
  if (!record.evaluation?.disagreementSummary || !record.evaluation?.failureAnalysis
    || !record.evaluation?.evaluator?.authority
    || !record.evaluation?.evaluator?.identityRootId
    || !record.evaluation?.evaluator?.methodId
    || !record.evaluation?.evaluator?.version
    || !isSha256(record.evaluation?.evaluator?.artifactHash)
    || record.evaluation?.evaluator?.blinded !== true) {
    reasons.push('adjudication evaluation evidence policy is incomplete');
  }
};

const verifyDiscoveryCheckpointFields = async (record, reasons) => {
  await checkCanonical(reasons, 'discovery checkpoint', record.checkpoint,
    () => normalizeDiscoveryCheckpoint(record.checkpoint, record.roomId));
};

const verifySequenceLinkFields = async (record, reasons) => {
  const linkHashReason = await contentHashReason(record.link || {}, 'linkHash', 'sequence link');
  if (linkHashReason) reasons.push(linkHashReason);
  for (const hash of [
    record.link?.nucleotideSubmissionHash,
    record.link?.proteinSubmissionHash,
    record.link?.reference?.assemblyHash,
    record.link?.reference?.referenceHash,
    record.link?.transcript?.transcriptHash,
    record.link?.translation?.nucleotideSequenceHash,
    record.link?.translation?.proteinSequenceHash,
    record.link?.translation?.translationHash
  ]) {
    if (!isSha256(hash)) reasons.push('sequence link contains an invalid identity hash');
  }
  if (!SEQUENCE_LINK_COORDINATE_SYSTEMS.includes(record.link?.coordinates?.coordinateSystem)
    || !SEQUENCE_LINK_STRANDS.includes(record.link?.coordinates?.strand)
    || !Number.isInteger(record.link?.coordinates?.start)
    || !Number.isInteger(record.link?.coordinates?.end)
    || record.link.coordinates.end <= record.link.coordinates.start) reasons.push('sequence link coordinates are invalid');
  if (!TRANSLATION_READING_FRAMES.includes(record.link?.translation?.readingFrame)) reasons.push('sequence link reading frame is invalid');
};

const verifyRevocationFields = async (record, reasons) => {
  if (!isSha256(record.targetHash)) reasons.push('revocation targetHash is invalid');
  if (record.revocation?.scope !== 'future_use' || !record.revocation?.reason
    || !Number.isFinite(Date.parse(record.revocation?.effectiveAt || ''))) reasons.push('revocation evidence is invalid');
};

export const governanceRecordVerifiers = Object.freeze([
  [RESEARCH_RECORD_KINDS.adjudicationExperiment, verifyAdjudicationExperimentFields],
  [RESEARCH_RECORD_KINDS.adjudicationEvaluation, verifyAdjudicationEvaluationFields],
  [RESEARCH_RECORD_KINDS.discoveryCheckpoint, verifyDiscoveryCheckpointFields],
  [RESEARCH_RECORD_KINDS.sequenceLink, verifySequenceLinkFields],
  [RESEARCH_RECORD_KINDS.revocation, verifyRevocationFields]
]);
