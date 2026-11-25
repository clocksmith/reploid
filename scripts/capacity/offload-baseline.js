#!/usr/bin/env node
/**
 * The one-machine baseline a pooled-capacity claim has to beat: the same model on ONE host, with as many layers on
 * its GPU as fit and the rest on its CPU. The pooled split is only worth having when it is faster than that.
 *
 * This runs an outside runtime, llama.cpp's `llama-bench`, on the machine it is started on. It does not use Doppler
 * or Reploid, so its settings are its own and are all recorded. One test per GPU-layer count: a prompt of the split
 * workload's token count followed by the split's number of output tokens (`-pg prompt,output`), repeated, timed by
 * llama-bench itself.
 *
 *   node scripts/capacity/offload-baseline.js --bench /absolute/llama-bench --model /absolute/model.gguf \
 *     --label host-a --prompt-tokens 146 --output-tokens 88 --gpu-layers 24,32,40 \
 *     [--threads 8] [--repetitions 3] [--timeout-minutes 30] [--out FILE.json]
 *
 * `scripts/capacity/compare.js` joins this receipt with a Stage 1 receipt.
 *
 * What it does not show. llama-bench times a synthetic prompt and does not produce the answer text, so this is speed
 * only. The model file is a GGUF, not the Doppler file the split ran, so quantization and file differ and both
 * digests are recorded. Model loading is not timed. It needs the GPU to itself: stop whatever else uses it first
 * and restore it afterwards; this script stops and restores nothing.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

export const BASELINE_SCHEMA = 'reploid.capacity-offload-baseline/v1';
const count = value => Number.isSafeInteger(value) && value >= 0;

/** llama-bench runs only the `-pg` test when the separate prompt and generation tests are set to 0. */
export function benchArguments({ model, promptTokens, outputTokens, gpuLayers, threads = null, repetitions = 3 }) {
  if (!count(promptTokens) || !Number.isSafeInteger(outputTokens) || outputTokens < 1) throw new TypeError('prompt and output token counts are required');
  if (!Array.isArray(gpuLayers) || gpuLayers.length === 0 || !gpuLayers.every(count)) throw new TypeError('at least one GPU-layer count is required');
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw new TypeError('repetitions must be a positive integer');
  return ['-m', model, '-p', '0', '-n', '0', '-pg', `${promptTokens},${outputTokens}`, '-ngl', gpuLayers.join(','),
    ...(threads === null ? [] : ['-t', String(threads)]), '-r', String(repetitions), '-o', 'json'];
}

/**
 * Reads llama-bench's JSON (one array, one object per test). Keeps the tests of this workload; a test of another
 * size is a different measurement and is refused rather than dropped silently.
 */
export function parseBenchRows(stdout, { promptTokens, outputTokens }) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw Object.assign(Error('llama-bench did not print JSON'), { code: 'bench-output-unreadable' }); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw Object.assign(Error('llama-bench printed no test'), { code: 'bench-output-empty' });
  const rows = parsed.map(row => {
    if (row?.n_prompt !== promptTokens || row?.n_gen !== outputTokens) throw Object.assign(Error('llama-bench ran a test of another size'), { code: 'bench-workload-mismatch' });
    if (!count(row.n_gpu_layers) && row.n_gpu_layers !== -1) throw Object.assign(Error('a test has no GPU-layer count'), { code: 'bench-output-unreadable' });
    if (!Number.isSafeInteger(row.avg_ns) || row.avg_ns <= 0) throw Object.assign(Error('a test has no duration'), { code: 'bench-output-unreadable' });
    const endToEndMs = row.avg_ns / 1e6;
    return { gpuLayers: row.n_gpu_layers, avgNs: row.avg_ns, stddevNs: row.stddev_ns ?? null, samplesNs: Array.isArray(row.samples_ns) ? row.samples_ns : null,
      endToEndMs: Math.round(endToEndMs * 1000) / 1000, outputTokensPerSecond: Math.round((outputTokens / (endToEndMs / 1000)) * 10000) / 10000 };
  });
  const first = parsed[0];
  const runtime = { name: 'llama.cpp llama-bench', buildCommit: first.build_commit ?? null, buildNumber: first.build_number ?? null, backends: first.backends ?? null,
    gpuInfo: first.gpu_info ?? null, cpuInfo: first.cpu_info ?? null, threads: first.n_threads ?? null, batch: first.n_batch ?? null,
    flashAttention: first.flash_attn ?? null, kvTypes: [first.type_k ?? null, first.type_v ?? null] };
  const model = { type: first.model_type ?? null, sizeBytes: first.model_size ?? null, parameters: first.model_n_params ?? null };
  return { rows, runtime, model };
}

/** The fastest test: the one-machine number the pooled split has to beat. */
export const bestRow = rows => rows.reduce((best, row) => (best === null || row.endToEndMs < best.endToEndMs ? row : best), null);

export async function hashFile(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}

const run = promisify(execFile);

/** Runs the baseline and returns its receipt. A run that fails still returns a receipt, with `failed` and no rows. */
export async function runBaseline({ bench, model, label, promptTokens, outputTokens, gpuLayers, threads = null, repetitions = 3, timeoutMs = 30 * 60000,
  exec = run, digest = hashFile, now = () => new Date() }) {
  const args = benchArguments({ model, promptTokens, outputTokens, gpuLayers, threads, repetitions });
  const startedAt = now().toISOString();
  const file = await digest(model);
  const receipt = { schema: BASELINE_SCHEMA, label, startedAt, finishedAt: null, runtime: { name: 'llama.cpp llama-bench' },
    model: { file: path.basename(model), bytes: file.bytes, sha256: file.sha256 }, workload: { promptTokens, outputTokens },
    settings: { gpuLayersTried: gpuLayers, threads, repetitions, arguments: args.map(value => (value === model ? '<model>' : value)) },
    rows: [], best: null,
    note: 'One machine, an outside runtime and a GGUF file: not the Doppler file or runtime the split used. A synthetic prompt of the same token count; speed only, no answer text. Model loading is not timed.' };
  try {
    const { stdout } = await exec(bench, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    const parsed = parseBenchRows(stdout, { promptTokens, outputTokens });
    Object.assign(receipt.runtime, parsed.runtime);
    Object.assign(receipt.model, parsed.model);
    receipt.rows = parsed.rows;
    receipt.best = bestRow(parsed.rows);
  } catch (error) {
    receipt.failed = { code: String(error.code ?? 'bench-failed'), message: String(error.message ?? error).split('\n')[0].slice(0, 300),
      stderrTail: typeof error.stderr === 'string' ? error.stderr.slice(-600) : null };
  }
  receipt.finishedAt = now().toISOString();
  return receipt;
}

async function main() {
  const { values } = parseArgs({ options: { bench: { type: 'string' }, model: { type: 'string' }, label: { type: 'string' },
    'prompt-tokens': { type: 'string' }, 'output-tokens': { type: 'string' }, 'gpu-layers': { type: 'string' }, threads: { type: 'string' },
    repetitions: { type: 'string', default: '3' }, 'timeout-minutes': { type: 'string', default: '30' }, out: { type: 'string' } } });
  for (const name of ['bench', 'model', 'label', 'prompt-tokens', 'output-tokens', 'gpu-layers']) if (!values[name]) throw Error(`--${name} is required`);
  for (const name of ['bench', 'model']) if (!path.isAbsolute(values[name])) throw Error(`--${name} must be an absolute path`);
  const whole = (name, text = values[name]) => { const value = Number(text); if (!Number.isSafeInteger(value) || value < 0) throw Error(`--${name} must be a whole number`); return value; };
  const receipt = await runBaseline({ bench: values.bench, model: values.model, label: values.label, promptTokens: whole('prompt-tokens'),
    outputTokens: whole('output-tokens'), gpuLayers: values['gpu-layers'].split(',').map(text => whole('gpu-layers', text)),
    threads: values.threads ? whole('threads') : null, repetitions: whole('repetitions'), timeoutMs: whole('timeout-minutes') * 60000 });
  const text = JSON.stringify(receipt, null, 2);
  if (values.out) await fs.writeFile(values.out, `${text}\n`);
  console.log(JSON.stringify({ label: receipt.label, best: receipt.best, failed: receipt.failed ?? null, rows: receipt.rows.length }, null, 2));
  process.exitCode = receipt.best ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
