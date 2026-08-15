import { describe, expect, it } from 'vitest';

import { projectResearchRoom } from '../../self/ui/pool-home/room-projection.js';
import { renderResearchRoom } from '../../self/ui/pool-home/room-view.js';

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
  it('routes an evidence-unavailable room to requester controls', () => {
    const html = renderResearchRoom({ roomId: 'empty-room', researchRecords: [] });
    const unresolvedEvidence = html.match(/<article class="pool-room-list-item" data-kind="evidence">[\s\S]*?<\/article>/)?.[0] || '';

    expect(html).toContain('href="/ask?room=empty-room"');
    expect(html).toContain('>No result yet</h2>');
    expect(unresolvedEvidence).toContain('>Run<');
    expect(unresolvedEvidence).not.toContain('href="/records?room=empty-room&amp;panel=review#pool-room-review"');
    expect(html).toContain('Reploid has not demonstrated its first product win.');
  });

  it('projects only an independently accepted frozen adjudication result as a passing product experiment', () => {
    const roomId = 'room-projection';
    const experiment = {
      kind: 'research_adjudication_experiment',
      recordHash: hash('h'),
      roomId,
      createdAt: '2026-08-09T11:00:00.000Z',
      author: { identityRootId: 'experiment-author', roleId: 'researcher' },
      experiment: {
        contractHash: hash('k'),
        target: {
          catalogId: 'DECLARED-CATALOG',
          catalogVersion: '2026.08',
          curatorRole: 'family annotation curator',
          decision: 'retain or revise the disputed annotation'
        },
        baseline: { workflowId: 'catalog-baseline', version: '1' },
        candidate: { policyId: 'reploid-room-policy', version: '1' },
        cohort: { caseCount: 24 },
        metrics: [{ id: 'quality' }, { id: 'effort' }],
        successPolicy: { mode: 'quality_or_effort' },
        resolution: {},
        frozenAt: '2026-08-09T11:00:00.000Z'
      }
    };
    const evaluation = {
      kind: 'research_adjudication_evaluation',
      recordHash: hash('i'),
      roomId,
      createdAt: '2026-08-09T12:00:00.000Z',
      author: { identityRootId: 'experiment-evaluator', roleId: 'verifier' },
      experimentHash: experiment.recordHash,
      evaluation: {
        assessment: { conclusion: 'passes', qualityPathPassed: true, effortPathPassed: false },
        metricResults: [{
          metricId: 'quality', baselineValue: 0.7, candidateValue: 0.8,
          orientedEffect: 0.1, effectInterval: { lower: 0.03, upper: 0.17 }, pairedSampleCount: 24
        }, {
          metricId: 'effort', baselineValue: 30, candidateValue: 30,
          orientedEffect: 0, effectInterval: { lower: -1, upper: 1 }, pairedSampleCount: 24
        }],
        resultManifest: { accession: 'RESULTS:1', version: '1', contentHash: hash('l') },
        regressionCount: 0,
        missingCaseCount: 0
      }
    };
    const records = [
      experiment,
      reviewDecision(experiment.recordHash, 'accepted', 'experiment-reviewer', hash('m')),
      evaluation,
      reviewDecision(evaluation.recordHash, 'accepted', 'evaluation-reviewer', hash('n'))
    ];
    const room = projectResearchRoom({ roomId, researchRecords: records });
    const html = renderResearchRoom({ roomId, researchRecords: records });

    expect(room.adjudicationProof).toMatchObject({
      status: 'experiment_passes',
      gaps: [],
      experiment: { target: { catalogId: 'DECLARED-CATALOG', curatorRole: 'family annotation curator' } },
      evaluation: { conclusion: 'passes', reviewState: 'accepted' }
    });
    expect(html).toContain('DECLARED-CATALOG @ 2026.08');
    expect(html).toContain('<strong>quality</strong>');
    expect(html).toContain('0.7 baseline to 0.8 candidate');
  });

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

  it('supersedes accepted memory when an independently accepted correction arrives', () => {
    const question = submission();
    const answer = result({ agreement: { status: 'accepted', receiptHashes: [hash('d'), hash('g')], providerIds: ['provider-one', 'provider-two'] } });
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
    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: answer.recordHash,
      state: 'superseded',
      supersededByHash: correction.recordHash,
      decisionMemoryAdmitted: false
    }));
    expect(room.archive.entries).toContainEqual(expect.objectContaining({
      recordHash: correction.recordHash,
      state: 'corrected',
      decisionMemoryAdmitted: true
    }));
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
      quarantinedRecords: [{
        record: { recordHash: hash('k'), kind: 'research_result', createdAt: answer.createdAt },
        reason: 'invalid signature',
        quarantinedAt: '2026-08-09T10:08:00.000Z'
      }],
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
    expect(room.archive.rejected).toEqual([
      expect.objectContaining({
        recordHash: hash('k'),
        claimedKind: 'research_result',
        state: 'rejected',
        provenance: 'verification_quarantine',
        reason: 'invalid signature'
      })
    ]);
    expect(room.decisionMemory.excluded).toContainEqual(expect.objectContaining({
      recordHash: hash('k'),
      state: 'rejected',
      reason: 'invalid signature'
    }));
    expect(room.counts.archive).toBe(3);
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

  it('shows exact signed task approval without implying execution authority', () => {
    const question = submission({ roomId: 'approved-task-room' });
    const initial = projectResearchRoom({ roomId: question.roomId, researchRecords: [question] });
    const task = initial.cycle.actions[0];
    const approval = {
      kind: 'human_claim',
      recordHash: hash('y'),
      roomId: question.roomId,
      createdAt: '2026-08-09T10:03:00.000Z',
      targetHash: task.targetHash,
      author: { identityRootId: 'reviewer-task-root', userId: 'reviewer-task', roleId: 'reviewer' },
      claim: {
        kind: 'task_approval',
        relation: 'approves',
        decision: 'approved',
        text: 'Approve the exact current task.',
        taskId: task.taskId,
        taskContract: task.taskContract
      }
    };
    const records = [question, approval];
    const room = projectResearchRoom({ roomId: question.roomId, researchRecords: records });
    const html = renderResearchRoom({ roomId: question.roomId, researchRecords: records });

    expect(room.nextQuestion).toMatchObject({
      humanApprovalRequired: false,
      humanApprovalStatus: 'approved',
      approvalRecordHashes: [approval.recordHash],
      executionAuthority: 'none'
    });
    expect(html).toContain('<small>1 signed approval</small>');
    expect(html).not.toContain('data-pool-room-approve-task=');
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

  it('shows qualified prior-room candidates without admitting them into current decision memory', () => {
    const question = submission({ roomId: 'current-room' });
    const duplicateRecordHash = hash('y');
    const priorQuestion = {
      ...submission({ roomId: 'prior-room', identityRootId: 'prior-requester' }),
      recordHash: hash('z'),
      requesterIntent: {
        kind: 'question',
        text: 'Should the origin catalog family assignment be retained?',
        decisionContext: 'Origin catalog release review',
        conditions: 'Public sequence annotation',
        scope: 'Family assignment',
        exclusions: 'No function claim',
        desiredObservation: 'Versioned supporting annotation'
      }
    };
    const priorRecord = {
      kind: 'research_prior_evidence',
      recordHash: hash('p'),
      roomId: 'prior-room',
      questionHash: priorQuestion.recordHash,
      createdAt: '2026-08-09T09:00:00.000Z',
      evidence: {
        kind: 'annotation',
        summary: 'A version-pinned catalog annotation accepted in the origin room.'
      }
    };
    const crossRoomEvidence = {
      phase: 'synchronized',
      registryBoundary: {
        boundary: 'input_snapshot',
        complete: true,
        inputRecordCount: 8,
        uniqueRecordCount: 8,
        scannedRecordCount: 8
      },
      projection: {
        schema: 'poolday.cross_room_sequence_evidence/v1',
        sequence: { hash: question.sequence.hash },
        rooms: [{
          roomId: 'prior-room',
          sourceVersions: [{
            recordHash: priorRecord.recordHash,
            accession: 'PUBLIC:123',
            version: '7',
            license: 'CC BY 4.0'
          }]
        }, {
          roomId: 'second-prior-room',
          sourceVersions: [{
            recordHash: duplicateRecordHash,
            accession: 'PUBLIC:123',
            version: '7',
            license: 'CC BY 4.0'
          }]
        }],
        candidates: [{
          recordHash: priorRecord.recordHash,
          originRoomId: 'prior-room',
          originQuestionHashes: [hash('z')],
          kind: priorRecord.kind,
          originalRoomAccepted: true,
          qualification: { status: 'source_metadata_complete', reasons: [] },
          deduplication: 'same_declared_versioned_source',
          duplicateRecordHashes: [priorRecord.recordHash, duplicateRecordHash],
          duplicateOriginRoomIds: ['prior-room', 'second-prior-room'],
          admission: 'requires_current_room_review'
        }],
        records: [priorQuestion, priorRecord]
      }
    };
    const room = projectResearchRoom({
      roomId: question.roomId,
      researchRecords: [question],
      crossRoomEvidence
    });
    const html = renderResearchRoom({
      roomId: question.roomId,
      researchRecords: [question],
      crossRoomEvidence
    });

    expect(room.priorRoomEvidence).toMatchObject({
      schema: 'poolday.prior_room_evidence_projection/v1',
      sequenceMatches: true,
      roomCount: 2,
      candidates: [expect.objectContaining({
        recordHash: priorRecord.recordHash,
        originRoomId: 'prior-room',
        admission: 'requires_current_room_review',
        attachable: true,
        attachedRecordHash: null,
        contextComparison: expect.objectContaining({ status: 'declared_context_differences' })
      })]
    });
    expect(room.decisionMemory.acceptedHashes).toEqual([]);
    expect(room.memory).toEqual([]);
    expect(room.counts.priorRoomCandidates).toBe(1);
    expect(html).toContain('Prior-room evidence');
    expect(html).toContain('Origin-room acceptance is provenance, not admission here.');
    expect(html).toContain('PUBLIC:123 @ 7 · declared license CC BY 4.0');
    expect(html).toContain('Declared decision context: declared context differences');
    expect(html).toContain('Same declared versioned source in 2 signed origin records across 2 rooms.');
    expect(html).toContain(`data-pool-room-attach-prior="${priorRecord.recordHash}"`);

    const duplicateAttachment = {
      kind: 'research_prior_evidence',
      recordHash: hash('x'),
      roomId: question.roomId,
      questionHash: question.recordHash,
      createdAt: '2026-08-09T10:00:00.000Z',
      evidence: { reference: { contentHash: duplicateRecordHash } }
    };
    const attachedRoom = projectResearchRoom({
      roomId: question.roomId,
      researchRecords: [question, duplicateAttachment],
      crossRoomEvidence
    });
    expect(attachedRoom.priorRoomEvidence.candidates[0]).toMatchObject({
      attachable: false,
      attachedRecordHash: duplicateAttachment.recordHash
    });
    expect(attachedRoom.archive.entries.find((entry) => entry.recordHash === duplicateAttachment.recordHash))
      .toMatchObject({ decisionMemoryAdmitted: false, decisionMemoryExclusionReason: 'unresolved' });
    expect(renderResearchRoom({
      roomId: question.roomId,
      researchRecords: [question, duplicateAttachment],
      crossRoomEvidence
    })).toContain('Decision-memory exclusion: unresolved.');
  });

  it('renders a room-first surface with consent-scoped technical disclosure', () => {
    const question = submission();
    const answer = result({ agreement: { status: 'accepted', receiptHashes: [hash('d'), hash('g')], providerIds: ['provider-one', 'provider-two'] } });
    const html = renderResearchRoom({
      roomId: question.roomId,
      routeId: 'home',
      researchRecords: [question, answer, acceptedReview(answer.recordHash)]
    });

    expect(html).toContain('data-pool-research-room');
    expect(html).toContain('Research room');
    expect(html).toContain('Model evidence');
    expect(html).toContain('Agreement assessed');
    expect(html).toContain('Uncertainty and evidence limits');
    expect(html).toContain('Fewer than two exact model contracts');
    expect(html).toContain('Remembered evidence');
    expect(html).toContain('Decision memory');
    expect(html).toContain('Complete evidence archive');
    expect(html).toContain('Remembered does not mean biologically true.');
    expect(html).toContain('poolday.accepted-memory-feedback/v1');
    expect(html).toContain('Accepted under the current room policy by 1 independent signed decision.');
    expect(html).toContain('Possible explanations and proposed work');
    expect(html).toContain('No signed hypotheses, predictions, or proposed work are present in this room yet.');
    expect(html).toContain('data-pool-room-approve-task="task:');
    expect(html).toContain('Approve next action');
    expect(html).toContain('Raw vectors and residue-level values remain hidden');
    expect(html).toContain('href="/ask?room=room-projection"');
    expect(html).toContain('href="/records?room=room-projection&amp;panel=review#pool-room-review"');
    expect(html).toContain(`href="/records?room=room-projection&amp;panel=review&amp;target=${encodeURIComponent(answer.recordHash)}#pool-room-review"`);
    expect(html).toContain('>Review</a>');
    expect(html).not.toContain('1,0,0');
  });
});
