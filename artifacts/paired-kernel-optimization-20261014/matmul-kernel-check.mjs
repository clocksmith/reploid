// Kernel-level check of a replacement paired matmul against the shipped matmul_paired.wgsl and an
// independent F64 evaluation, on identical inputs, on one physical GPU through Node/Dawn.
//
// Both shaders run unmodified with the shipped bindings (uniforms, input, weight, output) and
// the 32-byte uniform layout. The shipped program runs as Doppler dispatches it (WORKGROUP_SIZE
// 64, one workgroup per output); the candidate with its declared constants and, when it declares
// OUTPUT_LANES, WORKGROUP_SIZE / OUTPUT_LANES outputs per workgroup. Weights are random Q4_K blocks (as in
// Doppler artifacts/paired-matmul-prefill-cost-20261014) or F16; inputs are two-F32 pairs.
// The F64 reference dequantizes each Q4_K weight exactly as the kernel's stored-weight contract
// (F32 difference of the exact scale and minimum products) and sums in F64.
// Input profiles: uniform; wide (log-uniform 2^-20..2^6 magnitudes); cancel (inputs j and j + 32 of
// each 64-element run are x, -x (1 + 2^-20 u) against equal weights, so every dot product nearly
// cancels).
//
// Usage: node matmul-kernel-check.mjs <webgpu module dir> <shipped.wgsl> <candidate.wgsl>
//          <candidate constants JSON> <out.json> [repeats]
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const [moduleDir, shippedPath, candidatePath, candidateConstantsArg, destination, repeatsArg] = process.argv.slice(2);
if (!destination) throw new Error('Usage: matmul-kernel-check.mjs WEBGPU SHIPPED CANDIDATE CONSTANTS OUT [REPEATS]');
const candidateConstants = JSON.parse(candidateConstantsArg);
// Candidates that declare OUTPUT_LANES reduce WORKGROUP_SIZE / OUTPUT_LANES outputs per workgroup;
// the others one output per workgroup, as the shipped program does.
const outputsPerGroup = candidateConstants.OUTPUT_LANES === undefined ? 1 : candidateConstants.WORKGROUP_SIZE / candidateConstants.OUTPUT_LANES;
if (!Number.isInteger(outputsPerGroup) || !Number.isInteger(candidateConstants.WORKGROUP_SIZE)) throw new Error('Candidate constants must declare WORKGROUP_SIZE (and OUTPUT_LANES when grouped).');
const repeats = Number(repeatsArg ?? 5);
const { create, globals } = createRequire(import.meta.url)(moduleDir);
Object.assign(globalThis, globals);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = { shipped: await readFile(shippedPath, 'utf8'), candidate: await readFile(candidatePath, 'utf8') };

let seed = 20261017;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const signed = () => (random() < 0.5 ? -1 : 1);
const halfToFloat = half => ((half & 0x8000) ? -1 : 1) * (((half >>> 10) & 31) ? (1 + (half & 1023) / 1024) * 2 ** (((half >>> 10) & 31) - 15) : (half & 1023) * 2 ** -24);

function q4kWeights(N, K, profile) {
  const bytes = new Uint8Array(N * (K / 256) * 144), view = new DataView(bytes.buffer), values = new Float64Array(N * K);
  for (let row = 0; row < N; row++) for (let blockIndex = 0; blockIndex < K / 256; blockIndex++) {
    const base = (row * (K / 256) + blockIndex) * 144;
    view.setUint16(base, 0x2abc, true); view.setUint16(base + 2, 0x21ab, true);
    for (let i = 4; i < 144; i++) bytes[base + i] = Math.floor(random() * 256);
    if (profile === 'cancel') {
      // Equal scale/minimum in every sub-block and equal nibbles: elements j and j + 32 of each
      // 64-element run share one weight.
      const scale = 1 + Math.floor(random() * 15), minimum = Math.floor(random() * 16);
      for (let i = 4; i < 8; i++) { bytes[base + i] = scale; bytes[base + i + 4] = minimum; bytes[base + i + 8] = scale | (minimum << 4); }
      for (let i = 16; i < 144; i++) bytes[base + i] = (bytes[base + i] & 0x0f) | ((bytes[base + i] & 0x0f) << 4);
    }
    const d = halfToFloat(0x2abc), dmin = halfToFloat(0x21ab), byte = i => bytes[base + i];
    for (let local = 0; local < 256; local++) {
      const sub = Math.floor(local / 32);
      let scale, minimum;
      if (sub < 4) { scale = byte(4 + sub) & 63; minimum = byte(8 + sub) & 63; }
      else { scale = (byte(8 + sub) & 15) | ((byte(sub) >> 6) << 4); minimum = (byte(8 + sub) >> 4) | ((byte(4 + sub) >> 6) << 4); }
      const qbyte = byte(16 + Math.floor(local / 64) * 32 + local % 32);
      const quant = (qbyte >> ((Math.floor(local / 32) % 2) * 4)) & 15;
      values[row * K + blockIndex * 256 + local] = Math.fround(d * scale * quant - dmin * minimum);
    }
  }
  return { bytes, values };
}
function pairInputs(count, profile) {
  const data = new Float32Array(count * 2), values = new Float64Array(count);
  const put = (i, x) => { const hi = Math.fround(x), lo = Math.fround(x - hi); data[2 * i] = hi; data[2 * i + 1] = lo; values[i] = hi + lo; };
  for (let i = 0; i < count; i++) {
    if (profile === 'wide') put(i, signed() * 2 ** (-20 + 26 * random()));
    else if (profile === 'cancel' && i % 64 >= 32) put(i, -values[i - 32] * (1 + 2 ** -20 * random()));
    else put(i, (random() - 0.5) * 2);
  }
  return { data, values };
}

const cases = [];
for (const [N, K] of [[3584, 1024], [1024, 3584], [6144, 1024], [1024, 2048]]) for (const M of [1, 16]) cases.push({ profile: 'uniform', M, N, K });
for (const profile of ['wide', 'cancel']) cases.push({ profile, M: 3, N: 1024, K: 1024 });
cases.push({ profile: 'uniform', M: 1, N: 1027, K: 512 });
cases.push({ profile: 'uniform', M: 1, N: 65536, K: 1024, scalarOutput: true });

const result = { schema: 'reploid.paired-matmul-kernel-check/v1', startedAt: new Date().toISOString(),
  sources: { shipped: { path: shippedPath, sha256: sha256(sources.shipped) }, candidate: { path: candidatePath, sha256: sha256(sources.candidate) } },
  candidateConstants, repeats, cases: [], errors: [] };
try {
  const gpu = globalThis.dawnInstance = create([]);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info?.isFallbackAdapter) throw new Error('Physical adapter required.');
  result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
  const device = await adapter.requestDevice();
  device.addEventListener?.('uncapturederror', event => result.errors.push(event.error.message));
  const layout = device.createBindGroupLayout({ entries: ['uniform', 'read-only-storage', 'read-only-storage', 'storage']
    .map((type, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } })) });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const modules = {};
  for (const [name, code] of Object.entries(sources)) {
    const module = device.createShaderModule({ code });
    const bad = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error');
    if (bad.length) throw new Error(name + ': ' + bad.map(row => row.message).join('\n'));
    modules[name] = module;
  }
  const pipelines = new Map();
  const pipeline = async (name, scalarOutput) => {
    const key = name + scalarOutput;
    if (!pipelines.has(key)) {
      const base = name === 'candidate' ? candidateConstants : { WORKGROUP_SIZE: 64 };
      pipelines.set(key, await device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module: modules[name], entryPoint: 'main',
        constants: { ...base, WEIGHT_F16: 0, WEIGHT_Q4K: 1, TRANSPOSE_B: 1, SCALAR_OUTPUT: scalarOutput ? 1 : 0 } } }));
    }
    return pipelines.get(key);
  };
  const upload = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  const gridLimit = device.limits.maxComputeWorkgroupsPerDimension;
  for (const spec of cases) {
    const { M, N, K, profile } = spec, scalarOutput = spec.scalarOutput === true;
    const weights = q4kWeights(N, K, profile), inputs = pairInputs(M * K, profile);
    const reference = new Float64Array(M * N);
    for (let m = 0; m < M; m++) for (let n = 0; n < N; n++) {
      let sum = 0; for (let k = 0; k < K; k++) sum += inputs.values[m * K + k] * weights.values[n * K + k];
      reference[m * N + n] = sum;
    }
    const wBuf = upload(weights.bytes, GPUBufferUsage.STORAGE), xBuf = upload(inputs.data, GPUBufferUsage.STORAGE);
    const outBytes = M * N * (scalarOutput ? 4 : 8);
    const row = { ...spec, kernels: {} }, outputs = {};
    for (const name of ['shipped', 'candidate']) {
      const groups = name === 'candidate' ? Math.ceil(M * N / outputsPerGroup) : M * N;
      const width = Math.min(groups, gridLimit), raw = new ArrayBuffer(32), view = new DataView(raw);
      [M, N, K, width].forEach((n, i) => view.setUint32(i * 4, n, true)); view.setFloat32(16, 1, true);
      const uniforms = upload(new Uint8Array(raw), GPUBufferUsage.UNIFORM);
      const out = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const group = device.createBindGroup({ layout, entries: [uniforms, xBuf, wBuf, out].map((b, binding) => ({ binding, resource: { buffer: b } })) });
      const program = await pipeline(name, scalarOutput);
      const once = async () => {
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(program); pass.setBindGroup(0, group); pass.dispatchWorkgroups(width, Math.ceil(groups / width)); pass.end();
        const started = performance.now(); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        return performance.now() - started;
      };
      await once();
      const samples = []; for (let i = 0; i < repeats; i++) samples.push(await once());
      samples.sort((a, b) => a - b);
      const staging = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(out, 0, staging, 0, outBytes); device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap(); staging.destroy();
      outputs[name] = data;
      let maxRelative = 0;
      for (let i = 0; i < reference.length; i++) {
        const value = scalarOutput ? data[i] : data[2 * i] + data[2 * i + 1];
        maxRelative = Math.max(maxRelative, Math.abs(value - reference[i]) / Math.max(1, Math.abs(reference[i])));
      }
      row.kernels[name] = { maxRelativeErrorVsF64: maxRelative, medianMs: samples[Math.floor(samples.length / 2)], minMs: samples[0] };
      uniforms.destroy(); out.destroy();
    }
    let identical = 0, maxRelativeDifference = 0;
    const width = scalarOutput ? 1 : 2, a = outputs.shipped, b = outputs.candidate;
    for (let i = 0; i < reference.length; i++) {
      const x = scalarOutput ? a[i] : a[2 * i] + a[2 * i + 1], y = scalarOutput ? b[i] : b[2 * i] + b[2 * i + 1];
      if (a[width * i] === b[width * i] && (scalarOutput || a[2 * i + 1] === b[2 * i + 1])) identical++;
      maxRelativeDifference = Math.max(maxRelativeDifference, Math.abs(x - y) / Math.max(1, Math.abs(x)));
    }
    row.shippedVsCandidate = { maxRelativeDifference, bitIdenticalOutputs: identical, outputs: reference.length };
    result.cases.push(row);
    console.log(JSON.stringify({ case: `${profile} M${M} N${N} K${K}${scalarOutput ? ' scalar' : ''}`, shipped: row.kernels.shipped, candidate: row.kernels.candidate, diff: row.shippedVsCandidate }));
    wBuf.destroy(); xBuf.destroy();
  }
  await device.queue.onSubmittedWorkDone(); device.destroy();
} catch (error) { result.failure = error.stack; throw error; }
finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(destination, JSON.stringify(result, null, 1) + '\n', { flag: 'wx' });
}
process.exit(0);
