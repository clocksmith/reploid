import { describe, expect, it } from 'vitest';

import {
  renderDiscoveryPanel,
  renderNextWorkPanel,
  renderParticipationQualityPanel,
  recordLabel,
  renderReviewPanel
} from '../../self/ui/pool-home/research-panels.js';
import { renderLifecycleForms } from '../../self/ui/pool-home/research-lifecycle-panel.js';
import { renderSequenceDisclosure, renderTechnicalEvidencePanel } from '../../self/ui/pool-home/research-technical-panel.js';

const hash = (character) => `sha256:${character.repeat(64)}`;

describe('Research Room reusable panels', () => {
  it('keeps review and discovery targets contextual and compatible with existing bindings', () => {
    const question = {
      kind: 'research_submission',
      recordHash: hash('q'),
      requesterIntent: { label: 'Inspect the public sequence', text: 'Which evidence should be reviewed next?' },
      sequence: { hash: hash('s'), length: 15 },
      consent: { publicSequence: false }
    };
    const target = {
      kind: 'research_result',
      recordHash: hash('a'),
      submissionHash: question.recordHash,
      modelContract: { id: 'room-model', dimensions: 3 },
      compute: { receiptHash: hash('b'), agreement: null }
    };
    const review = renderReviewPanel({
      reviewTargets: [target],
      submissionsByHash: new Map([[question.recordHash, question]]),
      reviewStates: new Map([[target.recordHash, { state: 'unresolved' }]])
    });
    const discovery = renderDiscoveryPanel({ results: [target], target: target.recordHash });

    expect(review).toContain('id="pool-room-review"');
    expect(review).toContain('data-research-review-form');
    expect(review).toContain(`value="${target.recordHash}"`);
    expect(review).toContain('Which evidence should be reviewed next?');
    expect(review).toContain('room-model');
    expect(review).toContain('Agreement</dt><dd>Not assessed');
    expect(review).toContain('Sequence value withheld');
    expect(review).toContain('Similarity and retrieval ranking do not establish agreement.');
    expect(discovery).toContain('id="pool-room-discovery"');
    expect(discovery).toContain('data-research-similarity-target');
    expect(discovery).toContain('room-model');
  });

  it('keeps next work approval gated and explicit', () => {
    const task = {
      actionId: 'task:review:target',
      actionKind: 'independent_review',
      targetHash: hash('c'),
      reason: 'A reviewer is still needed.',
      heuristicPriority: 5,
      expectedInformationGain: { estimate: 4 },
      valueComponents: { totalCost: 1 },
      status: 'proposed'
    };
    const html = renderNextWorkPanel({
      rankedTasks: [task],
      actionRanking: { policy: { policyId: 'test-policy' } }
    });

    expect(html).toContain('data-research-approve-task="task:review:target"');
    expect(html).toContain('A reviewer is still needed.');
    expect(html).toContain('test-policy');
  });

  it('keeps the full lifecycle form vocabulary reusable without owning signing', () => {
    const question = { kind: 'research_submission', recordHash: hash('q') };
    const hypothesis = { kind: 'research_hypothesis', recordHash: hash('h') };
    const html = renderLifecycleForms({
      questions: [question],
      hypotheses: [hypothesis],
      predictions: [{ kind: 'research_prediction', recordHash: hash('p') }],
      workOrders: [{ kind: 'research_work_order', recordHash: hash('w') }],
      active: [question]
    });

    expect((html.match(/data-research-lifecycle-form/g) || []).length).toBe(9);
    expect(html).toContain('data-research-action="prior-evidence"');
    expect(html).toContain('data-research-action="hypothesis"');
    expect(html).toContain('data-research-action="prediction"');
    expect(html).toContain('data-research-action="work-order"');
    expect(html).toContain('data-research-action="work-claim"');
    expect(html).toContain('data-research-action="outcome"');
    expect(html).toContain('data-research-action="cohort"');
    expect(html).toContain('data-research-action="evaluation"');
    expect(html).toContain('data-research-action="revocation"');
    expect(html).toContain('data-research-lifecycle-status');
  });

  it('withholds unpublished sequence values while retaining technical provenance', () => {
    const record = {
      kind: 'research_submission',
      recordHash: hash('s'),
      roomId: 'technical-room',
      sequence: { value: 'SECRETSEQUENCE', hash: hash('t'), length: 14 },
      consent: { publicSequence: false }
    };
    const withheld = renderSequenceDisclosure(record);
    const published = renderSequenceDisclosure({ ...record, consent: { publicSequence: true } });
    const technical = renderTechnicalEvidencePanel({ record, reviewState: 'unresolved' });

    expect(withheld).not.toContain('SECRETSEQUENCE');
    expect(withheld).toContain('Sequence value withheld');
    expect(published).toContain('SECRETSEQUENCE');
    expect(technical).toContain('Technical evidence');
    expect(technical).toContain('Sequence publication');
    expect(technical).toContain('withheld');
    expect(technical).not.toContain('SECRETSEQUENCE');
  });

  it('withholds non-consented participant labels in reusable evidence panels', () => {
    const privateWorkClaim = {
      kind: 'research_work_claim',
      recordHash: hash('w'),
      author: { identityRootId: 'identity-root-that-must-be-shortened' },
      workClaim: {
        laboratory: { name: 'Private Laboratory' },
        consent: { publicLaboratoryIdentity: false }
      }
    };
    const publicWorkClaim = {
      ...privateWorkClaim,
      workClaim: {
        ...privateWorkClaim.workClaim,
        consent: { publicLaboratoryIdentity: true }
      }
    };
    const rewards = renderParticipationQualityPanel({ rewards: [{
      authorId: 'provider-identity-root-that-must-be-shortened',
      points: 2,
      verifiedCompute: 1,
      acceptedEvidence: 0,
      acceptedReviews: 0,
      quality: 0
    }] });

    expect(recordLabel(privateWorkClaim)).not.toContain('Private Laboratory');
    expect(recordLabel(privateWorkClaim)).toContain('identity-root');
    expect(recordLabel(publicWorkClaim)).toContain('Private Laboratory');
    expect(rewards).not.toContain('provider-identity-root-that-must-be-shortened');
  });
});
