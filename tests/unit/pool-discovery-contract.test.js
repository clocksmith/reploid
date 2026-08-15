import { describe, expect, it } from 'vitest';

import {
  createDiscoveryContractCheckpoint,
  projectDiscoveryCheckpointStatus,
  projectDiscoveryContractState,
  validateDiscoveryContractCheckpoint
} from '../../self/pool/discovery-contract.js';
import {
  createSignedDiscoveryCheckpoint,
  createSignedCandidateAction,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedResearchHypothesis,
  createSignedResearchRevocation,
  createSignedResearchSubmission,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel } from '../../self/pool/model-contract.js';

const at = (minute) => `2026-08-15T12:${String(minute).padStart(2, '0')}:00.000Z`;
const fakeHash = (character) => `sha256:${character.repeat(64)}`;

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

const fixture = async () => {
  const requester = await identity('requester', 'contract-requester');
  const researcher = await identity('researcher', 'contract-researcher');
  const reviewerOne = await identity('reviewer', 'contract-reviewer-one');
  const reviewerTwo = await identity('reviewer', 'contract-reviewer-two');
  const checkpointSigner = await identity('reviewer', 'contract-checkpoint-signer');
  const question = await createSignedResearchSubmission({
    identity: requester,
    roomId: 'discovery-contract-room',
    sequence: 'MAPLALLLLGLVAGA',
    intent: {
      kind: 'question',
      text: 'Should this disputed public domain annotation be retained?',
      decisionContext: 'Catalog release adjudication',
      conditions: 'Public protein sequence',
      scope: 'Residues 2-12',
      exclusions: 'No biological-function claim',
      desiredObservation: 'Version-pinned annotation evidence'
    },
    consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
    modelContract: buildLaunchProviderModel(),
    policyId: 'redundant_agreement',
    createdAt: at(0)
  });
  const prior = await createSignedPriorEvidence({
    identity: researcher,
    roomId: question.roomId,
    questionHash: question.recordHash,
    evidenceKind: 'annotation',
    summary: 'Catalog release seven assigns the disputed domain.',
    reference: { accession: 'PUBLIC:CONTRACT:123', version: '7' },
    annotation: {
      scope: 'domain',
      ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:CONTRACT:123', version: '7' },
      sequence: { hash: question.sequence.hash, length: question.sequence.length },
      coordinates: { sourceSystem: 'protein_residue_one_based_closed', sourceStart: 2, sourceEnd: 12 }
    },
    provenance: { retrievalMethod: 'version-pinned catalog API', license: 'CC BY 4.0' },
    createdAt: at(1)
  });
  const acceptance = await createSignedHumanClaim({
    identity: reviewerOne,
    roomId: question.roomId,
    targetHash: prior.recordHash,
    claimKind: 'review_decision',
    relation: 'reviews',
    text: 'The version and bounded coordinates are adequate for this decision.',
    confidence: 0.9,
    decision: 'accepted',
    createdAt: at(2)
  });
  return {
    requester,
    researcher,
    reviewerOne,
    reviewerTwo,
    checkpointSigner,
    question,
    prior,
    acceptance,
    records: [question, prior, acceptance]
  };
};

describe('Poolday Discovery Contract checkpoints', () => {
  it('signs and exactly replays one deterministic contract revision', async () => {
    const data = await fixture();
    const firstProjection = await projectDiscoveryContractState(data.records, {
      questionHash: data.question.recordHash
    });
    const secondProjection = await projectDiscoveryContractState([...data.records].reverse(), {
      questionHash: data.question.recordHash
    });
    expect(secondProjection).toEqual(firstProjection);

    const checkpoint = await createDiscoveryContractCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      records: data.records,
      createdAt: at(3)
    });

    expect(checkpoint).toMatchObject({
      kind: 'research_discovery_checkpoint',
      signatureDomain: 'poolday.research_discovery_checkpoint.v1',
      checkpoint: {
        schema: 'poolday.discovery_contract_checkpoint/v1',
        questionHash: data.question.recordHash,
        parentCheckpointHashes: [],
        inputRecordHashes: data.records.map((record) => record.recordHash),
        state: {
          schema: 'poolday.discovery_contract_state/v2',
          status: 'open',
          decisionMemory: { acceptedHashes: [data.prior.recordHash] },
          reopen: { required: false }
        }
      }
    });
    expect(await verifyResearchRecord(checkpoint)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(checkpoint, data.records)).toMatchObject({ ok: true });
    expect(await validateDiscoveryContractCheckpoint(checkpoint, data.records, {
      requireCurrentCompleteness: true
    })).toEqual({ ok: true, reasons: [] });
    expect((await projectDiscoveryCheckpointStatus([...data.records, checkpoint], {
      questionHash: data.question.recordHash
    })).status).toBe('current');
  });

  it('checkpoints the exact signed candidate-action ranking and approval boundary', async () => {
    const data = await fixture();
    const hypothesis = await createSignedResearchHypothesis({
      identity: data.researcher,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      statement: 'The bounded domain annotation should be retained.',
      conditions: { biologicalSystem: 'public catalog release seven' },
      discriminatingObservations: ['An independent version-pinned catalog reports the same bounded domain.'],
      createdAt: at(3)
    });
    const candidate = await createSignedCandidateAction({
      identity: data.researcher,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      action: {
        kind: 'retrieval',
        title: 'Retrieve an independent pinned annotation',
        rationale: 'A separate catalog could resolve the disputed domain assignment.',
        affectedHypothesisHashes: [hypothesis.recordHash],
        predictedObservations: [{ observation: 'The source reports the same bounded domain.', affectedHypothesisHashes: [hypothesis.recordHash] }],
        falsifiers: [{ hypothesisHash: hypothesis.recordHash, observation: 'The source reports an incompatible bounded domain.' }],
        execution: { contractKind: 'workload', contractId: 'catalog-retrieval', version: '1.0.0', artifactHash: fakeHash('a'), parametersHash: fakeHash('b') },
        uncertainty: [{ source: 'cross_source_disagreement', representation: 'ordinal', rationale: 'Public sources disagree.', ordinal: { level: 'high', scaleId: 'poolday.uncertainty.v1', scaleVersion: '1.0.0' } }],
        feasibility: { status: 'feasible', requiredCapabilities: ['version-pinned retrieval'], availability: 'Public release available.', materials: [], failureRisks: ['Historical endpoint unavailable.'] },
        independence: { dimensions: ['source organization'], exclusions: [], minimumIndependentExecutions: 1 },
        safety: { classification: 'public-data-only', requirements: ['Use only public records.'], reviewRequired: true },
        consent: { publicSequenceRequired: true, publicEvidencePublicationRequired: true, additionalRequirements: [] },
        scientificCost: {
          compute: { amount: 1, unit: 'cpu-second', burden: 0 },
          money: { amount: 0, unit: 'USD', burden: 0 },
          labor: { amount: 0.25, unit: 'person-hour', burden: 1 },
          instrument: { amount: 0, unit: 'instrument-hour', burden: 0 },
          sample: { amount: 0, unit: 'sample', burden: 0 },
          elapsedTime: { amount: 0.25, unit: 'hour', burden: 1 },
          assumptions: ['The public endpoint remains available.']
        },
        expectedValue: {
          status: 'heuristic_not_calibrated',
          method: { id: 'curator-declared-ordinal-value', version: '1.0.0' },
          uncertaintyReduction: 4,
          decisionRelevance: 5,
          duplicateWorkAvoidance: 3,
          calibrationEvidenceHashes: []
        }
      },
      createdAt: at(4)
    });
    const approval = await createSignedHumanClaim({
      identity: data.reviewerTwo,
      roomId: data.question.roomId,
      targetHash: candidate.recordHash,
      claimKind: 'candidate_action_approval',
      relation: 'approves',
      decision: 'approved',
      actionContractHash: candidate.action.contractHash,
      text: 'Approve the exact bounded retrieval contract.',
      confidence: 0.95,
      createdAt: at(5)
    });
    const records = [...data.records, hypothesis, candidate, approval];
    const projected = await projectDiscoveryContractState(records, { questionHash: data.question.recordHash });

    expect(projected.state.candidateActions).toMatchObject({
      schema: 'poolday.discovery_candidate_action_ranking/v1',
      policy: { policyId: 'poolday.signed_candidate_action_heuristic/v1', status: 'heuristic_not_calibrated' },
      selectedAction: {
        recordHash: candidate.recordHash,
        actionId: candidate.action.contractHash,
        humanApprovalState: 'approved',
        allocationAuthority: 'none',
        executionAuthority: 'none'
      },
      allocationAuthority: 'none',
      executionAuthority: 'none'
    });
    expect(projected.state.decisionMemory.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordHash: candidate.recordHash, reason: 'candidate_action_is_a_governance_proposal' })
    ]));
    const checkpoint = await createDiscoveryContractCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      records,
      createdAt: at(6)
    });
    expect(await validateDiscoveryContractCheckpoint(checkpoint, records, { requireCurrentCompleteness: true }))
      .toEqual({ ok: true, reasons: [] });
  });

  it('fails closed for missing, cross-room, or wrong-projection inputs', async () => {
    const data = await fixture();
    const projected = await projectDiscoveryContractState(data.records, {
      questionHash: data.question.recordHash
    });
    const checkpoint = await createSignedDiscoveryCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      checkpoint: projected,
      createdAt: at(3)
    });
    expect((await validateDiscoveryContractCheckpoint(checkpoint, [data.question])).reasons)
      .toContain('Discovery Contract replay input is missing');

    const otherQuestion = await createSignedResearchSubmission({
      identity: data.requester,
      roomId: 'other-contract-room',
      sequence: data.question.sequence.value,
      intent: { kind: 'question', text: 'A different room question.' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: buildLaunchProviderModel(),
      policyId: 'redundant_agreement',
      createdAt: at(1)
    });
    const crossRoomCheckpoint = await createSignedDiscoveryCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      checkpoint: {
        ...projected,
        inputRecordHashes: [...projected.inputRecordHashes, otherQuestion.recordHash],
        activeInputRecordHashes: [...projected.activeInputRecordHashes, otherQuestion.recordHash]
      },
      createdAt: at(3)
    });
    expect(validateResearchRecordLinks(crossRoomCheckpoint, [...data.records, otherQuestion]).reasons)
      .toContain(`linked research record belongs to a different room: ${otherQuestion.recordHash}`);

    await expect(createSignedDiscoveryCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      checkpoint: {
        ...projected,
        projection: { ...projected.projection, id: 'poolday.unsupported_projection/v1' }
      }
    })).rejects.toThrow('projection id is unsupported');
  });

  it('replays legacy v1 checkpoints and requires a v2 checkpoint for the candidate-action projection', async () => {
    const data = await fixture();
    const legacyProjection = await projectDiscoveryContractState(data.records, {
      questionHash: data.question.recordHash,
      projectionId: 'poolday.discovery_contract_projection/v1'
    });
    expect(legacyProjection).toMatchObject({
      projection: { id: 'poolday.discovery_contract_projection/v1' },
      state: { schema: 'poolday.discovery_contract_state/v1' }
    });
    expect(legacyProjection.state).not.toHaveProperty('candidateActions');
    const legacyCheckpoint = await createSignedDiscoveryCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      checkpoint: legacyProjection,
      createdAt: at(3)
    });
    expect(await validateDiscoveryContractCheckpoint(legacyCheckpoint, data.records, {
      requireCurrentCompleteness: true
    })).toEqual({ ok: true, reasons: [] });
    expect(await projectDiscoveryCheckpointStatus([...data.records, legacyCheckpoint], {
      questionHash: data.question.recordHash
    })).toMatchObject({ status: 'stale' });

    const upgraded = await createDiscoveryContractCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      records: [...data.records, legacyCheckpoint],
      parentCheckpointHashes: [legacyCheckpoint.recordHash],
      createdAt: at(4)
    });
    expect(upgraded.checkpoint).toMatchObject({
      projection: { id: 'poolday.discovery_contract_projection/v2' },
      state: { schema: 'poolday.discovery_contract_state/v2', candidateActions: { admittedCandidates: [] } }
    });
    expect(await validateDiscoveryContractCheckpoint(upgraded, [...data.records, legacyCheckpoint], {
      requireCurrentCompleteness: true
    })).toEqual({ ok: true, reasons: [] });
  });

  it('supersedes a parent and deterministically reopens on correction and revocation', async () => {
    const data = await fixture();
    const parent = await createDiscoveryContractCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      records: data.records,
      createdAt: at(3)
    });
    const forbiddenParentRevocation = await createSignedResearchRevocation({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      targetHash: parent.recordHash,
      reason: 'A checkpoint must be superseded by lineage rather than revoked.',
      createdAt: at(4)
    });
    expect(validateResearchRecordLinks(forbiddenParentRevocation, [...data.records, parent])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['Discovery Contract checkpoints cannot be revoked; append a child checkpoint'])
    });
    await expect(createDiscoveryContractCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      records: [...data.records, parent],
      parentCheckpointHashes: [parent.recordHash],
      createdAt: at(4)
    })).rejects.toThrow('child input set is unchanged from parent');
    const reducedProjection = await projectDiscoveryContractState([data.question], {
      questionHash: data.question.recordHash
    });
    const childMissingParentInputs = await createSignedDiscoveryCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      checkpoint: {
        ...reducedProjection,
        parentCheckpointHashes: [parent.recordHash]
      },
      createdAt: at(4)
    });
    expect(validateResearchRecordLinks(childMissingParentInputs, [...data.records, parent])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        `discovery checkpoint must retain parent archive input: ${data.prior.recordHash}`,
        `discovery checkpoint must retain parent archive input: ${data.acceptance.recordHash}`
      ])
    });
    const correction = await createSignedHumanClaim({
      identity: data.researcher,
      roomId: data.question.roomId,
      targetHash: data.prior.recordHash,
      claimKind: 'correction',
      relation: 'corrects',
      text: 'The source supports only the bounded domain, not a full-length family assignment.',
      confidence: 0.95,
      createdAt: at(4)
    });
    const correctionAcceptance = await createSignedHumanClaim({
      identity: data.reviewerTwo,
      roomId: data.question.roomId,
      targetHash: correction.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accept the bounded correction and supersede the broader source claim.',
      confidence: 0.95,
      decision: 'accepted',
      createdAt: at(5)
    });
    const correctedRecords = [...data.records, parent, correction, correctionAcceptance];
    const stale = await projectDiscoveryCheckpointStatus(correctedRecords, {
      questionHash: data.question.recordHash
    });
    expect(stale).toMatchObject({
      status: 'reopen_required',
      prospectiveState: {
        status: 'reopened',
        reopen: {
          required: true,
          triggerKinds: expect.arrayContaining(['correction', 'decision_memory_reopened'])
        }
      }
    });

    const child = await createDiscoveryContractCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      records: correctedRecords,
      parentCheckpointHashes: [parent.recordHash],
      createdAt: at(6)
    });
    expect(child.checkpoint).toMatchObject({
      parentCheckpointHashes: [parent.recordHash],
      state: {
        status: 'reopened',
        reopen: { triggerKinds: expect.arrayContaining(['correction', 'decision_memory_reopened']) },
        decisionMemory: { acceptedHashes: [correction.recordHash] }
      }
    });
    expect(await validateDiscoveryContractCheckpoint(child, correctedRecords, {
      requireCurrentCompleteness: true
    })).toEqual({ ok: true, reasons: [] });

    const revocation = await createSignedResearchRevocation({
      identity: data.researcher,
      roomId: data.question.roomId,
      targetHash: data.prior.recordHash,
      reason: 'The imported source record was withdrawn from future use.',
      createdAt: at(7)
    });
    const revokedRecords = [...correctedRecords, child, revocation];
    const grandchild = await createDiscoveryContractCheckpoint({
      identity: data.checkpointSigner,
      roomId: data.question.roomId,
      questionHash: data.question.recordHash,
      records: revokedRecords,
      parentCheckpointHashes: [child.recordHash],
      createdAt: at(8)
    });
    expect(grandchild.checkpoint.state).toMatchObject({
      status: 'reopened',
      reopen: {
        triggerKinds: expect.arrayContaining(['revocation', 'policy_active_input_invalidated']),
        invalidatedParentInputHashes: expect.arrayContaining([data.prior.recordHash])
      }
    });
    expect(grandchild.checkpoint.inputRecordHashes).toContain(revocation.recordHash);
    expect(grandchild.checkpoint.activeInputRecordHashes).not.toContain(data.prior.recordHash);
    expect(await validateDiscoveryContractCheckpoint(grandchild, revokedRecords, {
      requireCurrentCompleteness: true
    })).toEqual({ ok: true, reasons: [] });
  });
});
