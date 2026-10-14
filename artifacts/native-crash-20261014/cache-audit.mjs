// Shader-cache audit: open the three paired resident stages the natives serve, with Doppler's
// pipeline preparation (every pipeline a stage can request is created before readiness), against
// whatever Mesa cache MESA_SHADER_CACHE_DIR names. No token is executed. Each stage prints a line
// before opening, so a crash during preparation is attributable to a stage.
//
// Usage: node cache-audit.mjs <doppler package root> <model dir> <installed catalog>
//          <partition policy> <out.json>
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, modelDir, catalogPath, policyPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('Usage: cache-audit.mjs PACKAGE MODEL CATALOG POLICY OUT');
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim },
  { initDevice, destroyDevice, getKernelCapabilities }, { createPipeline },
  { createNodeFileArtifactStorageContext }, { createModelHandle }, { createCapsuleProgramAdapter },
  { createResidentPartitionSession }, { resolveResidentPartitionAllocation },
  { hashLayerPartitionPlan }, { resolveGenerationOptions }, { createDopplerLoader }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'),
  mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'),
  mod('client/model-host/model-session.js'), mod('client/runtime/capsule-program-adapter.js'),
  mod('inference/pipelines/text/resident-partition.js'),
  mod('inference/pipelines/text/resident-partition-contract.js'),
  mod('inference/pipelines/text/layer-partition-contract.js'), mod('config/generation-contract.js'),
  mod('loader/doppler-loader.js'),
]);

const catalog = (await readJson(catalogPath)).find(entry => entry.id === 'qwen-3-5-0-8b-q4k-ehaf16');
const capsule = catalog.capsule, targetPlan = capsule.targetPlans[0];
const policy = await readJson(policyPath);
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestIdentity = 'sha256:' + sha256(manifestBytes);
if (manifestIdentity !== catalog.identity) throw new Error('Manifest identity differs from catalog identity.');
const plan = structuredClone(catalog.partitionPlan), planId = hashLayerPartitionPlan(plan);
const generation = resolveGenerationOptions(catalog.generation);
const runtimeConfig = targetPlan.initialExecutionIdentity.programLoadPolicy.runtimeConfig;
const report = { schema: 'reploid.shader-cache-audit/v1', startedAt: new Date().toISOString(), machine: 'intel-host',
  mesaShaderCacheDir: process.env.MESA_SHADER_CACHE_DIR ?? null, manifestIdentity, planId, stages: [] };

const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
report.gpu = getKernelCapabilities().adapterInfo ?? null;
try {
  for (const partition of plan.partitions) {
    console.log(JSON.stringify({ event: 'stage-opening', index: partition.index, at: new Date().toISOString() }));
    const started = performance.now();
    const storage = createNodeFileArtifactStorageContext(pathToFileURL(modelDir + path.sep).href, manifest);
    const pipeline = await createPipeline(manifest, { partition: { plan, index: partition.index }, storage,
      runtimeConfig: structuredClone(runtimeConfig), loader: createDopplerLoader(runtimeConfig.loading), ownsLoader: true });
    const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: manifestIdentity.slice(7) });
    const program = createCapsuleProgramAdapter(handle, capsule, targetPlan);
    const allocation = resolveResidentPartitionAllocation(manifest, manifestIdentity, { model: { id: manifest.modelId,
      identity: manifestIdentity }, plan, planId, index: partition.index, participantId: 'peer:intel-host-cache-audit-' + partition.index,
      limits: structuredClone(policy.limits), generation });
    const resident = await createResidentPartitionSession(pipeline, allocation, program, () => handle.unload(), new AbortController().signal);
    const preparation = resident.getDescriptor?.()?.pipelinePreparation ?? null;
    report.stages.push({ index: partition.index, openMs: performance.now() - started,
      prepared: preparation?.count ?? null, preparationMs: preparation?.durationMs ?? null, lazy: preparation?.lazy ?? null,
      pipelines: (preparation?.pipelines ?? []).map(row => row.key ?? row) });
    console.log(JSON.stringify({ event: 'stage-ready', index: partition.index, prepared: preparation?.count ?? null,
      preparationMs: preparation?.durationMs ?? null }));
    await resident.close();
  }
  report.completed = true;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(outPath, JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
