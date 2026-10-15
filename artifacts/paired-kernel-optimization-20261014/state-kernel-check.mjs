// Kernel-level check of a replacement paired gated-delta state phase against the shipped one and
// an independent F64 evaluation, on identical inputs, on one physical GPU through Node/Dawn.
//
// Both shaders run unmodified with the registry bindings of gated_delta_recurrent/paired_state
// (uniforms, conv, gates, state, output) and the shared 80-byte gated-delta uniform layout. The
// shipped program runs as Doppler dispatches it (WORKGROUP_SIZE 128, one workgroup per value
// head); the candidate with its declared constants and one workgroup per value head and block of
// WORKGROUP_SIZE / K_SLICES value columns. Each run starts from the same paired state and
// processes the given tokens in one dispatch; the raw output of every token and the final state
// are compared.
// F64 reference per head and token: S = S * decay; p = S^T k; d = (v - p) * beta;
// S = S + k d^T; out = S^T q.
// Input profiles exercise the reordered prediction and readout sums:
//   model    Qwen3.5 0.8B ranges: unit-norm q/k (q scaled by 1/sqrt(128)), state and v about
//            [-1, 1], beta in (0.05, 0.95), decay in (0.85, 0.9999);
//   wide     log-uniform magnitudes 2^-24..2^4 for state, q, k and v, random signs;
//   cancel   state rows in equal pairs against opposite k and q pairs (x, -x (1 + 2^-20 u)), so
//            both the prediction and the readout are near-cancelling sums.
// Geometries: the model's (16 heads, 128 x 128), 1, 3 and 16 tokens; a GQA head map (q_rep 2);
// and a 100 x 72 head that leaves partial row slices and a partial column block.
//
// Usage: node state-kernel-check.mjs <webgpu module dir> <shipped.wgsl> <candidate.wgsl>
//          <candidate constants JSON> <out.json> [repeats]
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const [moduleDir, shippedPath, candidatePath, candidateConstantsArg, destination, repeatsArg] = process.argv.slice(2);
if (!destination) throw new Error('Usage: state-kernel-check.mjs WEBGPU SHIPPED CANDIDATE CONSTANTS OUT [REPEATS]');
const candidateConstants = JSON.parse(candidateConstantsArg);
const columnsPerGroup = candidateConstants.WORKGROUP_SIZE / candidateConstants.K_SLICES;
if (!Number.isInteger(columnsPerGroup)) throw new Error('Candidate constants must declare WORKGROUP_SIZE and K_SLICES.');
const repeats = Number(repeatsArg ?? 5);
const { create, globals } = createRequire(import.meta.url)(moduleDir);
Object.assign(globalThis, globals);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = { shipped: await readFile(shippedPath, 'utf8'), candidate: await readFile(candidatePath, 'utf8') };

let seed = 20261016;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const signed = () => (random() < 0.5 ? -1 : 1);
const logUniform = (low, high) => signed() * 2 ** (low + (high - low) * random());
const toPair = (data, index, value) => { const hi = Math.fround(value); data[2 * index] = hi; data[2 * index + 1] = Math.fround(value - hi); return hi + Math.fround(value - hi); };

const cases = [];
for (const profile of ['model', 'wide', 'cancel']) for (const tokens of [1, 3, 16]) {
  cases.push({ name: `${profile}-model-geometry-tokens${tokens}`, profile, tokens, kHeads: 16, vHeads: 16, kDim: 128, vDim: 128 });
}
cases.push({ name: 'model-gqa-qrep2-tokens3', profile: 'model', tokens: 3, kHeads: 4, vHeads: 8, kDim: 128, vDim: 128 });
cases.push({ name: 'model-partial-100x72-tokens3', profile: 'model', tokens: 3, kHeads: 2, vHeads: 2, kDim: 100, vDim: 72 });
cases.push({ name: 'cancel-partial-100x72-tokens16', profile: 'cancel', tokens: 16, kHeads: 2, vHeads: 2, kDim: 100, vDim: 72 });

function makeCase(spec) {
  const { tokens, kHeads, vHeads, kDim, vDim, profile } = spec;
  const qSize = kHeads * kDim, kSize = qSize, valueDim = vHeads * vDim, convDim = qSize + kSize + valueDim;
  const conv = new Float32Array(tokens * convDim * 2), conv64 = new Float64Array(tokens * convDim);
  const gates = new Float32Array(tokens * vHeads * 3 * 2), beta64 = new Float64Array(tokens * vHeads), decay64 = new Float64Array(tokens * vHeads);
  const state = new Float32Array(vHeads * kDim * vDim * 2), state64 = new Float64Array(vHeads * kDim * vDim);
  const epsilon = () => 1 + 2 ** -20 * random();
  for (let t = 0; t < tokens; t++) {
    for (let h = 0; h < kHeads; h++) {
      const q = [], k = [];
      for (let i = 0; i < kDim; i++) {
        if (profile === 'wide') { q.push(logUniform(-24, 4)); k.push(logUniform(-24, 4)); }
        else if (profile === 'cancel') {
          if (i % 2 === 0 || i === kDim - 1) { q.push(logUniform(-4, 0)); k.push(logUniform(-4, 0)); }
          else { q.push(-q[i - 1] * epsilon()); k.push(-k[i - 1] * epsilon()); }
        } else { q.push(random() * 2 - 1); k.push(random() * 2 - 1); }
      }
      if (profile === 'model') {
        const qn = Math.hypot(...q), kn = Math.hypot(...k);
        for (let i = 0; i < kDim; i++) { q[i] = q[i] / qn / Math.sqrt(kDim); k[i] = k[i] / kn; }
      }
      for (let i = 0; i < kDim; i++) {
        conv64[t * convDim + h * kDim + i] = toPair(conv, t * convDim + h * kDim + i, q[i]);
        conv64[t * convDim + qSize + h * kDim + i] = toPair(conv, t * convDim + qSize + h * kDim + i, k[i]);
      }
    }
    for (let i = 0; i < valueDim; i++) {
      const v = profile === 'wide' ? logUniform(-24, 4) : random() * 2 - 1;
      conv64[t * convDim + qSize + kSize + i] = toPair(conv, t * convDim + qSize + kSize + i, v);
    }
    for (let h = 0; h < vHeads; h++) {
      const ab = t * vHeads + h;
      beta64[ab] = toPair(gates, ab * 2, 0.05 + 0.9 * random());
      decay64[ab] = toPair(gates, ab * 2 + 1, profile === 'wide' ? 2 ** (-8 * random()) : 0.85 + 0.1499 * random());
    }
  }
  for (let h = 0; h < vHeads; h++) for (let k = 0; k < kDim; k++) for (let v = 0; v < vDim; v++) {
    const index = (h * kDim + k) * vDim + v;
    let value;
    if (profile === 'wide') value = logUniform(-24, 4);
    else if (profile === 'cancel' && k % 2 === 1 && k !== kDim - 1) value = state64[index - vDim];
    else value = random() * 2 - 1;
    state64[index] = toPair(state, index, value);
  }
  // F64 reference.
  const S = Float64Array.from(state64), out = new Float64Array(tokens * valueDim), qRep = vHeads / kHeads;
  for (let t = 0; t < tokens; t++) for (let h = 0; h < vHeads; h++) {
    const src = Math.floor(h / qRep), ab = t * vHeads + h;
    const qb = t * convDim + src * kDim, kb = t * convDim + qSize + src * kDim, vb = t * convDim + qSize + kSize + h * vDim;
    for (let v = 0; v < vDim; v++) {
      let prediction = 0;
      for (let k = 0; k < kDim; k++) { const i = (h * kDim + k) * vDim + v; S[i] *= decay64[ab]; prediction += S[i] * conv64[kb + k]; }
      const delta = (conv64[vb + v] - prediction) * beta64[ab];
      let raw = 0;
      for (let k = 0; k < kDim; k++) { const i = (h * kDim + k) * vDim + v; S[i] += conv64[kb + k] * delta; raw += S[i] * conv64[qb + k]; }
      out[t * valueDim + h * vDim + v] = raw;
    }
  }
  const uniform = new ArrayBuffer(80), view = new DataView(uniform);
  [tokens, convDim, 4, vHeads, kHeads, kDim, vDim, qSize, kSize, valueDim, qRep, 0].forEach((n, i) => view.setUint32(i * 4, n, true));
  view.setFloat32(48, Math.fround(1e-6), true); view.setFloat32(52, 1e-6 - Math.fround(1e-6), true);
  view.setFloat32(56, Math.fround(1e-6), true); view.setFloat32(60, 1e-6 - Math.fround(1e-6), true);
  return { conv, gates, state, uniform: new Uint8Array(uniform), expectedOut: out, expectedState: S, valueDim };
}

const result = { schema: 'reploid.paired-state-kernel-check/v1', startedAt: new Date().toISOString(),
  sources: { shipped: { path: shippedPath, sha256: sha256(sources.shipped) }, candidate: { path: candidatePath, sha256: sha256(sources.candidate) } },
  candidateConstants, repeats, cases: [], errors: [] };
const measure = (actual, expected) => {
  let maxRelative = 0, maxMagnitudeRelative = 0, finite = true;
  for (let i = 0; i < expected.length; i++) {
    const value = actual[2 * i] + actual[2 * i + 1];
    if (!Number.isFinite(value)) { finite = false; continue; }
    const error = Math.abs(value - expected[i]);
    maxRelative = Math.max(maxRelative, error / Math.max(1, Math.abs(expected[i])));
    maxMagnitudeRelative = Math.max(maxMagnitudeRelative, error / Math.max(2 ** -40, Math.abs(expected[i])));
  }
  return { maxRelativeErrorVsF64: maxRelative, maxMagnitudeRelativeErrorVsF64: maxMagnitudeRelative, finite };
};
const compare = (a, b) => {
  let maxRelativeDifference = 0, maxMagnitudeRelativeDifference = 0, identical = 0;
  for (let i = 0; i < a.length / 2; i++) {
    if (a[2 * i] === b[2 * i] && a[2 * i + 1] === b[2 * i + 1]) identical++;
    const x = a[2 * i] + a[2 * i + 1], difference = Math.abs(x - (b[2 * i] + b[2 * i + 1]));
    maxRelativeDifference = Math.max(maxRelativeDifference, difference / Math.max(1, Math.abs(x)));
    maxMagnitudeRelativeDifference = Math.max(maxMagnitudeRelativeDifference, difference / Math.max(2 ** -40, Math.abs(x)));
  }
  return { maxRelativeDifference, maxMagnitudeRelativeDifference, bitIdentical: identical, count: a.length / 2 };
};
try {
  const gpu = globalThis.dawnInstance = create([]);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info?.isFallbackAdapter) throw new Error('Physical adapter required.');
  result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
  const device = await adapter.requestDevice();
  device.addEventListener?.('uncapturederror', event => result.errors.push(event.error.message));
  const layout = device.createBindGroupLayout({ entries: ['uniform', 'read-only-storage', 'read-only-storage', 'storage', 'storage']
    .map((type, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } })) });
  const pipelines = {};
  for (const [name, code] of Object.entries(sources)) {
    const module = device.createShaderModule({ code });
    const bad = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error');
    if (bad.length) throw new Error(name + ': ' + bad.map(row => row.message).join('\n'));
    const started = performance.now();
    pipelines[name] = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'main', constants: name === 'candidate' ? candidateConstants : { WORKGROUP_SIZE: 128 } } });
    result[`compileMs_${name}`] = performance.now() - started;
  }
  const upload = (data, usage) => { const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }); device.queue.writeBuffer(b, 0, data); return b; };
  const read = async (source, bytes) => {
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, staging, 0, bytes); device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap(); staging.destroy();
    return data;
  };
  for (const spec of cases) {
    const fixture = makeCase(spec);
    const uniforms = upload(fixture.uniform, GPUBufferUsage.UNIFORM), conv = upload(fixture.conv, GPUBufferUsage.STORAGE), gates = upload(fixture.gates, GPUBufferUsage.STORAGE);
    const row = { ...spec, kernels: {} }, outputs = {};
    for (const [name, pipeline] of Object.entries(pipelines)) {
      const state = upload(fixture.state, GPUBufferUsage.STORAGE);
      const output = device.createBuffer({ size: spec.tokens * fixture.valueDim * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const group = device.createBindGroup({ layout, entries: [uniforms, conv, gates, state, output].map((b, binding) => ({ binding, resource: { buffer: b } })) });
      const grid = name === 'candidate' ? [spec.vHeads, Math.ceil(spec.vDim / columnsPerGroup), 1] : [spec.vHeads, 1, 1];
      const once = async () => {
        device.queue.writeBuffer(state, 0, fixture.state);
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(...grid); pass.end();
        const startedAt = performance.now(); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        return performance.now() - startedAt;
      };
      const samples = [];
      for (let i = 0; i < repeats; i++) samples.push(await once());
      samples.sort((a, b) => a - b);
      outputs[name] = { out: await read(output, spec.tokens * fixture.valueDim * 8), state: await read(state, fixture.state.byteLength) };
      row.kernels[name] = { output: measure(outputs[name].out, fixture.expectedOut), state: measure(outputs[name].state, fixture.expectedState),
        medianMs: samples[Math.floor(samples.length / 2)], minMs: samples[0], maxMs: samples.at(-1) };
      state.destroy(); output.destroy();
    }
    row.shippedVsCandidate = { output: compare(outputs.shipped.out, outputs.candidate.out), state: compare(outputs.shipped.state, outputs.candidate.state) };
    row.errorsSoFar = result.errors.length;
    result.cases.push(row);
    console.log(JSON.stringify({ case: spec.name, shipped: row.kernels.shipped, candidate: row.kernels.candidate, diff: row.shippedVsCandidate }));
    uniforms.destroy(); conv.destroy(); gates.destroy();
  }
  await device.queue.onSubmittedWorkDone(); device.destroy();
} catch (error) { result.failure = error.stack; throw error; }
finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(destination, JSON.stringify(result, null, 1) + '\n', { flag: 'wx' });
}
process.exit(0);
