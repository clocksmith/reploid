// Kernel-level check of a replacement paired gated-delta Q/K normalization phase against the
// shipped one and an independent F64 evaluation, on identical inputs, through Node/Dawn.
//
// Both shaders run unmodified with the bindings of gated_delta_recurrent/paired_qk (uniforms and
// the owned paired convolution buffer, normalized in place) and the shared 80-byte gated-delta
// uniform layout; one workgroup per key head. The shipped program runs with WORKGROUP_SIZE 128,
// the candidate with its declared constants. F64 reference: q / |q| / sqrt(head_k_dim) and
// k / |k|, with |x| = sqrt(sum x^2 + eps). Profiles: model (uniform values), wide
// (log-uniform 2^-30..2^6) and cancel (tiny norms: values near 2^-12, so eps dominates).
//
// Usage: node qk-kernel-check.mjs <webgpu module dir> <shipped.wgsl> <candidate.wgsl>
//          <candidate constants JSON> <out.json> [repeats]
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const [moduleDir, shippedPath, candidatePath, candidateConstantsArg, destination, repeatsArg] = process.argv.slice(2);
if (!destination) throw new Error('Usage: qk-kernel-check.mjs WEBGPU SHIPPED CANDIDATE CONSTANTS OUT [REPEATS]');
const candidateConstants = JSON.parse(candidateConstantsArg);
const repeats = Number(repeatsArg ?? 5);
const { create, globals } = createRequire(import.meta.url)(moduleDir);
Object.assign(globalThis, globals);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = { shipped: await readFile(shippedPath, 'utf8'), candidate: await readFile(candidatePath, 'utf8') };
let seed = 20261018;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const signed = () => (random() < 0.5 ? -1 : 1);
const EPS = 1e-6;

const cases = [];
for (const profile of ['model', 'wide', 'cancel']) for (const tokens of [1, 16]) cases.push({ profile, tokens, kHeads: 16, vHeads: 16, kDim: 128, vDim: 128 });
cases.push({ profile: 'model', tokens: 3, kHeads: 2, vHeads: 2, kDim: 100, vDim: 72 });

const result = { schema: 'reploid.paired-qk-kernel-check/v1', startedAt: new Date().toISOString(),
  sources: { shipped: { path: shippedPath, sha256: sha256(sources.shipped) }, candidate: { path: candidatePath, sha256: sha256(sources.candidate) } },
  candidateConstants, repeats, cases: [], errors: [] };
try {
  const gpu = globalThis.dawnInstance = create([]);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter || adapter.info?.isFallbackAdapter) throw new Error('Physical adapter required.');
  result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description };
  const device = await adapter.requestDevice();
  device.addEventListener?.('uncapturederror', event => result.errors.push(event.error.message));
  const layout = device.createBindGroupLayout({ entries: ['uniform', 'storage'].map((type, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } })) });
  const pipelines = {};
  for (const [name, code] of Object.entries(sources)) {
    const module = device.createShaderModule({ code });
    const bad = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error');
    if (bad.length) throw new Error(name + ': ' + bad.map(row => row.message).join('\n'));
    pipelines[name] = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'main', constants: name === 'candidate' ? candidateConstants : { WORKGROUP_SIZE: 128 } } });
  }
  for (const spec of cases) {
    const { tokens, kHeads, vHeads, kDim, vDim, profile } = spec;
    const qSize = kHeads * kDim, convDim = 2 * qSize + vHeads * vDim;
    const data = new Float32Array(tokens * convDim * 2), values = new Float64Array(tokens * convDim);
    for (let i = 0; i < values.length; i++) {
      const x = profile === 'wide' ? signed() * 2 ** (-30 + 36 * random()) : profile === 'cancel' ? signed() * 2 ** (-12 - random()) : random() * 2 - 1;
      const hi = Math.fround(x), lo = Math.fround(x - hi); data[2 * i] = hi; data[2 * i + 1] = lo; values[i] = hi + lo;
    }
    const expected = Float64Array.from(values);
    for (let t = 0; t < tokens; t++) for (let h = 0; h < kHeads; h++) for (const [base, extra] of [[t * convDim + h * kDim, 1 / Math.sqrt(kDim)], [t * convDim + qSize + h * kDim, 1]]) {
      let sum = 0; for (let i = 0; i < kDim; i++) sum += values[base + i] ** 2;
      const scale = extra / Math.sqrt(sum + EPS);
      for (let i = 0; i < kDim; i++) expected[base + i] = values[base + i] * scale;
    }
    const raw = new ArrayBuffer(80), view = new DataView(raw);
    [tokens, convDim, 4, vHeads, kHeads, kDim, vDim, qSize, qSize, vHeads * vDim, vHeads / kHeads, 0].forEach((n, i) => view.setUint32(i * 4, n, true));
    view.setFloat32(48, Math.fround(EPS), true); view.setFloat32(52, EPS - Math.fround(EPS), true);
    view.setFloat32(56, Math.fround(EPS), true); view.setFloat32(60, EPS - Math.fround(EPS), true);
    const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(uniforms, 0, raw);
    const row = { ...spec, kernels: {} }, outputs = {};
    for (const [name, pipeline] of Object.entries(pipelines)) {
      const conv = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      const group = device.createBindGroup({ layout, entries: [uniforms, conv].map((b, binding) => ({ binding, resource: { buffer: b } })) });
      const once = async () => {
        device.queue.writeBuffer(conv, 0, data);
        const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(kHeads); pass.end();
        const started = performance.now(); device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
        return performance.now() - started;
      };
      const samples = []; for (let i = 0; i < repeats; i++) samples.push(await once());
      samples.sort((a, b) => a - b);
      const staging = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(conv, 0, staging, 0, data.byteLength); device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(staging.getMappedRange().slice(0)); staging.unmap(); staging.destroy(); conv.destroy();
      outputs[name] = out;
      let maxRelative = 0;
      for (let i = 0; i < expected.length; i++) maxRelative = Math.max(maxRelative, Math.abs(out[2 * i] + out[2 * i + 1] - expected[i]) / Math.max(1, Math.abs(expected[i])));
      row.kernels[name] = { maxRelativeErrorVsF64: maxRelative, medianMs: samples[Math.floor(samples.length / 2)] };
    }
    let identical = 0;
    for (let i = 0; i < outputs.shipped.length; i++) if (outputs.shipped[i] === outputs.candidate[i]) identical++;
    row.shippedVsCandidate = { bitIdenticalWords: identical, words: outputs.shipped.length };
    result.cases.push(row);
    console.log(JSON.stringify({ case: `${profile} tokens${tokens} ${kHeads}x${kDim}`, shipped: row.kernels.shipped, candidate: row.kernels.candidate, diff: row.shippedVsCandidate }));
    uniforms.destroy();
  }
  await device.queue.onSubmittedWorkDone(); device.destroy();
} catch (error) { result.failure = error.stack; throw error; }
finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(destination, JSON.stringify(result, null, 1) + '\n', { flag: 'wx' });
}
process.exit(0);
