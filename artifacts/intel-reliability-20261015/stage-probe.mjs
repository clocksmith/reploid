// Intel stage probe (intel-host). Three modes, one bounded process each:
//
// - bind: the shader cache binding alone (stale-session sweep, seal lookup, new staging), then exit. CPU only: the
//   provider is never loaded.
// - prepare: bind the sealed Mesa shader cache through Reploid's server/native-shader-cache.js (the same calls the
//   native participant makes, with the same identity inputs: installed runtime and its pinned archive integrity,
//   the `webgpu` provider, the installed catalog entry, partition policy and ordered stage index), open the stage
//   through Doppler's public resident-stage API (as ../native-crash-20261014/cache-audit.mjs did), and offer the
//   readiness-time pipeline preparation to the seal. With `"cache": { "direct": true }` the protocol is not used and
//   the caller's MESA_SHADER_CACHE_DIR is opened as-is (control runs on a copied cache).
// - soak: record stage 0 activations for the configured prompts and teacher-forced decode steps, close stage 0,
//   then execute the configured stage repeatedly with those activations until the declared budget ends.
//
// The provider is opened as server/native-participant.js opens it: the `webgpu` module's create(['backend=vulkan'])
// installed as navigator.gpu. No token reaches any network. Every event is a JSON line on stdout; the report is
// rewritten to config.out after each phase so a killed or crashed process leaves its evidence.
//
// Usage: node stage-probe.mjs <config.json>
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const t0 = performance.now();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schema: 'reploid.intel-stage-probe/v1', mode: config.mode, config, pid: process.pid,
  startedAt: new Date().toISOString(), cache: null, gpu: null, stages: [], seal: null, soak: null, completed: false };
const emit = (event, fields = {}) => {
  const row = { event, at: new Date().toISOString(), t: Math.round(performance.now() - t0), ...fields };
  console.log(JSON.stringify(row)); return row;
};
const persist = async () => {
  await fs.writeFile(config.out + '.tmp', JSON.stringify(report, null, 1) + '\n');
  await fs.rename(config.out + '.tmp', config.out);
};
const threadNames = async () => {
  const names = {};
  for (const tid of await fs.readdir('/proc/self/task')) {
    const comm = await fs.readFile(`/proc/self/task/${tid}/comm`, 'utf8').then(text => text.trim(), () => '?');
    names[comm] = (names[comm] || 0) + 1;
  }
  return names;
};
/** Sizes of the bound cache's files: Mesa appends new entries; a cache hit only refreshes index metadata. */
const cacheListing = async (root, relative = '') => {
  const rows = {};
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch(() => [])) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) Object.assign(rows, await cacheListing(root, name));
    else rows[name] = (await fs.stat(path.join(root, name))).size;
  }
  return rows;
};
const bytesOf = data => data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

const catalog = JSON.parse(await fs.readFile(config.catalog, 'utf8')).find(entry => entry.id === config.modelId);
const policy = JSON.parse(await fs.readFile(config.policy, 'utf8'));
const manifestBytes = await fs.readFile(path.join(config.model, 'manifest.json'));
const manifest = JSON.parse(manifestBytes), manifestIdentity = 'sha256:' + sha256(manifestBytes);
if (manifestIdentity !== catalog.identity) throw new Error('Model manifest differs from the installed catalog identity.');
emit('start', { pid: process.pid, mode: config.mode, manifestIdentity, mesaShaderCacheDir: process.env.MESA_SHADER_CACHE_DIR ?? null });

// Bind the shader cache before the provider module loads, as the native participant does.
const protocol = await import(pathToFileURL(config.protocol).href);
let cache = null;
if (config.cache.direct) {
  if (!process.env.MESA_SHADER_CACHE_DIR) throw new Error('Direct mode requires the caller to set MESA_SHADER_CACHE_DIR.');
  report.cache = { mode: 'direct', directory: process.env.MESA_SHADER_CACHE_DIR };
} else {
  const identityStarted = performance.now();
  const { key, identity } = await protocol.nativeShaderCacheIdentity({
    runtime: { directory: config.runtime, archiveIntegrity: config.archiveIntegrity },
    provider: { module: 'webgpu', directory: config.provider },
    program: { model: catalog, policy, stage: config.stage, canonical: false } });
  const identityMs = Math.round(performance.now() - identityStarted);
  cache = await protocol.openNativeShaderCache({ root: config.cache.root, key, identity, onEvent: event => emit('shader-cache', event) });
  report.cache = { mode: 'protocol', identityMs, identity, binding: cache.status() };
}
report.cacheFilesBefore = await cacheListing(process.env.MESA_SHADER_CACHE_DIR);
await persist();
if (config.mode === 'bind') {
  // CPU only: the binding (sweep, seal lookup, staging) without loading the provider or touching the GPU.
  await cache?.close(); report.completed = true; report.finishedAt = new Date().toISOString(); await persist();
  emit('finished', { completed: true }); process.exit(0);
}

const provider = await import(pathToFileURL(path.join(config.provider, 'index.js')).href);
Object.assign(globalThis, provider.globals);
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: provider.create(['backend=vulkan']) } });
const mod = relative => import(pathToFileURL(path.join(config.runtime, 'src', relative)).href);
const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim },
  { initDevice, destroyDevice, getKernelCapabilities }, { createPipeline },
  { createNodeFileArtifactStorageContext }, { createModelHandle }, { createCapsuleProgramAdapter },
  { createResidentPartitionSession }, { resolveResidentPartitionAllocation, hashPartitionGeneration },
  { hashLayerPartitionPlan }, { resolveGenerationOptions }, { createDopplerLoader }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'),
  mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'),
  mod('client/model-host/model-session.js'), mod('client/runtime/capsule-program-adapter.js'),
  mod('inference/pipelines/text/resident-partition.js'),
  mod('inference/pipelines/text/resident-partition-contract.js'),
  mod('inference/pipelines/text/layer-partition-contract.js'), mod('config/generation-contract.js'),
  mod('loader/doppler-loader.js'),
]);
const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
report.gpu = { adapter: getKernelCapabilities().adapterInfo ?? null, provider: bootstrap.provider };
emit('device', report.gpu);

const capsule = catalog.capsule, targetPlan = capsule.targetPlans[0];
const runtimeConfig = targetPlan.initialExecutionIdentity.programLoadPolicy.runtimeConfig;
const plan = structuredClone(catalog.partitionPlan), planId = hashLayerPartitionPlan(plan);
const generation = resolveGenerationOptions(catalog.generation), generationDigest = hashPartitionGeneration(generation);
const participant = index => 'peer:intel-probe-stage-' + index;
const signal = new AbortController().signal;
const attemptIdentity = attemptId => ({ schema: 'doppler.resident-partition-attempt/v2', modelId: manifest.modelId,
  modelIdentity: manifestIdentity, planId, threadId: 'thread-' + attemptId, attemptId, requesterId: 'intel-probe',
  placementGeneration: 0, stages: plan.partitions.map(({ index }) => ({ index, participantId: participant(index),
    transportId: 'transport-' + index, residentId: 'resident-' + index, executionId: 'execution-' + index })) });

async function openStage(index) {
  emit('stage-opening', { index });
  const started = performance.now();
  const storage = createNodeFileArtifactStorageContext(pathToFileURL(config.model + path.sep).href, manifest);
  const pipeline = await createPipeline(manifest, { partition: { plan, index }, storage,
    runtimeConfig: structuredClone(runtimeConfig), loader: createDopplerLoader(runtimeConfig.loading), ownsLoader: true });
  const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: manifestIdentity.slice(7) });
  const program = createCapsuleProgramAdapter(handle, capsule, targetPlan);
  const allocation = resolveResidentPartitionAllocation(manifest, manifestIdentity, { model: { id: manifest.modelId,
    identity: manifestIdentity }, plan, planId, index, participantId: participant(index),
    limits: structuredClone(policy.limits), generation });
  // A runtime without readiness-time preparation ignores the progress port and creates pipelines lazily.
  const resident = await createResidentPartitionSession(pipeline, allocation, program, () => handle.unload(), signal, event => {
    if (event?.phase === 'pipelines') emit('pipeline', { index, status: event.status, prepared: event.prepared,
      total: event.total, key: event.key, elapsedMs: Math.round(event.elapsedMs) });
  });
  const preparation = resident.getDescriptor().pipelinePreparation ?? null;
  const opened = { index, openMs: Math.round(performance.now() - started), preparation: preparation && {
    complete: preparation.complete, count: preparation.count, durationMs: Math.round(preparation.durationMs),
    lazy: preparation.lazy, pipelines: preparation.pipelines.map(row => row.key) } };
  report.stages.push(opened);
  emit('stage-ready', { index, openMs: opened.openMs, complete: preparation?.complete ?? null,
    prepared: preparation?.count ?? null, preparationMs: opened.preparation?.durationMs ?? null });
  await persist();
  return { resident, preparation };
}

const stageInput = (index, identity, recorded, continuation) => ({ identity, partitionIndex: index, step: recorded.step,
  tokenPosition: recorded.tokenPosition, inputTokenCount: recorded.inputTokenIds.length, inputTokenIds: recorded.inputTokenIds,
  generation, generationDigest, maxTokens: generation.maxTokens, continuation, signal,
  ...(recorded.activation ? { activation: recorded.activation } : {}) });

try {
  if (config.mode === 'prepare') {
    const { resident, preparation } = await openStage(config.stage);
    if (cache) {
      report.seal = await cache.seal({ ...preparation, planId, index: config.stage, modelIdentity: manifestIdentity });
      report.cache.after = cache.status();
    }
    report.cacheFilesAfter = await cacheListing(process.env.MESA_SHADER_CACHE_DIR);
    report.writers = await protocol.observeMesaCacheWriters();
    report.threads = await threadNames();
    await persist();
    await resident.close();
  } else if (config.mode === 'soak') {
    const soak = report.soak = { budget: config.soak, recorded: [], attempts: [], stepsExecuted: 0, outputMismatches: 0,
      nonFiniteOutputs: 0, stoppedBy: null };
    // Record: stage 0 executes each prompt's prefill and teacher-forced decode steps once.
    const first = await openStage(0);
    const templates = [];
    for (const [number, prompt] of config.soak.prompts.entries()) {
      const identity = attemptIdentity('record-' + number);
      const { tokenIds } = await first.resident.tokenize({ identity, messages: [{ role: 'user', content: prompt }], signal });
      // Decode inputs reuse the prompt's own natural-language token stream.
      const steps = []; let ids = tokenIds, position = 0, continuation = null;
      const started = performance.now();
      for (let step = 0; step <= config.soak.decodeSteps; step++) {
        const recorded = { step, tokenPosition: position, inputTokenIds: ids };
        const result = await first.resident.executeStage(stageInput(0, identity, recorded, continuation));
        const { data, ...tensor } = result.activationTensor;
        const bytes = bytesOf(data).slice();
        steps.push({ ...recorded, activation: { ...tensor, tensorData: new Float32Array(bytes.buffer) } });
        continuation = result.continuation; position += ids.length; ids = [tokenIds[(step + 1) % tokenIds.length]];
      }
      await first.resident.closeAttempt({ identity });
      templates.push({ prompt: number, steps });
      soak.recorded.push({ prompt: number, inputTokens: tokenIds.length, decodeSteps: config.soak.decodeSteps,
        recordMs: Math.round(performance.now() - started) });
      emit('recorded', soak.recorded.at(-1)); await persist();
    }
    await first.resident.close();
    // Soak: the stage under test replays the recorded activations until the declared budget ends.
    let stage = await openStage(config.stage), opened = 1;
    const deadline = performance.now() + config.soak.minutes * 60000;
    const reference = new Map();
    soak.startedAt = new Date().toISOString();
    for (let attempt = 0; ; attempt++) {
      if (attempt >= config.soak.maxAttempts) { soak.stoppedBy = 'attempt budget'; break; }
      if (performance.now() >= deadline) { soak.stoppedBy = 'time budget'; break; }
      if (attempt > 0 && attempt % (policy.limits.maxAttempts - 1) === 0) {
        await stage.resident.close(); stage = await openStage(config.stage); opened++;
      }
      const template = templates[attempt % templates.length], identity = attemptIdentity('soak-' + attempt);
      const started = performance.now(); let continuation = null, mismatches = 0, nonFinite = 0, executeMs = 0;
      for (const recorded of template.steps) {
        const stepStarted = performance.now();
        const result = await stage.resident.executeStage(stageInput(config.stage, identity, recorded, continuation));
        executeMs += performance.now() - stepStarted;
        continuation = result.continuation;
        const output = bytesOf(result.activationTensor.data), values = new Float32Array(output.buffer, output.byteOffset, output.byteLength / 4);
        for (const value of values) if (!Number.isFinite(value)) nonFinite++;
        const digest = sha256(output), slot = template.prompt + ':' + recorded.step;
        if (!reference.has(slot)) reference.set(slot, digest); else if (reference.get(slot) !== digest) mismatches++;
        soak.stepsExecuted++;
      }
      await stage.resident.closeAttempt({ identity });
      soak.outputMismatches += mismatches; soak.nonFiniteOutputs += nonFinite;
      soak.attempts.push({ attempt, prompt: template.prompt, steps: template.steps.length, ms: Math.round(performance.now() - started),
        executeMs: Math.round(executeMs), mismatches, nonFinite });
      emit('soak-attempt', soak.attempts.at(-1)); await persist();
    }
    soak.finishedAt = new Date().toISOString(); soak.stageOpenings = opened;
    report.threads = await threadNames();
    await stage.resident.close();
  } else throw new Error('Unknown probe mode: ' + config.mode);
  report.completed = true;
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  emit('error', report.error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await persist();
  destroyDevice();
  await releaseNodeWebGPU();
  await cache?.close();
  emit('finished', { completed: report.completed });
}
