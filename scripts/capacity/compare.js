#!/usr/bin/env node
/**
 * Does the pooled split beat one machine with CPU offload? Joins a Stage 1 receipt with the offload baselines from
 * scripts/capacity/offload-baseline.js, one per stage host, under a rule fixed here.
 *
 *   - Same size of work: every baseline must have timed the split's prompt token count and its output token count.
 *   - The pooled time is the receipt's `split generate` step: the whole answer, from the request to the last token,
 *     with the network and the acknowledgments in it and model loading out of it.
 *   - The offload time is each host's fastest baseline test (prompt and output together, loading not timed).
 *   - `pooled-faster` only when the pooled time is below EVERY stage host's offload time. Otherwise `offload-faster`.
 *   - A pooled-capacity claim is supported only when the Stage 1 verdict's label is `pooled capacity` (each host
 *     refused the model alone at the split's settings) AND the verdict here is `pooled-faster`.
 *
 *   node scripts/capacity/compare.js --stage1 /absolute/receipt.json --baseline /absolute/host-a.json \
 *     --baseline /absolute/host-b.json [--out FILE.json]
 *
 * The two sides are different runtimes and different model files, and the baseline's prompt is synthetic. The
 * comparison says which was faster on these machines for this size of request, and nothing about answer quality.
 */
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { BASELINE_SCHEMA } from './offload-baseline.js';

export const COMPARISON_SCHEMA = 'reploid.capacity-comparison/v1';
export const POOLED_LABEL = 'pooled capacity';
export const GENERATE_STEP = 'split generate';

/** The pooled side, from a Stage 1 receipt or the `{ receipt, verdict }` file the harness writes. */
export function pooledRun(input) {
  const receipt = input?.receipt ?? input, verdict = input?.receipt ? input.verdict ?? null : null;
  const step = (receipt?.steps ?? []).find(row => row.step === GENERATE_STEP && row.status === 'done') ?? null;
  return {
    runtimeClass: receipt?.runtimeClass ?? null, modelId: receipt?.workload?.modelId ?? null,
    promptTokens: receipt?.workload?.promptCount ?? null, outputTokens: receipt?.split?.tokens?.outputIds?.length ?? null,
    generateMs: step?.ms ?? null, parityExact: receipt?.split?.parityExact ?? null,
    hosts: (receipt?.hosts ?? []).map(host => host.label), stage1Label: verdict?.label ?? null, stage1Ok: verdict?.ok ?? null
  };
}

export function compareCapacity({ stage1, baselines }) {
  const pooled = pooledRun(stage1), reasons = [], offload = {};
  if (pooled.runtimeClass !== 'physical') reasons.push('the Stage 1 receipt is not from a physical run');
  if (!Number.isFinite(pooled.generateMs) || pooled.generateMs <= 0) reasons.push(`the Stage 1 receipt has no finished "${GENERATE_STEP}" step`);
  if (!Number.isSafeInteger(pooled.outputTokens) || pooled.outputTokens < 1) reasons.push('the Stage 1 receipt has no output tokens');
  if (pooled.hosts.length === 0) reasons.push('the Stage 1 receipt names no stage host');
  for (const label of pooled.hosts) {
    const found = baselines.filter(row => row?.schema === BASELINE_SCHEMA && row.label === label);
    if (found.length !== 1) { reasons.push(`${label}: ${found.length === 0 ? 'no offload baseline' : 'more than one offload baseline'}`); continue; }
    const [baseline] = found;
    if (!baseline.best) { reasons.push(`${label}: the offload baseline did not finish a test`); continue; }
    if (baseline.workload?.promptTokens !== pooled.promptTokens || baseline.workload?.outputTokens !== pooled.outputTokens) {
      reasons.push(`${label}: the offload baseline timed another size of request`); continue;
    }
    offload[label] = { endToEndMs: baseline.best.endToEndMs, gpuLayers: baseline.best.gpuLayers, outputTokensPerSecond: baseline.best.outputTokensPerSecond,
      modelSha256: baseline.model?.sha256 ?? null, runtime: baseline.runtime?.buildCommit ?? baseline.runtime?.name ?? null };
  }
  const evaluated = reasons.length === 0;
  const fastest = evaluated ? Object.entries(offload).reduce((best, [label, row]) => (best === null || row.endToEndMs < best.endToEndMs ? { label, ...row } : best), null) : null;
  const pooledFaster = evaluated && pooled.generateMs < fastest.endToEndMs;
  const verdict = !evaluated ? 'not evaluated' : pooledFaster ? 'pooled-faster' : 'offload-faster';
  const claimReasons = [];
  if (pooled.stage1Label !== POOLED_LABEL) claimReasons.push(`the Stage 1 verdict's label is not "${POOLED_LABEL}"`);
  if (verdict !== 'pooled-faster') claimReasons.push(evaluated ? `one machine with CPU offload was faster (${fastest.label})` : 'the speed comparison was not evaluated');
  return {
    schema: COMPARISON_SCHEMA, pooled,
    pooledOutputTokensPerSecond: evaluated ? Math.round((pooled.outputTokens / (pooled.generateMs / 1000)) * 10000) / 10000 : null,
    offload, fastestOffload: fastest,
    pooledOverOffload: evaluated ? Math.round((pooled.generateMs / fastest.endToEndMs) * 1000) / 1000 : null,
    verdict, reasons,
    capacityClaim: claimReasons.length === 0 ? 'supported' : 'not supported', capacityClaimReasons: claimReasons,
    limits: ['The two sides are different runtimes and different model files.', 'The offload prompt is synthetic, of the same token count; no answer text is compared.',
      'Model loading is timed on neither side.', 'The pooled time includes the network and the acknowledgments.']
  };
}

async function main() {
  const { values } = parseArgs({ options: { stage1: { type: 'string' }, baseline: { type: 'string', multiple: true }, out: { type: 'string' } } });
  if (!values.stage1 || !values.baseline?.length) throw Error('Give --stage1 and at least one --baseline');
  const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
  const result = compareCapacity({ stage1: await read(values.stage1), baselines: await Promise.all(values.baseline.map(read)) });
  const text = JSON.stringify(result, null, 2);
  if (values.out) await fs.writeFile(values.out, `${text}\n`);
  console.log(text);
  process.exitCode = result.capacityClaim === 'supported' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
