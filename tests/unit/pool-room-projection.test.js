import { describe, expect, it } from 'vitest';

import { projectResearchRoom } from '../../apps/poolday/ui/pool-home/room-projection.js';

const hash = (character) => {
  const hex = String(character).codePointAt(0).toString(16).padStart(2, '0');
  return `sha256:${hex.repeat(Math.ceil(64 / hex.length)).slice(0, 64)}`;
};

const model = {
  id: 'room-model',
  hash: hash('1'),
  manifestHash: hash('2'),
  tokenizerHash: hash('3'),
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: 'sequence.embedding.v1',
  executionMode: 'full_model_browser_sequence',
  dimensions: 3
};

const submission = ({ roomId = 'room-projection', identityRootId = 'requester-root' } = {}) => ({
  kind: 'research_submission',
  recordHash: hash('a'),
  roomId,
  createdAt: '2026-08-09T10:00:00.000Z',
  author: { identityRootId, userId: `${identityRootId}-user`, roleId: 'requester' },
  sequence: { alphabet: 'amino_acid', value: 'MAPLALLLLGLVAGA', hash: hash('b'), length: 15 },
  consent: {
    publicSequence: true,
    publicEvidenceNetwork: true,
    publishEmbedding: true,
    publishResidueEvidence: false
  },
  requesterIntent: { kind: 'question', label: 'Inspect the sequence', text: 'What should reviewers inspect next?' },
  modelContract: model,
  policyId: 'redundant_agreement'
});

const result = ({ roomId = 'room-projection', submissionHash = hash('a'), agreement = null } = {}) => {
  const receiptHashes = agreement?.receiptHashes || [hash('d')];
  const providerIds = agreement?.providerIds || ['provider-one'];
  return ({
  kind: 'research_result',
  recordHash: hash('c'),
  roomId,
  createdAt: '2026-08-09T10:05:00.000Z',
  author: { identityRootId: 'requester-root', userId: 'requester-user', roleId: 'requester' },
  submissionHash,
  sequenceHash: hash('b'),
  sequenceLength: 15,
  modelContract: model,
  compute: {
    receiptHash: hash('d'),
    receiptHashes,
    receiptEvidence: receiptHashes.map((receiptHash, index) => ({
      receiptHash,
      providerId: providerIds[index] || `provider-${index + 1}`,
      providerPublicKey: `provider-${index + 1}-public-key`,
      receipt: {
        providerId: providerIds[index] || `provider-${index + 1}`,
        providerSignature: `provider-${index + 1}-signature`
      }
    })),
    agreement,
    providerId: 'provider-one',
    runtimeProfileHash: hash('e')
  },
  embedding: { dimensions: 3, values: [1, 0, 0], vectorHash: hash('f') },
  sequenceEvidence: {
    sequenceResultHash: hash('f'),
    residueEmbeddings: [{ sequenceIndex: 2, values: [1, 0, 0] }]
  }
  });
};

const reviewDecision = (targetHash, decision, identityRootId = 'reviewer-root', recordHash = null) => ({
  kind: 'human_claim',
  recordHash: recordHash || hash(`${decision[0]}${identityRootId[0]}`),
  roomId: 'room-projection',
  createdAt: '2026-08-09T10:06:00.000Z',
  targetHash,
  author: { identityRootId, userId: `${identityRootId}-user`, roleId: 'reviewer' },
  claim: { kind: 'review_decision', relation: 'reviews', decision, text: `Evidence is ${decision}.` }
});

const acceptedReview = (targetHash) => reviewDecision(targetHash, 'accepted');

describe('Research Room projection', () => {

  it('projects accepted evidence into memory without exposing raw vectors', () => {
    const question = submission();
    const answer = result({ agreement: { status: 'accepted', receiptHashes: [hash('d'), hash('g')], providerIds: ['provider-one', 'provider-two'] } });
    const room = projectResearchRoom({
      roomId: question.roomId,
      routeId: 'home',
      researchRecords: [question, answer, acceptedReview(answer.recordHash)],
      receipts: [{ receiptHash: hash('d'), provider: 'provider-one', fidelity: 'accepted', occurredAt: answer.createdAt }],
      peerEvents: [{ type: 'provider-advert', fromPeerId: 'provider-one', createdAt: answer.createdAt }]
    });

    expect(room.status).toBe('remembered');
    expect(room.question).toMatchObject({
      submissionHash: question.recordHash,
      sequenceHash: question.sequence.hash,
      sequenceLength: 15,
      policyId: 'redundant_agreement'
    });
    expect(room.latestResult).toMatchObject({
      sourceHash: answer.recordHash,
      status: 'accepted',
      embeddingDimensions: 3,
      receiptHash: hash('d'),
      agreement: { state: 'agreement_assessed', label: 'Agreement assessed' },
      publication: { sequence: true, embedding: true, residue: false }
    });
    expect(room.latestResult.uncertainty).toEqual(expect.arrayContaining([
      expect.stringContaining('Fewer than two exact model contracts')
    ]));
    expect(room.latestResult.embedding).toBeUndefined();
    expect(room.latestResult.hasRawEmbedding).toBe(true);
    expect(room.memory.map((entry) => entry.sourceHash)).toEqual([answer.recordHash]);
    expect(room.archive).toMatchObject({
      schema: 'poolday.complete_room_evidence_archive/v1',
      boundary: 'verified_local_snapshot'
    });
    expect(room.archive.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordHash: question.recordHash, state: 'provisional', decisionMemoryAdmitted: false }),
      expect.objectContaining({ recordHash: answer.recordHash, state: 'accepted', decisionMemoryAdmitted: true })
    ]));
    expect(room.decisionMemory).toMatchObject({
      schema: 'poolday.decision_memory_projection/v1',
      policyId: 'poolday.accepted-memory-feedback/v1',
      admissionPolicy: 'independent_review_fail_closed',
      decisionContextHash: question.recordHash,
      sourceArchiveSchema: room.archive.schema,
      acceptedHashes: [answer.recordHash]
    });
    expect(room.proposals).toEqual([]);
    expect(room.participants.contributors).toEqual([
      expect.objectContaining({ id: 'provider-one', role: 'contributor' })
    ]);
    expect(room.timeline.some((entry) => entry.sourceAuthority === 'peer_ledger')).toBe(true);
    expect(room.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'agreement', title: 'Agreement assessed', sourceHash: answer.recordHash })
    ]));
  });

  it('keeps agreement explicitly unassessed when no signed agreement exists', () => {
    const question = submission({ roomId: 'unassessed-room' });
    const answer = result({ roomId: 'unassessed-room', submissionHash: question.recordHash });
    answer.recordHash = hash('h');
    answer.compute.agreement = null;
    const room = projectResearchRoom({
      roomId: 'unassessed-room',
      researchRecords: [question, answer]
    });

    expect(room.latestResult.agreement).toEqual({
      state: 'not_assessed',
      label: 'Not assessed',
      sourceHash: answer.recordHash
    });
    expect(room.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'agreement', title: 'Agreement not assessed' }),
      expect.objectContaining({ kind: 'review', title: 'Result awaits review' })
    ]));
    expect(room.memory).toHaveLength(0);
  });

  it('does not remember a reviewed result until independent execution exists', () => {
    const question = submission({ roomId: 'single-provider-room' });
    const answer = result({ roomId: question.roomId, submissionHash: question.recordHash });
    answer.recordHash = hash('q');
    const acceptance = {
      ...acceptedReview(answer.recordHash),
      roomId: question.roomId,
      recordHash: hash('w')
    };
    const room = projectResearchRoom({
      roomId: question.roomId,
      researchRecords: [question, answer, acceptance]
    });

    expect(room.status).toBe('awaiting_replication');
    expect(room.latestResult).toMatchObject({
      sourceHash: answer.recordHash,
      reviewState: 'accepted',
      status: 'accepted_pending_replication'
    });
    expect(room.memory).toEqual([]);
    expect(room.memoryExclusions).toContainEqual(expect.objectContaining({
      recordHash: answer.recordHash,
      reason: 'independent_execution_missing'
    }));
    expect(room.unresolved).toContainEqual(expect.objectContaining({
      kind: 'replication',
      title: 'Accepted result needs independent execution'
    }));
    expect(room.recovery.states).toContain('awaiting_replication');
  });

  it('keeps rejected and needs-revision results out of memory while exposing the decision', () => {
    const question = submission();
    const rejected = result({ submissionHash: question.recordHash });
    rejected.recordHash = hash('r');
    const revised = result({ submissionHash: question.recordHash });
    revised.recordHash = hash('s');
    revised.createdAt = '2026-08-09T10:07:00.000Z';
    const room = projectResearchRoom({
      roomId: question.roomId,
      researchRecords: [
        question,
        rejected,
        revised,
        reviewDecision(rejected.recordHash, 'rejected', 'reviewer-reject', hash('v')),
        reviewDecision(revised.recordHash, 'needs_revision', 'reviewer-revise', hash('x'))
      ]
    });

    expect(room.latestResult).toMatchObject({
      sourceHash: revised.recordHash,
      status: 'needs_revision',
      reviewState: 'needs_revision'
    });
    expect(room.unresolved).toContainEqual(expect.objectContaining({
      kind: 'review',
      title: 'Result needs revision'
    }));
    expect(room.memory).toHaveLength(0);
    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: revised.recordHash,
      state: 'needs_revision'
    }));
    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: rejected.recordHash,
      state: 'rejected'
    }));
  });

  it('does not remember a result when independent reviewers disagree', () => {
    const question = submission();
    const answer = result({ submissionHash: question.recordHash });
    answer.recordHash = hash('t');
    const room = projectResearchRoom({
      roomId: question.roomId,
      researchRecords: [
        question,
        answer,
        reviewDecision(answer.recordHash, 'accepted', 'reviewer-accept'),
        reviewDecision(answer.recordHash, 'rejected', 'reviewer-reject')
      ]
    });

    expect(room.latestResult).toMatchObject({
      sourceHash: answer.recordHash,
      status: 'disputed',
      agreement: { state: 'disagreement_assessed', label: 'Disagreement assessed' }
    });
    expect(room.unresolved).toContainEqual(expect.objectContaining({
      kind: 'agreement',
      title: 'Disagreement assessed'
    }));
    expect(room.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'agreement', title: 'Disagreement assessed', sourceHash: answer.recordHash })
    ]));
    expect(room.memory).toHaveLength(0);
    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: answer.recordHash,
      state: 'disputed'
    }));
  });

  it('keeps invalidated history visible as a recovery boundary', () => {
    const question = submission({ roomId: 'invalidated-room' });
    const revocation = {
      kind: 'research_revocation',
      recordHash: hash('l'),
      roomId: question.roomId,
      targetHash: question.recordHash,
      createdAt: '2026-08-09T10:10:00.000Z'
    };
    const room = projectResearchRoom({
      roomId: question.roomId,
      researchRecords: [question, revocation],
      syncState: { phase: 'synchronized', remote: 'synchronized' }
    });

    expect(room.recovery.states).toContain('invalidated');
    expect(room.counts.invalidated).toBe(1);
    expect(room.timeline.some((entry) => entry.status === 'invalidated')).toBe(true);
    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: question.recordHash,
      state: 'revoked'
    }));
    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: revocation.recordHash,
      state: 'revocation_recorded'
    }));
  });

  it('retains failed outcome evidence in the archive while excluding it from decision memory', () => {
    const question = submission({ roomId: 'failed-outcome-room' });
    const failedOutcome = {
      kind: 'research_outcome',
      recordHash: hash('u'),
      roomId: question.roomId,
      createdAt: '2026-08-09T10:09:00.000Z',
      questionHash: question.recordHash,
      author: { identityRootId: 'researcher-root', roleId: 'researcher' },
      outcome: {
        classification: 'ambiguous',
        summary: 'The assay failed before its declared readout.',
        attempt: { status: 'failed', failureCategory: 'instrument_failure' }
      }
    };
    const room = projectResearchRoom({
      roomId: question.roomId,
      researchRecords: [question, failedOutcome]
    });

    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: failedOutcome.recordHash,
      state: 'failed',
      summary: failedOutcome.outcome.summary,
      decisionMemoryAdmitted: false
    }));
    expect(room.decisionMemory.acceptedHashes).toEqual([]);
    expect(room.decisionMemory.excluded).toContainEqual(expect.objectContaining({
      recordHash: failedOutcome.recordHash,
      state: 'failed'
    }));
  });

  it('isolates rooms and keeps participant identity labels consent-scoped', () => {
    const question = submission({ roomId: 'room-a' });
    const other = submission({ roomId: 'room-b', identityRootId: 'other-root' });
    const room = projectResearchRoom({ roomId: 'room-a', researchRecords: [question, other] });

    expect(room.counts.records).toBe(1);
    expect(room.participants.requester).toMatchObject({
      id: 'requester-root',
      label: expect.not.stringContaining('requester-user')
    });
    expect(room.timeline).toHaveLength(1);
  });

  it('does not merge room-tagged receipts or peer activity across rooms', () => {
    const question = submission({ roomId: 'room-a' });
    const roomAReceipt = { roomId: 'room-a', receiptHash: hash('m'), provider: 'provider-a', occurredAt: question.createdAt };
    const roomBReceipt = { roomId: 'room-b', receiptHash: hash('n'), provider: 'provider-b', occurredAt: question.createdAt };
    const room = projectResearchRoom({
      roomId: 'room-a',
      researchRecords: [question],
      receipts: [roomAReceipt, roomBReceipt],
      peerEvents: [
        { roomId: 'room-a', type: 'provider-advert', fromPeerId: 'provider-a', createdAt: question.createdAt },
        { roomId: 'room-b', type: 'provider-advert', fromPeerId: 'provider-b', createdAt: question.createdAt }
      ]
    });

    expect(room.timeline.map((entry) => entry.sourceHash)).not.toContain(roomBReceipt.receiptHash);
    expect(room.participants.peers.map((entry) => entry.id)).toEqual(['provider-a']);
  });
});
