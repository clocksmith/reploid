/** Local-byte diagnostic of retained partition memory. No peer or inference
 * completion claim: only partition A's exact prefill is executed. */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const requests = JSON.parse(await readFile(process.env.REPLOID_DIAGNOSTIC_REQUESTS, 'utf8'));
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
try {
  const page = await browser.newPage(); await page.goto('http://localhost:8000/config/chat-files.json');
  const cdp = await page.context().newCDPSession(page), failures = [];
  await cdp.send('Debugger.enable'); await cdp.send('Debugger.setPauseOnExceptions', { state: 'all' });
  cdp.on('Debugger.paused', async event => {
    try {
      if (event.data?.description?.includes('GPU memory budget exceeded') && failures.length === 0) {
        const failure = { description: event.data.description };
        for (const [key, name, expression] of [
          ['pool', 'acquire', '({stats:this.getStats(),labels:this.getLabelStats()})'],
          ['layer', 'processLayerGPU', 'layerIdx'],
          ['device', 'device.createBuffer', '({liveBytes:state.liveBytes,requested:size,buffers:[...state.buffers.values()]})']]) {
          const frame = event.callFrames.find(frame => frame.functionName === name);
          if (frame) failure[key] = (await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression, returnByValue: true })).result?.value;
        }
        failures.push(failure);
      }
    } finally { await cdp.send('Debugger.resume'); }
  });
  const result = await page.evaluate(async ({ requests, chunkLayers }) => {
    const config = await import('/config/doppler-local-models.js');
    const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
    globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
    const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
    const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
    const policy = await (await fetch('/config/partition-policy.json')).json();
    const source = 'http://127.0.0.1:9230/';
    const bytes = await (await fetch(source + 'manifest.json')).arrayBuffer();
    const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (identity !== requests[0].model.identity) throw Error('Model identity mismatch');
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
      activationDtype: manifest.inference.session.compute.defaults.activationDtype });
    const planId = runtime.hashLayerPartitionPlan(plan);
    await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
    const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: identity,
      runtimeConfig: { shared: { debug: { profiler: { enabled: false } } }, inference: { session: {
        kvcache: { maxSeqLen: requests[0].model.generation.maxSeqLen }, ...(chunkLayers ? { prefillChunkLayers: chunkLayers } : {}) } } },
      createStorage: () => createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) });
    const resident = await factory.openResidentPartition({ model: requests[0].model, plan, planId, index: 0,
      participantId: 'diagnostic-A', limits: policy.limits, signal: new AbortController().signal });
    const runs = [];
    try {
      for (const [index, request] of requests.entries()) {
        const binding = { modelId: manifest.modelId, modelIdentity: identity, planId,
          participantA: 'diagnostic-A', participantB: 'diagnostic-B', threadId: `thread-${index}`, attemptId: `attempt-${index}` };
        const row = { index, memoryBefore: runtime.inspectDeviceMemory() }; runs.push(row);
        try {
          const { tokenIds, generation } = await resident.tokenize({ identity: binding, messages: request.messages, signal: new AbortController().signal });
          row.tokens = tokenIds.length;
          const value = await resident.executeGroup0({ identity: binding, tokenIds, generation, maxTokens: generation.maxTokens,
            step: 0, tokenPosition: 0, inputTokenCount: tokenIds.length, continuation: null, signal: new AbortController().signal });
          row.metrics = value.metrics;
        } catch (error) { row.error = error.message; }
        finally { await resident.closeAttempt({ identity: binding }); row.memoryAfter = runtime.inspectDeviceMemory(); }
      }
      return { packageVersion: config.DOPPLER_PACKAGE_VERSION, chunkLayers, runs };
    } finally { await resident.close(); }
  }, { requests, chunkLayers: Number(process.env.REPLOID_DIAGNOSTIC_CHUNK_LAYERS) || null });
  await writeFile(process.env.REPLOID_CAPTURE_OUT, JSON.stringify({ scope: 'Single physical executor; local exact bytes; no complete generation.', ...result, failures }, null, 2));
  console.log(JSON.stringify(result.runs.map(({ index, tokens, error, metrics }) => ({ index, tokens, error, memory: metrics?.memory }))));
} finally { await browser.close(); }
