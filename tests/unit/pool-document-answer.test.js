import { describe, expect, it } from 'vitest';
import { inspectDocumentAnswer } from '../../self/pool/document-answer.js';
import { createDocumentSearch } from '../../self/pool/document-search.js';
import { createLocalPackExecutor } from '../../self/pool/local-pack-executor.js';
import { createDocumentPackFixture } from '../fixtures/document-packs.js';
import policy from '../../self/pool/document-search-policy.json' with { type: 'json' };

const passages = [{ id: 'a', text: 'Apple trees grow fruit.' }, { id: 'b', text: 'Whales live in the sea.' }];
const inspect = text => inspectDocumentAnswer({ text, passages, abstention: policy.answerAbstention });

describe('document answer reference accounting, without semantic certification', () => {
  it('accepts the explicit abstention without inventing a supporting citation', () => {
    expect(inspect(policy.answerAbstention)).toMatchObject({ status: 'abstained', citations: [], claims: [] });
    expect(inspect(`${policy.answerAbstention} The answer is definitely yes.`).status).toBe('invalid');
  });

  it('binds references after full stops to their preceding sentences and original passages', () => {
    const text = 'Apple trees grow fruit. [1] Whales live in the sea. [2]';
    const result = inspect(text);
    expect(result.status).toBe('cited');
    expect(result.claims.map(claim => claim.citations)).toEqual([[1], [2]]);
    expect(result.claims.map(claim => claim.passages[0].id)).toEqual(['a', 'b']);
    for (const claim of result.claims) expect(text.slice(claim.start, claim.end)).toBe(claim.text);
  });

  it('does not let one cited sentence cover another uncited claim', () => {
    expect(inspect('Apple trees grow fruit. [1] Whales fly.').status).toBe('invalid');
    expect(inspect('Whales fly. Apple trees grow fruit. [1]').status).toBe('invalid');
    expect(inspect('Whales fly. [999]').status).toBe('invalid');
  });

  it('keeps an incorrect but syntactically valid citation explicitly unevaluated', () => {
    const result = inspect('Whales fly. [1]');
    expect(result.status).toBe('cited');
    expect(result.support).toBe('not-evaluated');
    expect(result.claims[0]).toMatchObject({ support: 'not-evaluated', passages: [{ id: 'a' }] });
  });

  it('retains both cited sources when describing a contradiction', () => {
    const result = inspect('The sources disagree [1] [2].');
    expect(result.status).toBe('cited');
    expect(result.claims[0].citations).toEqual([1, 2]);
  });

  it('allows the actual document workflow to abstain and retains the exact generation context', async () => {
    const fixture = await createDocumentPackFixture({ answerText: policy.answerAbstention });
    const workflow = createDocumentSearch({ executor: createLocalPackExecutor({ service: fixture.service }) });
    workflow.configure(fixture.configuration);
    await workflow.setDocuments([{ name: 'fruit.txt', text: passages[0].text }]);
    try {
      const result = await workflow.search({ query: 'Who first planted this tree?', generateAnswer: true });
      expect(result.answer).toMatchObject({ status: 'abstained', citations: [] });
      expect(result.answerAudit.generationInput).toEqual(fixture.calls.at(-1).input);
      expect(result.answerAudit.generationReceipt).toEqual(result.receipts.at(-1));
      expect(result.answerAudit.retrieved[0].text).toBe(passages[0].text);
      expect(result.answerAudit.output).toBe(policy.answerAbstention);
      expect(workflow.getState().status).toBe('Not enough evidence');
      expect(result.answerAudit.generationInput.prompt).not.toContain('cite the closest passage');
    } finally { await workflow.close(); }
  });

  it('retains the failed output and its execution receipt for subsequent support review', async () => {
    const fixture = await createDocumentPackFixture({ answerText: 'Apple trees grow fruit. [1] Whales fly.' });
    const workflow = createDocumentSearch({ executor: createLocalPackExecutor({ service: fixture.service }) });
    workflow.configure(fixture.configuration);
    await workflow.setDocuments([{ name: 'fruit.txt', text: passages[0].text }]);
    try {
      await expect(workflow.search({ query: 'fruit', generateAnswer: true })).rejects.toThrow('passage references');
      const failed = workflow.getState().history[0];
      expect(failed.status).toBe('failed');
      expect(failed.answerAudit.status).toBe('invalid');
      expect(failed.answerAudit.output).toContain('Whales fly.');
      expect(failed.answerAudit.generationReceipt).toEqual(failed.receipts.at(-1));
      workflow.clear();
      expect(workflow.getState().history).toEqual([]);
    } finally { await workflow.close(); }
  });
});
