/** Diagnostic transport carries unchanged tensors between real browser partitions.
 * This local-byte diagnostic is separate from the ordinary-page WebRTC proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { observeBrowserNumerics } from './browser-numerical-observer.js';
const reference = JSON.parse(await readFile(process.env.DOPPLER_PARTITION_REFERENCE_OUT, 'utf8'));
const output = process.env.REPLOID_CAPTURE_OUT;
assert(output && process.env.REPLOID_EXECUTOR_WS, 'Output and physical executor endpoint are required');
const mac = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const linux = await chromium.connect(process.env.REPLOID_EXECUTOR_WS);
const hosts = process.env.REPLOID_DIAGNOSTIC_A === 'mac' ? [mac, linux] : [linux, mac];
const contexts = [], pages = [], observers = [], descriptors = [];
try {
  for (const [index, host] of hosts.entries()) {
    const context = await host.newContext(); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    await page.goto('http://localhost:8000/config/chat-files.json');
    observers.push(await observeBrowserNumerics(page, 'node_modules/doppler-gpu'));
    const opened = await page.evaluate(async ({ reference, index }) => {
      const config = await import('/config/doppler-local-models.js');
      const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
      globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
      const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
      const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
      const policy = await (await fetch('/config/partition-policy.json')).json();
      const source = 'http://127.0.0.1:9230/';
      const bytes = await (await fetch(source + 'manifest.json')).arrayBuffer();
      const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (identity !== reference.modelIdentity) throw Error('Manifest identity mismatch');
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
        activationDtype: manifest.inference.session.compute.defaults.activationDtype });
      const planId = runtime.hashLayerPartitionPlan(plan);
      if (planId !== reference.planId) throw Error('Plan identity mismatch');
      await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
      const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: identity,
        runtimeConfig: { shared: { debug: { profiler: { enabled: policy.profileGpu } } },
          inference: { session: { kvcache: { maxSeqLen: reference.generation.maxSeqLen } } } },
        createStorage: () => createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) });
      globalThis.resident = await factory.openResidentPartition({ model: { id: manifest.modelId, identity, generation: reference.generation },
        plan, planId, index, participantId: index ? 'diagnostic-B' : 'diagnostic-A', limits: policy.limits, signal: new AbortController().signal });
      globalThis.encodeNumericalBytes = data => {
        let text = ''; const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
        for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return btoa(text);
      };
      return { descriptor: resident.getDescriptor(), packageVersion: config.DOPPLER_PACKAGE_VERSION, maxGpuBufferBytes: policy.maxGpuBufferBytes };
    }, { reference, index });
    descriptors.push({ ...opened, platform: host === mac ? 'mac' : 'linux', browser: host.version() });
    console.log(`Opened ${index} on ${descriptors.at(-1).platform}`);
  }
  const runs = [];
  for (const [prompt, messages] of reference.prompts.entries()) {
    const identity = { modelId: descriptors[0].descriptor.modelId, modelIdentity: reference.modelIdentity,
      planId: reference.planId, participantA: 'diagnostic-A', participantB: 'diagnostic-B', threadId: `prompt-${prompt}`, attemptId: `attempt-${prompt}` };
    const tokenized = await pages[0].evaluate(({ identity, messages }) => resident.tokenize({ identity, messages, signal: new AbortController().signal }), { identity, messages });
    let ids = tokenized.tokenIds;
    const inputTokenIds = ids, steps = []; let position = 0, aContinuation = null, bContinuation = null, text = '';
    for (let step = 0; step < reference.generation.maxTokens; step++) {
      const request = { identity, step, tokenPosition: position, inputTokenCount: ids.length,
        generation: reference.generation, maxTokens: reference.generation.maxTokens };
      const a = await pages[0].evaluate(async ({ request, ids, continuation, prompt }) => {
        numericalObservation.prompt = prompt; numericalObservation.step = request.step;
        const result = await resident.executeGroup0({ ...request, tokenIds: ids, continuation, signal: new AbortController().signal });
        return { activation: { ...result.activationTensor, data: encodeNumericalBytes(result.activationTensor.data) }, continuation: result.continuation };
      }, { request, ids, continuation: aContinuation, prompt });
      const b = await pages[1].evaluate(async ({ request, ids, activation, continuation, prompt }) => {
        numericalObservation.prompt = prompt; numericalObservation.step = request.step;
        const data = Uint8Array.from(atob(activation.data), c => c.charCodeAt(0)).buffer;
        const result = await resident.executeGroup1({ ...request, inputTokenIds: ids,
          activation: { ...activation, tensorData: data }, continuation, signal: new AbortController().signal });
        return { tokenId: result.tokenId, stopReason: result.stopReason, done: result.done, delta: result.delta,
          logits: encodeNumericalBytes(result.logits), continuation: result.continuation };
      }, { request, ids, activation: a.activation, continuation: bContinuation, prompt });
      steps.push({ step, tokenId: b.tokenId, stopReason: b.stopReason, logits: b.logits }); text += b.delta;
      aContinuation = a.continuation; bContinuation = b.continuation; position += ids.length; ids = [b.tokenId];
      if (b.done) break;
    }
    runs.push({ prompt, inputTokenIds, text, steps });
    for (const page of pages) await page.evaluate(identity => resident.closeAttempt({ identity }), identity);
    console.log(JSON.stringify({ prompt, text, steps: steps.length }));
  }
  const observations = [];
  for (const observer of observers) {
    const data = await observer.read(); assert.deepEqual(data.errors, []);
    assert(data.records.every(record => record.data && !record.error), 'Incomplete partition capture');
    observations.push(data.records);
  }
  await writeFile(output, JSON.stringify({ surface: 'browser', scope: 'diagnostic local-byte acquisition and host-carried tensor transport; not WebRTC qualification',
    modelIdentity: reference.modelIdentity, planId: reference.planId, generation: reference.generation, descriptors, runs, observations }));
  console.log(JSON.stringify({ output, records: observations.map(records => records.length) }));
} finally {
  for (const page of pages) await page.evaluate(() => globalThis.resident?.close()).catch(() => {});
  for (const observer of observers) await observer.close();
  for (const context of contexts) await context.close();
  await mac.close(); await linux.close();
}
