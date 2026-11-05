import { expect, it, vi } from 'vitest';
import { createContributionHistory, CONTRIBUTION_HISTORY_KEY } from '../../apps/poolday/host/contribution-history.js';

const completion = { modelId: 'model', modelIdentity: 'sha256:fixture', outputTokens: 7 };
const memory = () => {
  const rows = new Map();
  return { getItem: key => rows.get(key), setItem: (key, value) => rows.set(key, value) };
};

it('retains completed execution metadata across owners without retaining conversation content', () => {
  const storage = memory(), first = createContributionHistory({ storage });
  first.record({ ...completion, messages: ['private prompt'], content: 'private answer' });
  const reopened = createContributionHistory({ storage });
  expect(reopened.getState().records).toEqual(first.getState().records);
  expect(reopened.getState().records[0]).toMatchObject(completion);
  expect(storage.getItem(CONTRIBUTION_HISTORY_KEY)).not.toContain('private');
  const copy = reopened.getState(); copy.records[0].outputTokens = 100;
  expect(reopened.getState().records[0].outputTokens).toBe(7);
});

it('merges interleaved owners and leaves unmeasured tokens unknown', () => {
  const storage = memory(), first = createContributionHistory({ storage }), second = createContributionHistory({ storage });
  first.record(completion); second.record({ ...completion, outputTokens: null });
  expect(createContributionHistory({ storage }).getState().records.map(row => row.outputTokens).sort()).toEqual([7, null]);
});

it('bounds retained history while preserving the latest actual executions', () => {
  const storage = memory(); let sequence = 0;
  const history = createContributionHistory({ storage, now: () => ++sequence });
  for (let index = 0; index < 210; index++) history.record(completion);
  expect(history.getState().records).toHaveLength(200);
  expect(history.getState().records[0].completedAt).toBe(210);
  expect(history.getState().records.at(-1).completedAt).toBe(11);
});

it('exposes unreadable or unwritable storage instead of fabricating durable history', () => {
  const storage = { getItem: () => '{', setItem: vi.fn(() => { throw Error('quota'); }) };
  const history = createContributionHistory({ storage });
  expect(history.getState()).toMatchObject({ records: [], error: 'Contribution history could not be read' });
  history.record(completion);
  expect(history.getState().error).toBe('Contribution history could not be saved');
  expect(history.getState().records).toHaveLength(1);
});
