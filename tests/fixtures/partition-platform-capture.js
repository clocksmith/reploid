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
  : new URL('./', import.meta.resolve('doppler-gpu/partitions'));
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
let pipeline;
try {
  const bootstrap = await bootstrapNodeWebGPU(); assert(bootstrap.ok, bootstrap.detail);
  installNodeFileFetchShim(); await initDevice();
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
  await writeFile(output, JSON.stringify({ schema: 'reploid.partition-platform-diagnostic/v1',
    packageVersion: JSON.parse(await readFile(new URL('../package.json', base), 'utf8')).version,
    source: process.env.DOPPLER_CAPTURE_SOURCE_DIR ? 'explicit-diagnostic-source' : 'installed-package',
    linearAttentionSourceHash: createHash('sha256').update(await readFile(
      new URL('inference/pipelines/text/linear-attention.js', base))).digest('hex'),
    modelIdentity, generation: reference.generation, prompt: reference.prompts[0],
    provider: bootstrap.receipt, device: getDevice().adapterInfo ?? null, text, logits,
    diagnostics: pipeline.getStats().operatorDiagnostics }));
  console.log(JSON.stringify({ output, text, records: pipeline.getStats().operatorDiagnostics?.recordCount }));
} finally { await pipeline?.unload(); destroyDevice(); await releaseNodeWebGPU(); }
