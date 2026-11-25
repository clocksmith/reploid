#!/usr/bin/env node
/**
 * Runs one middle stage of the north-star plan (edges-plan.js) alone on this host: no network, no other stage, no
 * ledger. It opens the stage from its stage directory exactly as a stage process does (Doppler's pinned-manifest
 * resident, verified piece storage), then executes a prefill step and a few decode steps on a replayed activation
 * (a seeded, deterministic tensor of the plan's activation shape) with withheld token context (zero token IDs), and
 * reports what happened at each step, including the error if the GPU device is lost.
 *
 *   node scripts/stage1/stage-probe.js --stage 2 --directory STAGE_DIRECTORY [--remap] [--prefill-chunk N]
 *     [--prompt-tokens 146] [--decode-steps 4] [--seed 1]
 *
 * One JSON line goes to standard output. Used to find which host setting a stage needs; it qualifies nothing.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadEdgesModel } from './edges-plan.js';
import { createWorkPartitionPlan } from '../../apps/poolday/host/work-partition-plan.js';
import { resolvePartitionGeneration } from '../../apps/poolday/config/partition-generation.js';
import policy from '../../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { openNativeModelSource } from '../../server/native-model-source.js';

/** A seeded standard-normal tensor (xorshift + Box-Muller), scaled: the same bytes for the same seed. */
export function replayedActivation(count, seed = 1, scale = 1) {
  let state = (seed >>> 0) || 1;
  const next = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return (state + 1) / 4294967297; };
  const data = new Float32Array(count);
  for (let index = 0; index < count; index += 2) {
    const radius = Math.sqrt(-2 * Math.log(next())), angle = 2 * Math.PI * next();
    data[index] = radius * Math.cos(angle) * scale;
    if (index + 1 < count) data[index + 1] = radius * Math.sin(angle) * scale;
  }
  return data;
}

export async function probeStage({ stageIndex, directory, remap = false, prefillChunk = null, promptTokens = 146, decodeSteps = 4, seed = 1,
  now = () => performance.now() }) {
  const { model } = await loadEdgesModel();
  const runtimeConfig = model.partitionRuntime.runtimeConfig;
  if (remap) runtimeConfig.inference.kernelPathPolicy.onIncompatible = 'remap';
  if (prefillChunk) runtimeConfig.inference.session.prefillTokenChunkSize = prefillChunk;
  const runtime = await import('dopplerx/partitions');
  const { createNativeGpuHost } = await import('../../server/native-gpu-host.js');
  const gpu = createNativeGpuHost(() => import('webgpu'));
  const report = { stageIndex, remap, prefillChunk: runtimeConfig.inference.session.prefillTokenChunkSize, promptTokens, decodeSteps, seed,
    opened: null, steps: [], error: null };
  const controller = new AbortController(), signal = controller.signal;
  let session = null, source = null;
  try {
    await gpu.open();
    await runtime.configureDeviceMemoryBudget({ maxBytes: model.partitionRuntime.maxGpuBufferBytes[stageIndex] });
    source = await openNativeModelSource({ model, modelDirectory: directory, signal, runtime });
    const plan = createWorkPartitionPlan(runtime, source.manifest, model, stageIndex);
    const planId = runtime.hashLayerPartitionPlan(plan);
    const generation = resolvePartitionGeneration(model);
    const factory = runtime.createManifestResidentPartitionFactory({ manifest: source.manifest, manifestIdentity: model.identity, runtimeConfig,
      createStorage: async () => source.storage });
    const participantId = `probe-stage-${stageIndex}`;
    const started = now();
    session = await factory.openResidentPartition({ model: { id: model.id, identity: model.identity, generation, adapters: [] }, plan, planId,
      index: stageIndex, participantId, limits: policy.limits, signal });
    report.opened = { ms: Math.round(now() - started), descriptor: { ready: session.getDescriptor?.()?.ready ?? null } };
    const identity = { schema: 'doppler.resident-partition-attempt/v2', modelId: model.id, modelIdentity: model.identity, planId,
      threadId: 'probe', attemptId: 'probe-attempt', requesterId: 'probe-requester', placementGeneration: 0,
      stages: plan.partitions.map((_, index) => ({ index, participantId: index === stageIndex ? participantId : `probe-other-${index}`,
        transportId: `t${index}`, residentId: `r${index}`, executionId: `e${index}` })) };
    const maxTokens = Math.min(generation.maxTokens, 128), stepGeneration = { ...generation, maxTokens };
    const generationDigest = runtime.hashPartitionGeneration(stepGeneration);
    const hidden = runtime.getPartitionActivationContract(plan).hiddenSize;
    let continuation = null, position = 0;
    for (let step = 0; step <= decodeSteps; step++) {
      const count = step === 0 ? promptTokens : 1;
      const at = now();
      try {
        const result = await session.executeStage({ identity, partitionIndex: stageIndex, step, tokenPosition: position, inputTokenCount: count,
          maxTokens, generation: stepGeneration, generationDigest, continuation, inputTokenIds: new Array(count).fill(0),
          activation: { shape: [1, count, hidden], dtype: plan.activationDtype, tensorData: replayedActivation(count * hidden, seed + step), step, seqOffset: position },
          signal });
        continuation = result.continuation; position += count;
        const out = result.activationTensor?.data;
        const values = out ? new Float32Array(out.buffer ?? out, out.byteOffset ?? 0, (out.byteLength ?? out.length * 4) / 4) : null;
        report.steps.push({ step, inputTokens: count, ms: Math.round(now() - at), outputBytes: values ? values.byteLength : 0,
          finite: values ? values.every(Number.isFinite) : null });
      } catch (error) {
        report.steps.push({ step, inputTokens: count, ms: Math.round(now() - at), error: String(error?.message ?? error),
          causes: [...(error?.errors ?? [])].map(item => String(item?.message ?? item)) });
        break;
      }
    }
  } catch (error) {
    report.error = String(error?.message ?? error);
  } finally {
    await session?.closeAttempt?.({ identity: undefined }).catch(() => {});
    await session?.close?.().catch(() => {});
    await source?.storage?.close?.().catch(() => {});
    await gpu.close().catch(() => {});
  }
  report.deviceLost = report.steps.some(row => /device (is |was )?lost/i.test(`${row.error} ${row.causes?.join(' ')}`)) || /device (is |was )?lost/i.test(String(report.error));
  report.completed = !report.error && report.steps.length === decodeSteps + 1 && report.steps.every(row => !row.error);
  return report;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  const { values } = parseArgs({ options: { stage: { type: 'string' }, directory: { type: 'string' }, remap: { type: 'boolean' },
    'prefill-chunk': { type: 'string' }, 'prompt-tokens': { type: 'string' }, 'decode-steps': { type: 'string' }, seed: { type: 'string' } } });
  const report = await probeStage({ stageIndex: Number(values.stage), directory: values.directory, remap: values.remap === true,
    prefillChunk: values['prefill-chunk'] ? Number(values['prefill-chunk']) : null, promptTokens: Number(values['prompt-tokens'] ?? 146),
    decodeSteps: Number(values['decode-steps'] ?? 4), seed: Number(values.seed ?? 1) });
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(report.completed ? 0 : 1);
}
