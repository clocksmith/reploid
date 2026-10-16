// Observe the existing partition executor at the first cross-device boundary.
// Internal diagnostic imports are explicit; this is not a public API test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [configPath, inputPath, output] = process.argv.slice(2);
const configBytes = await fs.readFile(configPath), config = JSON.parse(configBytes);
const inputBytes = await fs.readFile(inputPath), input = JSON.parse(inputBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output);
const mod = file => import(pathToFileURL(path.join(config.installedPackage, 'src', file)).href);
const { bootstrapNodeWebGPU, releaseNodeWebGPU } = await mod('tooling/node-webgpu.js');
const { installNodeFileFetchShim } = await mod('tooling/node-file-fetch.js');
const { getDevice, destroyDevice } = await mod('gpu/device.js');
const { getBufferPool, destroyBufferPool } = await mod('memory/buffer-pool.js');
const { createPipeline } = await mod('inference/pipelines/text.js');
const { runPipelineOperation } = await mod('inference/pipelines/shader-scoped-pipeline.js');
const { createPartitionAttempt } = await mod('inference/pipelines/text/partition-attempt.js');
const { executePartitionLayers } = await mod('inference/pipelines/text/partition-execution.js');
const { drainPendingTsirReads } = await mod('inference/pipelines/text/tsir-fixture-writer.js');
const { createNodeFileArtifactStorageContext, createHttpArtifactStorageContext } = await mod('storage/artifact-storage-context.js');
const runtime = await mod('partitions.js');
const manifestBytes = await fs.readFile(config.manifestPath);
assert.equal(sha(manifestBytes), config.manifestSha256);
const manifest = JSON.parse(manifestBytes);
const plan = runtime.createOrderedLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
  splitLayers: [1], activationDtype: 'f32' });
const report = { schema: 'reploid.partition-boundary-trace/v1', configSha256: sha(configBytes),
  inputSha256: sha(inputBytes), manifestSha256: sha(manifestBytes), steps: [], passed: false };
let pipeline, attempt;
try {
  if (process.platform === 'linux') {
    const available = Number((await fs.readFile('/proc/meminfo', 'utf8')).match(/^MemAvailable:\s+(\d+)/m)[1]) * 1024;
    const base = '/sys/class/drm/card1/device/';
    const headroom = Number(await fs.readFile(base + 'mem_info_gtt_total')) - Number(await fs.readFile(base + 'mem_info_gtt_used'));
    assert(available >= config.minHostAvailableBytes && headroom >= config.minGpuAvailableBytes);
  }
  report.provider = await bootstrapNodeWebGPU(); assert(report.provider.ok);
  installNodeFileFetchShim();
  await runtime.configureDeviceMemoryBudget({ maxBytes: config.runtimeConfig.shared.bufferPool.budget.maxTotalBytes });
  const storage = config.modelUrl.startsWith('file:')
    ? createNodeFileArtifactStorageContext(config.modelUrl, manifest, { verifyHashes: true })
    : createHttpArtifactStorageContext(config.modelUrl, manifest, { verifyHashes: true });
  pipeline = await createPipeline(manifest, { runtimeConfig: config.runtimeConfig, storage, partition: { plan, index: 0 } });
  await runPipelineOperation(pipeline, async owner => {
    attempt = createPartitionAttempt(owner, 128);
    for (const [step, ids] of input.steps.entries()) {
      const state = attempt.state;
      const tsirFixture = { dir: path.resolve(output, 'step-' + step), layerFilter: [0], prefillOnly: false };
      state.operatorDiagnostics = { enabled: false, tsirFixture };
      const result = await executePartitionLayers(state, { tokenIds: ids, numTokens: ids.length }, AbortSignal.timeout(config.stepTimeoutMs));
      await drainPendingTsirReads(tsirFixture);
      assert(result.activationBytes);
      await fs.writeFile(path.join(output, `step-${step}.f32`), Buffer.from(result.activationBytes));
      report.steps.push({ step, ids, outputSha256: sha(Buffer.from(result.activationBytes)),
        trace: tsirFixture.records ?? [], timing: result.timing });
      state.currentSeqLen += ids.length; state.decodeStepCount++;
    }
  });
  report.passed = true;
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  try {
    attempt?.close(); await pipeline?.unload();
    if (getDevice()) await getDevice().queue.onSubmittedWorkDone();
    report.cleanup = getBufferPool().getStats();
    assert.equal(report.cleanup.resources.active.bytes, 0);
    assert.equal(report.cleanup.resources.retainedModel.bytes, 0);
    assert.equal(report.cleanup.resources.deferredCleanup.bytes, 0);
    destroyBufferPool(); destroyDevice(); await releaseNodeWebGPU();
  } catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, error: report.error?.message, cleanupError: report.cleanupError }));
}
