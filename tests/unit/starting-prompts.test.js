import { describe, expect, it } from 'vitest';
import chatPrompts from '../../apps/poolday/config/chat-prompts.json' with { type: 'json' };
import { pickStartingPrompts } from '../../apps/poolday/host/decisions/conversation-controller.js';

const seq = values => { let i = 0; return () => values[i++ % values.length]; };

describe('starting prompts', () => {
  it('keeps a varied set of about fifty short, distinct prompts', () => {
    expect(chatPrompts.length).toBeGreaterThanOrEqual(45);
    expect(new Set(chatPrompts).size).toBe(chatPrompts.length);
    for (const text of chatPrompts) {
      expect(text.length).toBeLessThanOrEqual(60);
      expect(text).toMatch(/^(Suggest|Pick|Recommend) 3 /);
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('asks only about movies and shows, as the owner directed', () => {
    const screen = /\b(movies?|films?|shows?|series|miniseries|sitcom|episodes?|documentar(y|ies)|specials|musicals)\b/i;
    for (const text of chatPrompts) expect(text).toMatch(screen);
    for (const text of chatPrompts) expect(text).not.toMatch(/\b(gifts?|dinners?|desserts?|soups?|cocktails?|recipes?|puzzle|board games?|card games?|video games?|podcasts?|novels?|albums?|hikes?)\b/i);
  });

  it('picks three distinct prompts from the set', () => {
    for (const r of [0, 0.5, 0.999999, 0.25]) {
      const picked = pickStartingPrompts(chatPrompts, () => r);
      expect(picked).toHaveLength(3);
      expect(new Set(picked).size).toBe(3);
      for (const text of picked) expect(chatPrompts).toContain(text);
    }
  });

  it('varies with the random source and never repeats within one draw', () => {
    const seen = new Set();
    for (let k = 0; k < 40; k++) for (const text of pickStartingPrompts(chatPrompts, seq([k / 40, ((k * 7) % 40) / 40, ((k * 13) % 40) / 40]))) seen.add(text);
    expect(seen.size).toBeGreaterThan(20);
  });

  it('returns fewer when the set is smaller, and ignores blanks and duplicates', () => {
    expect(pickStartingPrompts(['A.', 'A.', ' ', 'B.'], () => 0)).toEqual(['A.', 'B.']);
    expect(pickStartingPrompts([], () => 0)).toEqual([]);
    expect(pickStartingPrompts(null, () => 0)).toEqual([]);
  });

  it('tolerates a broken random source', () => {
    const picked = pickStartingPrompts(chatPrompts, () => NaN);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });
});
