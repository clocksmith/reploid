// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const script = readFileSync(new URL('../../server/daily/site/app.js', import.meta.url), 'utf8');

it('never hardcodes the daily turn count in page copy', () => {
  // The limit comes from the server's rule value (turnsPerDay); a literal such as "3 tries today" goes stale.
  expect(script.match(/\d+ (tries|turns)\b/g) ?? []).toEqual([]);
});

it('labels a nonzero closeness below one percent as under one percent, and an exact zero as zero', () => {
  const source = script.match(/const closeness = record => (.+);/)?.[1];
  expect(source).toBeTruthy();
  const closeness = new Function('record', `return ${source};`);
  // Only a nonzero score below one percent is "Under 1%"; an exact zero is shown as zero.
  expect(closeness({ closeness: 0 })).toBe('0% close');
  expect(closeness({ closeness: 0.043 })).toBe('Under 1% close');
  expect(closeness({ closeness: Number.MIN_VALUE })).toBe('Under 1% close');
  expect(closeness({ closeness: 1 })).toBe('1% close');
  expect(closeness({ closeness: 89 })).toBe('89% close');
  expect(closeness({ closeness: null })).toBe('');
  expect(closeness({})).toBe('');
});
