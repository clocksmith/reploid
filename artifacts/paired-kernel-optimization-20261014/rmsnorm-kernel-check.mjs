// Kernel-level check of a replacement paired RMSNorm kernel against the shipped one and an
// independent F64 evaluation, on identical inputs, on one physical GPU through Node/Dawn.
//
// Both shaders run unmodified with the registry bindings and 32-byte uniform layout of
// rmsnorm/paired. The shipped program runs as Doppler dispatches it (WORKGROUP_SIZE 64, one
// workgroup per token); the candidate runs with its declared constants and one workgroup per
// token and output slice of WORKGROUP_SIZE elements. Fusions follow the model's call sites:
// plain input norm, pre-residual with prenorm output (post-attention norm), post-residual, with
// F32 and F16 weights and the (1 + w) weight offset. Epsilon 1e-6 is passed as a pair.
// Input profiles exercise the reordered sum of squares:
//   uniform  values uniform in [-3, 3];
//   wide     log-uniform magnitudes 2^-20..2^10 with random signs within each row;
//   cancel   pre-residual inputs whose residual nearly cancels the input
//            (r = -x (1 + 2^-20 u)), so the normalized row is a near-cancelled difference.
// Row sizes straddle the candidate's 256-element slices (255-257, 511-513, 1023-1025) and include
// the model's 1024 hidden and 256 head sizes; 1 and 16 tokens.
// Per case and kernel: maximum error against F64 relative to max(1, |ref|) and to
// max(2^-40, |ref|), the same measures between the two kernels, bit-identical outputs, and the
// median wall time of single-dispatch submissions.
//
// Usage: node rmsnorm-kernel-check.mjs <webgpu module dir> <shipped.wgsl> <candidate.wgsl>
//          <candidate constants JSON> <out.json> [repeats]
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const [moduleDir, shippedPath, candidatePath, candidateConstantsArg, destination, repeatsArg] = process.argv.slice(2);
if (!destination) throw new Error('Usage: rmsnorm-kernel-check.mjs WEBGPU SHIPPED CANDIDATE CONSTANTS OUT [REPEATS]');
const candidateConstants = JSON.parse(candidateConstantsArg);
const candidateWorkgroup = candidateConstants.WORKGROUP_SIZE;
if (!Number.isInteger(candidateWorkgroup)) throw new Error('Candidate constants must declare WORKGROUP_SIZE.');
const repeats = Number(repeatsArg ?? 5);
const { create, globals } = createRequire(import.meta.url)(moduleDir);
Object.assign(globalThis, globals);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = { shipped: await readFile(shippedPath, 'utf8'), candidate: await readFile(candidatePath, 'utf8') };
const EPS = 1e-6, EPS_HI = Math.fround(EPS), EPS_LO = Math.fround(EPS - EPS_HI);

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
  if (profile === 'cancel') return Array.from({ length: count }, () => signed() * 2 ** (-2 + 4 * random()));
  throw new Error('Unknown profile ' + profile);
}

const cases = [];
const fusions = [
  { name: 'input', pre: false, post: false, prenorm: false },
  { name: 'pre-prenorm', pre: true, post: false, prenorm: true },
  { name: 'post', pre: false, post: true, prenorm: false },
];
for (const profile of ['uniform', 'wide', 'cancel']) {
  for (const size of [255, 256, 257, 511, 512, 513, 1023, 1024, 1025]) {
    for (const tokens of [1, 16]) {
      const fusion = profile === 'cancel' ? fusions[1] : fusions[(size + tokens) % 3];
      cases.push({ name: `${profile}-size${size}-tokens${tokens}-${fusion.name}`, profile, size, tokens, fusion, weightF16: size % 2 === 0 && tokens === 16, offset: true });
    }
  }
}
for (const fusion of fusions) for (const weightF16 of [false, true]) for (const offset of [false, true]) {
  cases.push({ name: `model-size1024-${fusion.name}-${weightF16 ? 'f16' : 'f32'}w-${offset ? 'offset' : 'plain'}`, profile: 'uniform', size: 1024, tokens: 1, fusion, weightF16, offset });
}
cases.push({ name: 'qknorm-size256-rows8', profile: 'uniform', size: 256, tokens: 8, fusion: fusions[0], weightF16: false, offset: true });

function toHalfBits(value) {
  const f = new Float32Array([value]), bits = new Uint32Array(f.buffer)[0];
  const sign = (bits >>> 16) & 0x8000, exponent = ((bits >>> 23) & 255) - 127 + 15, mantissa = bits & 0x7fffff;
  if ((bits & 0x7fffffff) === 0) return sign;
  if (exponent <= 0 || exponent >= 31) throw new Error('F16 weight outside the normal range');
  let half = sign | (exponent << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half += 1;
  return half;
}
const fromHalf = half => ((half & 0x8000) ? -1 : 1) * (((half >>> 10) & 31) ? (1 + (half & 1023) / 1024) * 2 ** (((half >>> 10) & 31) - 15) : (half & 1023) * 2 ** -24);

const result = { schema: 'reploid.paired-rmsnorm-kernel-check/v1', startedAt: new Date().toISOString(),
  sources: { shipped: { path: shippedPath, sha256: sha256(sources.shipped) }, candidate: { path: candidatePath, sha256: sha256(sources.candidate) } },
  candidateConstants, repeats, eps: EPS, cases: [], errors: [] };
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
  result.compile = {};
  for (const [name, code] of Object.entries(sources)) {
    const module = device.createShaderModule({ code });
    const bad = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error');
    if (bad.length) throw new Error(name + ': ' + bad.map(row => row.message).join('\n'));
    modules[name] = module;
  }
  const pipelineCache = new Map();
  const pipelineFor = async (name, testCase) => {
    const constants = { ...(name === 'candidate' ? candidateConstants : { WORKGROUP_SIZE: 64 }),
      WEIGHT_F16: testCase.weightF16 ? 1 : 0, WEIGHT_OFFSET: testCase.offset ? 1 : 0,
      PRE_RESIDUAL: testCase.fusion.pre ? 1 : 0, POST_RESIDUAL: testCase.fusion.post ? 1 : 0, OUTPUT_PRENORM: testCase.fusion.prenorm ? 1 : 0 };
    const key = name + JSON.stringify(constants);
    if (!pipelineCache.has(key)) {
      const started = performance.now();
      pipelineCache.set(key, await device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module: modules[name], entryPoint: 'main', constants } }));
      result.compile[key] = performance.now() - started;
    }
    return pipelineCache.get(key);
  };
  const buffer = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  for (const testCase of cases) {
    const { size, tokens, fusion } = testCase, count = size * tokens;
    const x = makeRows(testCase.profile, count);
    let residual64 = makeRows('uniform', count);
    if (testCase.profile === 'cancel') residual64 = x.map(v => -v * (1 + 2 ** -20 * random()));
    const input = pairFrom(x), residual = pairFrom(residual64);
    const weights64 = Array.from({ length: size }, () => (random() * 2 - 1) * 1.5 + (random() < 0.02 ? 0 : 0.01));
    let weightData, weightValues;
    if (testCase.weightF16) {
      const halves = new Uint16Array(size + (size % 2)); weightValues = new Float64Array(size);
      for (let i = 0; i < size; i++) { const w = Math.abs(weights64[i]) < 2 ** -12 ? 0 : weights64[i]; halves[i] = toHalfBits(w); weightValues[i] = fromHalf(halves[i]); }
      weightData = new Uint32Array(halves.buffer);
    } else {
      const f = Float32Array.from(weights64); weightValues = Float64Array.from(f); weightData = new Uint32Array(f.buffer);
    }
    // F64 reference.
    const expected = new Float64Array(count), expectedPrenorm = new Float64Array(count);
    for (let t = 0; t < tokens; t++) {
      let squares = 0;
      for (let i = 0; i < size; i++) {
        const v = input.values[t * size + i] + (fusion.pre ? residual.values[t * size + i] : 0);
        expectedPrenorm[t * size + i] = v; squares += v * v;
      }
      const inverse = 1 / Math.sqrt(squares / size + (EPS_HI + EPS_LO));
      for (let i = 0; i < size; i++) {
        const w = weightValues[i] + (testCase.offset ? 1 : 0);
        expected[t * size + i] = expectedPrenorm[t * size + i] * inverse * w + (fusion.post ? residual.values[t * size + i] : 0);
      }
    }
    const raw = new ArrayBuffer(32), view = new DataView(raw);
    const tokenStride = Math.min(tokens, 65535);
    view.setUint32(0, size, true); view.setUint32(4, tokens, true); view.setFloat32(8, EPS_HI, true); view.setFloat32(12, EPS_LO, true);
    view.setUint32(16, tokenStride, true); view.setFloat32(20, 1, true); view.setFloat32(24, 0, true);
    const uniforms = buffer(new Uint8Array(raw), GPUBufferUsage.UNIFORM);
    const inBuf = buffer(input.data, GPUBufferUsage.STORAGE), resBuf = buffer(residual.data, GPUBufferUsage.STORAGE), wBuf = buffer(weightData, GPUBufferUsage.STORAGE);
    const row = { name: testCase.name, profile: testCase.profile, size, tokens, fusion: fusion.name, weightF16: testCase.weightF16, offset: testCase.offset, kernels: {} };
    const outputs = {};
    for (const name of ['shipped', 'candidate']) {
      const pipeline = await pipelineFor(name, testCase);
      const out = device.createBuffer({ size: count * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const pre = device.createBuffer({ size: fusion.prenorm ? count * 8 : 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const group = device.createBindGroup({ layout, entries: [uniforms, inBuf, wBuf, out, resBuf, pre].map((b, binding) => ({ binding, resource: { buffer: b } })) });
      const slices = name === 'candidate' ? Math.ceil(size / candidateWorkgroup) : 1;
      const once = async () => {
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(tokenStride, Math.ceil(tokens / tokenStride), slices); pass.end();
        const startedAt = performance.now(); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        return performance.now() - startedAt;
      };
      const samples = [];
      for (let i = 0; i < repeats; i++) samples.push(await once());
      samples.sort((a, b) => a - b);
      const read = async (source, bytes) => {
        const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, staging, 0, bytes); device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap(); staging.destroy();
        return data;
      };
      const data = await read(out, count * 8);
      const prenormData = fusion.prenorm ? await read(pre, count * 8) : null;
      outputs[name] = { data, prenormData };
      let maxRelative = 0, maxMagnitudeRelative = 0, finite = true, prenormExact = true;
      for (let i = 0; i < count; i++) {
        const value = data[2 * i] + data[2 * i + 1];
        if (!Number.isFinite(value)) { finite = false; continue; }
        const error = Math.abs(value - expected[i]);
        maxRelative = Math.max(maxRelative, error / Math.max(1, Math.abs(expected[i])));
        maxMagnitudeRelative = Math.max(maxMagnitudeRelative, error / Math.max(2 ** -40, Math.abs(expected[i])));
        if (prenormData && Math.abs(prenormData[2 * i] + prenormData[2 * i + 1] - expectedPrenorm[i]) > 2 ** -44 * Math.max(1, Math.abs(expectedPrenorm[i]))) prenormExact = false;
      }
      row.kernels[name] = { maxRelativeErrorVsF64: maxRelative, maxMagnitudeRelativeErrorVsF64: maxMagnitudeRelative, finite,
        ...(prenormData ? { prenormWithinPairedRounding: prenormExact } : {}),
        medianMs: samples[Math.floor(samples.length / 2)], minMs: samples[0], maxMs: samples.at(-1) };
      out.destroy(); pre.destroy();
    }
    let maxDifference = 0, maxRelativeDifference = 0, maxMagnitudeRelativeDifference = 0, identical = 0, prenormIdentical = true;
    const a = outputs.shipped.data, b = outputs.candidate.data;
    for (let i = 0; i < count; i++) {
      if (a[2 * i] === b[2 * i] && a[2 * i + 1] === b[2 * i + 1]) identical++;
      const value = a[2 * i] + a[2 * i + 1], difference = Math.abs(value - (b[2 * i] + b[2 * i + 1]));
      maxDifference = Math.max(maxDifference, difference);
      maxRelativeDifference = Math.max(maxRelativeDifference, difference / Math.max(1, Math.abs(value)));
      maxMagnitudeRelativeDifference = Math.max(maxMagnitudeRelativeDifference, difference / Math.max(2 ** -40, Math.abs(value)));
    }
    if (fusion.prenorm) {
      const pa = outputs.shipped.prenormData, pb = outputs.candidate.prenormData;
      for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) { prenormIdentical = false; break; }
    }
    row.shippedVsCandidate = { maxAbsDifference: maxDifference, maxRelativeDifference, maxMagnitudeRelativeDifference,
      bitIdenticalOutputs: identical, outputs: count, ...(fusion.prenorm ? { prenormBitIdentical: prenormIdentical } : {}) };
    row.errorsSoFar = result.errors.length;
    result.cases.push(row);
    console.log(JSON.stringify({ case: row.name, shipped: row.kernels.shipped, candidate: row.kernels.candidate, diff: row.shippedVsCandidate }));
    uniforms.destroy(); inBuf.destroy(); resBuf.destroy(); wBuf.destroy();
  }
  await device.queue.onSubmittedWorkDone(); device.destroy();
} catch (error) { result.failure = error.stack; throw error; }
finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(destination, JSON.stringify(result, null, 1) + '\n', { flag: 'wx' });
}
process.exit(0);
