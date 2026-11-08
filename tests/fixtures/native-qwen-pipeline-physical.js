import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openNativeModelSource } from '../../server/native-participant.js';
import { createNativeWholeModel } from '../../server/native-whole-model.js';
import { createReploidDopplerRuntimeService } from '../../shared/infrastructure/doppler-runtime-service.js';

// Explicit offline composition check. No signaling, participant service or billing.
const [modelId, directory, profile, output] = process.argv.slice(2);
const engine = process.env.DOPPLER_SOURCE_URL;
assert(engine && process.env.REPLOID_QWEN_PHYSICAL === '1', 'Explicit physical test inputs required');
const runtime = await import(new URL('src/index.js', engine));
const { installNodeFileFetchShim } = await import(new URL('src/tooling/node-file-fetch.js', engine));
const { bootstrapNodeWebGPU, releaseNodeWebGPU } = await import(new URL('src/tooling/node-webgpu.js', engine));
const { destroyDevice } = await import(new URL('src/gpu/device.js', engine));
const { loadRuntimeProfile } = await import(new URL('src/tooling/browser-harness/runtime-config.js', engine));
installNodeFileFetchShim();
const catalog = JSON.parse(await fs.readFile(new URL('../../shared/config/chat-models.json', import.meta.url)));
const model = structuredClone(catalog.find(m => m.id === modelId));
assert(model, 'The exact model must exist in Reploid');
const bytes = await fs.readFile(directory + '/manifest.json');
const catalogIdentity = model.identity;
model.identity = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
if (process.env.REPLOID_EXPECT_CATALOG_IDENTITY === '1') assert.equal(model.identity, catalogIdentity, 'Exact public catalog artifact required');
model.adapters = []; model.availableAdapters = [];
model.generation = { maxTokens: 4, temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1, repetitionPenaltyWindow: 1, maxSeqLen: 512, useChatTemplate: true };
if (profile !== 'catalog') model.loadOptions = { runtimeConfig: (await loadRuntimeProfile(profile, { baseUrl: new URL('src/config/runtime/', engine).href })).runtime };
if (model.loadOptions?.runtimeConfig?.shared?.bufferPool?.budget) {
  model.loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes = Math.min(model.loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes, 25769803776);
}
const service = createReploidDopplerRuntimeService({ loadModule: async () => runtime, expectedVersion: runtime.DOPPLER_VERSION });
const provider = createNativeWholeModel({ model, modelDirectory: directory, service,
  nativeGpu: async () => assert.equal((await bootstrapNodeWebGPU()).ok, true) });
const report = { schema: 'reploid.qwen-native-composition/v1', modelId, modelIdentity: model.identity,
  profile, catalogIdentity, catalogIdentityMatched: model.identity === catalogIdentity, scope: 'Controlled offline native provider on a supplied exact artifact; no network/public-provider qualification', passed: false };
const messages = [{ role: 'user', content: 'Say hello in one word.' }];
const run = signal => provider.generate(messages, () => {}, { adapterIdentities: [], signal: signal ?? new AbortController().signal, maxOutputTokens: 4 });
try {
  if (process.env.REPLOID_EXPECT_CATALOG_IDENTITY === '1') {
    const partitions = await import(new URL('src/partitions.js', engine));
    const source = await openNativeModelSource({ model, modelDirectory: directory,
      runtime: partitions, signal: new AbortController().signal });
    try {
      await source.storage.preflight?.();
      const piece = await source.storage.loadShardRange(0, 0, 16);
      assert.equal(piece.byteLength, 16);
      report.nativeAcquisition = source.getReceipt();
    } finally { await source.storage.close(); }
  }
  await provider.contribute(true);
  const first = await run(), second = await run();
  assert.equal(first.content, second.content); assert(first.content.trim());
  const abort = new AbortController(); abort.abort(new Error('controlled cancellation'));
  await assert.rejects(run(abort.signal), /controlled cancellation/);
  const reused = await run(); assert.equal(reused.content, first.content);
  const active = new AbortController();
  await assert.rejects(provider.generate(messages, () => active.abort(new Error('controlled active cancellation')),
    { adapterIdentities: [], signal: active.signal, maxOutputTokens: 4 }), /controlled active cancellation/);
  const afterActive = await run(); assert.equal(afterActive.content, first.content);
  report.first = first; report.reused = reused; report.afterActive = afterActive;
  report.checks = ['exact-artifact-preparation', 'generation', 'resident-reuse', 'pre-aborted-request', 'reuse-after-cancellation', 'active-cancellation', 'reuse-after-active-cancellation'];
  report.passed = true;
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  try { await provider.close(); await service.closeAll(); destroyDevice(); await releaseNodeWebGPU(); }
  catch (error) { report.cleanupFailure = String(error); process.exitCode = 1; }
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ modelId, passed: report.passed, failure: report.failure }));
}
