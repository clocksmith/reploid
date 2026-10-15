// In-page half of browser-check.mjs. Runs inside the owned Chrome (Metal) page, imports the Doppler
// package under test from /pkg/src/, and repeats substitution-check.mjs's paired paths unchanged:
// the 56-token speed turn twice (second pass reported), the unchanged 55-step comparison against
// the approved F64 reference, the F16 K/V cache dump of every full-attention layer after each request,
// and the warm 184-token prefill. Only runtimeConfig and dumpCaches are supported; the diagnostic
// substitution, split and hybrid modes of substitution-check.mjs are refused.
// The comparison loop below is copied from substitution-check.mjs without change: every one of the
// 248,320 logits within 0.001 of the F64 reference and the argmax equal to the reference token.
const SPEED_DECODE_TOKENS = 64;
const now = () => performance.now();
const post = (path, body, type = 'application/json') => fetch(path, { method: 'POST', headers: { 'content-type': type },
  body: type === 'application/json' ? JSON.stringify(body) : body }).then(r => { if (!r.ok) throw new Error(`POST ${path} ${r.status}`); });
const log = value => post('/log', value);

async function main() {
  const inputs = await (await fetch('/inputs.json')).json();
  const { config, modelBase, manifestText, reference, requests, speedTurn } = inputs;
  for (const key of Object.keys(config)) {
    if (!['label', 'runtimeConfig', 'dumpCaches'].includes(key)) throw new Error(`Unsupported browser config field ${key}`);
  }
  const mod = relative => import(`/pkg/src/${relative}`);
  const [{ initDevice, destroyDevice, getKernelCapabilities, getDevice }, { createPipeline },
    { createHttpArtifactStorageContext }, { createModelHandle }, { formatChatMessages }, { DOPPLER_VERSION },
    { createDopplerLoader }] = await Promise.all([
    mod('gpu/device.js'), mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'),
    mod('client/model-host/model-session.js'), mod('inference/pipelines/text/chat-format.js'), mod('version.js'),
    mod('loader/doppler-loader.js')]);
  const manifest = JSON.parse(manifestText);
  const layerTypes = manifest.inference.layerPattern.layerTypes;
  const fullLayers = layerTypes.flatMap((type, layer) => type === 'full_attention' ? [layer] : []);
  const report = { dopplerVersion: DOPPLER_VERSION, speed: {}, requests: [] };

  const argmax = values => { let best = 0; for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i; return best; };
  function summarize(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
    return { count: values.length, totalMs: values.reduce((a, b) => a + b, 0), medianMs: at(0.5), p90Ms: at(0.9), minMs: sorted[0], maxMs: sorted.at(-1) };
  }
  async function referenceLogits(attempt, step) {
    const response = await fetch(`/ref/${attempt}/${step}`);
    const dtype = response.headers.get('x-logits-dtype');
    const buffer = await response.arrayBuffer();
    return dtype === 'f64' ? new Float64Array(buffer) : new Float32Array(buffer);
  }

  await initDevice();
  const capabilities = getKernelCapabilities();
  report.gpu = { adapter: capabilities.adapterInfo ?? null, hasF16: capabilities.hasF16, userAgent: navigator.userAgent };
  await log({ phase: 'device', gpu: report.gpu });

  const storage = createHttpArtifactStorageContext(new URL(modelBase, location.href).href, manifest);
  const runtimeConfig = structuredClone(config.runtimeConfig);
  const pipeline = await createPipeline(manifest, { storage, ownsLoader: true, runtimeConfig, loader: createDopplerLoader(runtimeConfig.loading) });
  const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: inputs.manifestIdentity.slice(7) });
  const thinking = pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined;
  const tokenize = messages => handle.advanced.tokenizeText(formatChatMessages(messages, manifest.inference.chatTemplate.type, thinking));
  const resetAll = () => pipeline.reset();
  const decode = context => pipeline.decodeStepLogits(context, { useChatTemplate: false });
  const prefill = (messages, ids) => pipeline.prefillWithLogits(messages, { inputIds: ids, useChatTemplate: false });

  async function dumpCaches(index, seqLen) {
    const cache = pipeline.kvCache, device = getDevice();
    const layers = [], chunks = [];
    for (const layer of fullLayers) {
      const buffers = cache.getGPUBuffers(layer);
      if (!buffers || buffers.seqLen !== seqLen) throw new Error(`Cache layer ${layer} seqLen ${buffers?.seqLen} != ${seqLen}`);
      const bytes = seqLen * cache.numHeads * cache.headDim * 2;
      const row = { layer, seqLen, numHeads: cache.numHeads, headDim: cache.headDim };
      for (const [kind, source] of [['key', buffers.keysGPU], ['value', buffers.valuesGPU]]) {
        const staging = device.createBuffer({ label: 'cache_dump', size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
          device.queue.submit([encoder.finish()]);
          await staging.mapAsync(GPUMapMode.READ);
          chunks.push(new Uint8Array(staging.getMappedRange().slice(0)));
          staging.unmap();
        } finally { staging.destroy(); }
      }
      layers.push(row);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) { data.set(chunk, cursor); cursor += chunk.length; }
    await post(`/cache/${index}?layers=${encodeURIComponent(JSON.stringify(layers))}`, data, 'application/octet-stream');
  }

  try {
    // Speed: 56-token turn, twice (second pass warm).
    const speedIds = tokenize(speedTurn.requestMessages);
    report.speed.promptTokens = speedIds.length;
    report.speed.passes = [];
    for (let pass = 0; pass < 2; pass++) {
      resetAll();
      const context = [...speedIds], steps = [];
      let cache = null, prefillMs = null;
      try {
        for (let step = 0; step <= SPEED_DECODE_TOKENS; step++) {
          const started = now();
          const output = step === 0 ? await prefill(speedTurn.requestMessages, speedIds) : await decode(context);
          const elapsed = now() - started;
          if (step === 0) { cache = output.cache; prefillMs = elapsed; } else steps.push(elapsed);
          context.push(argmax(output.logits));
        }
      } finally { cache?.destroy?.(); }
      report.speed.passes.push({ prefillMs, decode: summarize(steps) });
      await log({ label: config.label, speedPass: pass, prefillMs, decodeMedianMs: summarize(steps).medianMs });
    }

    // The unchanged 55-step check.
    for (let attempt = 0; attempt < reference.expected.length; attempt++) {
      const target = reference.expected[attempt];
      const contract = requests[attempt];
      const ids = tokenize(reference.prompts[attempt]);
      const frozenPrefix = contract?.inputIds?.slice(0, contract.prefixLengths?.[0]) ?? null;
      const row = { attempt, promptTokens: ids.length, promptMatchesFrozenPrefix: frozenPrefix ? JSON.stringify(ids) === JSON.stringify(frozenPrefix) : null, steps: [] };
      report.requests.push(row);
      resetAll();
      const context = [...ids];
      let cache = null;
      try {
        for (let step = 0; step < target.steps.length; step++) {
          const started = now();
          const output = step === 0 ? await prefill(reference.prompts[attempt], ids) : await decode(context);
          const elapsedMs = now() - started;
          if (step === 0) cache = output.cache;
          const actual = output.logits, independent = await referenceLogits(attempt, step);
          let maxDifference = 0, at = -1, finite = actual.length === independent.length, over = 0;
          for (let index = 0; index < actual.length; index++) {
            if (!Number.isFinite(actual[index])) { finite = false; continue; }
            const difference = Math.abs(actual[index] - independent[index]);
            if (difference > 0.001) over++;
            if (difference > maxDifference) { maxDifference = difference; at = index; }
          }
          const tokenId = argmax(actual);
          row.steps.push({ step, maxDifference, maxDifferenceAt: at, valuesOverTolerance: over, finite, withinTolerance: finite && maxDifference <= 0.001,
            tokenId, referenceTokenId: target.steps[step].tokenId, tokenMatches: tokenId === target.steps[step].tokenId, elapsedMs });
          context.push(target.steps[step].tokenId); // teacher-forced along the reference tokens
        }
        if (config.dumpCaches) await dumpCaches(attempt, ids.length + target.steps.length - 1);
      } finally { cache?.destroy?.(); }
      row.maxDifference = Math.max(...row.steps.map(s => s.maxDifference));
      row.failedSteps = row.steps.filter(s => !s.withinTolerance || !s.tokenMatches).map(s => s.step);
      await log({ label: config.label, attempt, promptTokens: ids.length, maxDifference: row.maxDifference, failedSteps: row.failedSteps.length });
    }
    const all = report.requests.flatMap(r => r.steps);
    report.summary = { comparedSteps: all.length, withinTolerance: all.filter(s => s.withinTolerance).length,
      tokenMatches: all.filter(s => s.tokenMatches).length, maxDifference: Math.max(...all.map(s => s.maxDifference)),
      valuesOverTolerance: all.reduce((sum, s) => sum + s.valuesOverTolerance, 0),
      passed: all.length === reference.numericalReference.steps && all.every(s => s.withinTolerance && s.tokenMatches) };

    // Warm 184-token prefill timing (request 2 prompt), after the check.
    const longIds = tokenize(reference.prompts[2]);
    resetAll();
    const started = now();
    const output = await prefill(reference.prompts[2], longIds);
    report.speed.longPrompt = { promptTokens: longIds.length, prefillMs: now() - started };
    output.cache?.destroy?.();
    const decodeSteps = report.requests[2].steps.slice(1).map(s => s.elapsedMs);
    report.speed.checkRequest2Decode = summarize(decodeSteps);
    report.speed.summary = { prompt56Ms: report.speed.passes[1].prefillMs, prompt184Ms: report.speed.longPrompt.prefillMs,
      decodeMedianMs: report.speed.passes[1].decode.medianMs };
    await log({ label: config.label, ...report.summary, ...report.speed.summary });
  } finally {
    await handle.unload();
    destroyDevice();
  }
  return report;
}

main().then(report => post('/done', { ok: true, report }), error => post('/done', { ok: false, error: String(error?.stack ?? error) }));
