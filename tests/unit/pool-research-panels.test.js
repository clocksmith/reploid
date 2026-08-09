import { describe, expect, it } from 'vitest';

import {
  renderDiscoveryPanel,
  renderNextWorkPanel,
  renderReviewPanel
} from '../../self/ui/pool-home/research-panels.js';

const hash = (character) => `sha256:${character.repeat(64)}`;

describe('Research Room reusable panels', () => {
  it('keeps review and discovery targets contextual and compatible with existing bindings', () => {
    const target = { kind: 'research_result', recordHash: hash('a'), modelContract: { id: 'room-model' }, compute: { receiptHash: hash('b') } };
    const review = renderReviewPanel({ reviewTargets: [target] });
    const discovery = renderDiscoveryPanel({ results: [target], target: target.recordHash });

    expect(review).toContain('id="pool-room-review"');
    expect(review).toContain('data-research-review-form');
    expect(review).toContain(`value="${target.recordHash}"`);
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
});
