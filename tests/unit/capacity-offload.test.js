// @vitest-environment node
// The capacity control: the one-machine offload baseline's receipt and the fixed rule that compares it with a
// pooled split. Proves the arithmetic and refusals with an injected benchmark; no model or machine is measured here.
import { describe, expect, it, vi } from 'vitest';

import { BASELINE_SCHEMA, benchArguments, bestRow, parseBenchRows, runBaseline } from '../../scripts/capacity/offload-baseline.js';
import { compareCapacity, pooledRun } from '../../scripts/capacity/compare.js';

// One object per test, as llama-bench's JSON printer writes them: numbers unquoted, samples as arrays.
const benchRow = (gpuLayers, avgNs, extra = {}) => ({ build_commit: 'abc1234', build_number: 7001, cpu_info: 'test cpu', gpu_info: 'test gpu', backends: 'Vulkan',
  model_filename: 'model.gguf', model_type: 'test 27B Q4_K - Medium', model_size: 17000000000, model_n_params: 27000000000, n_batch: 2048, n_threads: 8,
  type_k: 'f16', type_v: 'f16', n_gpu_layers: gpuLayers, flash_attn: 1, n_prompt: 146, n_gen: 88, n_depth: 0, test_time: '2026-11-25T09:00:00Z',
  avg_ns: avgNs, stddev_ns: 1000, avg_ts: 1e9 * 234 / avgNs, stddev_ts: 0.1, samples_ns: [avgNs - 1000, avgNs + 1000], samples_ts: [1, 1], ...extra });
const workload = { promptTokens: 146, outputTokens: 88 };

describe('the one-machine offload baseline', () => {
  it('asks llama-bench for one prompt-and-output test per GPU-layer count and nothing else', () => {
    expect(benchArguments({ model: '/m/model.gguf', ...workload, gpuLayers: [24, 32], threads: 8, repetitions: 3 }))
      .toEqual(['-m', '/m/model.gguf', '-p', '0', '-n', '0', '-pg', '146,88', '-ngl', '24,32', '-t', '8', '-r', '3', '-o', 'json']);
    expect(benchArguments({ model: '/m/model.gguf', ...workload, gpuLayers: [0] })).not.toContain('-t');
    expect(() => benchArguments({ model: '/m/model.gguf', ...workload, gpuLayers: [] })).toThrow('GPU-layer');
    expect(() => benchArguments({ model: '/m/model.gguf', promptTokens: 146, outputTokens: 0, gpuLayers: [1] })).toThrow('token counts');
  });

  it('turns each test into an end-to-end time and an output rate, and picks the fastest', () => {
    const { rows, runtime, model } = parseBenchRows(JSON.stringify([benchRow(24, 44_000_000_000), benchRow(32, 22_000_000_000)]), workload);
    expect(rows).toEqual([
      { gpuLayers: 24, avgNs: 44_000_000_000, stddevNs: 1000, samplesNs: [43_999_999_000, 44_000_001_000], endToEndMs: 44000, outputTokensPerSecond: 2 },
      { gpuLayers: 32, avgNs: 22_000_000_000, stddevNs: 1000, samplesNs: [21_999_999_000, 22_000_001_000], endToEndMs: 22000, outputTokensPerSecond: 4 }]);
    expect(bestRow(rows).gpuLayers).toBe(32);
    expect(runtime).toMatchObject({ buildCommit: 'abc1234', backends: 'Vulkan', threads: 8 });
    expect(model).toMatchObject({ sizeBytes: 17000000000 });
  });

  it.each([
    ['text that is not JSON', 'model load failed', 'bench-output-unreadable'],
    ['an empty array', '[]', 'bench-output-empty'],
    ['a test of another size', JSON.stringify([benchRow(24, 1e9, { n_gen: 128 })]), 'bench-workload-mismatch'],
    ['a test with no duration', JSON.stringify([benchRow(24, 0)]), 'bench-output-unreadable']
  ])('refuses %s', (_name, stdout, code) => {
    expect(() => parseBenchRows(stdout, workload)).toThrow(expect.objectContaining({ code }));
  });

  const times = () => { let tick = 0; return () => new Date(Date.UTC(2026, 10, 25, 9, 0, tick++)); };
  const digest = async () => ({ bytes: 17, sha256: 'f'.repeat(64) });

  it('writes a receipt with the model digest and settings, and without the model path', async () => {
    const exec = vi.fn(async () => ({ stdout: JSON.stringify([benchRow(24, 44e9), benchRow(32, 22e9)]) }));
    const receipt = await runBaseline({ bench: '/opt/llama-bench', model: '/private/place/model.gguf', label: 'host-a', ...workload, gpuLayers: [24, 32], exec, digest, now: times() });
    expect(exec).toHaveBeenCalledWith('/opt/llama-bench', expect.arrayContaining(['-pg', '146,88', '-ngl', '24,32']), expect.objectContaining({ timeout: 1800000 }));
    expect(receipt).toMatchObject({ schema: BASELINE_SCHEMA, label: 'host-a', workload, model: { file: 'model.gguf', bytes: 17, sha256: 'f'.repeat(64) },
      best: { gpuLayers: 32, endToEndMs: 22000 }, startedAt: '2026-11-25T09:00:00.000Z', finishedAt: '2026-11-25T09:00:01.000Z' });
    expect(JSON.stringify(receipt)).not.toContain('/private/place');
    expect(receipt.failed).toBeUndefined();
  });

  it('records a failed run as a receipt with no test, instead of throwing', async () => {
    const exec = async () => { throw Object.assign(Error('Command failed: llama-bench\nmore'), { code: 1, stderr: 'error: failed to load model' }); };
    const receipt = await runBaseline({ bench: '/opt/llama-bench', model: '/m/model.gguf', label: 'host-b', ...workload, gpuLayers: [99], exec, digest, now: times() });
    expect(receipt).toMatchObject({ rows: [], best: null, failed: { code: '1', message: 'Command failed: llama-bench', stderrTail: 'error: failed to load model' } });
  });
});

describe('pooled split against one machine with CPU offload', () => {
  const stage1 = ({ generateMs = 30000, label = 'pooled capacity', runtimeClass = 'physical', status = 'done' } = {}) => ({
    receipt: { runtimeClass, workload: { modelId: 'model', promptCount: 146 }, hosts: [{ label: 'host-a' }, { label: 'host-b' }],
      split: { parityExact: true, tokens: { outputIds: Array.from({ length: 88 }, (_, index) => index) } },
      steps: [{ step: 'split open host-a', ms: 3000, status: 'done' }, { step: 'split generate', ms: generateMs, status }] },
    verdict: { ok: label !== null, label } });
  const baseline = (label, endToEndMs, extra = {}) => ({ schema: BASELINE_SCHEMA, label, workload, model: { sha256: 'f'.repeat(64) }, runtime: { buildCommit: 'abc1234' },
    best: { gpuLayers: 32, endToEndMs, outputTokensPerSecond: 88 / (endToEndMs / 1000) }, ...extra });

  it('reads the pooled side from the receipt file the harness writes, or from a bare receipt', () => {
    expect(pooledRun(stage1())).toMatchObject({ runtimeClass: 'physical', promptTokens: 146, outputTokens: 88, generateMs: 30000, hosts: ['host-a', 'host-b'],
      stage1Label: 'pooled capacity' });
    expect(pooledRun(stage1().receipt)).toMatchObject({ generateMs: 30000, stage1Label: null });
  });

  it('supports the capacity claim only when the split beats every host and both hosts refused the model alone', () => {
    const result = compareCapacity({ stage1: stage1({ generateMs: 30000 }), baselines: [baseline('host-a', 40000), baseline('host-b', 31000)] });
    expect(result).toMatchObject({ verdict: 'pooled-faster', capacityClaim: 'supported', capacityClaimReasons: [], pooledOverOffload: 0.968,
      fastestOffload: { label: 'host-b', endToEndMs: 31000 } });
    expect(result.pooledOutputTokensPerSecond).toBeCloseTo(88 / 30, 3);
  });

  it('says offload is faster when one host beats the split, even if the other does not', () => {
    const result = compareCapacity({ stage1: stage1({ generateMs: 372446 }), baselines: [baseline('host-a', 900000), baseline('host-b', 25000)] });
    expect(result).toMatchObject({ verdict: 'offload-faster', capacityClaim: 'not supported', fastestOffload: { label: 'host-b' } });
    expect(result.capacityClaimReasons).toEqual(['one machine with CPU offload was faster (host-b)']);
    expect(compareCapacity({ stage1: stage1({ generateMs: 25000 }), baselines: [baseline('host-a', 900000), baseline('host-b', 25000)] }).verdict).toBe('offload-faster');
  });

  it('does not support the claim when a host fitted the model alone, however fast the split was', () => {
    const result = compareCapacity({ stage1: stage1({ generateMs: 1000, label: null }), baselines: [baseline('host-a', 40000), baseline('host-b', 31000)] });
    expect(result).toMatchObject({ verdict: 'pooled-faster', capacityClaim: 'not supported' });
    expect(result.capacityClaimReasons).toEqual(['the Stage 1 verdict\'s label is not "pooled capacity"']);
  });

  it.each([
    ['a host has no baseline', {}, [baseline('host-a', 40000)], 'host-b: no offload baseline'],
    ['a host has two baselines', {}, [baseline('host-a', 40000), baseline('host-b', 1), baseline('host-b', 2)], 'host-b: more than one offload baseline'],
    ['a baseline timed another size of request', {}, [baseline('host-a', 40000), baseline('host-b', 31000, { workload: { promptTokens: 146, outputTokens: 64 } })], 'host-b: the offload baseline timed another size of request'],
    ['a baseline finished no test', {}, [baseline('host-a', 40000), baseline('host-b', 31000, { best: null })], 'host-b: the offload baseline did not finish a test'],
    ['the run was not physical', { runtimeClass: 'local' }, [baseline('host-a', 40000), baseline('host-b', 31000)], 'the Stage 1 receipt is not from a physical run'],
    ['the answer did not finish', { status: 'failed' }, [baseline('host-a', 40000), baseline('host-b', 31000)], 'the Stage 1 receipt has no finished "split generate" step']
  ])('gives no speed verdict when %s', (_name, options, baselines, reason) => {
    const result = compareCapacity({ stage1: stage1(options), baselines });
    expect(result).toMatchObject({ verdict: 'not evaluated', capacityClaim: 'not supported', pooledOverOffload: null });
    expect(result.reasons).toContain(reason);
  });
});
