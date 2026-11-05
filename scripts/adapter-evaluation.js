/**
 * Held-out adapter evaluation harness (Node). It derives the frozen held-out and retention
 * items from pinned dataset files, writes the prompts a Doppler runner executes for the base
 * model and the adapter, scores both arms' outputs into a receipt, and verifies receipts with
 * the same verifier the browser uses. It never trains and never runs a model.
 *
 *   node scripts/adapter-evaluation.js freeze  --spec <spec.json> --data <dir> --retention-data <dir> [--write]
 *   node scripts/adapter-evaluation.js prompts --spec <spec.json> --data <dir> --retention-data <dir> --out <prompts.jsonl>
 *   DOPPLER_SOURCE_URL=<tested Doppler checkout file URL/> node scripts/adapter-evaluation.js run --spec <spec.json> --prompts <prompts.jsonl>
 *       --adapter <catalog adapter id> --arm base|candidate --model-directory <verified weights> --adapter-file <safetensors> --out <outputs.jsonl>
 *   node scripts/adapter-evaluation.js score   --spec <spec.json> --data <dir> --retention-data <dir> --adapter <catalog adapter id>
 *                                               --base <outputs.jsonl> --candidate <outputs.jsonl> --run <run.json> --out <receipt.json>
 *   node scripts/adapter-evaluation.js verify  --receipt <receipt.json> --spec <spec.json> --adapter <catalog adapter id>
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ADAPTER_EVALUATION_RECEIPT_SCHEMA, computeAdapterEvaluation, itemListDigest, seededRandom,
  validateAdapterEvaluationSpec, verifyAdapterEvaluationReceipt
} from '../apps/poolday/pool/adapter-evaluation.js';
import { resolveServedFile } from '../server/browser-roots.js';

const root = () => path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sha256 = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
export const normalizeText = value => String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// Entity comparison ignores whitespace, so tokenized gold spans ("1990 's") match detokenized output ("1990's").
const entityKey = value => String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');

async function readPinned(directory, file) {
  const bytes = await readFile(path.join(directory, path.basename(file.path)));
  if (sha256(bytes) !== file.sha256) throw new Error(`${file.path} differs from its pinned sha256`);
  const rows = lines(bytes.toString('utf8'));
  if (rows.length !== file.rows) throw new Error(`${file.path} has ${rows.length} rows, expected ${file.rows}`);
  return rows;
}

/** BIO tags to the spec's output keys; spans keep their token spacing. */
export function goldEntities(row, labels, mapping, keys) {
  const names = Object.fromEntries(Object.entries(labels).map(([name, id]) => [id, name]));
  const result = Object.fromEntries(keys.map(key => [key, []]));
  let current = null;
  const close = () => { if (current) result[current.key].push(current.tokens.join(' ')); current = null; };
  row.tokens.forEach((token, index) => {
    const tag = names[row.tags[index]] || 'O', type = tag.slice(2), key = mapping[type];
    if (tag.startsWith('B-')) { close(); if (key) current = { key, type, tokens: [token] }; }
    else if (tag.startsWith('I-') && current?.type === type) current.tokens.push(token);
    else close();
  });
  close();
  return result;
}

const shuffle = (values, seed) => {
  const random = seededRandom(seed), copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
};

/** The frozen task items: held-out sentences absent from training and selection data, deduplicated,
 * then a seeded stratified sample. Item ids are normalized-sentence digests, so the list never carries text. */
export async function selectTaskItems(spec, directory) {
  const labels = JSON.parse(await readFile(path.join(directory, 'label.json'), 'utf8'));
  const seen = new Set();
  for (const file of [...spec.data.training.files, ...spec.data.selection.files]) {
    for (const row of await readPinned(directory, file)) seen.add(sha256(normalizeText(row.tokens.join(' '))));
  }
  const unique = new Map();
  for (const file of spec.data.heldOut.files) for (const row of await readPinned(directory, file)) {
    const id = sha256(normalizeText(row.tokens.join(' ')));
    if (!seen.has(id) && !unique.has(id)) unique.set(id, { id, sentence: row.tokens.join(' '),
      gold: goldEntities(row, labels, spec.data.labelMapping, spec.task.output.keys) });
  }
  const rows = [...unique.values()].sort((a, b) => a.id < b.id ? -1 : 1);
  const positive = rows.filter(row => Object.values(row.gold).some(list => list.length));
  const negative = rows.filter(row => !Object.values(row.gold).some(list => list.length));
  const { seed, withEntities, withoutEntities } = spec.data.heldOut;
  if (positive.length < withEntities || negative.length < withoutEntities) throw new Error('Held-out data cannot fill the declared strata');
  return [...shuffle(positive, seed).slice(0, withEntities), ...shuffle(negative, seed + 1).slice(0, withoutEntities)];
}

/** The frozen retention items: a seeded sample of the pinned retention test file. */
export async function selectRetentionItems(spec, directory) {
  const unique = new Map();
  for (const file of spec.retention.files) for (const row of await readPinned(directory, file)) {
    const id = sha256(normalizeText(row.question));
    const answer = String(row.answer).split('####').at(-1).trim().replace(/,/g, '');
    if (!unique.has(id)) unique.set(id, { id, question: row.question, answer: Number(answer) });
  }
  const rows = [...unique.values()].filter(row => Number.isFinite(row.answer)).sort((a, b) => a.id < b.id ? -1 : 1);
  if (rows.length < spec.retention.items.count) throw new Error('Retention data cannot fill the declared count');
  return shuffle(rows, spec.retention.seed).slice(0, spec.retention.items.count);
}

/** Strict JSON: one object, optionally inside one Markdown fence, with exactly the declared string arrays. */
export function scoreEntities(gold, output, keys) {
  const missing = Object.values(gold).reduce((total, list) => total + list.length, 0);
  let value;
  try {
    const body = String(output).trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/u, '$1').trim();
    value = JSON.parse(body);
  } catch { return { valid: false, tp: 0, fp: 0, fn: missing }; }
  const valid = value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Array.isArray(value[key]) && value[key].every(item => typeof item === 'string'));
  if (!valid) return { valid: false, tp: 0, fp: 0, fn: missing };
  let tp = 0, fp = 0, fn = 0;
  for (const key of keys) {
    const expected = new Map();
    for (const item of gold[key]) expected.set(entityKey(item), (expected.get(entityKey(item)) || 0) + 1);
    for (const item of value[key]) {
      const k = entityKey(item), left = expected.get(k) || 0;
      if (left) { tp++; expected.set(k, left - 1); } else fp++;
    }
    for (const left of expected.values()) fn += left;
  }
  return { valid: true, tp, fp, fn };
}

/** The last number in the output equals the reference answer. */
export function scoreFinalNumber(answer, output) {
  const numbers = String(output).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g);
  return { correct: !!numbers && Number(numbers.at(-1)) === answer };
}

export const taskMessages = (spec, item) => [{ role: 'system', content: spec.task.prompt.system },
  { role: 'user', content: spec.task.prompt.user.replace('{input}', item.sentence) }];
export const retentionMessages = (spec, item) => [{ role: 'user', content: spec.retention.prompt.replace('{input}', item.question) }];

const catalogAdapter = async adapterId => {
  const models = JSON.parse(await readFile(resolveServedFile('config/chat-models.json'), 'utf8'));
  for (const baseModel of models) {
    const adapter = (baseModel.availableAdapters || []).find(entry => entry.id === adapterId);
    if (adapter) return { adapter, baseModel };
  }
  throw new Error(`Adapter ${adapterId} is not in the catalog`);
};

/** Score both arms. Every output row must name the executed identities of its arm. */
export async function buildReceipt({ spec, specSha256, adapter, baseModel, task, retention, base, candidate, run }) {
  const byId = rows => new Map(rows.map(row => [`${row.suite}:${row.id}`, row]));
  const arms = { base: byId(base), candidate: byId(candidate) };
  const output = (arm, suite, id) => {
    const row = arms[arm].get(`${suite}:${id}`);
    if (!row || typeof row.text !== 'string') throw new Error(`${arm} output is missing ${suite} item ${id}`);
    const adapters = arm === 'base' ? [] : [adapter.identity];
    if (row.modelIdentity !== baseModel.identity || JSON.stringify(row.adapterIdentities) !== JSON.stringify(adapters)) {
      throw new Error(`${arm} output for ${suite} item ${id} names different executed identities`);
    }
    return row.text;
  };
  const taskRows = task.map(item => {
    const scored = arm => { const text = output(arm, 'task', item.id); return { ...scoreEntities(item.gold, text, spec.task.output.keys), outputSha256: sha256(text) }; };
    return { id: item.id, base: scored('base'), candidate: scored('candidate') };
  });
  const retentionRows = retention.map(item => {
    const scored = arm => { const text = output(arm, 'retention', item.id); return { ...scoreFinalNumber(item.answer, text), outputSha256: sha256(text) }; };
    return { id: item.id, base: scored('base'), candidate: scored('candidate') };
  });
  const result = computeAdapterEvaluation(spec, taskRows, retentionRows);
  return { schema: ADAPTER_EVALUATION_RECEIPT_SCHEMA, spec: { id: spec.id, sha256: specSha256 },
    adapter: { id: adapter.id, identity: adapter.identity, artifactSha256: adapter.artifact.hash, baseModelIdentity: adapter.baseModelIdentity },
    baseModel: { id: baseModel.id, identity: baseModel.identity },
    runtime: run.runtime, trainer: run.trainer, evaluator: run.evaluator, evaluatedAt: run.evaluatedAt,
    heldOut: { items: taskRows }, retention: { items: retentionRows },
    metrics: result.metrics, outcome: result.outcome, failures: result.failures };
}

/** Execute the frozen prompts through Reploid's native whole-model composition and Doppler (GPU required).
 * Each output row records the model and adapter identities Doppler's generation evidence reported. */
async function runPrompts({ spec, prompts, adapterId, arm, modelDirectory, adapterFile, out }) {
  if (!['base', 'candidate'].includes(arm)) throw new Error('--arm must be base or candidate');
  const engine = process.env.DOPPLER_SOURCE_URL;
  if (!engine) throw new Error('DOPPLER_SOURCE_URL must identify the tested Doppler checkout URL');
  const { adapter, baseModel } = await catalogAdapter(adapterId);
  const [{ createNativeWholeModel }, { createWorkAdapterResolver }, { createReploidDopplerRuntimeService }] = await Promise.all([
    import('../server/native-whole-model.js'), import('../apps/poolday/providers/work-adapter.js'), import('../shared/infrastructure/doppler-runtime-service.js')]);
  const { probeNodeGPU } = await import(new URL('tests/helpers/gpu-probe.js', engine));
  const { destroyDevice } = await import(new URL('src/gpu/device.js', engine));
  const { releaseNodeWebGPU } = await import(new URL('src/tooling/node-webgpu.js', engine));
  const doppler = await import(new URL('src/index.js', engine));
  const model = { ...baseModel, adapters: arm === 'candidate' ? [adapter] : [],
    generation: { ...baseModel.generation, maxTokens: spec.generation.maxTokens, temperature: 0, topK: 1, topP: 1,
      repetitionPenalty: 1, useChatTemplate: spec.generation.useChatTemplate !== false, maxSeqLen: baseModel.generation?.maxSeqLen ?? 4096 } };
  const service = createReploidDopplerRuntimeService({ loadModule: async () => doppler, expectedVersion: doppler.DOPPLER_VERSION });
  const provider = createNativeWholeModel({ model, modelDirectory, service,
    nativeGpu: async () => { if (!(await probeNodeGPU({ installFileFetchShim: true })).ready) throw new Error('No native GPU'); },
    resolveAdapter: createWorkAdapterResolver({ models: [baseModel], acquire: async () => readFile(adapterFile) }) });
  const rows = [];
  try {
    await provider.contribute(true);
    for (const prompt of prompts) {
      const result = await provider.generate(prompt.messages, () => {}, { adapterIdentities: model.adapters.map(item => item.identity),
        signal: new AbortController().signal, maxOutputTokens: spec.generation.maxTokens });
      rows.push({ suite: prompt.suite, id: prompt.id, text: result.content, modelIdentity: result.modelIdentity,
        adapterIdentities: result.adapterIdentities, runtimeVersion: doppler.DOPPLER_VERSION });
      if (rows.length % 50 === 0) console.log(`[adapter-evaluation] ${rows.length}/${prompts.length} ${arm} outputs`);
    }
  } finally { await provider.close(); await service.closeAll(); destroyDevice(); releaseNodeWebGPU(); }
  await writeFile(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

async function main() {
  const [command] = process.argv.slice(2);
  const { values } = parseArgs({ args: process.argv.slice(3), options: Object.fromEntries(['spec', 'data', 'retention-data', 'out', 'adapter',
    'base', 'candidate', 'run', 'receipt', 'prompts', 'arm', 'model-directory', 'adapter-file'].map(key => [key, { type: 'string' }]).concat([['write', { type: 'boolean', default: false }]])) });
  const specBytes = await readFile(values.spec);
  const spec = JSON.parse(specBytes.toString('utf8'));
  const items = async () => ({ task: await selectTaskItems(spec, values.data), retention: await selectRetentionItems(spec, values['retention-data']) });
  if (command === 'freeze') {
    const { task, retention } = await items();
    spec.data.heldOut.items = { count: task.length, sha256: await itemListDigest(task.map(item => item.id)) };
    spec.retention.items = { count: retention.length, sha256: await itemListDigest(retention.map(item => item.id)) };
    console.log(JSON.stringify({ heldOut: spec.data.heldOut.items, retention: spec.retention.items }, null, 2));
    if (values.write) await writeFile(values.spec, JSON.stringify(spec, null, 2) + '\n');
    return;
  }
  validateAdapterEvaluationSpec(spec);
  if (command === 'prompts') {
    const { task, retention } = await items();
    const rows = [...task.map(item => ({ suite: 'task', id: item.id, messages: taskMessages(spec, item) })),
      ...retention.map(item => ({ suite: 'retention', id: item.id, messages: retentionMessages(spec, item) }))];
    await writeFile(values.out, rows.map(row => JSON.stringify({ ...row, generation: spec.generation })).join('\n') + '\n');
    console.log(`Wrote ${rows.length} prompts; run them once with the base model and once with the adapter`);
    return;
  }
  if (command === 'run') {
    await runPrompts({ spec, prompts: lines(await readFile(values.prompts, 'utf8')), adapterId: values.adapter, arm: values.arm,
      modelDirectory: values['model-directory'], adapterFile: values['adapter-file'], out: values.out });
    return;
  }
  const { adapter, baseModel } = await catalogAdapter(values.adapter);
  if (command === 'score') {
    const { task, retention } = await items();
    const receipt = await buildReceipt({ spec, specSha256: sha256(specBytes), adapter, baseModel, task, retention,
      base: lines(await readFile(values.base, 'utf8')), candidate: lines(await readFile(values.candidate, 'utf8')),
      run: JSON.parse(await readFile(values.run, 'utf8')) });
    await writeFile(values.out, JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ outcome: receipt.outcome, failures: receipt.failures, metrics: receipt.metrics }, null, 2));
    return;
  }
  if (command === 'verify') {
    const receiptBytes = await readFile(values.receipt);
    const result = await verifyAdapterEvaluationReceipt({ receipt: JSON.parse(receiptBytes.toString('utf8')), spec,
      specSha256: sha256(specBytes), adapter, baseModel });
    console.log(JSON.stringify({ receiptSha256: sha256(receiptBytes), ...result }, null, 2));
    if (result.verdict !== 'passed') process.exitCode = 1;
    return;
  }
  throw new Error('Choose freeze, prompts, score or verify');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[adapter-evaluation] ${error.message}`); process.exitCode = 1; });
}
