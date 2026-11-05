import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AdapterEvaluationError, validateAdapterEvaluationSpec, verifyAdapterEvaluationReceipt } from '../../self/pool/adapter-evaluation.js';
import { buildReceipt, goldEntities, scoreEntities, scoreFinalNumber, selectTaskItems } from '../../scripts/adapter-evaluation.js';
import { adapter, baseModel, fixtureReceipt, json, keys, sha } from '../fixtures/adapter-evaluation.js';
import { resolveServedFile } from '../../server/browser-roots.js';
const verify = ({ spec, specSha256, receipt }, overrides = {}) => verifyAdapterEvaluationReceipt({ receipt, spec, specSha256, adapter, baseModel, ...overrides });

describe('held-out adapter evaluation', () => {
  it('passes only a receipt whose recomputed held-out gain, validity and retention meet the frozen spec', async () => {
    const fixture = await fixtureReceipt();
    const result = await verify(fixture);
    expect(result).toMatchObject({ verdict: 'passed', failures: [] });
    expect(result.metrics.task.candidate).toBe(1);
    expect(result.metrics.task.base).toBe(0);
    expect(result.metrics.task.gainLowerBound).toBeGreaterThan(0);
  });

  it('reports a failing adapter as failed, never as evaluated', async () => {
    const fixture = await fixtureReceipt({ candidateCorrect: false });
    expect(fixture.receipt.outcome).toBe('fail');
    const result = await verify(fixture);
    expect(result.verdict).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining(['task-score-below-minimum', 'task-gain-below-minimum']));
    fixture.receipt.outcome = 'pass';
    await expect(verify(fixture)).rejects.toThrow('receipt outcome differs from its item results');
  });

  it('rejects receipts that misreport results, change identities, reuse the trainer or use other items', async () => {
    const cases = [
      [receipt => { receipt.metrics.task.candidate = 0.99; receipt.heldOut.items[0].candidate.valid = false; receipt.heldOut.items[0].candidate.tp = 0;
        receipt.heldOut.items[0].candidate.fn = 1; }, 'differ from its item results'],
      [receipt => { receipt.outcome = 'pass'; receipt.metrics.task.candidate = 0; }, 'differ'],
      [receipt => { receipt.adapter.identity = sha('other adapter'); }, 'different adapter'],
      [receipt => { receipt.runtime.observedAdapterIdentity = sha('other adapter'); }, 'executed adapter'],
      [receipt => { receipt.evaluator.id = receipt.trainer.id; }, 'independent'],
      [receipt => { receipt.trainer.trainingFiles = [sha('test')]; }, 'spec training files'],
      [receipt => { receipt.heldOut.items[0].id = sha('unfrozen'); }, 'frozen held-out split'],
      [receipt => { receipt.spec.sha256 = sha('edited spec'); }, 'different evaluation spec']
    ];
    for (const [tamper, message] of cases) {
      const fixture = await fixtureReceipt();
      tamper(fixture.receipt);
      await expect(verify(fixture)).rejects.toThrow(message);
    }
    const fixture = await fixtureReceipt();
    await expect(verify(fixture, { baseModel: { ...baseModel, identity: sha('other base') } })).rejects.toThrow(AdapterEvaluationError);
  });

  it('rejects outputs that do not record the arm’s executed identities', async () => {
    const { spec } = await fixtureReceipt();
    const task = [{ id: sha('item0'), gold: { people: [], places: [], dates: [] } }];
    const row = { suite: 'task', id: task[0].id, text: '{}', modelIdentity: baseModel.identity, adapterIdentities: [] };
    await expect(buildReceipt({ spec, specSha256: sha('spec'), adapter, baseModel, task, retention: [], base: [row], candidate: [row], run: {} }))
      .rejects.toThrow('candidate output for task item');
  });

  it('scores strict JSON entity output and final numeric answers', () => {
    const gold = { people: ['Maya Lin'], places: ['New York'], dates: ['the 1990 \'s'] };
    expect(scoreEntities(gold, json({ people: ['maya lin'], places: ['Paris'], dates: ["the 1990's"] }), keys)).toEqual({ valid: true, tp: 2, fp: 1, fn: 1 });
    expect(scoreEntities(gold, '```json\n' + json({ people: [], places: [], dates: [] }) + '\n```', keys)).toEqual({ valid: true, tp: 0, fp: 0, fn: 3 });
    expect(scoreEntities(gold, 'Here: ' + json(gold), keys)).toEqual({ valid: false, tp: 0, fp: 0, fn: 3 });
    expect(scoreEntities(gold, json({ ...gold, orgs: [] }), keys).valid).toBe(false);
    expect(scoreFinalNumber(1200, 'Total: 1,200 dollars')).toEqual({ correct: true });
    expect(scoreFinalNumber(12, '12 then 13')).toEqual({ correct: false });
  });

  it('derives deduplicated held-out items from pinned files and maps BIO tags to output keys', async () => {
    const labels = { O: 0, 'B-PERSON': 1, 'I-PERSON': 2, 'B-GPE': 3 };
    expect(goldEntities({ tokens: ['Maya', 'Lin', 'visited', 'Paris'], tags: [1, 2, 0, 3] }, labels, { PERSON: 'people', GPE: 'places' }, keys))
      .toEqual({ people: ['Maya Lin'], places: ['Paris'], dates: [] });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'adapter-evaluation-'));
    const rows = { train: [{ tokens: ['Seen', 'Maya'], tags: [0, 1] }], valid: [{ tokens: ['Other'], tags: [0] }],
      test: [{ tokens: ['Seen', 'Maya'], tags: [0, 1] }, { tokens: ['New', 'Maya'], tags: [0, 1] }, { tokens: ['Nobody'], tags: [0] }, { tokens: ['new', 'Maya'], tags: [0, 1] }] };
    const files = {};
    for (const [name, list] of Object.entries(rows)) {
      const text = list.map(row => JSON.stringify(row)).join('\n') + '\n';
      await writeFile(path.join(directory, name + '.json'), text);
      files[name] = { path: `dataset/${name}.json`, sha256: sha(text), rows: list.length };
    }
    await writeFile(path.join(directory, 'label.json'), JSON.stringify(labels));
    const spec = { task: { output: { keys } }, data: { labelMapping: { PERSON: 'people' }, training: { files: [files.train] }, selection: { files: [files.valid] },
      heldOut: { files: [files.test], seed: 9, withEntities: 1, withoutEntities: 1 } } };
    const items = await selectTaskItems(spec, directory);
    // The sentence seen in training is excluded and the case-only duplicate counts once.
    expect(items.map(item => item.sentence)).toEqual(['New Maya', 'Nobody']);
    expect(await selectTaskItems(spec, directory)).toEqual(items);
    await writeFile(path.join(directory, 'test.json'), 'tampered\n');
    await expect(selectTaskItems(spec, directory)).rejects.toThrow('differs from its pinned sha256');
  });

  it('keeps the published NER spec frozen, valid and disjoint from its training data', async () => {
    const spec = JSON.parse(await readFile(resolveServedFile('config/adapter-evaluations/ner-json-people-places-dates-v1.json'), 'utf8'));
    expect(validateAdapterEvaluationSpec(spec)).toBe(spec);
    for (const items of [spec.data.heldOut.items, spec.retention.items]) expect(items.sha256).not.toBe('sha256:' + '0'.repeat(64));
  });
});
