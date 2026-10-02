import { open } from 'node:fs/promises';
import path from 'node:path';

/** Read-only snapshots of the exact installed runtime in each executor page. */
export async function inspectExecutorMemory(page) {
  return page.evaluate(async () => {
    const { DOPPLER_PARTITIONS_MODULE_URL } = await import('/config/doppler-local-models.js');
    return (await import(DOPPLER_PARTITIONS_MODULE_URL)).inspectDeviceMemory();
  });
}

/** Diagnostic comparison, separate from the user journey: the same installed
 * pipeline, model bytes, precision and context, with no partition allocation.
 * Its HTTP fixture is not evidence of peer acquisition. */
export async function measureStandaloneDenial(page, model) {
  return page.evaluate(async selected => {
    const config = await import('/config/doppler-local-models.js');
    const policy = await (await fetch('/config/partition-policy.json')).json();
    const profile = await (await fetch('/config/work-profile.json')).json();
    const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
    globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
    const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
    const { createPipeline } = await import(new URL('./inference/pipelines/text.js', base).href);
    const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base).href);
    const bytes = await (await fetch(selected.source.baseUrl + 'manifest.json')).arrayBuffer();
    const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (identity !== selected.identity) throw Error('Standalone diagnostic model identity mismatch');
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
    let pipeline = null, error = null;
    const started = performance.now();
    try {
      pipeline = await createPipeline(manifest, { runtimeConfig: {
        shared: { debug: { profiler: { enabled: policy.profileGpu } } },
        inference: { session: { kvcache: { maxSeqLen: policy.maxSeqLen } } } },
        storage: createHttpArtifactStorageContext(selected.source.baseUrl, manifest, { verifyHashes: true }) });
    } catch (cause) { error = cause.message; }
    finally { await pipeline?.unload(); }
    return { modelIdentity: identity, stage: 'opening',
      generation: { ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen }, maxSeqLen: policy.maxSeqLen, maxGpuBufferBytes: policy.maxGpuBufferBytes,
      elapsedMs: performance.now() - started, error, memory: runtime.inspectDeviceMemory() };
  }, model);
}

export async function routeDiagnosticModel(context, model, directory) {
  await context.route(model.source.baseUrl + '*', async route => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!/^[\w.-]+$/.test(filename)) throw Error('Invalid diagnostic fixture path');
    const file = await open(path.join(directory, filename), 'r');
    try {
      const size = (await file.stat()).size, range = route.request().headers().range;
      if (!range) { await route.fulfill({ body: await file.readFile() }); return; }
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) throw Error('Invalid diagnostic range');
      const start = Number(match[1]), end = Number(match[2]);
      if (start > end || end >= size) throw Error('Diagnostic range outside file');
      const body = Buffer.alloc(end - start + 1);
      const { bytesRead } = await file.read(body, 0, body.length, start);
      if (bytesRead !== body.length) throw Error('Truncated diagnostic range');
      await route.fulfill({ status: 206, body, headers: {
        'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' } });
    } finally { await file.close(); }
  });
}

/** Native connection observations; omit endpoint addresses and credentials. */
export async function inspectConnections(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'RTCPeerConnection.prototype' });
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
    const inspected = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId,
      functionDeclaration: `async function() {
        const observations = [];
        for (const connection of this) {
          const stats = await connection.getStats();
          const transport = [...stats.values()].find(item => item.type === 'transport' && item.selectedCandidatePairId);
          const pair = transport && stats.get(transport.selectedCandidatePairId);
          if (!pair) continue;
          const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
          observations.push({ connectionState: connection.connectionState,
            localCandidateType: local?.candidateType, remoteCandidateType: remote?.candidateType,
            protocol: local?.protocol, relayProtocol: local?.relayProtocol ?? null,
            roundTripMs: pair.currentRoundTripTime == null ? null : pair.currentRoundTripTime * 1000,
            bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived,
            channels: [...stats.values()].filter(item => item.type === 'data-channel').map(item => ({
              label: item.label, state: item.state, messagesSent: item.messagesSent, messagesReceived: item.messagesReceived,
              bytesSent: item.bytesSent, bytesReceived: item.bytesReceived })) });
        }
        return observations;
      }`, awaitPromise: true, returnByValue: true });
    if (inspected.exceptionDetails) throw Error(inspected.exceptionDetails.text);
    return inspected.result.value;
  } finally { await cdp.detach(); }
}
