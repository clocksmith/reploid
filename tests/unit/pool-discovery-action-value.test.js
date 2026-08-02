import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_ACTION_VALUE_POLICY,
  rankDiscoveryActions
} from '../../self/pool/discovery-action-value.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;

describe('Poolday heuristic discovery action ranking', () => {
  it('binds the complete ordered record identity and exposed cost components', () => {
    const records = [{ recordHash: fakeHash('b') }, { recordHash: fakeHash('a') }];
    const tasks = [{
      taskId: `task:independent_review:${fakeHash('a')}`,
      kind: 'independent_review',
      targetHash: fakeHash('a'),
      reason: 'No independent review exists.',
      status: 'proposed'
    }];

    const ranking = rankDiscoveryActions(records, tasks);
    expect(ranking).toMatchObject({
      schema: 'poolday.discovery_action_ranking/v1',
      policy: DISCOVERY_ACTION_VALUE_POLICY,
      inputRecordHashes: [fakeHash('a'), fakeHash('b')],
      candidateActionIds: [`task:independent_review:${fakeHash('a')}`],
      allocation: 'not_authorized_by_heuristic_projection',
      executionAuthority: 'none'
    });
    expect(ranking.selectedAction).toMatchObject({
      actionKind: 'independent_review',
      expectedInformationGain: {
        units: 'ordinal heuristic uncertainty-reduction units',
        calibrationEvidence: []
      },
      decisionChangeProbability: { status: 'unassessed_not_calibrated', value: null },
      scientificCost: {
        units: 'relative planning units',
        compute: 0,
        money: 0,
        labor: 2,
        instrument: 0,
        sample: 0,
        elapsedTime: 1
      },
      humanApprovalRequired: true
    });
  });

  it('orders equal inputs deterministically without treating priority as a calibrated probability', () => {
    const records = [{ recordHash: fakeHash('a') }, { recordHash: fakeHash('b') }, { recordHash: fakeHash('c') }];
    const tasks = [
      { kind: 'perform_assay', targetHash: fakeHash('b'), reason: 'Perform the assay.' },
      { kind: 'adjudicate_contradiction', targetHash: fakeHash('c'), reason: 'Resolve contradiction.' }
    ];

    const first = rankDiscoveryActions(records, tasks);
    const second = rankDiscoveryActions([...records].reverse(), [...tasks].reverse());
    expect(first.rankedCandidates.map((entry) => entry.actionId)).toEqual(
      second.rankedCandidates.map((entry) => entry.actionId)
    );
    expect(first.selectedAction.actionKind).toBe('adjudicate_contradiction');
    expect(first.rankedCandidates.every((entry) => entry.decisionChangeProbability.value === null)).toBe(true);
  });

  it('rejects detached, unknown, duplicate, and terminal tasks without giving them a score', () => {
    const targetHash = fakeHash('a');
    const validTask = { taskId: 'task:review:a', kind: 'independent_review', targetHash, reason: 'Review the result.' };
    const ranking = rankDiscoveryActions([{ recordHash: targetHash }], [
      validTask,
      { ...validTask, reason: 'Duplicate task identity.' },
      { kind: 'unbounded_experiment', targetHash, reason: 'Not an admitted action.' },
      { kind: 'perform_assay', targetHash: fakeHash('b'), reason: 'Detached from this evidence set.' },
      { kind: 'perform_assay', targetHash, status: 'running', reason: 'Already running.' },
      { kind: 'perform_assay', targetHash, reason: '' }
    ]);

    expect(ranking.rankedCandidates).toHaveLength(1);
    expect(ranking.selectedAction.actionId).toBe('task:review:a');
    const rejectionReasons = ranking.rejectedActions.flatMap((action) => action.reasons);
    expect(rejectionReasons).toEqual(expect.arrayContaining([
      'action_id_is_not_unique',
      'action_kind_is_not_admitted',
      'target_hash_is_not_in_the_input_evidence_set',
      'action_status_is_not_rankable',
      'action_reason_is_required'
    ]));
  });

  it('fails closed when an input record lacks a signed-record hash', () => {
    const ranking = rankDiscoveryActions(
      [{ recordHash: fakeHash('a') }, { recordHash: 'not-a-record-hash' }],
      [{ kind: 'independent_review', targetHash: fakeHash('a'), reason: 'Review the result.' }]
    );

    expect(ranking.inputValidation.status).toBe('rejected_invalid_input_evidence');
    expect(ranking.selectedAction).toBeNull();
    expect(ranking.rankedCandidates).toEqual([]);
  });
});
