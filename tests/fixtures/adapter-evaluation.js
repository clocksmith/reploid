import { createHash } from 'node:crypto';
import { itemListDigest } from '../../apps/poolday/pool/adapter-evaluation.js';
import { buildReceipt } from '../../scripts/adapter-evaluation.js';

/** Synthetic held-out evaluation fixtures. They prove verifier mechanics only, never an adapter's quality. */
export const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
export const keys = ['people', 'places', 'dates'];
export const baseModel = { id: 'base', identity: sha('base') };
export const adapter = { id: 'ner', identity: sha('adapter'), baseModelIdentity: baseModel.identity, artifact: { hash: sha('bytes') } };
const file = name => ({ path: `dataset/${name}`, sha256: sha(name), rows: 1 });
const source = { dataset: 'fixture', revision: 'a'.repeat(40), url: 'https://example.invalid/data', license: 'fixture' };

/** A small frozen spec over synthetic item ids; not a statement about any real adapter. */
export async function fixtureSpec(taskIds, retentionIds) {
  return {
    schema: 'reploid.adapter-evaluation-spec/v1', id: 'fixture/v1', frozenAt: '2026-11-05',
    task: { id: 'fixture', description: 'Fixture task', prompt: { system: 'Extract.', user: 'Sentence: {input}' }, output: { format: 'json-object', keys } },
    data: { source, labelMapping: { PERSON: 'people' }, training: { files: [file('train')] }, selection: { files: [file('valid')] },
      heldOut: { files: [file('test')], method: 'dedupe-normalized-sentences-then-seeded-stratified-sample', seed: 1,
        withEntities: taskIds.length - 1, withoutEntities: 1, items: { count: taskIds.length, sha256: await itemListDigest(taskIds) } } },
    retention: { source, files: [file('math')], method: 'seeded-sample', seed: 2, prompt: '{input}', metric: 'final-number-exact-match',
      maximumRegression: 0.02, items: { count: retentionIds.length, sha256: await itemListDigest(retentionIds) } },
    metrics: { task: { id: 'entity-micro-f1', minimumCandidate: 0.8, minimumGain: 0.05,
      bootstrap: { resamples: 200, seed: 3, level: 0.95, minimumLowerBound: 0 } }, validity: { id: 'json-valid-rate', minimumCandidate: 0.99 } },
    generation: { temperature: 0, topK: 1, maxTokens: 64 }, independence: { evaluatorDistinctFromTrainer: true }
  };
}

export const json = value => JSON.stringify(value);
export async function fixtureReceipt({ candidateCorrect = true } = {}) {
  const task = Array.from({ length: 20 }, (_, index) => ({ id: sha('item' + index), gold: { people: index === 19 ? [] : ['Maya Lin'], places: [], dates: [] } }));
  const retention = [{ id: sha('r1'), answer: 4 }, { id: sha('r2'), answer: 10 }];
  const spec = await fixtureSpec(task.map(item => item.id), retention.map(item => item.id));
  const row = (suite, id, text, adapters) => ({ suite, id, text, modelIdentity: baseModel.identity, adapterIdentities: adapters });
  const base = [...task.map((item, index) => row('task', item.id, index % 2 ? 'Maya Lin is a person.' : json({ people: [], places: [], dates: [] }), [])),
    ...retention.map(item => row('retention', item.id, `So the answer is ${item.answer}`, []))];
  const candidate = [...task.map(item => row('task', item.id, candidateCorrect ? json(item.gold) : json({ people: [], places: [], dates: [] }), [adapter.identity])),
    ...retention.map(item => row('retention', item.id, `Answer:\n${item.answer}`, [adapter.identity]))];
  const run = { runtime: { engine: 'doppler', version: '0.6.33', observedAdapterIdentity: adapter.identity, observedBaseIdentity: baseModel.identity },
    trainer: { id: 'trainer', trainingFiles: [sha('train')] }, evaluator: { id: 'evaluator' }, evaluatedAt: '2026-11-05T00:00:00Z' };
  const specSha256 = sha(json(spec));
  return { spec, specSha256, receipt: await buildReceipt({ spec, specSha256, adapter, baseModel, task, retention, base, candidate, run }) };
}
