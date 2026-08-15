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
  createSignedResearchRevocation,
  createSignedResearchSubmission,
  createSignedResearchWorkClaim,
  createSignedResearchWorkOrder,
  projectResearchReviewStates,
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
      createdAt: at(6)
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
    const claimOne = await append(await createSignedResearchWorkClaim({
      identity: laboratoryOne,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      laboratory: { id: 'lab-one', name: 'Laboratory One', institution: 'Public Institute One' },
      capabilities: ['cell-free reporter assay'],
      consent: { publicLaboratoryIdentity: true, publishOutcome: true, acknowledgedAt: at(8) },
      createdAt: at(8)
    }));
    const claimTwo = await append(await createSignedResearchWorkClaim({
      identity: laboratoryTwo,
      roomId: question.roomId,
      workOrderHash: order.recordHash,
      laboratory: { id: 'lab-two', name: 'Laboratory Two', institution: 'Public Institute Two' },
      capabilities: ['independent cell-free reporter replication'],
      consent: { publicLaboratoryIdentity: true, publishOutcome: true, acknowledgedAt: at(9) },
      createdAt: at(9)
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
      uncertainty: { method: 'standard error', value: 0.04, unit: 'ratio' },
      blind: { state: 'sealed', codeHash: fakeHash('9'), allocationHash: fakeHash('6') },
      createdAt: at(12)
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
