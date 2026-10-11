import { describe, expect, it } from 'vitest';
import { compareCountedLines } from '../fixtures/counted-lines.js';

describe('retained counting task oracle', () => {
  const complete = Array.from({ length: 200 }, (_, index) => String(index + 1));
  it('accepts the complete numeral sequence and written numbers', () => {
    expect(compareCountedLines(complete.join('\n'), 200).passed).toBe(true);
    expect(compareCountedLines('One\nTwo\nThree', 3).passed).toBe(true);
    const written = [...complete];
    written[20] = 'twenty-one'; written[100] = 'one hundred and one'; written[199] = 'two hundred';
    expect(compareCountedLines(written.join('\n'), 200).passed).toBe(true);
  });
  it('rejects the observed EOS answer ending at 120', () => {
    expect(compareCountedLines(complete.slice(0, 120).join('\n'), 200)).toEqual({
      passed: false, expectedLines: 200, actualLines: 120,
      firstMismatch: { line: 121, actual: null, expected: '121' },
    });
  });
  it('rejects skipped, duplicated, reordered and extra numbers', () => {
    for (const lines of [complete.filter(value => value !== '47'),
      [...complete.slice(0, 40), ...complete.slice(39)],
      ['2', '1', ...complete.slice(2)], [...complete, '201']]) {
      expect(compareCountedLines(lines.join('\n'), 200).passed).toBe(false);
    }
  });
  it('rejects summaries and comma-separated output', () => {
    expect(compareCountedLines('1 through 200', 200).passed).toBe(false);
    expect(compareCountedLines(complete.join(', '), 200).passed).toBe(false);
    expect(compareCountedLines('', 200).passed).toBe(false);
  });
});
