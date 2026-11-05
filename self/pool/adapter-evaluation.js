/**
 * Held-out adapter evaluation. A spec is frozen before training: task, data provenance, the
 * held-out and retention item lists (by hash), metrics and acceptance thresholds. A receipt
 * carries per-item counts for the base model and the adapter. The verifier recomputes every
 * metric from those counts, so a receipt's own summary or outcome is never trusted.
 * Only a verified passing receipt bound to the exact adapter and base identities may label an
 * adapter evaluated. Anything else is a failed or invalid receipt, or no evaluation evidence.
 */
import { canonicalize } from '../../shared/pool/canonical-json.js';

export const ADAPTER_EVALUATION_SPEC_SCHEMA = 'reploid.adapter-evaluation-spec/v1';
export const ADAPTER_EVALUATION_RECEIPT_SCHEMA = 'reploid.adapter-evaluation-receipt/v1';
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;

export class AdapterEvaluationError extends Error {}
const fail = message => { throw new AdapterEvaluationError(message); };
const need = (ok, message) => { if (!ok) fail(message); };
const object = (value, field) => need(value && typeof value === 'object' && !Array.isArray(value), `${field} must be an object`);
const text = (value, field) => need(typeof value === 'string' && value.trim().length > 0 && value.length <= 4096, `${field} must be nonempty text`);
const digest = (value, field) => need(typeof value === 'string' && SHA256.test(value), `${field} must be sha256:<64 hex>`);
const fraction = (value, field) => need(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1, `${field} must be a number from 0 through 1`);
const count = (value, field, min = 0) => need(Number.isSafeInteger(value) && value >= min, `${field} must be an integer of at least ${min}`);

export async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return 'sha256:' + [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
/** The frozen identity of an ordered item list. */
export const itemListDigest = ids => sha256Text(canonicalize(ids));

const files = (value, field) => {
  need(Array.isArray(value) && value.length > 0, `${field} must list files`);
  value.forEach((file, index) => { text(file?.path, `${field}[${index}].path`); digest(file?.sha256, `${field}[${index}].sha256`); count(file?.rows, `${field}[${index}].rows`, 1); });
};
const items = (value, field) => { object(value, field); count(value.count, `${field}.count`, 1); digest(value.sha256, `${field}.sha256`); };
const source = (value, field) => {
  object(value, field); text(value.dataset, `${field}.dataset`); text(value.license, `${field}.license`); text(value.url, `${field}.url`);
  need(typeof value.revision === 'string' && REVISION.test(value.revision), `${field}.revision must be a 40-hex commit`);
};

/** Validate a spec's structure. A spec without frozen item hashes cannot back any receipt. */
export function validateAdapterEvaluationSpec(spec) {
  object(spec, 'spec');
  need(spec.schema === ADAPTER_EVALUATION_SPEC_SCHEMA, `spec.schema must be ${ADAPTER_EVALUATION_SPEC_SCHEMA}`);
  text(spec.id, 'spec.id'); text(spec.frozenAt, 'spec.frozenAt');
  object(spec.task, 'spec.task'); text(spec.task.id, 'spec.task.id'); text(spec.task.description, 'spec.task.description');
  object(spec.task.prompt, 'spec.task.prompt'); text(spec.task.prompt.system, 'spec.task.prompt.system');
  need(typeof spec.task.prompt.user === 'string' && spec.task.prompt.user.includes('{input}'), 'spec.task.prompt.user must contain {input}');
  need(Array.isArray(spec.task.output?.keys) && spec.task.output.keys.length > 0 && spec.task.output.keys.every(key => typeof key === 'string' && key),
    'spec.task.output.keys must list JSON keys');
  object(spec.data, 'spec.data'); source(spec.data.source, 'spec.data.source'); object(spec.data.labelMapping, 'spec.data.labelMapping');
  for (const [label, key] of Object.entries(spec.data.labelMapping)) need(spec.task.output.keys.includes(key), `spec.data.labelMapping.${label} must name an output key`);
  files(spec.data.training?.files, 'spec.data.training.files'); files(spec.data.selection?.files, 'spec.data.selection.files');
  files(spec.data.heldOut?.files, 'spec.data.heldOut.files');
  const heldOut = spec.data.heldOut;
  need(heldOut.method === 'dedupe-normalized-sentences-then-seeded-stratified-sample', 'spec.data.heldOut.method is unsupported');
  count(heldOut.seed, 'spec.data.heldOut.seed'); count(heldOut.withEntities, 'spec.data.heldOut.withEntities');
  count(heldOut.withoutEntities, 'spec.data.heldOut.withoutEntities'); items(heldOut.items, 'spec.data.heldOut.items');
  need(heldOut.items.count === heldOut.withEntities + heldOut.withoutEntities, 'spec.data.heldOut.items.count must equal its strata');
  const shared = [...spec.data.training.files, ...spec.data.selection.files].map(file => file.sha256);
  need(spec.data.heldOut.files.every(file => !shared.includes(file.sha256)), 'held-out files must differ from training and selection files');
  object(spec.retention, 'spec.retention'); source(spec.retention.source, 'spec.retention.source'); files(spec.retention.files, 'spec.retention.files');
  need(spec.retention.method === 'seeded-sample', 'spec.retention.method is unsupported'); count(spec.retention.seed, 'spec.retention.seed');
  items(spec.retention.items, 'spec.retention.items'); text(spec.retention.prompt, 'spec.retention.prompt');
  need(spec.retention.metric === 'final-number-exact-match', 'spec.retention.metric is unsupported');
  fraction(spec.retention.maximumRegression, 'spec.retention.maximumRegression');
  const task = spec.metrics?.task, validity = spec.metrics?.validity;
  need(task?.id === 'entity-micro-f1', 'spec.metrics.task.id must be entity-micro-f1');
  fraction(task.minimumCandidate, 'spec.metrics.task.minimumCandidate'); fraction(task.minimumGain, 'spec.metrics.task.minimumGain');
  object(task.bootstrap, 'spec.metrics.task.bootstrap'); count(task.bootstrap.resamples, 'spec.metrics.task.bootstrap.resamples', 100);
  need(task.bootstrap.resamples <= 20000, 'spec.metrics.task.bootstrap.resamples must be at most 20000');
  count(task.bootstrap.seed, 'spec.metrics.task.bootstrap.seed'); fraction(task.bootstrap.level, 'spec.metrics.task.bootstrap.level');
  need(typeof task.bootstrap.minimumLowerBound === 'number' && Number.isFinite(task.bootstrap.minimumLowerBound), 'spec.metrics.task.bootstrap.minimumLowerBound must be a number');
  need(validity?.id === 'json-valid-rate', 'spec.metrics.validity.id must be json-valid-rate');
  fraction(validity.minimumCandidate, 'spec.metrics.validity.minimumCandidate');
  object(spec.generation, 'spec.generation');
  need(spec.generation.temperature === 0 && spec.generation.topK === 1, 'spec.generation must be greedy');
  count(spec.generation.maxTokens, 'spec.generation.maxTokens', 1);
  need(spec.independence?.evaluatorDistinctFromTrainer === true, 'spec.independence.evaluatorDistinctFromTrainer must be true');
  return spec;
}

/** Deterministic 32-bit generator for the held-out sample and the bootstrap. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = ({ tp, fp, fn }) => tp + fp + fn === 0 ? 1 : 2 * tp / (2 * tp + fp + fn);
const sum = (rows, arm) => rows.reduce((total, row) => ({ tp: total.tp + row[arm].tp, fp: total.fp + row[arm].fp, fn: total.fn + row[arm].fn }), { tp: 0, fp: 0, fn: 0 });

/** Paired bootstrap lower bound of the candidate-minus-base micro F1 gain. */
export function bootstrapGainLowerBound(rows, { resamples, seed, level }) {
  const random = seededRandom(seed), gains = new Float64Array(resamples), n = rows.length;
  for (let r = 0; r < resamples; r++) {
    let btp = 0, bfp = 0, bfn = 0, ctp = 0, cfp = 0, cfn = 0;
    for (let i = 0; i < n; i++) {
      const row = rows[Math.floor(random() * n)];
      btp += row.base.tp; bfp += row.base.fp; bfn += row.base.fn;
      ctp += row.candidate.tp; cfp += row.candidate.fp; cfn += row.candidate.fn;
    }
    gains[r] = f1({ tp: ctp, fp: cfp, fn: cfn }) - f1({ tp: btp, fp: bfp, fn: bfn });
  }
  gains.sort();
  return gains[Math.floor(((1 - level) / 2) * resamples)];
}

/** Recompute every metric from per-item counts. */
export function computeAdapterEvaluation(spec, task, retention) {
  const base = f1(sum(task, 'base')), candidate = f1(sum(task, 'candidate'));
  const valid = arm => task.filter(row => row[arm].valid).length / task.length;
  const correct = arm => retention.filter(row => row[arm].correct).length / retention.length;
  const metrics = {
    task: { base, candidate, gain: candidate - base, gainLowerBound: bootstrapGainLowerBound(task, spec.metrics.task.bootstrap) },
    validity: { base: valid('base'), candidate: valid('candidate') },
    retention: { base: correct('base'), candidate: correct('candidate') }
  };
  metrics.retention.regression = Math.max(0, metrics.retention.base - metrics.retention.candidate);
  const failures = [
    metrics.task.candidate >= spec.metrics.task.minimumCandidate ? null : 'task-score-below-minimum',
    metrics.task.gain >= spec.metrics.task.minimumGain ? null : 'task-gain-below-minimum',
    metrics.task.gainLowerBound > spec.metrics.task.bootstrap.minimumLowerBound ? null : 'task-gain-not-established',
    metrics.validity.candidate >= spec.metrics.validity.minimumCandidate ? null : 'json-validity-below-minimum',
    metrics.retention.regression <= spec.retention.maximumRegression ? null : 'retention-regression-exceeded'
  ].filter(Boolean);
  return { metrics, failures, outcome: failures.length ? 'fail' : 'pass' };
}

const close = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 1e-9;
const taskRow = (row, field) => {
  text(row?.id, `${field}.id`);
  for (const arm of ['base', 'candidate']) {
    need(typeof row[arm]?.valid === 'boolean', `${field}.${arm}.valid must be boolean`);
    for (const key of ['tp', 'fp', 'fn']) count(row[arm][key], `${field}.${arm}.${key}`);
    need(row[arm].valid || row[arm].tp === 0 && row[arm].fp === 0, `${field}.${arm} cannot score an invalid output`);
    need(row.base.tp + row.base.fn === row.candidate.tp + row.candidate.fn, `${field} arms must share the same gold entities`);
    digest(row[arm].outputSha256, `${field}.${arm}.outputSha256`);
  }
};
const retentionRow = (row, field) => {
  text(row?.id, `${field}.id`);
  for (const arm of ['base', 'candidate']) {
    need(typeof row[arm]?.correct === 'boolean', `${field}.${arm}.correct must be boolean`);
    digest(row[arm].outputSha256, `${field}.${arm}.outputSha256`);
  }
};

/**
 * Verify one receipt against its spec bytes' hash, the exact catalog adapter and its base model.
 * Returns { verdict: 'passed' | 'failed', failures, metrics }. Throws AdapterEvaluationError when the
 * receipt is malformed, bound to different identities or data, or misreports its own results.
 */
export async function verifyAdapterEvaluationReceipt({ receipt, spec, specSha256, adapter, baseModel }) {
  validateAdapterEvaluationSpec(spec); digest(specSha256, 'specSha256');
  object(receipt, 'receipt');
  need(receipt.schema === ADAPTER_EVALUATION_RECEIPT_SCHEMA, `receipt.schema must be ${ADAPTER_EVALUATION_RECEIPT_SCHEMA}`);
  need(receipt.spec?.id === spec.id && receipt.spec?.sha256 === specSha256, 'receipt is bound to a different evaluation spec');
  need(adapter && baseModel && adapter.baseModelIdentity === baseModel.identity, 'catalog adapter does not declare this base model');
  need(receipt.adapter?.identity === adapter.identity && receipt.adapter?.id === adapter.id
    && receipt.adapter?.artifactSha256 === adapter.artifact?.hash && receipt.adapter?.baseModelIdentity === baseModel.identity,
  'receipt is bound to a different adapter');
  need(receipt.baseModel?.id === baseModel.id && receipt.baseModel?.identity === baseModel.identity, 'receipt is bound to a different base model');
  need(receipt.runtime?.engine === 'doppler' && typeof receipt.runtime.version === 'string'
    && receipt.runtime.observedAdapterIdentity === adapter.identity && receipt.runtime.observedBaseIdentity === baseModel.identity,
  'receipt does not record the executed adapter and base identities');
  text(receipt.trainer?.id, 'receipt.trainer.id'); text(receipt.evaluator?.id, 'receipt.evaluator.id');
  need(receipt.trainer.id !== receipt.evaluator.id, 'the evaluator must be independent of the trainer');
  const declared = spec.data.training.files.map(file => file.sha256).sort();
  need(Array.isArray(receipt.trainer.trainingFiles) && JSON.stringify([...receipt.trainer.trainingFiles].sort()) === JSON.stringify(declared),
    'the trainer must declare exactly the spec training files');
  const task = receipt.heldOut?.items, retention = receipt.retention?.items;
  need(Array.isArray(task) && task.length === spec.data.heldOut.items.count, 'receipt held-out item count differs from the spec');
  need(Array.isArray(retention) && retention.length === spec.retention.items.count, 'receipt retention item count differs from the spec');
  task.forEach((row, index) => taskRow(row, `receipt.heldOut.items[${index}]`));
  retention.forEach((row, index) => retentionRow(row, `receipt.retention.items[${index}]`));
  need(await itemListDigest(task.map(row => row.id)) === spec.data.heldOut.items.sha256, 'receipt held-out items differ from the frozen held-out split');
  need(await itemListDigest(retention.map(row => row.id)) === spec.retention.items.sha256, 'receipt retention items differ from the frozen retention set');
  const result = computeAdapterEvaluation(spec, task, retention);
  const reported = receipt.metrics;
  need(reported && ['task', 'validity', 'retention'].every(group => Object.entries(result.metrics[group])
    .every(([key, value]) => close(reported[group]?.[key], value))), 'receipt metrics differ from its item results');
  need(receipt.outcome === result.outcome, 'receipt outcome differs from its item results');
  return { verdict: result.outcome === 'pass' ? 'passed' : 'failed', failures: result.failures, metrics: result.metrics };
}
