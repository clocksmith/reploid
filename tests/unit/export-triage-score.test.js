// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { choiceDecision, countScores } from '../fixtures/community-lora-two-host-score.mjs';
import contract from '../../examples/export-triage/contract.json' with { type: 'json' };

const choices = (a, b) => [{ id: 'A', logit: a }, { id: 'B', logit: b }];

describe('independent export triage decisions', () => {
  it('compares finite logits strictly and represents ties explicitly', () => {
    expect(choiceDecision(choices(900, 900))).toEqual({ prediction: null, conditionalProbabilities: { A: 0.5, B: 0.5 } });
    expect(choiceDecision(choices(-999, -1000)).conditionalProbabilities.A).toBeCloseTo(0.73105857863);
    expect(choiceDecision(choices(-1000, 999)).prediction).toBe('B');
    for (const bad of [NaN, Infinity, undefined]) expect(() => choiceDecision(choices(bad, 1))).toThrow();
  });

  it('requires each per-label threshold and preserves every previously correct control', () => {
    // Only categorical outcomes are needed to exercise the counter. No model or prompts.
    const rows = [];
    for (const label of ['A', 'B']) {
      for (let index = 0; index < 12; index++) {
        const other = label === 'A' ? 'B' : 'A';
        rows.push({ id: `test-${label}-${index}`, label, base: { prediction: index < 6 ? label : other },
          single: { prediction: index < (label === 'A' ? 10 : 6) ? label : other },
          pooled: { prediction: index < 8 ? label : other } });
      }
    }
    for (let i = 0; i < 12; i++) {
      const label = i < 6 ? 'A' : 'B';
      rows.push({ id: 'control-' + i, label, base: { prediction: label }, single: { prediction: label }, pooled: { prediction: label } });
    }
    const scores = countScores(rows, contract.gate);
    expect(scores.base.taskCorrect).toBe(12);
    expect(scores.single.checks.perLabel).toBe(false);
    expect(scores.single.passed).toBe(false);
    expect(scores.pooled).toMatchObject({ taskCorrect: 16, taskNetGain: 4, controlLosses: [], passed: true });
    rows.at(-1).pooled.prediction = null;
    expect(countScores(rows, contract.gate).pooled).toMatchObject({ controlLosses: ['control-11'], passed: false });
  });
});
