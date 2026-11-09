import { createDopplerRuntime } from '../pool/doppler-runtime.js';
import { listPoolModels, validateModelRuntimeCapabilities } from '../../../shared/pool/model-contract.js';
const errorString = error => String(error?.message || error?.error || error || 'Unknown error');
export const POOL_DEVICE_CAPABILITY_TIERS = Object.freeze({
  basic: Object.freeze({ id: 'basic', label: 'Basic', minScore: 1, maxConcurrentJobs: 1, maxTokensPerJob: 64 }),
  standard: Object.freeze({ id: 'standard', label: 'Standard', minScore: 40, maxConcurrentJobs: 1, maxTokensPerJob: 128 }),
  advanced: Object.freeze({ id: 'advanced', label: 'Advanced', minScore: 65, maxConcurrentJobs: 2, maxTokensPerJob: 256 }),
  high: Object.freeze({ id: 'high', label: 'High capacity', minScore: 85, maxConcurrentJobs: 3, maxTokensPerJob: 512 })
});

const bytesToMiB = (value) => Number(value || 0) / (1024 * 1024);
const median = (values = []) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const capabilityTierForScore = (score, measured) => {
  if (!measured || score < POOL_DEVICE_CAPABILITY_TIERS.standard.minScore) {
    return POOL_DEVICE_CAPABILITY_TIERS.basic;
  }
  if (score >= POOL_DEVICE_CAPABILITY_TIERS.high.minScore) return POOL_DEVICE_CAPABILITY_TIERS.high;
  if (score >= POOL_DEVICE_CAPABILITY_TIERS.advanced.minScore) return POOL_DEVICE_CAPABILITY_TIERS.advanced;
  return POOL_DEVICE_CAPABILITY_TIERS.standard;
};

export const scorePoolDeviceCapability = ({ deviceInfo = {}, benchmark = {} } = {}) => {
  if (deviceInfo.hasWebGPU !== true) {
    return Object.freeze({
      supported: false,
      score: 0,
      tier: Object.freeze({ id: 'unsupported', label: 'Request only', maxConcurrentJobs: 0, maxTokensPerJob: 0 }),
      measured: false,
      summary: 'WebGPU is unavailable. This browser can request work but cannot advertise local model execution.'
    });
  }
  const limits = deviceInfo.limits || {};
  const maxBufferMiB = bytesToMiB(deviceInfo.maxBufferSize || limits.maxBufferSize);
  const storageMiB = bytesToMiB(limits.maxStorageBufferBindingSize);
  const workgroupSize = Number(limits.maxComputeInvocationsPerWorkgroup || limits.maxComputeWorkgroupSizeX || 0);
  const gigaOpsPerSecond = Number(benchmark.gigaOpsPerSecond || 0);
  const stability = Number(benchmark.stability || 0);
  const measured = benchmark.status === 'measured' && gigaOpsPerSecond > 0;
  let score = 20;
  score += maxBufferMiB >= 512 ? 20 : maxBufferMiB >= 256 ? 16 : maxBufferMiB >= 128 ? 12 : maxBufferMiB >= 64 ? 8 : 3;
  score += storageMiB >= 256 ? 15 : storageMiB >= 128 ? 12 : storageMiB >= 64 ? 8 : storageMiB >= 32 ? 5 : 2;
  score += workgroupSize >= 256 ? 5 : workgroupSize >= 128 ? 3 : 1;
  score += deviceInfo.hasF16 || deviceInfo.features?.includes?.('shader-f16') ? 10 : 0;
  score += deviceInfo.hasSubgroups || deviceInfo.features?.includes?.('subgroups') ? 5 : 0;
  score += gigaOpsPerSecond >= 100 ? 20 : gigaOpsPerSecond >= 40 ? 16 : gigaOpsPerSecond >= 12 ? 11 : gigaOpsPerSecond > 0 ? 6 : 0;
  score += stability >= 0.85 ? 5 : stability >= 0.65 ? 3 : stability > 0 ? 1 : 0;
  score = Math.min(100, Math.round(measured ? score : Math.min(score, 39)));
  const tier = capabilityTierForScore(score, measured);
  return Object.freeze({
    supported: true,
    measured,
    score,
    tier,
    maxBufferMiB,
    storageMiB,
    workgroupSize,
    gigaOpsPerSecond,
    stability,
    summary: measured
      ? `${tier.label} browser compute based on observed WebGPU limits and a bounded local kernel.`
      : 'WebGPU is present, but the bounded kernel did not produce a stable measurement. Contribution stays conservative.'
  });
};

export const resolveCapabilityAvailabilityLimits = (participation = {}, capabilityProfile = {}) => ({
  maxConcurrentJobs: Math.min(
    Math.max(1, Number(participation.limits?.maxConcurrentJobs || 1)),
    Math.max(0, Number(capabilityProfile.tier?.maxConcurrentJobs || 0))
  ),
  maxTokensPerJob: Math.min(
    Math.max(16, Number(participation.limits?.maxTokensPerJob || 16)),
    Math.max(0, Number(capabilityProfile.tier?.maxTokensPerJob || 0))
  )
});

const runBoundedWebGpuProbe = async () => {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu?.requestAdapter) return { status: 'unavailable', samplesMs: [] };
  const usage = globalThis.GPUBufferUsage;
  if (!usage) return { status: 'unavailable', samplesMs: [] };
  let device = null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { status: 'adapter_unavailable', samplesMs: [] };
    device = await adapter.requestDevice();
    const elementCount = 65_536;
    const iterations = 64;
    const buffer = device.createBuffer({
      size: elementCount * 4,
      usage: usage.STORAGE
    });
    const shader = device.createShaderModule({ code: `
      @group(0) @binding(0) var<storage, read_write> values: array<f32>;
      @compute @workgroup_size(256)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        if (id.x >= ${elementCount}u) { return; }
        var value = f32(id.x % 251u) * 0.001;
        for (var index = 0u; index < ${iterations}u; index = index + 1u) {
          value = value * 1.000001 + f32(index & 7u) * 0.000001;
        }
        values[id.x] = value;
      }
    ` });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: shader, entryPoint: 'main' }
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }]
    });
    const submit = async () => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(elementCount / 256));
      pass.end();
      const started = performance.now();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      return performance.now() - started;
    };
    await submit();
    const samplesMs = [];
    for (let index = 0; index < 5; index += 1) samplesMs.push(await submit());
    const medianMs = median(samplesMs);
    const operations = elementCount * iterations * 2;
    const gigaOpsPerSecond = medianMs > 0 ? operations / (medianMs / 1000) / 1e9 : 0;
    const stability = samplesMs.length > 1
      ? Math.min(...samplesMs) / Math.max(...samplesMs)
      : 1;
    buffer.destroy?.();
    return { status: 'measured', samplesMs, medianMs, gigaOpsPerSecond, stability };
  } catch (error) {
    return { status: 'failed', samplesMs: [], error: errorString(error) };
  } finally {
    device?.destroy?.();
  }
};

let capabilityAssessmentPromise = null;

export const resetPoolDeviceCapabilityForTests = () => {
  capabilityAssessmentPromise = null;
  delete window.REPLOID_POOL_DEVICE_CAPABILITY;
};

export const assessPoolDeviceCapability = async ({ runtime = null, force = false } = {}) => {
  if (capabilityAssessmentPromise && !force) return capabilityAssessmentPromise;
  capabilityAssessmentPromise = (async () => {
    const activeRuntime = runtime || window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
    const deviceInfo = typeof activeRuntime?.getDeviceInfo === 'function'
      ? await activeRuntime.getDeviceInfo()
      : { hasWebGPU: !!navigator.gpu, features: [], limits: {} };
    const benchmark = deviceInfo.capabilityBenchmark && typeof deviceInfo.capabilityBenchmark === 'object'
      ? deviceInfo.capabilityBenchmark
      : deviceInfo.hasWebGPU
        ? await runBoundedWebGpuProbe()
        : { status: 'unavailable', samplesMs: [] };
    const scored = scorePoolDeviceCapability({ deviceInfo, benchmark });
    const modelEligibility = listPoolModels({ enabledOnly: true }).map((model) => {
      const qualification = validateModelRuntimeCapabilities(model, deviceInfo);
      const minimumScore = Number(model.browserCapability?.minimumScore ?? 40);
      const scoreQualified = scored.score >= minimumScore;
      return {
        modelId: model.modelId,
        label: model.label || model.modelId,
        eligible: scored.supported && qualification.ok && scoreQualified,
        minimumScore,
        minimumTier: model.browserCapability?.minimumTier || 'standard',
        reasons: [
          ...qualification.reasons,
          ...(!scoreQualified ? [`device capability score ${scored.score} is below required score ${minimumScore}`] : [])
        ]
      };
    });
    const profile = Object.freeze({
      schema: 'reploid.pool.device-capability/v1',
      measuredAt: new Date().toISOString(),
      deviceInfo,
      benchmark,
      ...scored,
      modelEligibility
    });
    window.REPLOID_POOL_DEVICE_CAPABILITY = profile;
    window.dispatchEvent(new CustomEvent('reploid:pool-device-capability', { detail: profile }));
    return profile;
  })();
  return capabilityAssessmentPromise;
};
