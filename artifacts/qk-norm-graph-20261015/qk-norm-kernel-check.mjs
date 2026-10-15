// Kernel-level check of the two paired RMSNorm programs on the Q/K head-norm shape, on identical
// inputs, against an independent F64 evaluation, on one physical GPU through Node/Dawn.
//
// Adapted from paired-kernel-optimization-20261014/rmsnorm-kernel-check.mjs (same bindings, 32-byte
// uniform layout, epsilon pair and per-kernel constants). Both shaders run unmodified as Doppler
// dispatches them for a head norm: rmsnorm_paired.wgsl (WORKGROUP_SIZE 64, one workgroup per head row)
// and rmsnorm_paired_sliced.wgsl (WORKGROUP_SIZE 256 from the registry, one workgroup per head row and
// 256-element slice; one slice at head dimension 256). No residual or prenorm fusion (the head-norm
// call site), the (1 + w) weight offset, epsilon 1e-6.
// The reordered reduction is the sum of squares: 64 lanes of 4 squares versus 256 lanes of 1.
//
// Shape: head dimension 256; Q rows = tokens x 8 heads, K rows = tokens x 2 heads; tokens 1 (decode),
// 3 (a partial prefill chunk) and 16 (a full chunk). Weights: the model's own F16 q_norm and k_norm
// weights of all six full-attention layers (read from the base model shards), plus synthetic F32
// weights with and without the offset.
// Input profiles:
//   uniform  values uniform in [-3, 3];
//   wide     log-uniform magnitudes 2^-20..2^10 with random signs within each row;
//   outlier  values uniform in [-1, 1] with 2% of channels scaled by 2^8..2^10 (a few dominant channels);
//   tiny     magnitudes 2^-14..2^-9, so the mean square is comparable to epsilon.
// Per case and kernel: maximum error against F64 relative to max(1, |ref|) and to max(2^-40, |ref|);
// between the kernels: identical outputs, maximum difference, and (K rows) elements whose nearest F16
// value differs, a proxy for the F16 K cache (the cache stores K after RoPE). Median wall time of single
// submissions.
//
// Usage: node qk-norm-kernel-check.mjs <webgpu module dir> <rmsnorm_paired.wgsl> <rmsnorm_paired_sliced.wgsl>
//          <model dir> <out.json> [repeats]
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [moduleDir, shippedPath, slicedPath, modelDir, destination, repeatsArg] = process.argv.slice(2);
if (!destination) throw new Error('Usage: qk-norm-kernel-check.mjs WEBGPU SHIPPED SLICED MODEL OUT [REPEATS]');
const repeats = Number(repeatsArg ?? 5);
const { create, globals } = createRequire(import.meta.url)(moduleDir);
Object.assign(globalThis, globals);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = { shipped: await readFile(shippedPath, 'utf8'), sliced: await readFile(slicedPath, 'utf8') };
const KERNELS = { shipped: { constants: { WORKGROUP_SIZE: 64 }, sliceWidth: null }, sliced: { constants: { WORKGROUP_SIZE: 256 }, sliceWidth: 256 } };
const EPS = 1e-6, EPS_HI = Math.fround(EPS), EPS_LO = Math.fround(EPS - EPS_HI), HEAD = 256;

let seed = 20261015;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const signed = () => (random() < 0.5 ? -1 : 1);
function pairFrom(values64) {
  const data = new Float32Array(values64.length * 2), values = new Float64Array(values64.length);
  for (let i = 0; i < values64.length; i++) {
    const hi = Math.fround(values64[i]), lo = Math.fround(values64[i] - hi);
    data[2 * i] = hi; data[2 * i + 1] = lo; values[i] = hi + lo;
  }
  return { data, values };
}
function makeRows(profile, count) {
  if (profile === 'uniform') return Array.from({ length: count }, () => (random() * 2 - 1) * 3 * (1 + 2 ** -30 * random()));
  if (profile === 'wide') return Array.from({ length: count }, () => signed() * 2 ** (-20 + 30 * random()));
  if (profile === 'outlier') return Array.from({ length: count }, () => (random() * 2 - 1) * (random() < 0.02 ? 2 ** (8 + 2 * random()) : 1));
  if (profile === 'tiny') return Array.from({ length: count }, () => signed() * 2 ** (-14 + 5 * random()));
  throw new Error('Unknown profile ' + profile);
}
const fromHalf = half => ((half & 0x8000) ? -1 : 1) * (((half >>> 10) & 31) ? (1 + (half & 1023) / 1024) * 2 ** (((half >>> 10) & 31) - 15) : (half & 1023) * 2 ** -24);
// Nearest F16 value (ties to even) of a finite F64 value inside the F16 range.
function nearestHalf(x) {
  if (x === 0) return 0;
  const a = Math.abs(x);
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e -= 1;
  if (2 ** (e + 1) <= a) e += 1;
  const quantum = 2 ** Math.max(e - 10, -24);
  const scaled = a / quantum;
  let n = Math.floor(scaled);
  const fraction = scaled - n;
  if (fraction > 0.5 || (fraction === 0.5 && n % 2 === 1)) n += 1;
  return Math.sign(x) * n * quantum;
}

// The model's F16 head-norm weights, read from the manifest's tensor locations.
const manifest = JSON.parse(await readFile(path.join(modelDir, 'manifest.json'), 'utf8'));
const layers = manifest.inference.layerPattern.layerTypes.flatMap((type, layer) => type === 'full_attention' ? [layer] : []);
const modelWeights = [];
for (const layer of layers) for (const role of ['q', 'k']) {
  const name = `model.language_model.layers.${layer}.self_attn.${role}_norm.weight`;
  const tensor = manifest.tensors[name];
  if (!tensor || tensor.dtype !== 'F16' || tensor.size !== HEAD * 2) throw new Error('Unexpected head-norm tensor ' + name);
  const shard = manifest.shards.find(entry => entry.index === tensor.shard);
  const bytes = (await readFile(path.join(modelDir, shard.filename))).subarray(tensor.offset, tensor.offset + tensor.size);
  const halves = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  modelWeights.push({ name, layer, role, halves, sha256: sha256(bytes) });
}

const cases = [];
for (const weight of modelWeights) for (const profile of ['uniform', 'wide', 'outlier', 'tiny']) for (const tokens of [1, 3, 16]) {
  cases.push({ name: `L${weight.layer}-${weight.role}_norm-${profile}-tokens${tokens}`, role: weight.role, heads: weight.role === 'q' ? 8 : 2,
    profile, tokens, weight: { kind: 'model-f16', name: weight.name, halves: weight.halves }, offset: true });
}
for (const profile of ['uniform', 'wide']) for (const offset of [false, true]) for (const tokens of [1, 16]) {
  cases.push({ name: `synthetic-f32w-${offset ? 'offset' : 'plain'}-${profile}-tokens${tokens}`, role: 'q', heads: 8, profile, tokens,
    weight: { kind: 'synthetic-f32' }, offset });
}

const result = { schema: 'reploid.qk-norm-kernel-check/v1', startedAt: new Date().toISOString(),
  sources: { shipped: { path: shippedPath, sha256: sha256(sources.shipped) }, sliced: { path: slicedPath, sha256: sha256(sources.sliced) } },
  kernels: KERNELS, repeats, eps: EPS, headDim: HEAD, modelManifestSha256: sha256(await readFile(path.join(modelDir, 'manifest.json'))),
  modelWeights: modelWeights.map(({ name, layer, role, sha256: digest }) => ({ name, layer, role, sha256: digest })), cases: [], errors: [] };
try {
  const gpu = globalThis.dawnInstance = create([]);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info?.isFallbackAdapter) throw new Error('Physical adapter required.');
  result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
  const device = await adapter.requestDevice();
  device.addEventListener?.('uncapturederror', event => result.errors.push(event.error.message));
  const layout = device.createBindGroupLayout({ entries: ['uniform', 'read-only-storage', 'read-only-storage', 'storage', 'read-only-storage', 'storage']
    .map((type, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } })) });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const modules = {};
  for (const [name, code] of Object.entries(sources)) {
    const module = device.createShaderModule({ code });
    const bad = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error');
    if (bad.length) throw new Error(name + ': ' + bad.map(row => row.message).join('\n'));
    modules[name] = module;
  }
  const pipelineCache = new Map();
  const pipelineFor = async (name, testCase) => {
    const constants = { ...KERNELS[name].constants, WEIGHT_F16: testCase.weight.kind === 'model-f16' ? 1 : 0, WEIGHT_OFFSET: testCase.offset ? 1 : 0,
      PRE_RESIDUAL: 0, POST_RESIDUAL: 0, OUTPUT_PRENORM: 0 };
    const key = name + JSON.stringify(constants);
    if (!pipelineCache.has(key)) {
      pipelineCache.set(key, await device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module: modules[name], entryPoint: 'main', constants } }));
    }
    return pipelineCache.get(key);
  };
  const buffer = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  const read = async (source, bytes) => {
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, staging, 0, bytes); device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap(); staging.destroy();
    return data;
  };
  for (const testCase of cases) {
    const rows = testCase.tokens * testCase.heads, count = rows * HEAD;
    const input = pairFrom(makeRows(testCase.profile, count));
    let weightData, weightValues;
    if (testCase.weight.kind === 'model-f16') {
      weightData = new Uint32Array(testCase.weight.halves.slice().buffer);
      weightValues = Float64Array.from(testCase.weight.halves, fromHalf);
    } else {
      const f = Float32Array.from({ length: HEAD }, () => (random() * 2 - 1) * 1.5);
      weightValues = Float64Array.from(f); weightData = new Uint32Array(f.buffer);
    }
    const expected = new Float64Array(count);
    for (let r = 0; r < rows; r++) {
      let squares = 0;
      for (let i = 0; i < HEAD; i++) squares += input.values[r * HEAD + i] ** 2;
      const inverse = 1 / Math.sqrt(squares / HEAD + (EPS_HI + EPS_LO));
      for (let i = 0; i < HEAD; i++) expected[r * HEAD + i] = input.values[r * HEAD + i] * inverse * (weightValues[i] + (testCase.offset ? 1 : 0));
    }
    const raw = new ArrayBuffer(32), view = new DataView(raw), tokenStride = Math.min(rows, 65535);
    view.setUint32(0, HEAD, true); view.setUint32(4, rows, true); view.setFloat32(8, EPS_HI, true); view.setFloat32(12, EPS_LO, true);
    view.setUint32(16, tokenStride, true); view.setFloat32(20, 1, true); view.setFloat32(24, 0, true);
    const uniforms = buffer(new Uint8Array(raw), GPUBufferUsage.UNIFORM);
    const inBuf = buffer(input.data, GPUBufferUsage.STORAGE), wBuf = buffer(weightData, GPUBufferUsage.STORAGE);
    const row = { name: testCase.name, role: testCase.role, rows, tokens: testCase.tokens, profile: testCase.profile, weight: testCase.weight.kind,
      weightTensor: testCase.weight.name ?? null, offset: testCase.offset, kernels: {} };
    const outputs = {};
    for (const name of ['shipped', 'sliced']) {
      const pipeline = await pipelineFor(name, testCase);
      const out = device.createBuffer({ size: count * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const prenorm = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
      // The residual binding repeats the input, as the head-norm call site binds it.
      const group = device.createBindGroup({ layout, entries: [uniforms, inBuf, wBuf, out, inBuf, prenorm].map((b, binding) => ({ binding, resource: { buffer: b } })) });
      const slices = KERNELS[name].sliceWidth ? Math.ceil(HEAD / KERNELS[name].sliceWidth) : 1;
      const samples = [];
      for (let i = 0; i < repeats; i++) {
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(tokenStride, Math.ceil(rows / tokenStride), slices); pass.end();
        const startedAt = performance.now(); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        samples.push(performance.now() - startedAt);
      }
      samples.sort((a, b) => a - b);
      const data = await read(out, count * 8);
      outputs[name] = data;
      let maxRelative = 0, maxMagnitudeRelative = 0, finite = true;
      for (let i = 0; i < count; i++) {
        const value = data[2 * i] + data[2 * i + 1];
        if (!Number.isFinite(value)) { finite = false; continue; }
        const error = Math.abs(value - expected[i]);
        maxRelative = Math.max(maxRelative, error / Math.max(1, Math.abs(expected[i])));
        maxMagnitudeRelative = Math.max(maxMagnitudeRelative, error / Math.max(2 ** -40, Math.abs(expected[i])));
      }
      row.kernels[name] = { maxRelativeErrorVsF64: maxRelative, maxMagnitudeRelativeErrorVsF64: maxMagnitudeRelative, finite,
        medianMs: samples[Math.floor(samples.length / 2)], minMs: samples[0], maxMs: samples.at(-1) };
      out.destroy(); prenorm.destroy();
    }
    const a = outputs.shipped, b = outputs.sliced;
    let identical = 0, maxDifference = 0, maxRelativeDifference = 0, halfRoundingDiffers = 0;
    for (let i = 0; i < count; i++) {
      const x = a[2 * i] + a[2 * i + 1], y = b[2 * i] + b[2 * i + 1];
      if (a[2 * i] === b[2 * i] && a[2 * i + 1] === b[2 * i + 1]) identical++;
      const difference = Math.abs(x - y);
      maxDifference = Math.max(maxDifference, difference);
      maxRelativeDifference = Math.max(maxRelativeDifference, difference / Math.max(2 ** -40, Math.abs(x)));
      if (nearestHalf(x) !== nearestHalf(y)) halfRoundingDiffers++;
    }
    row.between = { elements: count, bitIdenticalPairs: identical, maxDifference, maxRelativeDifference, nearestF16Differs: halfRoundingDiffers };
    result.cases.push(row);
    uniforms.destroy(); inBuf.destroy(); wBuf.destroy();
  }
  const all = result.cases;
  const max = (rows, pick) => rows.reduce((m, row) => Math.max(m, pick(row)), 0);
  result.summary = {
    cases: all.length, elements: all.reduce((s, row) => s + row.between.elements, 0),
    allFinite: all.every(row => row.kernels.shipped.finite && row.kernels.sliced.finite),
    maxRelativeErrorVsF64: { shipped: max(all, row => row.kernels.shipped.maxRelativeErrorVsF64), sliced: max(all, row => row.kernels.sliced.maxRelativeErrorVsF64) },
    maxMagnitudeRelativeErrorVsF64: { shipped: max(all, row => row.kernels.shipped.maxMagnitudeRelativeErrorVsF64), sliced: max(all, row => row.kernels.sliced.maxMagnitudeRelativeErrorVsF64) },
    bitIdenticalPairs: all.reduce((s, row) => s + row.between.bitIdenticalPairs, 0),
    casesFullyIdentical: all.filter(row => row.between.bitIdenticalPairs === row.between.elements).length,
    maxRelativeDifferenceBetweenKernels: max(all, row => row.between.maxRelativeDifference),
    nearestF16Differs: { all: all.reduce((s, row) => s + row.between.nearestF16Differs, 0),
      kRows: all.filter(row => row.role === 'k').reduce((s, row) => s + row.between.nearestF16Differs, 0) },
    // Median over the model-weight cases of each case's median single-dispatch wall time.
    medianMs: Object.fromEntries(['shipped', 'sliced'].map(name => [name, Object.fromEntries(['q', 'k'].flatMap(role => [1, 3, 16].map(tokens => {
      const values = all.filter(row => row.role === role && row.tokens === tokens && row.weight === 'model-f16').map(row => row.kernels[name].medianMs).sort((x, y) => x - y);
      return [`${role}Rows-tokens${tokens}`, values[Math.floor(values.length / 2)] ?? null];
    })))])),
  };
  result.passed = result.errors.length === 0 && result.summary.allFinite;
  device.destroy?.();
} catch (error) {
  result.failure = error.stack ?? String(error);
  result.passed = false;
}
result.finishedAt = new Date().toISOString();
await writeFile(destination, JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ passed: result.passed, summary: result.summary, failure: result.failure ?? null, errors: result.errors.length }));
if (!result.passed) process.exitCode = 1;
