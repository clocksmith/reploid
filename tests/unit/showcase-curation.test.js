import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { summarizeShowcase, validateShowcaseSummary } from '../../scripts/curate-showcase.js';

describe('showcase publication boundary', () => {
  it('omits sensitive content even in nested snapshots, names and unknown fields', () => {
    const privateText = 'private-canary-do-not-publish';
    const bytes = Buffer.from(JSON.stringify({ state: { totalCycles: 3, currentGoal: privateText },
      vfs: { [privateText]: JSON.stringify({ credentials: privateText }) },
      systemPrompt: privateText, conversationContext: [{ content: privateText }],
      activityLog: [{ type: 'error', message: privateText }], newExportField: privateText }));
    const summary = summarizeShowcase(bytes);
    expect(() => validateShowcaseSummary(summary)).not.toThrow();
    expect(JSON.stringify(summary)).not.toContain(privateText);
    expect(summary.source.sha256).toBe('sha256:' + createHash('sha256').update(bytes).digest('hex'));
    expect(summary.counts).toMatchObject({ cycles: 3, contextMessages: 1, virtualFiles: 1, errorEntries: 1 });
  });
  it('fails closed on raw exports and extra payloads, including nested fields', () => {
    const summary = summarizeShowcase(Buffer.from(JSON.stringify({ state: {}, vfs: {} })));
    for (const invalid of [{ state: {}, vfs: {} }, { ...summary, conversationContext: [] },
      { ...summary, source: { ...summary.source, content: 'secret' } },
      { ...summary, counts: { ...summary.counts, cycles: 'secret' } },
      { ...summary, omittedFields: ['secret'] }]) {
      expect(() => validateShowcaseSummary(invalid)).toThrow(/rejected/);
    }
  });
});
