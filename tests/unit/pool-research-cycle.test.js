import { describe, expect, it } from 'vitest';

import { projectGovernedResearchCycle } from '../../self/pool/research-cycle.js';

const hash = (character) => `sha256:${character.repeat(64)}`;
const createdAt = (minute) => `2026-08-09T12:${String(minute).padStart(2, '0')}:00.000Z`;

const question = ({ recordHash = hash('a'), text = 'Which observation distinguishes secretion from membrane retention?' } = {}) => ({
  kind: 'research_submission',
  recordHash,
  roomId: 'cycle-room',
  createdAt: createdAt(0),
  author: { identityRootId: 'requester-root', roleId: 'requester' },
  sequence: { hash: hash('b'), length: 15, alphabet: 'amino_acid', value: 'MAPLALLLLGLVAGA' },
  requesterIntent: {
    kind: 'question',
    text,
    label: 'Secretory mechanism',
    context: '',
    conditions: 'Cell-free reporter at 30 C.',
    desiredObservation: 'A blinded extracellular reporter ratio.',
    decisionContext: 'Choose the next discriminating assay.',
    scope: 'Secretory versus membrane-associated behavior.',
    exclusions: 'Does not establish in-vivo function.',
    knownUnknowns: 'Native trafficking is not represented.'
  }
});

const result = ({ recordHash = hash('c'), submissionHash = hash('a') } = {}) => ({
  kind: 'research_result',
  recordHash,
  roomId: 'cycle-room',
  createdAt: createdAt(1),
  author: { identityRootId: 'requester-root', roleId: 'requester' },
  submissionHash,
  compute: {
    receiptHash: hash('d'),
    receiptHashes: [hash('d'), hash('e')],
    providerId: 'provider-one',
    agreement: {
      status: 'accepted',
      receiptHashes: [hash('d'), hash('e')],
      providerIds: ['provider-one', 'provider-two']
    }
  },
  modelContract: { id: 'exact-model' }
});

const review = ({
  targetHash = hash('c'),
  decision = 'accepted',
  reviewer = 'reviewer-one',
  recordHash = hash('f'),
  minute = 2
} = {}) => ({
  kind: 'human_claim',
  recordHash,
  roomId: 'cycle-room',
  createdAt: createdAt(minute),
  targetHash,
  author: { identityRootId: reviewer, roleId: reviewer },
  claim: { kind: 'review_decision', relation: 'reviews', decision, text: decision, confidence: 0.9 }
});

describe('Poolday governed research cycle', () => {
  it('keeps the seven stages explicit when no question exists', () => {
    const cycle = projectGovernedResearchCycle([]);

    expect(cycle.schema).toBe('poolday.governed_research_cycle/v1');
    expect(cycle.nextQuestion).toMatchObject({
      status: 'needs_human_question',
      basisHashes: [],
      humanApprovalRequired: true,
      executionAuthority: 'none'
    });
    expect(cycle.stages.map((stage) => stage.id)).toEqual([
      'question',
      'independent_execution',
      'signed_provenance',
      'agreement_and_gaps',
      'human_review',
      'accepted_memory',
      'next_question'
    ]);
  });

  it('does not let provisional hypotheses steer scientific actions', () => {
    const source = question();
    const computed = result();
    const hypothesis = {
      kind: 'research_hypothesis',
      recordHash: hash('1'),
      roomId: source.roomId,
      createdAt: createdAt(2),
      questionHash: source.recordHash,
      author: { identityRootId: 'agent-root', roleId: 'agent' },
      hypothesis: {
        statement: 'The protein may be secreted.',
        priorEvidenceHashes: [],
        alternativeToHashes: [],
        discriminatingObservations: ['Extracellular reporter signal']
      }
    };

    const cycle = projectGovernedResearchCycle([source, computed, hypothesis]);

    expect(cycle.memory.acceptedHashes).toEqual([]);
    expect(cycle.actions).toContainEqual(expect.objectContaining({
      kind: 'independent_review',
      targetHash: hypothesis.recordHash,
      basis: 'governance'
    }));
    expect(cycle.actions).not.toContainEqual(expect.objectContaining({
      kind: 'run_diverse_predictor',
      targetHash: hypothesis.recordHash
    }));
    expect(cycle.nextQuestion).toMatchObject({
      status: 'awaiting_accepted_evidence',
      basisHashes: [],
      humanApprovalRequired: true
    });
  });

  it('derives scientific actions only from independently accepted memory', () => {
    const source = question();
    const computed = result();
    const acceptance = review();
    const cycle = projectGovernedResearchCycle([source, computed, acceptance]);
    const hypothesisAction = cycle.actions.find((action) => action.kind === 'add_competing_hypothesis');

    expect(cycle.execution[0]).toMatchObject({
      independentReceiptCount: 2,
      reproducibility: 'independently_reproduced',
      reviewState: 'accepted'
    });
    expect(cycle.memory.acceptedHashes).toEqual([computed.recordHash]);
    expect(cycle.memory.records[0]).toMatchObject({
      recordHash: computed.recordHash,
      reviewDecisionHashes: [acceptance.recordHash]
    });
    expect(hypothesisAction).toMatchObject({
      basis: 'accepted_memory',
      basisHashes: [computed.recordHash]
    });
    expect(cycle.nextQuestion.humanApprovalRequired).toBe(true);
    expect(cycle.nextQuestion).toMatchObject({
      actionKind: 'add_competing_hypothesis',
      prompt: 'What condition-specific alternative hypothesis would make a different observable prediction from the accepted evidence?',
      basisHashes: [computed.recordHash]
    });
  });

  it('keeps replication requests and disputed reviews out of memory', () => {
    const source = question();
    const computed = result();
    const replication = review({ decision: 'replication_requested' });
    const replicationCycle = projectGovernedResearchCycle([source, computed, replication]);

    expect(replicationCycle.review.replicationRequested).toEqual([computed.recordHash]);
    expect(replicationCycle.memory.acceptedHashes).toEqual([]);
    expect(replicationCycle.actions).toContainEqual(expect.objectContaining({
      kind: 'reproduce',
      targetHash: computed.recordHash
    }));

    const rejection = review({
      decision: 'rejected',
      reviewer: 'reviewer-two',
      recordHash: hash('9'),
      minute: 3
    });
    const acceptance = review({ recordHash: hash('8') });
    const disputedCycle = projectGovernedResearchCycle([source, computed, acceptance, rejection]);

    expect(disputedCycle.review.disputed).toEqual([computed.recordHash]);
    expect(disputedCycle.memory.acceptedHashes).toEqual([]);
    expect(disputedCycle.evidence.disagreements).toContainEqual(expect.objectContaining({
      kind: 'review_disagreement',
      targetHash: computed.recordHash
    }));
  });

  it('uses each independent reviewer identity latest decision', () => {
    const source = question();
    const computed = result();
    const revision = review({ decision: 'needs_revision', recordHash: hash('6'), minute: 2 });
    const laterAcceptance = review({ decision: 'accepted', recordHash: hash('7'), minute: 3 });
    const cycle = projectGovernedResearchCycle([source, computed, revision, laterAcceptance]);

    expect(cycle.review.accepted).toEqual([computed.recordHash]);
    expect(cycle.review.needsRevision).toEqual([]);
    expect(cycle.memory.acceptedHashes).toEqual([computed.recordHash]);
  });
});
