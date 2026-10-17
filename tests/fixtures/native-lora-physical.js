import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createNativeWholeModel } from '../../server/native-whole-model.js';
import { createWorkAdapterResolver } from '../../self/providers/work-adapter.js';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';
const engine = process.env.DOPPLER_SOURCE_URL;
assert(engine, 'DOPPLER_SOURCE_URL must identify the tested Doppler checkout URL');
const { probeNodeGPU } = await import(new URL('tests/helpers/gpu-probe.js', engine));
const { destroyDevice } = await import(new URL('src/gpu/device.js', engine));
const { releaseNodeWebGPU } = await import(new URL('src/tooling/node-webgpu.js', engine));
const doppler = await import(new URL('src/index.js', engine));
const model = JSON.parse(await fs.readFile('self/config/chat-models.json'))[0];
model.adapters = [model.availableAdapters[0]];
model.generation = { maxTokens: 8, temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1, repetitionPenaltyWindow: 1, maxSeqLen: 512, useChatTemplate: true };
model.loadOptions = { runtimeConfig: { inference: { session: { kvcache: { maxSeqLen: 512 } } } } };
const service = createReploidDopplerRuntimeService({ loadModule: async () => doppler, expectedVersion: doppler.DOPPLER_VERSION });
const provider = createNativeWholeModel({ model, modelDirectory: process.env.LORA_MODEL_DIR, service,
  nativeGpu: async () => assert.equal((await probeNodeGPU({ installFileFetchShim: true })).ready, true),
  resolveAdapter: createWorkAdapterResolver({ models: [model], acquire: async () => fs.readFile(process.env.LORA_ADAPTER_FILE) }) });
const report = { schema: 'reploid.native-lora-lifecycle/v1', modelIdentity: model.identity, adapterIdentity: model.adapters[0].identity, checks: [] };
const prompt = [{ role: 'user', content: 'Extract people and places: Maya lives in Paris. Return JSON.' }];
const run = (ids, signal = new AbortController().signal) => provider.generate(prompt, () => {}, { adapterIdentities: ids, signal, maxOutputTokens: 8 });
try {
  await provider.contribute(true);
  assert.deepEqual(provider.getState().adapterIdentities, [model.adapters[0].identity]);
  report.checks.push('prepared-adapter');
  const base = await run([]), adapted = await run([model.adapters[0].identity]), repeatedBase = await run([]);
  assert.equal(repeatedBase.content, base.content);
  report.checks.push('base-adapter-base-isolation');
  const [a, b] = await Promise.all([run([model.adapters[0].identity]), run([])]);
  assert.equal(a.content, adapted.content); assert.equal(b.content, base.content);
  report.checks.push('concurrent-caller-isolation');
  const abort = new AbortController(); abort.abort(new Error('test cancellation'));
  await assert.rejects(run([model.adapters[0].identity], abort.signal), /test cancellation/);
  assert.equal((await run([model.adapters[0].identity])).content, adapted.content);
  report.checks.push('cancel-and-reuse');
  report.base = base; report.adapted = adapted;
} finally { await provider.close(); await service.closeAll(); destroyDevice(); releaseNodeWebGPU(); }
report.checks.push('closed');
console.log('LORA_SERVICE_RESULT=' + JSON.stringify(report));
