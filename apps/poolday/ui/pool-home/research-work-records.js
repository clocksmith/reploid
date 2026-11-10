/**
 * @fileoverview Signed work-phase records from lifecycle forms: work orders, laboratory work
 * claims and blinded experimental outcomes. Claims are declarations, not proof.
 */
import { createSignedExperimentalOutcome, createSignedResearchWorkClaim, createSignedResearchWorkOrder } from '../../pool/evidence-network.js';
import { commaList, protocolFromForm } from './research-form-values.js';

const workOrderRecord = (values, { researcher, roomId, byHash }) => {
  const hypothesisHashes = values.getAll('hypothesisHashes');
  const hypotheses = hypothesisHashes.map((hash) => byHash.get(hash)).filter(Boolean);
  const questionHashes = new Set(hypotheses.map((record) => record.questionHash));
  if (hypotheses.length !== hypothesisHashes.length || questionHashes.size !== 1) {
    throw new Error('Select competing hypotheses from one question');
  }
  return createSignedResearchWorkOrder({
    identity: researcher,
    roomId,
    questionHash: [...questionHashes][0],
    hypothesisHashes,
    title: values.get('title'),
    protocol: protocolFromForm(values),
    replicaTarget: values.get('replicaTarget'),
    blindness: { required: true, allocationHash: values.get('allocationHash') },
    feasibility: {
      resources: values.get('workResources'),
      biosafety: values.get('workBiosafety'),
      limitations: values.get('workLimitations')
    },
    analysis: {
      methodId: values.get('workAnalysisMethodId'),
      version: values.get('workAnalysisVersion'),
      artifactHash: values.get('workAnalysisArtifactHash'),
      parametersHash: values.get('workAnalysisParametersHash')
    },
    failureCategories: commaList(values.get('allowedFailureCategories')),
    custody: {
      planId: values.get('custodyPlanId'),
      version: values.get('custodyPlanVersion'),
      artifactHash: values.get('custodyArtifactHash'),
      requiredRoles: commaList(values.get('custodyRequiredRoles')),
      materialsPolicy: values.get('materialsPolicy'),
      samplesPolicy: values.get('samplesPolicy'),
      instrumentsPolicy: values.get('instrumentsPolicy')
    },
    publication: {
      scope: 'public_complete_record',
      license: values.get('workPublicationLicense'),
      publishLaboratoryIdentity: values.get('publishLaboratoryIdentity') === 'on',
      publishQualification: values.get('publishQualification') === 'on',
      publishProtocol: values.get('publishProtocol') === 'on',
      publishRawObservations: values.get('publishRawObservations') === 'on',
      publishFailures: values.get('publishFailures') === 'on'
    },
    replication: {
      requiredIndependentDimensions: commaList(values.get('replicationIndependentDimensions'))
    },
    scopeBoundary: {
      biologicalInterpretation: 'evidence_only_no_interpretation_authority',
      medicalUse: 'prohibited',
      protocolSafetyClassification: 'public_non_pathogenic_non_clinical',
      sampleScope: 'explicitly_public_synthetic_or_public_reference_only',
      privateSamples: 'prohibited',
      laboratoryAuthority: 'none',
      safetyReview: 'independent_human_required_before_execution'
    }
  });
};

const workClaimRecord = (values, { researcher, roomId, byHash }) => {
  const workOrder = byHash.get(values.get('workOrderHash'));
  if (workOrder?.kind !== 'research_work_order') throw new Error('Selected work order is unavailable');
  return createSignedResearchWorkClaim({
    identity: researcher,
    roomId,
    workOrderHash: values.get('workOrderHash'),
    laboratory: {
      id: values.get('laboratoryId'),
      name: values.get('laboratoryName'),
      institution: values.get('institution'),
      institutionIdentityHash: values.get('institutionIdentityHash'),
      ror: values.get('ror')
    },
    capabilityClaims: [{
      id: values.get('capabilityId'),
      version: values.get('capabilityVersion'),
      evidenceHash: values.get('capabilityEvidenceHash'),
      description: values.get('capabilityDescription')
    }],
    protocolCustody: {
      protocolHash: workOrder.work.protocol.protocolHash,
      role: values.get('protocolCustodyRole'),
      evidenceHash: values.get('protocolCustodyEvidenceHash')
    },
    safety: {
      classification: values.get('laboratorySafetyClassification'),
      oversightAuthority: values.get('oversightAuthority'),
      approvalHash: values.get('safetyApprovalHash'),
      limitations: commaList(values.get('safetyLimitations'))
    },
    availability: {
      status: values.get('laboratoryAvailabilityStatus'),
      capacity: values.get('laboratoryCapacity'),
      validFrom: values.get('laboratoryAvailableFrom'),
      validUntil: values.get('laboratoryAvailableUntil')
    },
    consent: {
      publicLaboratoryIdentity: values.get('publicConsent') === 'on',
      publishQualification: values.get('publicConsent') === 'on',
      publishOutcome: values.get('publicConsent') === 'on'
    },
    conflictDisclosure: values.get('laboratoryConflictDisclosure')
  });
};

const outcomeRecord = (values, { researcher, roomId, byHash }) => {
  const workClaim = byHash.get(values.get('workClaimHash'));
  const workOrder = byHash.get(workClaim?.workOrderHash);
  if (!workClaim || !workOrder) throw new Error('Selected work claim or work order is unavailable');
  const replicationOfHash = values.get('replicationOfHash') || null;
  return createSignedExperimentalOutcome({
    identity: researcher,
    roomId,
    questionHash: workOrder.questionHash,
    workOrderHash: workOrder.recordHash,
    workClaimHash: workClaim.recordHash,
    hypothesisHashes: workOrder.hypothesisHashes,
    classification: values.get('classification'),
    summary: values.get('summary'),
    attempt: {
      status: values.get('attemptStatus'),
      failureCategory: values.get('failureCategory'),
      failureDetail: values.get('failureDetail'),
      completedAt: new Date().toISOString()
    },
    observations: [{
      readout: values.get('readout'),
      value: values.get('value'),
      normalizedValue: values.get('normalizedValue'),
      unit: values.get('unit'),
      uncertainty: { method: 'reported uncertainty', value: values.get('uncertaintyValue'), unit: values.get('unit') }
    }],
    protocol: workOrder.work.protocol,
    analysis: workOrder.work.plannedAnalysis
      ? { ...workOrder.work.plannedAnalysis, lineageHashes: replicationOfHash ? [replicationOfHash] : [] }
      : {
        methodId: values.get('analysisId'),
        version: values.get('analysisVersion'),
        artifactHash: values.get('analysisArtifactHash'),
        parametersHash: values.get('analysisParametersHash'),
        lineageHashes: replicationOfHash ? [replicationOfHash] : []
      },
    executionContext: {
      institutionIdentityHash: workClaim.workClaim.laboratory.institutionIdentityHash,
      instrumentIdentityHash: values.get('instrumentIdentityHash'),
      sampleBatchHash: values.get('sampleBatchHash'),
      preparationBatchHash: values.get('preparationBatchHash'),
      analysisExecutionHash: values.get('analysisExecutionHash')
    },
    uncertainty: { method: 'reported uncertainty', value: values.get('uncertaintyValue'), unit: values.get('unit') },
    blind: { state: 'sealed', codeHash: values.get('codeHash'), allocationHash: workOrder.work.blindness.allocationHash },
    replicationOfHash
  });
};

export const workRecordBuilders = Object.freeze({
  'work-order': workOrderRecord,
  'work-claim': workClaimRecord,
  outcome: outcomeRecord
});
