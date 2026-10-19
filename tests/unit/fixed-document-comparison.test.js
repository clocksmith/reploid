// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { compareDocuments, comparisonMessages, inspectAnswer } from '../answer-regression/node/fixed-document-comparison.js';
import policy from '../../packages/reploid/src/retrieval/policy.json' with { type: 'json' };

const item = { id: 'name', query: 'Who wrote it? Name only, with citation.', sources: ['Mira wrote it.'],
  answerable: true, requiredFacts: ['Mira'], forbiddenFacts: ['Pike'], requiredCitations: [1],
  format: 'name-only', expectedName: 'Mira' };
const contract = { schema: 'reploid.fixed-document-comparison/v1', delta: 'move-source-instructions-to-system',
  maxGenerations: 4, maxOutputTokens: 64, perRequestTimeoutMs: 1000, systemContext: 'Answer briefly.',
  cases: [item, { ...item, id: 'second' }] };

describe('fixed-document comparison', () => {
  it('moves only instructions and preserves exact documents, questions and common system context', () => {
    const baseline = comparisonMessages(contract, item, policy, 'baseline');
    const candidate = comparisonMessages(contract, item, policy, 'candidate');
    expect(candidate[0].content).toBe(`${baseline[0].content}\n\n${policy.context.instructions}`);
    expect(candidate[1].content).toBe(baseline[1].content.slice(policy.context.instructions.length).trimStart());
  });
  it('separates fact indicators, citation support, format and harmful abstention', () => {
    const result = content => ({ content, completion: { stopReason: 'stop-token' } });
    const answer = inspectAnswer(item, result('Mira wrote it [1].'));
    expect(answer).toMatchObject({ factIndicators: true, citationMarkers: true, requestedFormat: false,
      factualCorrectness: null, citationSupport: null, reviewRequired: true });
    expect(inspectAnswer(item, result('[1]')).factIndicators).toBe(false);
    expect(inspectAnswer(item, result('The retrieved sources do not answer it.'))).toMatchObject({
      supportedQuestionAbstention: true, factIndicators: false });
    expect(inspectAnswer(item, result('Mira [9]')).citationMarkers).toBe(false);
  });
  it('alternates arms, freezes inputs, counts all cases and cannot promote mechanical success', async () => {
    const saved = [], calls = [];
    const receipt = await compareDocuments({ contract, policy, identity: {}, save: value => { saved.push(value); },
      generate: async (messages, controls) => {
        calls.push({ messages: structuredClone(messages), maxOutputTokens: controls.maxOutputTokens });
        messages[0].content = 'mutated by port';
        return { content: 'Mira [1]', completion: { stopReason: 'stop-token' } };
      } });
    expect(receipt.rows.map(row => row.arm)).toEqual(['baseline', 'candidate', 'candidate', 'baseline']);
    expect(new Set(calls.map(row => row.maxOutputTokens))).toEqual(new Set([64]));
    expect(receipt.rows[0].messages[0].content).toBe('Answer briefly.');
    expect(receipt.summary.baseline.answerable).toBe(2);
    expect(receipt.completed).toBe(true);
    expect(receipt.qualified).toBe(false);
    expect(saved[0].rows).toEqual([]);
  });
  it('retains a runtime failure and stops before dispatching another arm', async () => {
    let calls = 0;
    const receipt = await compareDocuments({ contract, policy, identity: {}, save: () => {},
      generate: async () => { calls++; throw new Error('Device lost'); } });
    expect(calls).toBe(1);
    expect(receipt.completed).toBe(false);
    expect(receipt.rows[0].error.message).toBe('Device lost');
    expect(receipt.rows[0]).not.toHaveProperty('checks');
  });
});
