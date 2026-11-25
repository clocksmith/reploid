// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createStepClock } from '../../scripts/stage1/steps.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('bounded steps', () => {
  it('logs each step with a UTC time and its duration, and records it for the receipt', async () => {
    const lines = [], clock = createStepClock({ log: line => lines.push(line) });
    const span = clock.budget('split-after', 1000);
    expect(await clock.step('split witnesses', span, async ({ timeoutMs }) => { expect(timeoutMs).toBeLessThanOrEqual(1000); return 7; })).toBe(7);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z step split witnesses start \(split-after budget, \d+ ms left\)$/);
    expect(lines[1]).toMatch(/^\S+Z step split witnesses done after \d+ ms$/);
    expect(clock.records()).toEqual([{ step: 'split witnesses', budget: 'split-after', startedAt: expect.any(String), ms: expect.any(Number), status: 'done' }]);
  });

  it('ends a step that outlives its budget with a reason naming the step and the budget, even when its work ignores the signal', async () => {
    const clock = createStepClock();
    const span = clock.budget('split-after', 40);
    await expect(clock.step('split requester weights after', span, () => new Promise(() => {})))
      .rejects.toMatchObject({ code: 'step-timed-out', message: 'step-timed-out: split requester weights after exceeded the split-after budget of 40 ms' });
    expect(clock.records()[0]).toMatchObject({ status: 'timed-out', detail: expect.stringContaining('split-after budget') });
  });

  it('shares one budget across the steps given it, and refuses to start a step once it is spent', async () => {
    // Fake timers and a fake clock: the 60 ms budget ends before the 70 ms pause however loaded the machine is.
    vi.useFakeTimers();
    try {
      const clock = createStepClock(), span = clock.budget('split-before', 60);
      const first = clock.step('first', span, () => pause(70).then(() => 'late')).then(() => null, error => error);
      await vi.advanceTimersByTimeAsync(70);
      expect(await first).toMatchObject({ code: 'step-timed-out', message: expect.stringContaining('the split-before budget of 60 ms') });
      await expect(clock.step('second', span, () => 'never')).rejects.toThrow('second did not start: the split-before budget of 60 ms was spent');
      expect(clock.records().map(row => row.status)).toEqual(['timed-out', 'timed-out']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a step cap below the budget, and passes the remaining time to work that takes a timeout', async () => {
    const clock = createStepClock(), span = clock.budget('preflight', 10000);
    let given = null;
    await expect(clock.step('capped', span, ({ timeoutMs }) => { given = timeoutMs; return new Promise(() => {}); }, { capMs: 30 }))
      .rejects.toThrow('capped exceeded its 30 ms limit');
    expect(given).toBeLessThanOrEqual(30);
  });

  it('records a step stopped by its phase as stopped, and one that failed on its own as failed', async () => {
    const phase = new AbortController(), clock = createStepClock(), span = clock.budget('split-answer', 10000, phase.signal);
    const waiting = clock.step('split generate', span, () => new Promise(() => {}));
    phase.abort(Error('Phase timeout'));
    await expect(waiting).rejects.toThrow('Phase timeout');
    await expect(clock.step('split settlement', clock.budget('x', 1000), () => { throw Error('ledger refused'); })).rejects.toThrow('ledger refused');
    expect(clock.records().map(row => row.status)).toEqual(['stopped', 'failed']);
  });

  it('redacts what it logs and records', async () => {
    const lines = [], clock = createStepClock({ log: line => lines.push(line), redact: text => text.replaceAll('/home/secret', '[private]') });
    await clock.step('scan', clock.budget('x', 1000), () => { throw Error('no such directory /home/secret/models'); }).catch(() => {});
    expect(lines.join('\n')).not.toContain('/home/secret');
    expect(clock.records()[0].detail).toBe('no such directory [private]/models');
  });
});
