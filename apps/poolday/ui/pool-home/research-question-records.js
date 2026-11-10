/**
 * @fileoverview Signed question-phase records from lifecycle forms: public prior evidence,
 * hypotheses, frozen predictions, resolution policies and candidate actions.
 */
import {
  createSignedCandidateAction,
  createSignedPublicProteinEvidence,
  createSignedResearchHypothesis,
  createSignedResearchPrediction,
  createSignedResearchResolutionPolicy
} from '../../pool/evidence-network.js';
import { commaList, candidateScientificCostFromForm, candidateUncertaintyFromForm } from './research-form-values.js';

const priorEvidenceRecord = (values, { researcher, roomId, byHash }) => {
  const question = byHash.get(values.get('questionHash'));
  if (question?.kind !== 'research_submission') throw new Error('Selected research question is unavailable');
  const evidenceKind = values.get('evidenceKind');
  const requiresAnnotationIdentity = ['annotation', 'domain'].includes(evidenceKind);
  const finding = evidenceKind === 'assay'
    ? { classification: values.get('findingClassification'), attempt: { status: 'completed', failureCategory: 'none' } }
    : evidenceKind === 'negative_result'
      ? { classification: 'negative', attempt: { status: 'completed', failureCategory: 'none' } }
      : evidenceKind === 'failed_attempt'
        ? { classification: 'not_observed', attempt: { status: 'failed', failureCategory: values.get('failureCategory') } }
        : {};
  return createSignedPublicProteinEvidence({
    identity: researcher,
    roomId,
    questionHash: question.recordHash,
    evidenceKind,
    summary: values.get('summary'),
    reference: {
      uri: values.get('uri'),
      accession: values.get('accession'),
      version: values.get('version'),
      contentHash: values.get('sourceContentHash')
    },
    annotation: requiresAnnotationIdentity ? {
      scope: evidenceKind === 'domain' ? 'domain' : values.get('annotationScope'),
      ontology: {
        namespace: values.get('ontologyNamespace'),
        termId: values.get('ontologyTermId'),
        version: values.get('ontologyVersion'),
        label: values.get('ontologyLabel')
      },
      sequence: { hash: question.sequence?.hash, length: question.sequence?.length },
      coordinates: {
        sourceSystem: values.get('coordinateSystem'),
        sourceStart: values.get('coordinateStart'),
        sourceEnd: values.get('coordinateEnd')
      }
    } : null,
    conditions: { notes: values.get('conditions') },
    transformations: [{
      id: values.get('transformationId'),
      version: values.get('transformationVersion'),
      parametersHash: values.get('transformationParametersHash'),
      description: values.get('transformationDescription')
    }],
    uncertainty: { method: 'contributor assessment', description: values.get('uncertainty') },
    finding,
    provenance: {
      retrievalMethod: values.get('retrievalMethod'),
      retrievedAt: new Date().toISOString(),
      sourceIdentity: values.get('accession') || values.get('uri'),
      license: values.get('sourceLicense')
    }
  });
};

const hypothesisRecord = (values, { researcher, roomId }) => {
  return createSignedResearchHypothesis({
    identity: researcher,
    roomId,
    questionHash: values.get('questionHash'),
    statement: values.get('statement'),
    conditions: { notes: values.get('conditions') },
    discriminatingObservations: [values.get('discriminator')],
    priorEvidenceHashes: values.get('priorEvidenceHash') ? [values.get('priorEvidenceHash')] : [],
    alternativeToHashes: values.get('alternativeToHash') ? [values.get('alternativeToHash')] : []
  });
};

const predictionRecord = (values, { researcher, roomId, byHash }) => {
  const hypothesis = byHash.get(values.get('hypothesisHash'));
  if (!hypothesis) throw new Error('Selected hypothesis is unavailable');
  return createSignedResearchPrediction({
    identity: researcher,
    roomId,
    questionHash: hypothesis.questionHash,
    hypothesisHash: hypothesis.recordHash,
    method: { methodId: values.get('methodId'), version: values.get('methodVersion'), artifactHash: values.get('artifactHash') },
    expectedObservation: values.get('expectedObservation'),
    normalizedLabel: values.get('normalizedLabel'),
    conditions: { notes: values.get('conditions') },
    confidence: values.get('confidence'),
    outcomeAccess: 'blinded'
  });
};

const resolutionPolicyRecord = (values, { researcher, roomId, byHash }) => {
  const hypothesis = byHash.get(values.get('resolutionTargetHypothesisHash'));
  if (hypothesis?.kind !== 'research_hypothesis') throw new Error('Selected resolution target hypothesis is unavailable');
  const rule = (prefix) => ({
    outcomeClassifications: [values.get(`${prefix}Classification`)],
    minimumAcceptedCompletedOutcomes: values.get(`${prefix}MinimumOutcomes`),
    minimumIndependentReplications: values.get(`${prefix}MinimumReplications`),
    maximumAmbiguousOutcomes: values.get(`${prefix}MaximumAmbiguous`),
    requiredDistinctReviewerIdentities: values.get(`${prefix}MinimumReviewers`),
    uncertainty: {
      methodId: values.get(`${prefix}UncertaintyMethodId`),
      version: values.get(`${prefix}UncertaintyVersion`),
      metricId: values.get(`${prefix}UncertaintyMetricId`),
      maximumValue: values.get(`${prefix}MaximumUncertainty`),
      unit: values.get(`${prefix}UncertaintyUnit`)
    }
  });
  const frozenAt = new Date().toISOString();
  return createSignedResearchResolutionPolicy({
    identity: researcher,
    roomId,
    questionHash: hypothesis.questionHash,
    targetHypothesisHash: hypothesis.recordHash,
    conclusionLabel: values.get('resolutionConclusionLabel'),
    decisionScope: values.get('resolutionDecisionScope'),
    provisionalAcceptance: rule('acceptance'),
    continuedUncertainty: { triggers: commaList(values.get('uncertaintyTriggers')) },
    rejection: rule('rejection'),
    reopening: { triggers: commaList(values.get('reopeningTriggers')) },
    closure: {
      minimumAcceptedCompletedOutcomes: values.get('closureMinimumOutcomes'),
      minimumIndependentReplications: values.get('closureMinimumReplications'),
      maximumAmbiguousOutcomes: values.get('closureMaximumAmbiguous'),
      requiredDistinctReviewerIdentities: values.get('closureMinimumReviewers'),
      requireAllControlsPassed: values.get('closureControlsPassed') === 'on',
      requireNoDisputedReviews: values.get('closureNoDisputedReviews') === 'on',
      requireNoActiveContradictions: values.get('closureNoContradictions') === 'on'
    },
    frozenAt
  });
};

const candidateActionRecord = (values, { researcher, roomId, byHash }) => {
  const question = byHash.get(values.get('questionHash'));
  const affectedHypothesisHashes = values.getAll('affectedHypothesisHashes');
  const hypotheses = affectedHypothesisHashes.map((hash) => byHash.get(hash)).filter(Boolean);
  if (question?.kind !== 'research_submission') throw new Error('Selected research question is unavailable');
  if (!affectedHypothesisHashes.length
    || hypotheses.length !== affectedHypothesisHashes.length
    || hypotheses.some((record) => record.kind !== 'research_hypothesis' || record.questionHash !== question.recordHash)) {
    throw new Error('Select affected hypotheses from the chosen question');
  }
  return createSignedCandidateAction({
    identity: researcher,
    roomId,
    questionHash: question.recordHash,
    action: {
      kind: values.get('candidateKind'),
      title: values.get('candidateTitle'),
      rationale: values.get('candidateRationale'),
      affectedHypothesisHashes,
      predictedObservations: [{
        observation: values.get('predictedObservation'),
        affectedHypothesisHashes
      }],
      falsifiers: affectedHypothesisHashes.map((hypothesisHash) => ({
        hypothesisHash,
        observation: values.get('falsifyingObservation')
      })),
      execution: {
        contractKind: values.get('contractKind'),
        contractId: values.get('contractId'),
        version: values.get('contractVersion'),
        artifactHash: values.get('contractArtifactHash'),
        parametersHash: values.get('contractParametersHash')
      },
      uncertainty: candidateUncertaintyFromForm(values),
      feasibility: {
        status: values.get('feasibilityStatus'),
        requiredCapabilities: commaList(values.get('requiredCapabilities')),
        availability: values.get('availability'),
        materials: commaList(values.get('materials')),
        failureRisks: commaList(values.get('failureRisks'))
      },
      independence: {
        dimensions: commaList(values.get('independenceDimensions')),
        exclusions: commaList(values.get('independenceExclusions')),
        minimumIndependentExecutions: values.get('minimumIndependentExecutions')
      },
      safety: {
        classification: values.get('safetyClassification'),
        requirements: commaList(values.get('safetyRequirements')),
        reviewRequired: values.get('candidateSafetyReview') === 'on'
      },
      consent: {
        publicSequenceRequired: values.get('candidatePublicConsent') === 'on',
        publicEvidencePublicationRequired: values.get('candidatePublicConsent') === 'on',
        additionalRequirements: []
      },
      scientificCost: candidateScientificCostFromForm(values),
      expectedValue: {
        status: values.get('valueStatus'),
        method: { id: values.get('valueMethodId'), version: values.get('valueMethodVersion') },
        uncertaintyReduction: values.get('uncertaintyReduction'),
        decisionRelevance: values.get('decisionRelevance'),
        duplicateWorkAvoidance: values.get('duplicateWorkAvoidance'),
        calibrationEvidenceHashes: values.getAll('valueCalibrationEvidenceHashes').filter(Boolean)
      }
    }
  });
};

export const questionRecordBuilders = Object.freeze({
  'prior-evidence': priorEvidenceRecord,
  hypothesis: hypothesisRecord,
  prediction: predictionRecord,
  'resolution-policy': resolutionPolicyRecord,
  'candidate-action': candidateActionRecord
});
