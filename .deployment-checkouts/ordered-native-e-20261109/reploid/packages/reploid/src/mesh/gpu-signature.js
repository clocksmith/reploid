import policy from './gpu-signature.policy.json' with { type: 'json' };
import { gpuSignatureShader } from './gpu-signature-shader.js';
import { publicProviderHardware } from './provider-hardware.js';

const active = new WeakSet();
const permutation = row => Array.isArray(row) && row.length === policy.workgroups
  && row.every(value => Number.isInteger(value) && value >= 0 && value < policy.workgroups)
  && new Set(row).size === policy.workgroups;

function summarize(signature) {
  if (!signature || signature.schema !== policy.schema || signature.profile !== policy.profile
    || signature.status !== 'measured' || signature.workgroups !== policy.workgroups
    || signature.trials !== policy.trials || !Array.isArray(signature.samples)
    || signature.samples.length !== policy.seeds.length) throw new TypeError('Invalid GPU signature');
  const means = [], deviations = [];
  for (const [index, sample] of signature.samples.entries()) {
    if (sample.seed !== policy.seeds[index] || sample.workload !== index
      || !Array.isArray(sample.orders) || sample.orders.length !== policy.trials
      || !sample.orders.every(permutation)) throw new TypeError('Invalid GPU signature samples');
    for (let group = 0; group < policy.workgroups; group++) {
      const values = sample.orders.map(row => row[group] / (policy.workgroups - 1));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      means.push(mean);
      deviations.push(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length));
    }
  }
  return { means, deviations };
}

/** Measures the LOCAL GPU only. No identifier, storage write, or network upload.
 * The caller must opt in. Cancellation stops new dispatches; submitted work is bounded,
 * not forcibly preempted. A borrowed device is never destroyed.
 */
export async function captureGpuSignature(device = null, { consent = false, signal,
  gpu = globalThis.navigator?.gpu } = {}) {
  if (consent !== true) throw new Error('GPU signature collection requires explicit consent');
  signal?.throwIfAborted();
  if (!device && !gpu?.requestAdapter) return { status: 'unavailable', reason: 'webgpu-unavailable' };
  if (device && active.has(device)) throw new Error('GPU signature measurement is already running on this device');
  const started = performance.now(), buffers = [];
  const owned = !device;
  let timer, cancel, finished = false, hardware = null;
  const interrupted = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('GPU signature measurement timed out')), policy.timeoutMs);
    cancel = () => reject(signal.reason || new Error('GPU signature measurement cancelled'));
    signal?.addEventListener('abort', cancel, { once: true });
  });
  // Attach a rejection handler even if setup fails before the first await.
  interrupted.catch(() => {});
  let lost;
  const wait = promise => Promise.race([promise, interrupted, ...(lost ? [lost] : [])]);
  try {
    if (!device) {
      const adapter = await wait(gpu.requestAdapter());
      if (!adapter) return { status: 'unavailable', reason: 'adapter-unavailable' };
      if (adapter.info?.isFallbackAdapter) return { status: 'unavailable', reason: 'software-adapter' };
      hardware = publicProviderHardware(adapter.info);
      device = await wait(adapter.requestDevice().then(created => {
        if (finished) { created.destroy(); throw new Error('GPU signature acquisition expired'); }
        return created;
      }));
    } else hardware = publicProviderHardware(device.adapterInfo);
    active.add(device);
    lost = device.lost.then(info => { throw new Error('GPU device lost: ' + info.reason); });
    lost.catch(() => {});
    const makeBuffer = (size, usage) => {
      const buffer = device.createBuffer({ size, usage }); buffers.push(buffer); return buffer;
    };
    const outputBytes = (1 + 2 * policy.workgroups) * 4;
    const params = makeBuffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const input = makeBuffer(policy.dataWords * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const result = makeBuffer(outputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
    const readback = makeBuffer(outputBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const data = Uint32Array.from({ length: policy.dataWords }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0);
    device.queue.writeBuffer(input, 0, data);
    const module = device.createShaderModule({ code: gpuSignatureShader });
    const pipeline = await wait(device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }));
    const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [params, input, result].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const samples = [];
    for (let workload = 0; workload < policy.seeds.length; workload++) {
      const seed = policy.seeds[workload], orders = [], checksums = [];
      // Discard one dispatch per workload for compilation/initial scheduling effects.
      for (let trial = -1; trial < policy.trials; trial++) {
        signal?.throwIfAborted();
        device.queue.writeBuffer(params, 0, new Uint32Array([seed, workload, 0, 0]));
        device.queue.writeBuffer(result, 0, new Uint32Array(outputBytes / 4));
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, bindings); pass.dispatchWorkgroups(policy.workgroups); pass.end();
        encoder.copyBufferToBuffer(result, 0, readback, 0, outputBytes);
        device.queue.submit([encoder.finish()]);
        await wait(readback.mapAsync(GPUMapMode.READ));
        const words = new Uint32Array(readback.getMappedRange()).slice();
        readback.unmap();
        const order = Array.from(words.slice(1, 1 + policy.workgroups));
        if (words[0] !== policy.workgroups || !permutation(order)) throw new Error('GPU signature dispatch returned incomplete results');
        if (trial >= 0) { orders.push(order); checksums.push(Array.from(words.slice(1 + policy.workgroups))); }
      }
      samples.push({ workload, seed, orders, checksums });
    }
    signal?.throwIfAborted();
    const signature = { schema: policy.schema, profile: policy.profile, status: 'measured',
      source: 'local-webgpu', hardware, workgroups: policy.workgroups, trials: policy.trials,
      collectedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
      allocationBytes: buffers.reduce((sum, buffer) => sum + buffer.size, 0), samples };
    return { ...signature, statistics: summarize(signature) };
  } finally {
    finished = true;
    clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    for (const buffer of buffers) buffer.destroy();
    if (device) { active.delete(device); if (owned) device.destroy(); }
  }
}

/** Distance is descriptive. Thresholds must be supplied with a calibration reference;
 * no default threshold claims that a signature identifies a physical GPU.
 */
export function compareGpuSignatures(baseline, candidate, thresholds = null) {
  if (!baseline || !candidate || baseline.status !== 'measured' || candidate.status !== 'measured') {
    return { status: 'unmeasured', distance: null, reason: 'missing-measurement' };
  }
  if (baseline.profile !== candidate.profile || baseline.schema !== candidate.schema) {
    return { status: 'uncertain', distance: null, reason: 'incompatible-profiles' };
  }
  const a = summarize(baseline), b = summarize(candidate);
  const distance = Math.sqrt(a.means.reduce((sum, mean, i) => sum + (mean - b.means[i]) ** 2, 0) / a.means.length);
  const variability = Math.sqrt([...a.deviations, ...b.deviations].reduce((sum, value) => sum + value ** 2, 0) / (a.means.length * 2));
  if (!thresholds) return { status: 'uncertain', distance, variability, reason: 'calibration-required' };
  const { calibrationId, consistentMax, changedMin } = thresholds;
  if (typeof calibrationId !== 'string' || !calibrationId.trim() || !Number.isFinite(consistentMax)
    || !Number.isFinite(changedMin) || consistentMax < 0 || changedMin <= consistentMax || changedMin > 1) {
    throw new TypeError('GPU comparison needs calibrated distance thresholds and a calibrationId');
  }
  const status = distance <= consistentMax ? 'consistent' : distance >= changedMin ? 'changed' : 'uncertain';
  return { status, distance, variability, calibrationId, consistentMax, changedMin, reason: 'signature-distance-only' };
}
