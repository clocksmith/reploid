import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getContributionSnapshot,
  recordContributionReceipt,
  resetContributionStateForTests,
  updateContributionState
} from '../../self/ui/pool-home/contribution-state.js';
import { renderContributionStatusBar } from '../../self/ui/pool-home/view.js';

const createMemoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
};

describe('Poolday contribution state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
    vi.stubGlobal('localStorage', createMemoryStorage());
    resetContributionStateForTests();
  });

  afterEach(() => {
    resetContributionStateForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tracks live state labels without starting contribution in tests', () => {
    const snapshot = updateContributionState({
      state: 'working',
      optedIn: true,
      modelId: 'qwen-3-5-0-8b-q4k-ehaf16',
      roomId: 'room-a'
    });

    expect(snapshot.state).toBe('working');
    expect(snapshot.label).toBe('Answering');
    expect(snapshot.optedIn).toBe(true);
    expect(snapshot.modelId).toBe('qwen-3-5-0-8b-q4k-ehaf16');
  });

  it('persists recent contribution history and computes token windows', () => {
    recordContributionReceipt({
      receiptHash: 'sha256:old',
      receipt: {
        assignmentId: 'assignment-old',
        tokenCounts: { input: 100, output: 100 },
        timing: { completedAt: '2026-07-03T10:00:00.000Z' }
      }
    }, { roomId: 'room-a' });
    recordContributionReceipt({
      receiptHash: 'sha256:recent-a',
      receipt: {
        assignmentId: 'assignment-a',
        model: { id: 'qwen-3-5-0-8b-q4k-ehaf16' },
        tokenCounts: { input: 7, output: 11 },
        timing: { completedAt: '2026-07-04T11:30:00.000Z' }
      }
    }, { roomId: 'room-a' });
    recordContributionReceipt({
      receiptHash: 'sha256:recent-b',
      receipt: {
        assignmentId: 'assignment-b',
        tokenCounts: { input: 3, output: 5 },
        timing: { completedAt: '2026-07-04T10:45:00.000Z' }
      }
    }, { roomId: 'room-a', modelId: 'qwen-3-5-0-8b-q4k-ehaf16' });

    const snapshot = getContributionSnapshot();

    expect(snapshot.tokensHour).toBe(18);
    expect(snapshot.tokens24h).toBe(26);
    expect(snapshot.contributions24h).toBe(2);
    expect(snapshot.recent).toHaveLength(3);
    expect(snapshot.recent[0].receiptHash).toBe('sha256:recent-b');
    expect(snapshot.recent[1].receiptHash).toBe('sha256:recent-a');
    expect(snapshot.recent[2].receiptHash).toBe('sha256:old');
  });

  it('renders contribution metrics from the stored snapshot', () => {
    updateContributionState({
      state: 'idle',
      optedIn: true
    });
    recordContributionReceipt({
      receiptHash: 'sha256:recent-render',
      receipt: {
        tokenCounts: { input: 1000, output: 600 },
        timing: { completedAt: '2026-07-04T11:59:00.000Z' }
      }
    });

    const html = renderContributionStatusBar(getContributionSnapshot());

    expect(html).toContain('<b>24h</b> 1.6k');
    expect(html).toContain('<b>1h</b> 1.6k/hr');
    expect(html).toContain('sha256:recent-render');
  });
});
