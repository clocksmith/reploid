// @vitest-environment node
// The burst rule in scripts/pilot/browser-reliability.js: which prompt each tab sends and how a level is scored.
// The browser side is covered by `node scripts/pilot/browser-reliability.js --self-check`; nothing here touches a page.
import { describe, expect, it } from 'vitest';

import { burstPrompt, summarizeBurst } from '../../scripts/pilot/browser-reliability.js';

const ok = ms => ({ completed: true, failure: null, firstTokenMs: ms });
const failed = (failure, ms = null) => ({ completed: false, failure, firstTokenMs: ms });

describe('pilot browser burst', () => {
  it('walks the prompts in order across each round, then wraps', () => {
    const prompts = ['a', 'b', 'c', 'd', 'e'];
    const order = [];
    for (let round = 0; round < 3; round++) for (let session = 0; session < 2; session++) order.push(burstPrompt(prompts, 2, session, round));
    expect(order.join('')).toBe('abcdea');
    expect(burstPrompt(prompts, 8, 7, 0)).toBe('c');
  });

  it('passes a level whose every request completed with a p95 within 5 s', () => {
    const summary = summarizeBurst(Array.from({ length: 20 }, (_, index) => ok(1000 + index * 100)));
    expect(summary).toMatchObject({ requests: 20, completed: 20, completionRate: 1, withinLimit: 20, verdict: 'pass',
      firstCharacterMs: { p50: 1900, p95: 2800 } });
  });

  it('counts a failure as infinite even when a character appeared, and fails a small level on one failure', () => {
    const rows = [...Array.from({ length: 19 }, () => ok(1000)), failed('transport', 900)];
    const summary = summarizeBurst(rows);
    expect(summary.failures).toEqual({ transport: 1 });
    expect(summary.withinLimit).toBe(19);
    expect(summary.firstCharacterMs.p95).toBe(1000);
    expect(summary.checks).toEqual({ completedEnough: false, fastEnough: true });
    expect(summary.verdict).toBe('fail');
  });

  it('writes an infinite p95 as inf and fails on time alone', () => {
    const rows = [...Array.from({ length: 150 }, () => ok(2000)), ...Array.from({ length: 10 }, () => ok(6000))];
    expect(summarizeBurst(rows)).toMatchObject({ completed: 160, firstCharacterMs: { p95: 6000 }, checks: { completedEnough: true, fastEnough: false }, verdict: 'fail' });
    const timedOut = [...Array.from({ length: 10 }, () => ok(2000)), ...Array.from({ length: 10 }, () => failed('timeout'))];
    expect(summarizeBurst(timedOut).firstCharacterMs).toEqual({ p50: 2000, p95: 'inf' });
  });

  it('allows one failure in a level of 160, as the 99% rule does', () => {
    const rows = [...Array.from({ length: 159 }, () => ok(1500)), failed('timeout')];
    expect(summarizeBurst(rows)).toMatchObject({ completed: 159, checks: { completedEnough: true, fastEnough: true }, verdict: 'pass' });
    expect(summarizeBurst([]).verdict).toBe('not run');
  });
});
