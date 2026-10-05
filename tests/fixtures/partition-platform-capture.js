/** Diagnostic only: compares platform computation using the installed package.
 * Local bytes and internal probes are not evidence of peer acquisition. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const directory = process.env.DOPPLER_CHAT_MODEL_DIR;
const output = process.env.REPLOID_CAPTURE_OUT;
assert(directory && output, 'DOPPLER_CHAT_MODEL_DIR and REPLOID_CAPTURE_OUT are required');
const base = process.env.DOPPLER_CAPTURE_SOURCE_DIR
  ? pathToFileURL(resolve(process.env.DOPPLER_CAPTURE_SOURCE_DIR) + '/')
  : new URL('./', import.meta.resolve('doppler-gpu'));
const load = file => import(new URL(file, base));
const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { initDevice, destroyDevice, getDevice },
  { createPipeline }, { createNodeFileArtifactStorageContext }, { installNodeFileFetchShim }] = await Promise.all([
  load('tooling/node-webgpu.js'), load('gpu/device.js'), load('inference/pipelines/text.js'),
  load('storage/artifact-storage-context.js'), load('tooling/node-file-fetch.js')
]);
const reference = JSON.parse(await readFile(process.env.DOPPLER_PARTITION_REFERENCE_OUT, 'utf8'));
const bytes = await readFile(resolve(directory, 'manifest.json'));
const modelIdentity = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
assert.equal(modelIdentity, reference.modelIdentity);
const manifest = JSON.parse(bytes);
const interventionPath = process.env.DOPPLER_CAPTURE_PIPELINE_INTERVENTION;
const intervention = interventionPath ? JSON.parse(await readFile(interventionPath, 'utf8')) : null;
if (intervention) {
  assert.equal(process.env.DOPPLER_TEST_ONLY_ARITHMETIC, '1', 'Pipeline substitutions are test-only');
  assert.match(intervention.shaderSha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof intervention.fromEntryPoint, 'string');
  assert.equal(typeof intervention.toEntryPoint, 'string');
}
const substitutions = [];
let pipeline;
let restoreObservation;
try {
  const bootstrap = await bootstrapNodeWebGPU(); assert(bootstrap.ok, bootstrap.detail);
  installNodeFileFetchShim(); await initDevice();
  const device = getDevice();
  const shaders = new WeakMap();
  const shaderCreations = [];
  const pipelineCreations = [];
  const originalShader = device.createShaderModule;
  const originalPipeline = device.createComputePipeline;
  const originalAsyncPipeline = device.createComputePipelineAsync;
  const describePipeline = descriptor => ({
    label: descriptor.label ?? null,
    shader: shaders.get(descriptor.compute.module) ?? null,
    entryPoint: descriptor.compute.entryPoint ?? null,
    constants: { ...descriptor.compute.constants },
  });
  const substitutePipeline = descriptor => {
    const observed = describePipeline(descriptor);
    if (!intervention || observed.shader?.sha256 !== intervention.shaderSha256
      || observed.entryPoint !== intervention.fromEntryPoint) return descriptor;
    substitutions.push({ ...observed, replacementEntryPoint: intervention.toEntryPoint });
    return { ...descriptor, compute: { ...descriptor.compute, entryPoint: intervention.toEntryPoint } };
  };
  device.createShaderModule = function (descriptor) {
    const module = originalShader.call(this, descriptor);
    const shader = { label: descriptor.label ?? null,
      sha256: createHash('sha256').update(descriptor.code).digest('hex') };
    shaders.set(module, shader);
    shaderCreations.push(shader);
    return module;
  };
  device.createComputePipeline = function (descriptor) {
    const selected = substitutePipeline(descriptor);
    pipelineCreations.push(describePipeline(selected));
    return originalPipeline.call(this, selected);
  };
  device.createComputePipelineAsync = function (descriptor) {
    const selected = substitutePipeline(descriptor);
    pipelineCreations.push(describePipeline(selected));
    return originalAsyncPipeline.call(this, selected);
  };
  restoreObservation = () => {
    device.createShaderModule = originalShader;
    device.createComputePipeline = originalPipeline;
    device.createComputePipelineAsync = originalAsyncPipeline;
  };
  pipeline = await createPipeline(manifest, {
    runtimeConfig: { inference: { session: { kvcache: { maxSeqLen: reference.generation.maxSeqLen } } } },
    storage: createNodeFileArtifactStorageContext(pathToFileURL(resolve(directory)).href, manifest)
  });
  const logits = [];
  let text = '';
  for await (const delta of pipeline.generate(reference.prompts[0], { ...reference.generation,
    diagnostics: { enabled: true, captureConfig: { enabled: true, defaultLevel: 'slice',
      targetLayers: [0], targetOpIds: ['embed.out'], targetLevel: 'full' } },
    onLogits: values => logits.push(Array.from(values)) })) text += delta;
  if (intervention) assert(substitutions.length > 0, 'Requested entry-point substitution must execute');
  await writeFile(output, JSON.stringify({ schema: 'reploid.partition-platform-diagnostic/v1',
    packageVersion: JSON.parse(await readFile(new URL('../package.json', base), 'utf8')).version,
    source: process.env.DOPPLER_CAPTURE_SOURCE_DIR ? 'explicit-diagnostic-source' : 'installed-package',
    linearAttentionSourceHash: createHash('sha256').update(await readFile(
      new URL('inference/pipelines/text/linear-attention.js', base))).digest('hex'),
    shaderCreations, pipelineCreations, intervention, substitutions,
    modelIdentity, generation: reference.generation, prompt: reference.prompts[0],
    provider: bootstrap.receipt, device: getDevice().adapterInfo ?? null, text, logits,
    diagnostics: pipeline.getStats().operatorDiagnostics }));
  console.log(JSON.stringify({ output, text, records: pipeline.getStats().operatorDiagnostics?.recordCount }));
} finally {
  restoreObservation?.();
  await pipeline?.unload(); destroyDevice(); await releaseNodeWebGPU();
}
