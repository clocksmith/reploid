import { describe, expect, it } from 'vitest';

import {
  activeResearchRecords,
  buildPredictionDisagreementMap,
  buildQuestionLifecycles,
  createSignedCohortEvaluation,
  createSignedEvaluationCohort,
  createSignedExperimentalOutcome,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedResearchHypothesis,
  createSignedResearchPrediction,
  createSignedResearchResolutionPolicy,
  createSignedResearchRevocation,
  createSignedResearchSubmission,
  createSignedResearchWorkClaim,
  createSignedResearchWorkOrder,
  proposeDiscoveryTasks,
  projectResearchReviewStates,
  projectResearchResolutionCriteria,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const at = (minute) => `2026-08-01T12:${String(minute).padStart(2, '0')}:00.000Z`;
const model = {
  id: 'esm2-lifecycle',
  hash: fakeHash('1'),
  manifestHash: fakeHash('2'),
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: 'sequence.embedding.v1',
  executionMode: 'full_model_browser_sequence',
  dimensions: 3
};
const protocol = {
  protocolId: 'assay.signal-peptide.v1',
  version: '1.0.0',
  assayType: 'secretory-reporter',
  executableUri: 'https://example.org/protocols/signal-peptide-v1',
  referenceIdentities: [{ accession: 'PROTOCOL:001', version: '1.0.0' }],
  conditions: { biologicalSystem: 'public cell-free reporter', temperature: '30 C', timepoint: '2 h' },
  controls: ['positive secretion control', 'non-secreted negative control'],
  readouts: ['normalized extracellular reporter signal'],
  normalization: { method: 'control-ratio', version: '1.0.0', reference: 'negative control equals zero' },
  transformations: [{ id: 'background-subtraction', version: '1.0.0', parametersHash: fakeHash('3') }],
  uncertaintyPlan: 'Report replicate standard error and raw values.',
  acceptanceCriteria: 'Controls pass and at least two independent replicas are reported.'
};

const laboratoryQualification = ({ id, name, institution, protocolHash, hashCharacters, acknowledgedAt }) => ({
  laboratory: {
    id,
    name,
    institution,
    institutionIdentityHash: fakeHash(hashCharacters.institution)
  },
  capabilityClaims: [{
    id: 'cell-free-reporter-assay',
    version: '1.0.0',
    evidenceHash: fakeHash(hashCharacters.capability),
    description: 'Operate the declared blinded cell-free reporter assay and its controls.'
  }],
  protocolCustody: {
    protocolHash,
    role: 'operator',
    evidenceHash: fakeHash(hashCharacters.custody)
  },
  safety: {
    classification: 'public_non_pathogenic_non_clinical',
    oversightAuthority: 'Declared institutional biosafety oversight',
    approvalHash: fakeHash(hashCharacters.safety),
    limitations: ['No clinical, pathogenic, or private-sequence work.']
  },
  availability: {
    status: 'available',
    capacity: 'One blinded paired run under the accepted protocol.',
    validFrom: '2026-08-01T00:00:00.000Z',
    validUntil: '2027-08-01T00:00:00.000Z'
  },
  consent: {
    publicLaboratoryIdentity: true,
    publishQualification: true,
    publishOutcome: true,
    acknowledgedAt
  },
  conflictDisclosure: 'none declared'
});

const identity = async (kind, id) => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_${id}`,
      userId: `user_${id}`,
      deviceId: `device_${id}`,
      identityRootId: `root_${id}`
    }),
    getSigningKeyPair: async () => keyPair
  };
};

describe('Poolday prospective protein question lifecycle', () => {
  it('runs the complete signed question, experiment, replication, and cohort evaluation path', async () => {
    const requester = await identity('requester', 'requester');
    const researcher = await identity('researcher', 'researcher');
    const reviewer = await identity('reviewer', 'reviewer');
    const laboratoryOne = await identity('researcher', 'laboratory-one');
    const laboratoryTwo = await identity('researcher', 'laboratory-two');
    const evaluator = await identity('verifier', 'evaluator');
    const records = [];
    const append = async (record) => {
      expect(await verifyResearchRecord(record)).toMatchObject({ ok: true });
      expect(validateResearchRecordLinks(record, records)).toMatchObject({ ok: true });
      records.push(record);
      return record;
    };

    const question = await append(await createSignedResearchSubmission({
      identity: requester,
      roomId: 'prospective-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', label: 'Long-tail secretory protein', text: 'Which function is consistent with a public discriminating assay?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement',
      createdAt: at(0)
    }));
    const prior = await append(await createSignedPriorEvidence({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      evidenceKind: 'annotation',
      summary: 'A versioned public annotation reports an N-terminal hydrophobic region.',
      reference: { uri: 'https://example.org/records/PROT-001', accession: 'PROT-001', version: '4' },
      annotation: {
        scope: 'domain',
        ontology: { namespace: 'TEST', termId: 'HYDROPHOBIC-N', version: '4', label: 'N-terminal hydrophobic region' },
        sequence: { hash: question.sequence.hash, length: question.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_zero_based_half_open', sourceStart: 0, sourceEnd: 8 }
      },
      conditions: { biologicalSystem: 'public annotation record' },
      uncertainty: { method: 'curator confidence', value: 0.6, unit: 'probability', description: 'No direct assay is linked.' },
      provenance: { retrievedAt: at(1), retrievalMethod: 'version-pinned HTTP retrieval', sourceIdentity: 'public-example' },
      createdAt: at(1)
    }));
    expect(prior.evidence.annotation).toMatchObject({
      schema: 'poolday.protein_annotation_identity/v1',
      coordinates: {
        sourceSystem: 'protein_residue_zero_based_half_open',
        sourceStart: 0,
        sourceEnd: 8,
        canonicalSystem: 'protein_residue_one_based_closed',
        start: 1,
        end: 8
      }
    });
    const secretion = await append(await createSignedResearchHypothesis({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      statement: 'The protein is secreted under the declared cell-free conditions.',
      rationale: 'The N-terminal region is compatible with a signal peptide.',
      conditions: protocol.conditions,
      discriminatingObservations: ['Extracellular reporter signal exceeds the negative control.'],
      priorEvidenceHashes: [prior.recordHash],
      createdAt: at(2)
    }));
    const membrane = await append(await createSignedResearchHypothesis({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      statement: 'The protein remains membrane-associated under the declared conditions.',
      rationale: 'Hydrophobicity may indicate an anchor rather than a cleaved signal peptide.',
      conditions: protocol.conditions,
      discriminatingObservations: ['Reporter signal remains cell-associated after fractionation.'],
      priorEvidenceHashes: [prior.recordHash],
      alternativeToHashes: [secretion.recordHash],
      createdAt: at(3)
    }));
    const resolutionPolicy = await append(await createSignedResearchResolutionPolicy({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      targetHypothesisHash: secretion.recordHash,
      conclusionLabel: 'Secreted under the frozen public cell-free assay conditions',
      decisionScope: 'This policy applies only to the declared reporter protocol and public protein sequence.',
      provisionalAcceptance: {
        outcomeClassifications: ['positive'],
        minimumAcceptedCompletedOutcomes: 2,
        minimumIndependentReplications: 1,
        maximumAmbiguousOutcomes: 0,
        requiredDistinctReviewerIdentities: 1,
        uncertainty: { methodId: 'standard-error', version: '1.0.0', metricId: 'reporter-ratio-se', maximumValue: 0.1, unit: 'ratio' }
      },
      continuedUncertainty: {
        triggers: ['insufficient_accepted_outcomes', 'insufficient_independent_replications', 'ambiguous_outcome', 'failed_attempt', 'disputed_review', 'active_contradiction', 'uncertainty_above_threshold', 'control_failure']
      },
      rejection: {
        outcomeClassifications: ['negative'],
        minimumAcceptedCompletedOutcomes: 2,
        minimumIndependentReplications: 1,
        maximumAmbiguousOutcomes: 0,
        requiredDistinctReviewerIdentities: 1,
        uncertainty: { methodId: 'standard-error', version: '1.0.0', metricId: 'reporter-ratio-se', maximumValue: 0.1, unit: 'ratio' }
      },
      reopening: { triggers: ['contradiction', 'correction', 'revocation', 'failed_replication', 'policy_invalidation'] },
      closure: {
        minimumAcceptedCompletedOutcomes: 3,
        minimumIndependentReplications: 2,
        maximumAmbiguousOutcomes: 0,
        requiredDistinctReviewerIdentities: 2,
        requireAllControlsPassed: true,
        requireNoDisputedReviews: true,
        requireNoActiveContradictions: true
      },
      frozenAt: at(3)
    }));
    await append(await createSignedHumanClaim({
      identity: reviewer,
      roomId: question.roomId,
      targetHash: resolutionPolicy.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The criteria were frozen before work and preserve uncertainty and reopening.',
      confidence: 0.95,
      decision: 'accepted',
      createdAt: at(4)
    }));
    expect(projectResearchResolutionCriteria(records, question.recordHash)).toMatchObject({
      status: 'criteria_frozen',
      policyHash: resolutionPolicy.recordHash,
      closureAuthority: 'none',
      closureState: 'not_evaluated'
    });
    const predictionOne = await append(await createSignedResearchPrediction({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      hypothesisHash: secretion.recordHash,
      method: { methodId: 'predictor-a', version: '1.0.0', artifactHash: fakeHash('4') },
      expectedObservation: 'The extracellular reporter ratio is above 0.7.',
      normalizedLabel: 'secreted',
      conditions: protocol.conditions,
      confidence: 0.76,
      frozenAt: at(4)
    }));
    const predictionTwo = await append(await createSignedResearchPrediction({
      identity: evaluator,
      roomId: question.roomId,
      questionHash: question.recordHash,
      hypothesisHash: membrane.recordHash,
      method: { methodId: 'predictor-b', version: '2.1.0', artifactHash: fakeHash('5') },
      expectedObservation: 'The extracellular reporter ratio is below 0.3.',
      normalizedLabel: 'membrane-associated',
      conditions: protocol.conditions,
      confidence: 0.71,
      frozenAt: at(5)
    }));
    for (const [prediction, label] of [[predictionOne, 'predictor-a'], [predictionTwo, 'predictor-b']]) {
      await append(await createSignedHumanClaim({
        identity: reviewer,
        roomId: question.roomId,
        targetHash: prediction.recordHash,
        claimKind: 'review_decision',
        relation: 'reviews',
        text: `${label} is frozen, attributable, and suitable for the prospective cohort.`,
        confidence: 0.9,
        decision: 'accepted',
        createdAt: at(6)
      }));
    }
    const order = await append(await createSignedResearchWorkOrder({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      hypothesisHashes: [secretion.recordHash, membrane.recordHash],
      title: 'Blinded secretory reporter assay',
      protocol,
      replicaTarget: 2,
      blindness: { required: true, allocationHash: fakeHash('6'), revealRule: 'Reveal after both laboratories sign outcomes.' },
      feasibility: { resources: 'cell-free reporter kit', biosafety: 'public non-pathogenic system', limitations: 'Reporter may not capture native trafficking.' },
      analysis: { methodId: 'reporter-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8') },
      failureCategories: ['expression_failure', 'protocol_failure', 'analysis_failure', 'inconclusive'],
      custody: {
        planId: 'public-reporter-custody',
        version: '1.0.0',
        artifactHash: fakeHash('5'),
        requiredRoles: ['operator'],
        materialsPolicy: 'Record public kit lot identities.',
        samplesPolicy: 'Public synthetic samples only; preserve blinded code custody.',
        instrumentsPolicy: 'Record instrument identity and calibration evidence.'
      },
      publication: {
        scope: 'public_complete_record',
        license: 'CC-BY-4.0',
        publishLaboratoryIdentity: true,
        publishQualification: true,
        publishProtocol: true,
        publishRawObservations: true,
        publishFailures: true
      },
      replication: {
        requiredIndependentDimensions: [
          'operator_identity',
          'institution',
          'instrument',
          'sample_batch',
          'preparation_batch',
          'analysis_execution'
        ]
      },
      scopeBoundary: {
        biologicalInterpretation: 'evidence_only_no_interpretation_authority',
        medicalUse: 'prohibited',
        protocolSafetyClassification: 'public_non_pathogenic_non_clinical',
        sampleScope: 'explicitly_public_synthetic_or_public_reference_only',
        privateSamples: 'prohibited',
        laboratoryAuthority: 'none',
        safetyReview: 'independent_human_required_before_execution'
      },
      createdAt: at(6)
    }));
    expect(order.work).toMatchObject({
      schema: 'poolday.research_work_order/v1',
      allocationState: 'unallocated',
      plannedAnalysis: { methodId: 'reporter-analysis', artifactHash: fakeHash('7') },
      allowedFailureCategories: expect.arrayContaining(['inconclusive']),
      custody: { protocolHash: order.work.protocol.protocolHash, requiredRoles: ['operator'] },
      publication: { scope: 'public_complete_record', publishFailures: true },
      replication: { comparisonRule: 'all_declared_dimensions_must_differ' },
      scopeBoundary: { medicalUse: 'prohibited', laboratoryAuthority: 'none' }
    });
    await expect(createSignedResearchWorkOrder({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      hypothesisHashes: order.hypothesisHashes,
      workKind: order.work.kind,
      title: order.work.title,
      protocol: order.work.protocol,
      replicaTarget: order.work.replicaTarget,
      blindness: order.work.blindness,
      feasibility: order.work.feasibility,
      analysis: order.work.plannedAnalysis,
      failureCategories: order.work.allowedFailureCategories,
      custody: order.work.custody,
      publication: order.work.publication,
      replication: order.work.replication,
      scopeBoundary: { ...order.work.scopeBoundary, medicalUse: 'allowed' },
      createdAt: at(6)
    })).rejects.toThrow('must prohibit biological interpretation authority, medical use, unsafe protocols, private samples, and laboratory authority');
    const lateResolutionPolicy = await createSignedResearchResolutionPolicy({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      targetHypothesisHash: secretion.recordHash,
      conclusionLabel: resolutionPolicy.policy.conclusionLabel,
      decisionScope: resolutionPolicy.policy.decisionScope,
      provisionalAcceptance: resolutionPolicy.policy.provisionalAcceptance,
      continuedUncertainty: resolutionPolicy.policy.continuedUncertainty,
      rejection: resolutionPolicy.policy.rejection,
      reopening: resolutionPolicy.policy.reopening,
      closure: resolutionPolicy.policy.closure,
      frozenAt: at(7)
    });
    expect(validateResearchRecordLinks(lateResolutionPolicy, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['resolution policy must be frozen before work orders, claims, or outcomes for its question'])
    }));
    await append(await createSignedHumanClaim({
      identity: reviewer,
      roomId: question.roomId,
      targetHash: order.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The protocol distinguishes the hypotheses and has explicit controls.',
      confidence: 0.95,
      decision: 'accepted',
      createdAt: at(7)
    }));
    const qualificationOne = laboratoryQualification({
      id: 'lab-one',
      name: 'Laboratory One',
      institution: 'Public Institute One',
      protocolHash: order.work.protocol.protocolHash,
      hashCharacters: { institution: 'a', capability: 'b', custody: 'c', safety: 'd' },
      acknowledgedAt: at(8)
    });
    await expect(createSignedResearchWorkClaim({
      identity: laboratoryOne,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      ...qualificationOne,
      laboratory: { ...qualificationOne.laboratory, institutionIdentityHash: '' },
      createdAt: at(8)
    })).rejects.toThrow('institutionIdentityHash');
    const claimOne = await append(await createSignedResearchWorkClaim({
      identity: laboratoryOne,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      ...qualificationOne,
      createdAt: at(8)
    }));
    expect(claimOne.workClaim).toMatchObject({
      schema: 'poolday.laboratory_capability_claim/v1',
      laboratory: { institutionIdentityHash: fakeHash('a') },
      protocolCustody: { protocolHash: order.work.protocol.protocolHash, role: 'operator' },
      safety: { classification: 'public_non_pathogenic_non_clinical' },
      availability: { status: 'available' },
      consent: { publishQualification: true }
    });
    expect(claimOne.workClaim.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const recordsWithoutResolutionPolicy = records.filter((record) => (
      record.recordHash !== resolutionPolicy.recordHash
      && record.targetHash !== resolutionPolicy.recordHash
    ));
    expect(validateResearchRecordLinks(claimOne, recordsWithoutResolutionPolicy)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['qualified laboratory claims require an independently accepted pre-work-order resolution policy'])
    }));
    const qualificationTwo = laboratoryQualification({
      id: 'lab-two',
      name: 'Laboratory Two',
      institution: 'Public Institute Two',
      protocolHash: order.work.protocol.protocolHash,
      hashCharacters: { institution: 'e', capability: 'f', custody: '0', safety: '4' },
      acknowledgedAt: at(9)
    });
    const claimTwo = await append(await createSignedResearchWorkClaim({
      identity: laboratoryTwo,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      ...qualificationTwo,
      createdAt: at(9)
    }));
    const mismatchedCustodyClaim = await createSignedResearchWorkClaim({
      identity: laboratoryTwo,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      ...qualificationTwo,
      protocolCustody: { ...qualificationTwo.protocolCustody, protocolHash: fakeHash('5') },
      createdAt: at(9)
    });
    expect(validateResearchRecordLinks(mismatchedCustodyClaim, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['laboratory protocol custody does not match the accepted work order'])
    }));
    const unauthorizedCustodyRoleClaim = await createSignedResearchWorkClaim({
      identity: laboratoryTwo,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      ...qualificationTwo,
      protocolCustody: { ...qualificationTwo.protocolCustody, role: 'owner' },
      createdAt: at(9)
    });
    expect(validateResearchRecordLinks(unauthorizedCustodyRoleClaim, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['laboratory protocol custody role is outside the accepted work order'])
    }));
    const mismatchedSafetyClaim = await createSignedResearchWorkClaim({
      identity: laboratoryTwo,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      ...qualificationTwo,
      safety: { ...qualificationTwo.safety, classification: 'undeclared_protocol_class' },
      createdAt: at(9)
    });
    expect(validateResearchRecordLinks(mismatchedSafetyClaim, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['laboratory safety classification does not match the accepted public non-clinical work order scope'])
    }));
    const cohort = await append(await createSignedEvaluationCohort({
      identity: evaluator,
      roomId: question.roomId,
      label: 'Frozen secretory-function cohort 1',
      questionHashes: [question.recordHash],
      predictionHashes: [predictionOne.recordHash, predictionTwo.recordHash],
      workOrderHashes: [order.recordHash],
      metrics: [{ id: 'balanced_accuracy', label: 'Prospective balanced accuracy', direction: 'higher_is_better', unit: 'fraction' }],
      frozenAt: at(10)
    }));
    await append(await createSignedHumanClaim({
      identity: reviewer,
      roomId: question.roomId,
      targetHash: cohort.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The cohort binds only independently accepted predictions and work orders.',
      confidence: 0.95,
      decision: 'accepted',
      createdAt: at(10)
    }));
    const outcomeOne = await append(await createSignedExperimentalOutcome({
      identity: laboratoryOne,
      roomId: question.roomId,
      questionHash: question.recordHash,
      workOrderHash: order.recordHash,
      workClaimHash: claimOne.recordHash,
      hypothesisHashes: [secretion.recordHash, membrane.recordHash],
      classification: 'positive',
      summary: 'The blinded sample exceeded the declared reporter threshold.',
      attempt: { status: 'completed', failureCategory: 'none', startedAt: at(11), completedAt: at(12) },
      observations: [{ readout: 'extracellular reporter ratio', value: 0.82, unit: 'ratio', normalizedValue: 0.82, uncertainty: { method: 'standard error', value: 0.04, unit: 'ratio' } }],
      protocol,
      analysis: { methodId: 'reporter-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8') },
      executionContext: {
        institutionIdentityHash: fakeHash('a'),
        instrumentIdentityHash: fakeHash('1'),
        sampleBatchHash: fakeHash('2'),
        preparationBatchHash: fakeHash('3'),
        analysisExecutionHash: fakeHash('4')
      },
      uncertainty: { method: 'standard error', value: 0.04, unit: 'ratio' },
      blind: { state: 'sealed', codeHash: fakeHash('9'), allocationHash: fakeHash('6') },
      createdAt: at(12)
    }));
    const unplannedFailure = await createSignedExperimentalOutcome({
      identity: laboratoryTwo,
      roomId: question.roomId,
      questionHash: question.recordHash,
      workOrderHash: order.recordHash,
      workClaimHash: claimTwo.recordHash,
      hypothesisHashes: [secretion.recordHash, membrane.recordHash],
      classification: 'ambiguous',
      summary: 'A deliberately out-of-contract failure category for gate testing.',
      attempt: { status: 'failed', failureCategory: 'binding_failure', completedAt: at(13) },
      observations: [{ readout: 'extracellular reporter ratio', value: 0.1, normalizedValue: 0.1 }],
      protocol,
      analysis: { methodId: 'reporter-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8') },
      executionContext: {
        institutionIdentityHash: fakeHash('e'),
        instrumentIdentityHash: fakeHash('5'),
        sampleBatchHash: fakeHash('6'),
        preparationBatchHash: fakeHash('7'),
        analysisExecutionHash: fakeHash('8')
      },
      uncertainty: { method: 'standard error', value: 0.2, unit: 'ratio' },
      blind: { state: 'sealed', codeHash: fakeHash('b'), allocationHash: fakeHash('6') },
      createdAt: at(13)
    });
    expect(validateResearchRecordLinks(unplannedFailure, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['outcome failure category is outside its accepted work order'])
    }));
    const unplannedAnalysis = await createSignedExperimentalOutcome({
      identity: laboratoryTwo,
      roomId: question.roomId,
      questionHash: question.recordHash,
      workOrderHash: order.recordHash,
      workClaimHash: claimTwo.recordHash,
      hypothesisHashes: [secretion.recordHash, membrane.recordHash],
      classification: 'ambiguous',
      summary: 'A deliberately out-of-contract analysis identity for gate testing.',
      attempt: { status: 'completed', failureCategory: 'none', completedAt: at(13) },
      observations: [{ readout: 'extracellular reporter ratio', value: 0.1, normalizedValue: 0.1 }],
      protocol,
      analysis: { methodId: 'unexpected-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8') },
      executionContext: {
        institutionIdentityHash: fakeHash('e'),
        instrumentIdentityHash: fakeHash('5'),
        sampleBatchHash: fakeHash('6'),
        preparationBatchHash: fakeHash('7'),
        analysisExecutionHash: fakeHash('8')
      },
      uncertainty: { method: 'standard error', value: 0.2, unit: 'ratio' },
      blind: { state: 'sealed', codeHash: fakeHash('c'), allocationHash: fakeHash('6') },
      createdAt: at(13)
    });
    expect(validateResearchRecordLinks(unplannedAnalysis, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['outcome analysis does not match its accepted work order'])
    }));
    const sharedInstrumentReplica = await createSignedExperimentalOutcome({
      identity: laboratoryTwo,
      roomId: question.roomId,
      questionHash: question.recordHash,
      workOrderHash: order.recordHash,
      workClaimHash: claimTwo.recordHash,
      hypothesisHashes: [secretion.recordHash, membrane.recordHash],
      classification: 'positive',
      summary: 'A replica that improperly shares the original instrument identity.',
      attempt: { status: 'completed', failureCategory: 'none', completedAt: at(13) },
      observations: [{ readout: 'extracellular reporter ratio', value: 0.8, normalizedValue: 0.8 }],
      protocol,
      analysis: { methodId: 'reporter-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8'), lineageHashes: [outcomeOne.recordHash] },
      executionContext: {
        institutionIdentityHash: fakeHash('e'),
        instrumentIdentityHash: fakeHash('1'),
        sampleBatchHash: fakeHash('6'),
        preparationBatchHash: fakeHash('7'),
        analysisExecutionHash: fakeHash('8')
      },
      uncertainty: { method: 'standard error', value: 0.05, unit: 'ratio' },
      blind: { state: 'sealed', codeHash: fakeHash('d'), allocationHash: fakeHash('6') },
      replicationOfHash: outcomeOne.recordHash,
      createdAt: at(13)
    });
    expect(validateResearchRecordLinks(sharedInstrumentReplica, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['replication is not independent across declared dimension: instrument'])
    }));
    const outcomeTwo = await append(await createSignedExperimentalOutcome({
      identity: laboratoryTwo,
      roomId: question.roomId,
      questionHash: question.recordHash,
      workOrderHash: order.recordHash,
      workClaimHash: claimTwo.recordHash,
      hypothesisHashes: [secretion.recordHash, membrane.recordHash],
      classification: 'ambiguous',
      summary: 'The independent replica crossed the threshold but control variance was high.',
      attempt: { status: 'failed', failureCategory: 'inconclusive', failureDetail: 'Control variance exceeded the acceptance criterion.', startedAt: at(13), completedAt: at(14) },
      observations: [{ readout: 'extracellular reporter ratio', value: 0.74, unit: 'ratio', normalizedValue: 0.74, uncertainty: { method: 'standard error', value: 0.2, unit: 'ratio' } }],
      protocol,
      analysis: { methodId: 'reporter-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8'), lineageHashes: [outcomeOne.recordHash] },
      executionContext: {
        institutionIdentityHash: fakeHash('e'),
        instrumentIdentityHash: fakeHash('5'),
        sampleBatchHash: fakeHash('6'),
        preparationBatchHash: fakeHash('7'),
        analysisExecutionHash: fakeHash('8')
      },
      uncertainty: { method: 'standard error', value: 0.2, unit: 'ratio', description: 'Control variance caused ambiguity.' },
      blind: { state: 'sealed', codeHash: fakeHash('a'), allocationHash: fakeHash('6') },
      replicationOfHash: outcomeOne.recordHash,
      createdAt: at(14)
    }));
    for (const [outcome, minute] of [[outcomeOne, 15], [outcomeTwo, 16]]) {
      await append(await createSignedHumanClaim({
        identity: reviewer,
        roomId: question.roomId,
        targetHash: outcome.recordHash,
        claimKind: 'review_decision',
        relation: 'reviews',
        text: 'Protocol, failure state, uncertainty, and lineage are complete.',
        confidence: 0.9,
        decision: 'accepted',
        createdAt: at(minute)
      }));
    }
    const tasksAfterFailure = proposeDiscoveryTasks(records);
    expect(tasksAfterFailure).toContainEqual(expect.objectContaining({
      kind: 'diagnose_failed_attempt',
      targetHash: outcomeTwo.recordHash,
      basis: 'accepted_memory',
      basisHashes: [order.recordHash, outcomeTwo.recordHash].sort()
    }));
    expect(tasksAfterFailure).toContainEqual(expect.objectContaining({
      kind: 'replicate_assay',
      targetHash: order.recordHash,
      basis: 'accepted_memory',
      basisHashes: expect.arrayContaining([order.recordHash, outcomeOne.recordHash, outcomeTwo.recordHash])
    }));
    const evaluation = await append(await createSignedCohortEvaluation({
      identity: evaluator,
      roomId: question.roomId,
      cohortHash: cohort.recordHash,
      outcomeHashes: [outcomeOne.recordHash, outcomeTwo.recordHash],
      metricResults: [{ metricId: 'balanced_accuracy', direction: 'higher_is_better', baselineValue: 0.5, currentValue: 0.7 }],
      disagreementSummary: 'Predictors disagreed under the same conditions; one positive and one ambiguous assay record preserve that disagreement.',
      failureAnalysis: 'The independent replica exposed control variance and remains part of the measured cohort.',
      nextCohortQuestionHashes: [question.recordHash],
      createdAt: at(17)
    }));

    expect(buildPredictionDisagreementMap(records, question.recordHash)).toEqual([
      expect.objectContaining({ predictionCount: 2, disagreement: true, unresolved: true })
    ]);
    const lifecycle = buildQuestionLifecycles(records)[0];
    expect(lifecycle).toMatchObject({
      hypotheses: expect.arrayContaining([secretion, membrane]),
      priorEvidence: [prior],
      predictions: expect.arrayContaining([predictionOne, predictionTwo]),
      resolutionPolicies: [resolutionPolicy],
      workOrders: [order],
      workClaims: expect.arrayContaining([claimOne, claimTwo]),
      outcomes: expect.arrayContaining([outcomeOne, outcomeTwo]),
      cohorts: [cohort],
      evaluations: [evaluation]
    });
    expect(lifecycle.measuredEffects).toContainEqual(expect.objectContaining({
      metricId: 'balanced_accuracy',
      improved: true
    }));
    expect(lifecycle.measuredEffects[0].absoluteDelta).toBeCloseTo(0.2);
    expect(projectResearchReviewStates(records)).toContainEqual(expect.objectContaining({
      recordHash: outcomeTwo.recordHash,
      state: 'accepted'
    }));

    const revocation = await append(await createSignedResearchRevocation({
      identity: laboratoryTwo,
      roomId: question.roomId,
      targetHash: outcomeTwo.recordHash,
      reason: 'Laboratory consent for future reuse was withdrawn.',
      createdAt: at(18)
    }));
    expect(revocation.revocation.scope).toBe('future_use');
    const activeHashes = new Set(activeResearchRecords(records).map((record) => record.recordHash));
    expect(activeHashes.has(outcomeTwo.recordHash)).toBe(false);
    expect(activeHashes.has(evaluation.recordHash)).toBe(false);
    expect(records).toContain(outcomeTwo);
  });
});
