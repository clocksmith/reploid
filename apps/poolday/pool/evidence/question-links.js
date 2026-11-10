/** Link validation for results, sequence links, claims, candidate actions, hypotheses, prior evidence, predictions and resolution criteria. */
import {
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_RECORD_KINDS,
  decisionContextSnapshot
} from '../evidence-record-contract.js';
import {
  hasPublicEvidenceConsent,
  sameJson
} from './primitives.js';
import {
  independentlyAccepted
} from './review-state.js';
import {
  SEQUENCE_ALPHABETS
} from '../../../../shared/pool/sequence-workload.js';
import {
  exactModelContractKey
} from '../../../../shared/pool/model-contract.js';

const linkResult = (record, reasons, { target }) => {
  const submission = target(record.submissionHash);
  if (submission && submission.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('research result must target a submission');
  if (submission && record.sequenceHash !== submission.sequence?.hash) reasons.push('research result sequence does not match its submission');
  if (submission && record.sequenceLength !== submission.sequence?.length) reasons.push('research result sequence length does not match its submission');
  if (submission && record.compute?.submissionModelContractKey !== exactModelContractKey(submission.modelContract)) {
    reasons.push('research result submission model contract identity does not match its submission');
  }
  if (record.compute?.receiptModelContractKey !== exactModelContractKey(record.modelContract)) {
    reasons.push('research result receipt model contract identity does not match its published exact model contract');
  }
  if (submission && record.modelContract?.sequence?.alphabet
    && record.modelContract.sequence.alphabet !== submission.sequence?.alphabet) {
    reasons.push('research result model contract alphabet does not match its submission');
  }
  if (record.sequenceEvidence && record.sequenceEvidence.sequenceLength !== submission?.sequence?.length) {
    reasons.push('research result sequence evidence length does not match its submission');
  }
  if (record.embedding && submission?.consent?.publishEmbedding !== true) reasons.push('research submission did not consent to embedding publication');
  if ((record.sequenceEvidence?.residueEmbeddings?.length > 0
    || record.sequenceEvidence?.maskedResidueProposals?.length > 0)
    && submission?.consent?.publishResidueEvidence !== true) {
    reasons.push('research submission did not consent to residue evidence publication');
  }
};

const linkSequenceLink = (record, reasons, { target }) => {
  const nucleotide = target(record.link?.nucleotideSubmissionHash);
  const protein = target(record.link?.proteinSubmissionHash);
  if (nucleotide?.kind !== RESEARCH_RECORD_KINDS.submission
    || nucleotide?.sequence?.alphabet !== SEQUENCE_ALPHABETS.nucleotide) {
    reasons.push('sequence link must target a nucleotide submission');
  }
  if (protein?.kind !== RESEARCH_RECORD_KINDS.submission
    || protein?.sequence?.alphabet !== SEQUENCE_ALPHABETS.aminoAcid) {
    reasons.push('sequence link must target a protein submission');
  }
  if (nucleotide && record.link?.translation?.nucleotideSequenceHash !== nucleotide.sequence?.hash) {
    reasons.push('sequence link nucleotide identity does not match its submission');
  }
  if (protein && record.link?.translation?.proteinSequenceHash !== protein.sequence?.hash) {
    reasons.push('sequence link protein identity does not match its submission');
  }
};

const linkHumanClaim = (record, reasons, { target }) => {
  const reviewed = target(record.targetHash);
  if (record.claim?.kind === 'review_decision' && reviewed?.author?.identityRootId === record.author?.identityRootId) {
    reasons.push('review decisions must be independently authored');
  }
  const reuseContext = reviewed?.kind === RESEARCH_RECORD_KINDS.priorEvidence
    ? reviewed.evidence?.reuseContext
    : null;
  const assessment = record.claim?.contextAssessment;
  if (assessment && !reuseContext) reasons.push('contextual reuse review must target cross-room prior evidence');
  if (reuseContext && assessment) {
    if (assessment.originRecordHash !== reuseContext.originRecordHash
      || assessment.originQuestionHash !== reuseContext.origin.questionHash
      || assessment.currentQuestionHash !== reuseContext.current.questionHash
      || assessment.comparisonHash !== reuseContext.comparisonHash) {
      reasons.push('contextual reuse review does not match the attached context comparison');
    }
  }
  if (reuseContext && record.claim?.kind === 'review_decision'
    && record.claim?.decision === 'accepted'
    && assessment?.determination !== 'relevant') {
    reasons.push('accepted cross-room evidence requires an explicit relevant context determination');
  }
  if (record.claim?.kind === 'candidate_action_approval') {
    if (reviewed?.kind !== RESEARCH_RECORD_KINDS.candidateAction) {
      reasons.push('candidate action approval must target a candidate action');
    } else {
      if (reviewed.author?.identityRootId === record.author?.identityRootId) {
        reasons.push('candidate actions cannot be self-approved');
      }
      if (record.claim?.actionContractHash !== reviewed.action?.contractHash) {
        reasons.push('candidate action approval contract hash does not match its target');
      }
    }
  }
};

const linkCandidateAction = (record, reasons, { records, target }) => {
  const question = target(record.questionHash);
  if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
    reasons.push('candidate action must target a research question submission');
  } else if (!hasPublicEvidenceConsent(question)) {
    reasons.push('candidate action requires public sequence and evidence-network consent');
  }
  for (const hash of record.action?.affectedHypothesisHashes || []) {
    const hypothesis = target(hash);
    if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
      reasons.push(`candidate action hypothesis does not belong to its question: ${hash}`);
    }
  }
  for (const uncertainty of record.action?.uncertainty || []) {
    if (uncertainty.representation !== 'probability') continue;
    const cohort = target(uncertainty.calibration?.cohortHash);
    if (cohort?.kind !== RESEARCH_RECORD_KINDS.cohort || cohort.cohort?.state !== 'frozen') {
      reasons.push(`probability calibration does not target a frozen evaluation cohort: ${uncertainty.calibration?.cohortHash}`);
    } else if (!independentlyAccepted(records, cohort)) {
      reasons.push(`probability calibration cohort lacks independent acceptance: ${cohort.recordHash}`);
    }
  }
  for (const hash of record.action?.expectedValue?.calibrationEvidenceHashes || []) {
    const calibration = target(hash);
    if (![RESEARCH_RECORD_KINDS.evaluation, RESEARCH_RECORD_KINDS.adjudicationEvaluation].includes(calibration?.kind)) {
      reasons.push(`candidate value calibration evidence kind mismatch: ${hash}`);
    } else if (!independentlyAccepted(records, calibration)) {
      reasons.push(`candidate value calibration evidence lacks independent acceptance: ${hash}`);
    }
  }
};

const linkHypothesis = (record, reasons, { target }) => {
  if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('hypothesis must target a research question submission');
  for (const hash of record.hypothesis?.priorEvidenceHashes || []) {
    if (target(hash)?.kind !== RESEARCH_RECORD_KINDS.priorEvidence) reasons.push(`hypothesis prior evidence kind mismatch: ${hash}`);
  }
  for (const hash of record.hypothesis?.alternativeToHashes || []) {
    const alternative = target(hash);
    if (alternative?.kind !== RESEARCH_RECORD_KINDS.hypothesis || alternative.questionHash !== record.questionHash) {
      reasons.push(`competing hypothesis does not share the question: ${hash}`);
    }
  }
};

const linkPriorEvidence = (record, reasons, { target }) => {
  const question = target(record.questionHash);
  if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
    reasons.push('prior evidence must target a research question submission');
  }
  if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
    && question?.kind === RESEARCH_RECORD_KINDS.submission
    && !hasPublicEvidenceConsent(question)) {
    reasons.push('public protein evidence requires public sequence and evidence-network consent');
  }
  if (record.evidence?.annotation && question?.kind === RESEARCH_RECORD_KINDS.submission) {
    if (record.evidence.annotation.sequence?.hash !== question.sequence?.hash) {
      reasons.push('protein annotation sequence identity does not match its question');
    }
    if (record.evidence.annotation.sequence?.length !== question.sequence?.length) {
      reasons.push('protein annotation sequence length does not match its question');
    }
  }
  if (record.evidence?.reuseContext && question?.kind === RESEARCH_RECORD_KINDS.submission) {
    const reuseContext = record.evidence.reuseContext;
    const currentSnapshot = decisionContextSnapshot(question);
    if (!hasPublicEvidenceConsent(question)) {
      reasons.push('cross-room reuse requires current-question public evidence consent');
    }
    if (reuseContext.current?.questionHash !== currentSnapshot.questionHash
      || reuseContext.current?.roomId !== currentSnapshot.roomId
      || reuseContext.current?.sequenceHash !== currentSnapshot.sequenceHash
      || !sameJson(reuseContext.current?.consent, currentSnapshot.consent)
      || !sameJson(reuseContext.current?.intent, currentSnapshot.intent)) {
      reasons.push('cross-room reuse context does not match the current question');
    }
    if (reuseContext.originRecordHash !== record.evidence.reference?.contentHash) {
      reasons.push('cross-room reuse origin does not match the attached record reference');
    }
  }
};

const linkPrediction = (record, reasons, { target }) => {
  const hypothesis = target(record.hypothesisHash);
  if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('prediction must target a research question submission');
  if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
    reasons.push('prediction hypothesis does not belong to its question');
  }
};

const linkResolutionPolicy = (record, reasons, { records, target }) => {
  const question = target(record.questionHash);
  const hypothesis = target(record.policy?.targetHypothesisHash);
  if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
    reasons.push('resolution policy must target a research question submission');
  }
  if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
    reasons.push('resolution policy target hypothesis does not belong to its question');
  }
  const priorExecutionPlanning = records.filter((entry) => (
    [RESEARCH_RECORD_KINDS.workOrder, RESEARCH_RECORD_KINDS.workClaim, RESEARCH_RECORD_KINDS.outcome]
      .includes(entry.kind)
    && (entry.questionHash === record.questionHash
      || target(entry.workOrderHash)?.questionHash === record.questionHash)
    && Date.parse(entry.createdAt || '') <= Date.parse(record.createdAt || '')
  ));
  if (priorExecutionPlanning.length) {
    reasons.push('resolution policy must be frozen before work orders, claims, or outcomes for its question');
  }
};

export const questionLinkValidators = Object.freeze([
  [RESEARCH_RECORD_KINDS.result, linkResult],
  [RESEARCH_RECORD_KINDS.sequenceLink, linkSequenceLink],
  [RESEARCH_RECORD_KINDS.claim, linkHumanClaim],
  [RESEARCH_RECORD_KINDS.candidateAction, linkCandidateAction],
  [RESEARCH_RECORD_KINDS.hypothesis, linkHypothesis],
  [RESEARCH_RECORD_KINDS.priorEvidence, linkPriorEvidence],
  [RESEARCH_RECORD_KINDS.prediction, linkPrediction],
  [RESEARCH_RECORD_KINDS.resolutionPolicy, linkResolutionPolicy]
]);
