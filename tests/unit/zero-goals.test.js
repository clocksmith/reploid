import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ZERO_GOAL,
  ZERO_GOAL_CHOICES,
  getRandomZeroGoal
} from '../../self/ui/boot-wizard/goals.js';

describe('Zero goal presets', () => {
  it('keeps a 64-prompt RSI shuffle pool across levels 1 through 5', () => {
    expect(ZERO_GOAL_CHOICES).toHaveLength(64);
    expect(DEFAULT_ZERO_GOAL).toBe(ZERO_GOAL_CHOICES[0].text);

    const levelCounts = ZERO_GOAL_CHOICES.reduce((counts, goal) => {
      counts.set(goal.level, (counts.get(goal.level) || 0) + 1);
      return counts;
    }, new Map());

    expect([...levelCounts.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(Object.fromEntries(levelCounts)).toEqual({
      1: 13,
      2: 13,
      3: 13,
      4: 13,
      5: 12
    });
  });

  it('keeps every prompt unique, named, and below the goal input limit', () => {
    const views = new Set();
    const texts = new Set();

    for (const goal of ZERO_GOAL_CHOICES) {
      expect(goal.view).toEqual(expect.any(String));
      expect(goal.text).toEqual(expect.any(String));
      expect(goal.view.trim().length).toBeGreaterThan(0);
      expect(goal.text.trim().length).toBeGreaterThan(20);
      expect(goal.text.length).toBeLessThanOrEqual(500);
      views.add(goal.view);
      texts.add(goal.text);
    }

    expect(views.size).toBe(ZERO_GOAL_CHOICES.length);
    expect(texts.size).toBe(ZERO_GOAL_CHOICES.length);
  });

  it('returns a different prompt object when the current prompt can be skipped', () => {
    const currentGoal = ZERO_GOAL_CHOICES[0].text;
    const nextGoal = getRandomZeroGoal(1, currentGoal);

    expect(nextGoal).toEqual(expect.objectContaining({
      view: expect.any(String),
      text: expect.any(String),
      level: expect.any(Number)
    }));
    expect(nextGoal.text).not.toBe(currentGoal);
  });
});
