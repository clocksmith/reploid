// GPU buffer peak of a paired program through Doppler's buffer pool (the accounting the
// loader's memory monitor reports), against the 1,420,000,000-byte per-executor
// maxGpuBufferBytes of the installed partition policy. Whole model in one process on amd-host:
// load, the 184-token request-2 prompt plus 50 decode steps, then the 189-token answer-cause
// follow-up plus 16 decode steps (greedy). Records pool statistics after each phase, with the
// process VmHWM. Pool accounting covers buffers acquired through Doppler's pool, not driver-side
// allocations or pipeline objects.
//
// Usage: node memory-peak.mjs <doppler package root> <model dir> <approved-reference.json>
//          <distributed-observed.json> <config.json> <out.json>
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, modelDir, referencePath, observedPath, configPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('Usage: memory-peak.mjs PACKAGE MODEL REFERENCE OBSERVED CONFIG OUT');
const LIMIT = 1_420_000_000;
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim }, { initDevice, destroyDevice },
  { createPipeline }, { createNodeFileArtifactStorageContext }, { createModelHandle }, { formatChatMessages },
  { createDopplerLoader }, { getBufferPool }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'), mod('inference/pipelines/text.js'),
  mod('storage/artifact-storage-context.js'), mod('client/model-host/model-session.js'), mod('inference/pipelines/text/chat-format.js'),
  mod('loader/doppler-loader.js'), mod('memory/buffer-pool.js'),
]);
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const reference = JSON.parse(await fs.readFile(referencePath, 'utf8'));
const observed = JSON.parse(await fs.readFile(observedPath, 'utf8'));
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const hwm = async () => Number((await fs.readFile('/proc/self/status', 'utf8')).match(/^VmHWM:\s+(\d+) kB/m)[1]) * 1024;
const report = { schema: 'reploid.paired-memory-peak/v1', label: config.label, manifestIdentity: 'sha256:' + sha256(manifestBytes),
  limitBytes: LIMIT, phases: [] };
const record = async phase => {
  const stats = getBufferPool().getStats();
  report.phases.push({ phase, currentBytesAllocated: stats.currentBytesAllocated, peakBytesAllocated: stats.peakBytesAllocated,
    peakBytesRequested: stats.peakBytesRequested, activeBuffers: stats.activeBuffers, pooledBuffers: stats.pooledBuffers,
    processVmHWMBytes: await hwm() });
  console.log(JSON.stringify(report.phases.at(-1)));
};
const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
const storage = createNodeFileArtifactStorageContext(pathToFileURL(modelDir + path.sep).href, manifest);
const pipeline = await createPipeline(manifest, { storage, ownsLoader: true, runtimeConfig: structuredClone(config.runtimeConfig),
  loader: createDopplerLoader(config.runtimeConfig.loading) });
const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: report.manifestIdentity.slice(7) });
try {
  await record('loaded');
  const thinking = pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined;
  const tokenize = messages => handle.advanced.tokenizeText(formatChatMessages(messages, manifest.inference.chatTemplate.type, thinking));
  const argmax = values => { let best = 0; for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i; return best; };
  for (const [label, messages, steps] of [['request-2', reference.prompts[2], 50], ['answer-cause-follow-up', observed.runs['run-5'].turns[1].requestMessages, 16]]) {
    pipeline.reset();
    const ids = tokenize(messages), context = [...ids];
    let cache = null;
    try {
      const first = await pipeline.prefillWithLogits(messages, { inputIds: ids, useChatTemplate: false });
      cache = first.cache; context.push(argmax(first.logits));
      await record(`${label} prefill (${ids.length} tokens)`);
      for (let step = 0; step < steps; step++) context.push(argmax((await pipeline.decodeStepLogits(context, { useChatTemplate: false })).logits));
      await record(`${label} after ${steps} decode steps`);
    } finally { cache?.destroy?.(); }
  }
  const peak = Math.max(...report.phases.map(row => row.peakBytesAllocated));
  report.summary = { peakBytesAllocated: peak, limitBytes: LIMIT, withinLimit: peak <= LIMIT, headroomBytes: LIMIT - peak };
  console.log(JSON.stringify(report.summary));
} finally {
  await handle.unload();
  await fs.writeFile(outPath, JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
