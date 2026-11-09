// Opt-in real GPU check of Reploid's native provider and installed Doppler API.
// No signaling, public provider, adapter qualification, or throughput claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as webgpu from 'webgpu';
import * as runtime from 'doppler-gpu/compat';
import { getKernelCapabilities } from 'doppler-gpu/tooling/device';
import { createNativeGpuHost } from '../../server/native-participant.js';
import { createNativeWholeModel } from '../../server/native-whole-model.js';
import { createReploidDopplerRuntimeService } from '../../shared/infrastructure/doppler-runtime-service.js';

const [directory, output, profile = 'bounded'] = process.argv.slice(2);
assert(directory && output, 'Pass the local Qwen model directory and receipt path');
assert(['bounded', 'catalog'].includes(profile), 'Choose bounded or catalog load configuration');
assert.equal(process.env.REPLOID_CONTEXT_PHYSICAL, '1', 'Explicit physical test opt-in required');
assert(import.meta.resolve('doppler-gpu/compat').includes('/node_modules/doppler-gpu/'), 'Use installed package bytes');
const manifestBytes = await fs.readFile(directory + '/manifest.json'), manifest = JSON.parse(manifestBytes);
const packagePin = JSON.parse(await fs.readFile(new URL('../../shared/config/doppler-package.json', import.meta.url)));
const catalog = JSON.parse(await fs.readFile(new URL('../../shared/config/chat-models.json', import.meta.url)));
const catalogModel = catalog.find(row => row.id === manifest.modelId);
assert(profile !== 'catalog' || catalogModel, 'Catalog configuration requires a registered model');
const model = profile === 'catalog' ? structuredClone(catalogModel) : { id: manifest.modelId, provider: 'doppler',
  identity: 'sha256:' + createHash('sha256').update(manifestBytes).digest('hex'), adapters: [],
  loadOptions: { runtimeConfig: { inference: { session: { kvcache: { maxSeqLen: 256 } } } } },
  generation: { maxTokens: 4, temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1, useChatTemplate: true } };
const gpu = createNativeGpuHost(async () => webgpu);
const service = createReploidDopplerRuntimeService({ loadModule: async () => runtime, expectedVersion: packagePin.version });
const provider = createNativeWholeModel({ model, modelDirectory: directory, service, nativeGpu: () => gpu.open() });
const report = { schema: 'reploid.generation-context-installed/v1', passed: false,
  runtimeVersion: runtime.DOPPLER_VERSION, packageIntegrity: packagePin.integrity,
  modelIdentity: model.identity, modelId: model.id, node: process.version, platform: process.platform,
  configuration: { profile, loadOptions: model.loadOptions, generation: model.generation, maxOutputTokens: 4 },
  scope: 'Offline installed-package/native-provider development check; no public service or browser qualification', cases: [] };
const run = (messages, contextOwner, contextId, extra = {}) => provider.generate(messages, extra.onUpdate || (() => {}), {
  signal: extra.signal || new AbortController().signal, contextOwner, contextId, maxOutputTokens: 4 });
try {
  await provider.contribute(true);
  report.adapter = getKernelCapabilities().adapterInfo;
  assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter)), 'Physical GPU required');
  const a = [{ role: 'user', content: 'Remember these colors: ' + Array(20).fill('red green blue').join(' ') + '. Name the first color.' }];
  const first = await run(a, 'alice', 'a');
  await run([{ role: 'user', content: 'Say goodbye briefly.' }], 'alice', 'b');
  a.push({ role: 'assistant', content: first.content }, { role: 'user', content: 'Name the last color.' });
  const cached = await run(a, 'alice', 'a'), fresh = await run(a);
  assert(cached.timing.reusedPrefixTokens >= 64, 'The installed provider must preserve and report actual prefix reuse');
  assert.equal(cached.content, fresh.content);
  report.cases.push({ kind: 'alternating-threads-followup', cached: cached.timing, fresh: fresh.timing, content: cached.content });
  const other = await run(a, 'bob', 'a');
  assert.equal(other.timing.reusedPrefixTokens, 0, 'Same thread ID from another requester must not share a context');
  const again = await run(a, 'alice', 'a');
  assert(again.timing.reusedPrefixTokens > 0); assert.equal(again.content, fresh.content);
  report.cases.push({ kind: 'requester-isolation', otherReused: other.timing.reusedPrefixTokens, originalReused: again.timing.reusedPrefixTokens });
  const cancel = new AbortController();
  await assert.rejects(run(a, 'alice', 'a', { signal: cancel.signal,
    onUpdate: () => cancel.abort(new Error('controlled cancellation')) }), /controlled cancellation/);
  const recovered = await run(a, 'alice', 'a');
  assert.equal(recovered.timing.reusedPrefixTokens, 0); assert.equal(recovered.content, fresh.content);
  report.cases.push({ kind: 'cancel-rebuild-reuse', reusedAfterCancel: recovered.timing.reusedPrefixTokens });
  const changed = await run([{ role: 'user', content: 'Say hello.' }], 'alice', 'a');
  assert.equal(changed.timing.reusedPrefixTokens, 0);
  report.cases.push({ kind: 'edited-history', reused: changed.timing.reusedPrefixTokens });
  report.passed = true;
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  try { await provider.close(); await service.closeAll(); await gpu.close(); report.cleanup = 'settled'; }
  catch (error) { report.passed = false; report.cleanupFailure = String(error); process.exitCode = 1; }
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, cleanup: report.cleanup }));
}
