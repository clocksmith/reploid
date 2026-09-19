import { describe, it, expect } from 'vitest';
import { extractProposedCriteria, deriveOutcomeTags, createWorkSession } from '../../self/host/work-session.js';

describe('work-session helpers', () => {
  it('extracts proposed criteria from a non-empty goal', () => {
    const goal = 'Repair the legacy timeout configuration and output repaired.json';
    const criteria = extractProposedCriteria(goal);
    expect(criteria).toContain('Repair the legacy timeout configuration');
    expect(criteria).toContain('Verify file syntax and integrity without unverified execution.');
  });

  it('provides a default criteria when goal is empty', () => {
    const criteria = extractProposedCriteria('');
    expect(criteria).toBe('Produce the requested deliverable and verify file syntax and integrity without unverified execution.');
  });

  it('derives outcome tags correctly based on artifact checks and output', () => {
    const rowWithJson = {
      status: 'review',
      output: 'Task completed',
      artifacts: [
        {
          id: '1',
          name: 'repaired.json',
          inspection: {
            checks: [{ name: 'json-syntax', passed: true }]
          }
        }
      ]
    };
    const tags = deriveOutcomeTags(rowWithJson);
    expect(tags).toContain('JSON validated');
    expect(tags).toContain('Patch drafted');
    expect(tags).toContain('Needs execution');

    const rowWithSyntaxError = {
      status: 'review',
      output: 'Task failed syntax',
      artifacts: [
        {
          id: '2',
          name: 'broken.json',
          inspection: {
            checks: [{ name: 'json-syntax', passed: false }]
          }
        }
      ]
    };
    const errorTags = deriveOutcomeTags(rowWithSyntaxError);
    expect(errorTags).toContain('Syntax error');
    expect(errorTags).toContain('Patch drafted');
    expect(errorTags).toContain('Needs execution');
  });

  it('rejects goals shorter than 5 characters', async () => {
    const storage = { getItem: () => null, setItem: () => {} };
    const session = createWorkSession({ storage });
    await expect(session.start({ goal: 'fix' })).rejects.toThrow('Enter a bounded goal');
  });
});
