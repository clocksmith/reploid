// Kernel-level check of a replacement paired attention kernel against the shipped one and an
// independent F64 evaluation, on identical inputs, on one physical GPU through Node/Dawn.
//
// Both shaders run unmodified from the given files with the registry bindings and 48-byte uniform
// layout of attention/paired. Inputs: two-F32 queries (hi + lo of an F64 value), F16 keys and
// values (exact F16 bit patterns), scale 1/16 (queryPreAttnScalar 256). Shapes follow Qwen3.5
// 0.8B full attention (8 query heads, 2 KV heads, head dim 256), plus small masking cases.
// Three input profiles exercise the reordered score, maximum, sum and value reductions:
//   uniform  values uniform in a symmetric range (plus one peaked-softmax case);
//   wide     log-uniform magnitudes with random signs: queries 2^-12..2^6, keys and values
//            2^-10..2^4 (F16 normal range), so scores and weights span many binades;
//   cancel   adjacent query dimensions nearly cancel (q[2i+1] = -q[2i](1 + 2^-18 r)) against equal
//            key pairs, so every score is a near-cancelling sum, and adjacent keys carry opposite
//            values, so every output is a near-cancelling weighted sum.
// Key counts straddle the candidate's 64-key score rounds and 255-key tiles (63-65, 254-256,
// 509-511), in decode and in a 16-token prefill chunk whose causal range crosses a tile edge.
// For every case it records, per kernel, the maximum error against F64 relative to max(1, |ref|)
// (the paired physical test's measure) and relative to max(2^-40, |ref|), the maximum difference
// between the two kernels' (hi + lo) on both measures, the number of bit-identical outputs, and
// the median wall time of single-dispatch submissions.
//
// Usage: node attention-kernel-check.mjs <webgpu module dir> <shipped.wgsl> <candidate.wgsl>
//          <candidate constants JSON> <out.json> [repeats]
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const [moduleDir, shippedPath, candidatePath, candidateConstantsArg, destination, repeatsArg] = process.argv.slice(2);
if (!destination) throw new Error('Usage: attention-kernel-check.mjs WEBGPU SHIPPED CANDIDATE CONSTANTS OUT [REPEATS]');
const candidateConstants = JSON.parse(candidateConstantsArg);
const repeats = Number(repeatsArg ?? 5);
const { create, globals } = createRequire(import.meta.url)(moduleDir);
Object.assign(globalThis, globals);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = { shipped: await readFile(shippedPath, 'utf8'), candidate: await readFile(candidatePath, 'utf8') };

const H = 8, KVH = 2, D = 256;
let seed = 20261014;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const f16Bits = new Uint16Array(1), f16View = new Float32Array(1), f32Bits = new Uint32Array(f16View.buffer);
// Round-to-nearest-even F32 -> F16 for normal-range values used here (|x| in [2^-14, 65504]) and zero.
function toHalf(value) {
  f16View[0] = value;
  const bits = f32Bits[0], sign = (bits >>> 16) & 0x8000, exponent = ((bits >>> 23) & 255) - 127 + 15;
  let mantissa = bits & 0x7fffff;
  if ((bits & 0x7fffffff) === 0) return sign;
  if (exponent <= 0 || exponent >= 31) throw new Error('F16 fixture value outside the normal range: ' + value);
  let half = sign | (exponent << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half += 1;
  return half;
}
function fromHalf(half) {
  const sign = half & 0x8000 ? -1 : 1, exponent = (half >>> 10) & 31, mantissa = half & 1023;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
const signed = () => (random() < 0.5 ? -1 : 1);
const logUniform = (low, high) => signed() * 2 ** (low + (high - low) * random());
function halfFrom(values64) {
  const bits = new Uint16Array(values64.length), values = new Float64Array(values64.length);
  for (let i = 0; i < values64.length; i++) { bits[i] = toHalf(values64[i]); values[i] = fromHalf(bits[i]); }
  return { bits, values };
}
function pairFrom(values64) {
  const data = new Float32Array(values64.length * 2), values = new Float64Array(values64.length);
  for (let i = 0; i < values64.length; i++) {
    const hi = Math.fround(values64[i]), lo = Math.fround(values64[i] - hi);
    data[2 * i] = hi; data[2 * i + 1] = lo; values[i] = hi + lo;
  }
  return { data, values };
}
function makeInputs(spec, qCount, kvCount) {
  const profile = spec.profile ?? 'uniform';
  if (profile === 'uniform') return { q: pairValues(qCount, 2.5), k: halfValues(kvCount, spec.keySpread ?? 2.5), v: halfValues(kvCount, 2) };
  if (profile === 'wide') {
    return { q: pairFrom(Array.from({ length: qCount }, () => logUniform(-12, 6))),
      k: halfFrom(Array.from({ length: kvCount }, () => logUniform(-10, 4))),
      v: halfFrom(Array.from({ length: kvCount }, () => logUniform(-10, 4))) };
  }
  if (profile !== 'cancel') throw new Error('Unknown profile ' + profile);
  const q = new Float64Array(qCount), k = new Float64Array(kvCount), v = new Float64Array(kvCount);
  for (let i = 0; i < qCount; i += 2) { q[i] = logUniform(-4, 2); q[i + 1] = -q[i] * (1 + 2 ** -18 * random()); }
  for (let i = 0; i < kvCount; i += 2) { k[i] = k[i + 1] = logUniform(-6, 2); }
  // Rows are [key][kvHead][dim]; odd keys negate the even key's values.
  const row = KVH * D;
  for (let j = 0; j < kvCount / row; j++) for (let x = 0; x < row; x++) {
    v[j * row + x] = j % 2 ? -v[(j - 1) * row + x] : logUniform(-6, 2);
  }
  return { q: pairFrom(q), k: halfFrom(k), v: halfFrom(v) };
}
function halfValues(count, spread) {
  const bits = new Uint16Array(count), values = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let x = (random() * 2 - 1) * spread;
    if (Math.abs(x) < 2 ** -10) x = 0;
    bits[i] = toHalf(x); values[i] = fromHalf(bits[i]);
  }
  return { bits, values };
}
function pairValues(count, spread) {
  const data = new Float32Array(count * 2), values = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const x = (random() * 2 - 1) * spread * (1 + 2 ** -30 * random());
    const hi = Math.fround(x), lo = Math.fround(x - hi);
    data[2 * i] = hi; data[2 * i + 1] = lo; values[i] = hi + lo;
  }
  return { data, values };
}

const cases = [];
for (const kv of [1, 57, 72, 128, 234, 255, 256, 257, 317, 600]) cases.push({ name: `decode-kv${kv}`, seq: 1, kv, start: kv - 1 });
for (const profile of ['uniform', 'wide', 'cancel']) {
  for (const kv of [63, 64, 65, 254, 255, 256, 509, 510, 511]) cases.push({ name: `${profile}-decode-kv${kv}`, profile, seq: 1, kv, start: kv - 1 });
  cases.push({ name: `${profile}-prefill16-start248`, profile, seq: 16, kv: 264, start: 248 });
}
for (const start of [0, 48, 176]) cases.push({ name: `prefill16-start${start}`, seq: 16, kv: start + 16, start });
cases.push({ name: 'prefill8-start176', seq: 8, kv: 184, start: 176 });
cases.push({ name: 'prefill16-start584', seq: 16, kv: 600, start: 584 });
cases.push({ name: 'decode-kv300-peaked', seq: 1, kv: 300, start: 299, keySpread: 24 });
cases.push({ name: 'window-kv9', seq: 1, kv: 9, start: 8, window: 3 });
cases.push({ name: 'kvstart4-kv3', seq: 1, kv: 3, start: 0, kvStart: 4 });
cases.push({ name: 'noncausal-seq3-kv7', seq: 3, kv: 7, start: 4, causal: 0 });

const result = { schema: 'reploid.paired-attention-kernel-check/v2', startedAt: new Date().toISOString(),
  sources: { shipped: { path: shippedPath, sha256: sha256(sources.shipped) }, candidate: { path: candidatePath, sha256: sha256(sources.candidate) } },
  candidateConstants, repeats, geometry: { heads: H, kvHeads: KVH, headDim: D, scale: 1 / 16 }, cases: [], errors: [] };
try {
  // The Dawn instance must stay reachable for the device's lifetime.
  const gpu = globalThis.dawnInstance = create([]);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info?.isFallbackAdapter || !adapter.features.has('shader-f16')) throw new Error('Physical F16 adapter required.');
  result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
  const device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'] });
  device.addEventListener?.('uncapturederror', event => result.errors.push(event.error.message));
  const layout = device.createBindGroupLayout({ entries: ['uniform', 'read-only-storage', 'read-only-storage', 'read-only-storage', 'storage']
    .map((type, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } })) });
  const pipelines = {};
  result.compile = {};
  for (const [name, code] of Object.entries(sources)) {
    const started = performance.now();
    const module = device.createShaderModule({ code });
    const bad = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error');
    if (bad.length) throw new Error(name + ': ' + bad.map(row => row.message).join('\n'));
    pipelines[name] = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'main', ...(name === 'candidate' && Object.keys(candidateConstants).length ? { constants: candidateConstants } : {}) } });
    result.compile[name] = { ms: performance.now() - started };
    console.log(JSON.stringify({ compile: name, ms: result.compile[name].ms }));
  }
  const buffer = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
  for (const spec of cases) {
    const { seq, kv, start } = spec, kvStart = spec.kvStart ?? 0, window = spec.window ?? 0, causal = spec.causal ?? 1;
    const { q, k, v } = makeInputs(spec, seq * H * D, kv * KVH * D);
    const raw = new ArrayBuffer(48), view = new DataView(raw);
    [seq, kv, H, KVH, D, start, kvStart, window].forEach((n, i) => view.setUint32(i * 4, n, true));
    view.setFloat32(32, 1 / 16, true); view.setFloat32(36, 0, true); view.setUint32(40, causal, true);
    const uniforms = buffer(new Uint8Array(raw), GPUBufferUsage.UNIFORM);
    const qBuf = buffer(q.data, GPUBufferUsage.STORAGE), kBuf = buffer(k.bits, GPUBufferUsage.STORAGE), vBuf = buffer(v.bits, GPUBufferUsage.STORAGE);
    const outBytes = seq * H * D * 8;
    // F64 reference.
    const reference = new Float64Array(seq * H * D);
    for (let t = 0; t < seq; t++) for (let h = 0; h < H; h++) {
      const g = Math.floor(h / (H / KVH)), qpos = start + t, scores = [], keys = [];
      for (let j = 0; j < kv; j++) {
        const position = kvStart + j;
        if (causal && position > qpos) continue;
        if (window > 0 && position + window <= qpos) continue;
        let sum = 0;
        for (let d = 0; d < D; d++) sum += q.values[(t * H + h) * D + d] * k.values[(j * KVH + g) * D + d];
        scores.push(sum / 16); keys.push(j);
      }
      if (!keys.length) continue;
      const max = Math.max(...scores), weights = scores.map(s => Math.exp(s - max)), den = weights.reduce((a, b) => a + b, 0);
      for (let d = 0; d < D; d++) {
        let acc = 0;
        for (let i = 0; i < keys.length; i++) acc += weights[i] * v.values[(keys[i] * KVH + g) * D + d];
        reference[(t * H + h) * D + d] = acc / den;
      }
    }
    const row = { ...spec, kvStart, window, causal, kernels: {} };
    const outputs = {};
    for (const [name, pipeline] of Object.entries(pipelines)) {
      const out = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const staging = device.createBuffer({ size: outBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const group = device.createBindGroup({ layout, entries: [uniforms, qBuf, kBuf, vBuf, out].map((b, binding) => ({ binding, resource: { buffer: b } })) });
      const once = async () => {
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(H, seq, 1); pass.end();
        const startedAt = performance.now(); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        return performance.now() - startedAt;
      };
      const samples = [await once()];
      for (let i = 1; i < repeats; i++) samples.push(await once());
      samples.sort((a, b) => a - b);
      const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(out, 0, staging, 0, outBytes); device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap();
      outputs[name] = data;
      let maxRelative = 0, maxMagnitudeRelative = 0, finite = true;
      for (let i = 0; i < reference.length; i++) {
        const value = data[2 * i] + data[2 * i + 1];
        if (!Number.isFinite(value)) { finite = false; continue; }
        maxRelative = Math.max(maxRelative, Math.abs(value - reference[i]) / Math.max(1, Math.abs(reference[i])));
        maxMagnitudeRelative = Math.max(maxMagnitudeRelative, Math.abs(value - reference[i]) / Math.max(2 ** -40, Math.abs(reference[i])));
      }
      row.kernels[name] = { maxRelativeErrorVsF64: maxRelative, maxMagnitudeRelativeErrorVsF64: maxMagnitudeRelative, finite,
        medianMs: samples[Math.floor(samples.length / 2)], minMs: samples[0], maxMs: samples.at(-1) };
      out.destroy(); staging.destroy();
    }
    let maxDifference = 0, maxRelativeDifference = 0, maxMagnitudeRelativeDifference = 0, identical = 0;
    for (let i = 0; i < reference.length; i++) {
      const a = outputs.shipped, b = outputs.candidate;
      if (a[2 * i] === b[2 * i] && a[2 * i + 1] === b[2 * i + 1]) identical++;
      const x = a[2 * i] + a[2 * i + 1], difference = Math.abs(x - (b[2 * i] + b[2 * i + 1]));
      maxDifference = Math.max(maxDifference, difference);
      maxRelativeDifference = Math.max(maxRelativeDifference, difference / Math.max(1, Math.abs(x)));
      maxMagnitudeRelativeDifference = Math.max(maxMagnitudeRelativeDifference, difference / Math.max(2 ** -40, Math.abs(x)));
    }
    row.shippedVsCandidate = { maxAbsDifference: maxDifference, maxRelativeDifference, maxMagnitudeRelativeDifference,
      bitIdenticalOutputs: identical, outputs: reference.length };
    row.errorsSoFar = result.errors.length;
    result.cases.push(row);
    console.log(JSON.stringify({ case: spec.name, shipped: row.kernels.shipped, candidate: row.kernels.candidate, diff: row.shippedVsCandidate }));
    uniforms.destroy(); qBuf.destroy(); kBuf.destroy(); vBuf.destroy();
  }
  await device.queue.onSubmittedWorkDone(); device.destroy();
} catch (error) { result.failure = error.stack; throw error; }
finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(destination, JSON.stringify(result, null, 1) + '\n', { flag: 'wx' });
}
process.exit(0);
