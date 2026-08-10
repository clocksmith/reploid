import { describe, expect, it } from 'vitest';

import { projectResearchRoom } from '../../self/ui/pool-home/room-projection.js';
import { renderResearchRoom } from '../../self/ui/pool-home/room-view.js';

const hash = (character) => `sha256:${character.repeat(64)}`;

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

const result = ({ roomId = 'room-projection', submissionHash = hash('a'), agreement = null } = {}) => ({
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
  it('routes an evidence-unavailable room to requester controls', () => {
    const html = renderResearchRoom({ roomId: 'empty-room', researchRecords: [] });
    const unresolvedEvidence = html.match(/<article class="pool-room-list-item" data-kind="evidence">[\s\S]*?<\/article>/)?.[0] || '';

    expect(html).toContain('href="/ask?room=empty-room"');
    expect(html).toContain('Agreement:</strong> Evidence unavailable');
    expect(unresolvedEvidence).toContain('>Run<');
    expect(unresolvedEvidence).not.toContain('href="/records?room=empty-room&amp;panel=review#pool-room-review"');
  });

  it('projects accepted evidence into memory without exposing raw vectors', () => {
    const question = submission();
    const answer = result({ agreement: { status: 'accepted', receiptHashes: [hash('d')] } });
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
        reviewDecision(rejected.recordHash, 'rejected', 'reviewer-reject'),
        reviewDecision(revised.recordHash, 'needs_revision', 'reviewer-revise')
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
      status: 'unresolved',
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
  });

  it('supersedes accepted memory when an independently accepted correction arrives', () => {
    const question = submission();
    const answer = result({ agreement: { status: 'accepted', receiptHashes: [hash('d')] } });
    const correction = {
      kind: 'human_claim',
      recordHash: hash('n'),
      roomId: question.roomId,
      createdAt: '2026-08-09T10:07:00.000Z',
      targetHash: answer.recordHash,
      author: { identityRootId: 'requester-root', userId: 'requester-user', roleId: 'requester' },
      claim: {
        kind: 'correction',
        relation: 'corrects',
        decision: null,
        text: 'The result must not be reused: the receipt was linked to the wrong sequence.'
      }
    };
    const correctionReview = reviewDecision(correction.recordHash, 'accepted', 'reviewer-root-2', hash('o'));
    const records = [question, answer, acceptedReview(answer.recordHash), correction, correctionReview];
    const room = projectResearchRoom({ roomId: question.roomId, researchRecords: records });

    expect(room.status).toBe('corrected');
    expect(room.latestResult.status).toBe('corrected');
    expect(room.memory.map((entry) => entry.sourceHash)).toEqual([correction.recordHash]);
    expect(room.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceHash: answer.recordHash, status: 'corrected' }),
      expect.objectContaining({ sourceHash: correction.recordHash, title: 'Correction attached', status: 'accepted' })
    ]));
    expect(room.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'correction', title: 'Result corrected' })
    ]));
    expect(renderResearchRoom({ roomId: question.roomId, researchRecords: records })).toContain('Result corrected');
  });

  it('projects recovery boundaries without treating them as evidence', () => {
    const question = submission({ roomId: 'recovery-room' });
    const answer = result({ roomId: 'recovery-room', submissionHash: question.recordHash });
    answer.recordHash = hash('j');
    const room = projectResearchRoom({
      roomId: 'recovery-room',
      researchRecords: [question, answer],
      syncState: {
        phase: 'stale',
        remote: 'unavailable',
        remoteError: 'offline',
        rejectedRecords: [{ recordHash: hash('k'), reason: 'invalid signature' }]
      }
    });

    expect(room.recovery.states).toEqual([
      'local_only',
      'stale',
      'rejected',
      'awaiting_review'
    ]);
    expect(room.recovery.labels).toEqual([
      'Local-only recovery',
      'Stale coordinator view',
      'Rejected records',
      'Awaiting review'
    ]);
    expect(room.recovery.remoteError).toBe('offline');
    expect(room.memory).toHaveLength(0);
    expect(renderResearchRoom({
      roomId: 'recovery-room',
      researchRecords: [question, answer],
      syncState: room.recovery
    })).toContain('data-recovery-state="awaiting_review"');
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
  });

  it('projects signed hypotheses as provisional inspiration with evidence gaps', () => {
    const question = submission();
    const hypothesis = {
      kind: 'research_hypothesis',
      recordHash: hash('i'),
      roomId: question.roomId,
      createdAt: '2026-08-09T10:02:00.000Z',
      questionHash: question.recordHash,
      hypothesis: {
        statement: 'The sequence may contain a cleavable signal peptide.',
        priorEvidenceHashes: [question.recordHash],
        discriminatingObservations: ['A compatible residue-level cleavage pattern']
      }
    };
    const room = projectResearchRoom({ roomId: question.roomId, researchRecords: [question, hypothesis] });

    expect(room.proposals).toEqual([expect.objectContaining({
      kind: 'research_hypothesis',
      title: 'Possible explanation',
      status: 'provisional',
      supportingEvidence: [question.recordHash],
      distinguishes: ['A compatible residue-level cleavage pattern']
    })]);
    expect(renderResearchRoom({ roomId: question.roomId, researchRecords: [question, hypothesis] }))
      .toContain('The sequence may contain a cleavable signal peptide.');
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

  it('renders a room-first surface with consent-scoped technical disclosure', () => {
    const question = submission();
    const answer = result({ agreement: { status: 'accepted' } });
    const html = renderResearchRoom({
      roomId: question.roomId,
      routeId: 'home',
      researchRecords: [question, answer, acceptedReview(answer.recordHash)]
    });

    expect(html).toContain('data-pool-research-room');
    expect(html).toContain('Reploid Research Room');
    expect(html).toContain('Inspectable model evidence');
    expect(html).toContain('Agreement assessed');
    expect(html).toContain('<span class="rgr-status-label">Uncertainty</span>');
    expect(html).toContain('Uncertainty and evidence limits');
    expect(html).toContain('Fewer than two exact model contracts');
    expect(html).toContain('Remembered evidence');
    expect(html).toContain('Accepted under the current room policy.');
    expect(html).toContain('Possible explanations and proposed work');
    expect(html).toContain('No signed hypotheses, predictions, or proposed work are present in this room yet.');
    expect(html).toContain('data-pool-room-approve-task="task:');
    expect(html).toContain('Approve next action');
    expect(html).toContain('Raw vectors and residue-level values remain hidden');
    expect(html).toContain('href="/ask?room=room-projection"');
    expect(html).toContain('href="/records?room=room-projection&amp;panel=review#pool-room-review"');
    expect(html).not.toContain('1,0,0');
  });
});
