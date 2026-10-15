// Standalone-to-partition speed isolation on one machine (amd-host), one mode per process.
//
// Same Doppler 0.6.28 package (runtime archive sha256:2df37d88...), same model bytes (checked
// against the installed catalog), same prompts (the two answer-cause turns), same GPU. Modes:
//   ordinary-batched     whole model, manifest runtime defaults, generateTokens (decode loop as
//                        the manifest declares it: batched submits, periodic readback)
//   ordinary-per-token   whole model, manifest runtime defaults, prefillWithLogits then one
//                        decodeStepLogits per token (logits read back every token)
//   paired-unsplit       whole model, the Capsule TargetPlan runtimeConfig (paired arithmetic,
//                        16-token prefill chunks), per-token loop as the reproduction harness does
//   paired-three-stage   three resident partitions in one process, driven step by step as
//                        Reploid's route execution drives them (activation frames serialized and
//                        validated between stages)
//   ordinary-profile,    turn 1 prefill, then maxTokens decode steps with Doppler's GPU timestamp
//   paired-profile       profiling (decode option profile: true); per-kernel times by label
// Timing is wall time around each call, which includes GPU completion and readback.
//
// The two ordinary modes load the ordinary manifest and tokenizer (Doppler's published
// qwen-3-5-0-8b-q4k-ehaf16 model folder) over the same weight shards: the run checks that both
// manifests list identical shard hashes.
//
// Usage: node speed-ladder.mjs <doppler package root> <model dir> <installed catalog>
//          <partition policy> <distributed-observed.json> <mode> <maxTokens> <out.json>
//          [ordinary model dir | -] [base Capsule manifest]
//
// Copied from artifacts/speed-isolation-20261014/speed-ladder.mjs. The only change: with a base
// Capsule manifest argument, <model dir> may hold a variant manifest (make-variant-model.py) that
// selects replacement kernels. The base manifest must carry the catalog identity, every other
// model artifact in <model dir> must match the catalog, and the variant may differ from the base
// only in inference.execution.kernels entries (kernel, entry, digest, constants) and in added
// mechanismKernels declarations, which the report records. Timing and profiling code is unchanged.
//
// Copied from faster-candidate-20261015/numerical/speed-ladder.mjs for qk-norm-graph-20261015. The only
// change: the variant may also insert q_norm and k_norm layer steps, and the kernel key those steps name
// may be a declaration referenced only by them (not in mechanismKernels). The steps are removed before
// the comparison with the base and recorded in verification.kernelSubstitution.qkNormSteps.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, modelDir, catalogPath, policyPath, observedPath, mode, maxTokensArg, outPath, ordinaryModelDirArg, baseManifestPath] = process.argv.slice(2);
const ordinaryModelDir = ordinaryModelDirArg === '-' ? undefined : ordinaryModelDirArg;
const MODES = ['ordinary-batched', 'ordinary-per-token', 'paired-unsplit', 'paired-three-stage', 'ordinary-profile', 'paired-profile'];
if (!outPath || !MODES.includes(mode)) throw new Error('Usage: speed-ladder.mjs PACKAGE MODEL CATALOG POLICY OBSERVED MODE MAXTOKENS OUT');
const maxTokens = Number(maxTokensArg);
if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('maxTokens must be a positive integer.');
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const now = () => performance.now();

const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim },
  { initDevice, destroyDevice, getKernelCapabilities }, { createPipeline },
  { createNodeFileArtifactStorageContext }, { createModelHandle }, { createCapsuleProgramAdapter },
  { createResidentPartitionSession }, { resolveResidentPartitionAllocation, hashPartitionGeneration },
  { hashLayerPartitionPlan, serializeActivationFrame, validateActivationFrameForPlan },
  { resolveGenerationOptions }, { sampleCapsuleLogits, stoppingReason }, { createDopplerLoader },
  { assertInitialExecutionIdentity }, { formatChatMessages }, { DOPPLER_VERSION }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'),
  mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'),
  mod('client/model-host/model-session.js'), mod('client/runtime/capsule-program-adapter.js'),
  mod('inference/pipelines/text/resident-partition.js'),
  mod('inference/pipelines/text/resident-partition-contract.js'),
  mod('inference/pipelines/text/layer-partition-contract.js'), mod('config/generation-contract.js'),
  mod('inference/generation-step.js'), mod('loader/doppler-loader.js'),
  mod('config/initial-execution-identity.js'), mod('inference/pipelines/text/chat-format.js'), mod('version.js'),
]);

const report = { schema: 'reploid.speed-isolation/v1', mode, maxTokens, startedAt: new Date().toISOString(),
  machine: 'amd-host', dopplerVersion: DOPPLER_VERSION, inputs: {}, verification: {}, turns: [] };

const catalog = (await readJson(catalogPath)).find(entry => entry.id === 'qwen-3-5-0-8b-q4k-ehaf16');
const capsule = catalog.capsule;
const targetPlan = capsule.targetPlans[0];
const policy = await readJson(policyPath);
const observed = await readJson(observedPath);
report.inputs = { catalogSha256: sha256(await fs.readFile(catalogPath)), policySha256: sha256(await fs.readFile(policyPath)),
  capsuleId: capsule.capsuleId, archivePackageVersion: (await readJson(path.join(packageRoot, 'package.json'))).version };

// Model bytes: every Capsule model artifact present in modelDir must carry the catalog hash, and
// the manifest and every weight shard must be present. Absent files (such as the piece index,
// which loading does not read) are recorded.
const checks = [], absent = [];
for (const artifact of capsule.artifacts.filter(a => a.path.startsWith('artifacts/model/'))) {
  const name = path.basename(artifact.path);
  const source = name === 'manifest.json' && baseManifestPath ? baseManifestPath : path.join(modelDir, name);
  const bytes = await fs.readFile(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!bytes) { absent.push(name); continue; }
  checks.push({ file: name, match: 'sha256:' + sha256(bytes) === artifact.hash });
}
report.verification.modelArtifacts = { checked: checks.length, allMatch: checks.every(row => row.match), absent };
if (!report.verification.modelArtifacts.allMatch) throw new Error('Model bytes do not match the installed catalog.');
if (absent.some(name => name === 'manifest.json' || /^shard_\d+\.bin$/.test(name))) throw new Error('Model weights or manifest absent: ' + absent.join(', '));
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestIdentity = 'sha256:' + sha256(manifestBytes);
if (baseManifestPath) {
  const baseBytes = await fs.readFile(baseManifestPath);
  if ('sha256:' + sha256(baseBytes) !== catalog.identity) throw new Error('Base manifest identity differs from catalog identity.');
  const base = JSON.parse(baseBytes), variant = structuredClone(manifest), substituted = {};
  const baseKernels = base.inference.execution.kernels, variantKernels = variant.inference.execution.kernels;
  const qkNormSteps = {};
  for (const phase of ['decode', 'prefill']) {
    const inserted = variant.inference.execution[phase].filter(step => step[0] === 'q_norm' || step[0] === 'k_norm');
    if (inserted.length) {
      qkNormSteps[phase] = inserted;
      variant.inference.execution[phase] = variant.inference.execution[phase].filter(step => !inserted.includes(step));
    }
  }
  const qkNormKeys = new Set(Object.values(qkNormSteps).flat().map(step => step[1]));
  for (const key of Object.keys(variantKernels)) {
    const { kernel, entry, digest, constants, ...rest } = variantKernels[key];
    const original = baseKernels[key];
    if (!original) {
      // Added declared mechanism programs (replacement programs selected by declaration).
      if (!variant.inference.execution.mechanismKernels.includes(key) && !qkNormKeys.has(key)) throw new Error(`Variant adds execution kernel ${key} outside mechanismKernels.`);
      substituted[key] = { added: variantKernels[key], ...(qkNormKeys.has(key) ? { qkNormStepKernel: true } : {}) };
      delete variantKernels[key];
      variant.inference.execution.mechanismKernels = variant.inference.execution.mechanismKernels.filter(entry => entry !== key);
      continue;
    }
    const { kernel: k0, entry: e0, digest: d0, constants: c0, ...rest0 } = original;
    if (JSON.stringify(rest) !== JSON.stringify(rest0)) throw new Error(`Variant changes more than the program of ${key}.`);
    if (kernel !== k0 || entry !== e0 || digest !== d0 || JSON.stringify(constants ?? null) !== JSON.stringify(c0 ?? null)) {
      substituted[key] = { before: { kernel: k0, entry: e0, digest: d0, constants: c0 ?? null }, after: { kernel, entry, digest, constants: constants ?? null } };
    }
    variantKernels[key] = original;
  }
  if (JSON.stringify(variant) !== JSON.stringify(base)) throw new Error('Variant manifest differs from the base outside execution kernel programs.');
  report.verification.kernelSubstitution = { baseManifestIdentity: catalog.identity, variantManifestIdentity: manifestIdentity, substituted, qkNormSteps };
} else if (manifestIdentity !== catalog.identity) throw new Error('Manifest identity differs from catalog identity.');

const plan = structuredClone(catalog.partitionPlan);
const planId = hashLayerPartitionPlan(plan);
const generation = resolveGenerationOptions({ ...catalog.generation, maxTokens });
const generationDigest = hashPartitionGeneration(generation);
const limits = structuredClone(policy.limits);
const capsuleRuntimeConfig = structuredClone(targetPlan.initialExecutionIdentity.programLoadPolicy.runtimeConfig);
report.inputs.planId = planId;
report.inputs.splitLayers = plan.splitLayers;
report.inputs.generation = generation;
report.inputs.capsuleRuntimeConfigSha256 = sha256(JSON.stringify(capsuleRuntimeConfig));
report.inputs.manifestDecodeLoop = manifest.inference?.session?.decodeLoop ?? null;
const turns = observed.runs['run-5'].turns.map(turn => ({ label: turn.label, messages: turn.requestMessages }));

function summarize(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  return { count: values.length, totalMs: values.reduce((a, b) => a + b, 0), medianMs: at(0.5), p90Ms: at(0.9), minMs: sorted[0], maxMs: sorted.at(-1) };
}
async function openProgram(index, runtimeConfig, source = { modelDir, manifest, manifestIdentity }) {
  const storage = createNodeFileArtifactStorageContext(pathToFileURL(source.modelDir + path.sep).href, source.manifest);
  const options = { ...(index === null ? {} : { partition: { plan, index } }), storage, ownsLoader: true };
  if (runtimeConfig) Object.assign(options, { runtimeConfig: structuredClone(runtimeConfig), loader: createDopplerLoader(runtimeConfig.loading) });
  const started = now();
  const pipeline = await createPipeline(source.manifest, options);
  const loadMs = now() - started;
  const handle = createModelHandle(pipeline, { modelId: source.manifest.modelId, manifestHash: source.manifestIdentity.slice(7) });
  return { pipeline, handle, loadMs };
}

const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
const capabilities = getKernelCapabilities();
report.gpu = { adapter: capabilities.adapterInfo ?? null, hasF16: capabilities.hasF16, hasSubgroups: capabilities.hasSubgroups };

try {
  if (mode === 'ordinary-profile' || mode === 'paired-profile') {
    let source = { modelDir, manifest, manifestIdentity }, runtimeConfig = capsuleRuntimeConfig;
    if (mode === 'ordinary-profile') {
      const bytes = await fs.readFile(path.join(ordinaryModelDir, 'manifest.json'));
      source = { modelDir: ordinaryModelDir, manifest: JSON.parse(bytes), manifestIdentity: 'sha256:' + sha256(bytes) };
      runtimeConfig = null;
    }
    const whole = await openProgram(null, runtimeConfig, source);
    const thinking = whole.pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined;
    const turn = turns[0];
    const ids = whole.handle.advanced.tokenizeText(formatChatMessages(turn.messages, source.manifest.inference.chatTemplate.type, thinking));
    const context = [...ids], wall = [];
    let cache = null;
    try {
      whole.pipeline.reset();
      for (let step = 0; step <= maxTokens; step++) {
        const started = now();
        const output = step === 0
          ? await whole.pipeline.prefillWithLogits(turn.messages, { inputIds: ids, useChatTemplate: false })
          : await whole.pipeline.decodeStepLogits(context, { useChatTemplate: false, profile: true });
        if (step === 0) cache = output.cache; else wall.push(now() - started);
        let best = 0; for (let i = 1; i < output.logits.length; i++) if (output.logits[i] > output.logits[best]) best = i;
        context.push(best);
      }
    } finally { cache?.destroy?.(); }
    const stats = whole.pipeline.getStats?.() ?? whole.pipeline._state?.stats ?? {};
    const steps = stats.decodeProfileSteps ?? [];
    const byLabel = new Map();
    let gpuTotal = 0;
    for (const entry of steps) {
      const timings = entry.timings ?? {};
      const rows = Array.isArray(timings) ? timings.map(row => [row.label ?? row.name, row.ms ?? row.durationMs ?? row.timeMs])
        : Object.entries(timings).map(([label, value]) => [label, typeof value === 'number' ? value : (value?.ms ?? value?.totalMs ?? value?.durationMs)]);
      for (const [label, ms] of rows) {
        if (typeof ms !== 'number') continue;
        const row = byLabel.get(label) ?? { label, totalMs: 0, count: 0 };
        row.totalMs += ms; row.count++; byLabel.set(label, row); gpuTotal += ms;
      }
    }
    const kernels = [...byLabel.values()].map(row => ({ ...row, perStepMs: row.totalMs / Math.max(1, steps.length) }))
      .sort((a, b) => b.totalMs - a.totalMs);
    report.turns.push({ label: turn.label, promptTokens: ids.length, profiledSteps: steps.length, wall: summarize(wall),
      gpuPerStepMs: gpuTotal / Math.max(1, steps.length), kernels,
      firstStepSample: steps[0] ? JSON.stringify(steps[0]).slice(0, 2000) : null, statsKeys: Object.keys(stats) });
    console.log(JSON.stringify({ mode, profiledSteps: steps.length, wallMedianMs: summarize(wall)?.medianMs,
      gpuPerStepMs: gpuTotal / Math.max(1, steps.length), top: kernels.slice(0, 12).map(row => [row.label, +row.perStepMs.toFixed(2)]) }));
    await whole.handle.unload();
  } else if (mode === 'ordinary-batched' || mode === 'ordinary-per-token') {
    // Ordinary: manifest-first runtime (no Capsule runtimeConfig). Prompt ids come from the same
    // chat template rendering the reproduction harness verified against the resident tokenizer.
    if (!ordinaryModelDir) throw new Error('Ordinary modes need the ordinary model dir.');
    const ordinaryBytes = await fs.readFile(path.join(ordinaryModelDir, 'manifest.json'));
    const ordinary = { modelDir: ordinaryModelDir, manifest: JSON.parse(ordinaryBytes), manifestIdentity: 'sha256:' + sha256(ordinaryBytes) };
    const shardList = m => JSON.stringify(m.shards.map(shard => [shard.filename, shard.size, shard.hash]));
    report.verification.ordinaryManifest = { identity: ordinary.manifestIdentity, sameShardsAsCapsule: shardList(ordinary.manifest) === shardList(manifest),
      decodeLoop: ordinary.manifest.inference?.session?.decodeLoop ?? null };
    if (!report.verification.ordinaryManifest.sameShardsAsCapsule) throw new Error('Ordinary manifest lists different weight shards.');
    const whole = await openProgram(null, null, ordinary);
    report.loadMs = whole.loadMs;
    report.inputs.ordinaryRuntime = 'ordinary manifest defaults (no runtimeConfig override)';
    const thinking = whole.pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined;
    const prompts = turns.map(turn => ({ label: turn.label, messages: turn.messages,
      ids: whole.handle.advanced.tokenizeText(formatChatMessages(turn.messages, ordinary.manifest.inference.chatTemplate.type, thinking)) }));
    try {
      for (const prompt of prompts) {
        whole.pipeline.reset();
        if (mode === 'ordinary-batched') {
          const started = now(); const arrivals = [];
          for await (const _token of whole.pipeline.generateTokens(prompt.messages, { inputIds: prompt.ids, maxTokens, useChatTemplate: false })) arrivals.push(now() - started);
          const gaps = arrivals.slice(1).map((at, index) => at - arrivals[index]);
          const decodeMs = arrivals.length > 1 ? arrivals.at(-1) - arrivals[0] : null;
          report.turns.push({ label: prompt.label, promptTokens: prompt.ids.length, tokens: arrivals.length,
            firstTokenMs: arrivals[0] ?? null, decodeMs, decodeTokensPerSecond: decodeMs ? (arrivals.length - 1) / (decodeMs / 1000) : null,
            arrivalGaps: summarize(gaps), stats: whole.pipeline.getStats?.() ?? null });
        } else {
          const context = [...prompt.ids], steps = [];
          let cache = null, prefillMs = null;
          try {
            for (let step = 0; step < maxTokens; step++) {
              const started = now();
              const output = step === 0
                ? await whole.pipeline.prefillWithLogits(prompt.messages, { inputIds: prompt.ids, useChatTemplate: false })
                : await whole.pipeline.decodeStepLogits(context, { useChatTemplate: false });
              const elapsed = now() - started;
              if (step === 0) { cache = output.cache; prefillMs = elapsed; } else steps.push(elapsed);
              let best = 0; for (let i = 1; i < output.logits.length; i++) if (output.logits[i] > output.logits[best]) best = i;
              context.push(best);
            }
          } finally { cache?.destroy?.(); }
          report.turns.push({ label: prompt.label, promptTokens: prompt.ids.length, tokens: steps.length + 1,
            prefillMs, decode: summarize(steps), decodeTokensPerSecond: steps.length / (steps.reduce((a, b) => a + b, 0) / 1000) });
        }
        console.log(JSON.stringify({ mode, ...report.turns.at(-1), stats: undefined, arrivalGaps: undefined }));
      }
    } finally { await whole.handle.unload(); }
  } else if (mode === 'paired-unsplit') {
    const whole = await openProgram(null, capsuleRuntimeConfig);
    report.loadMs = whole.loadMs;
    const program = createCapsuleProgramAdapter(whole.handle, capsule, targetPlan);
    const identity = await program.getInitialExecutionIdentity();
    try { assertInitialExecutionIdentity(targetPlan.initialExecutionIdentity, identity); report.verification.executionIdentity = { match: true }; }
    catch (error) { report.verification.executionIdentity = { match: false, error: error.message }; }
    const tokenContract = program.getTokenContract();
    try {
      for (const turn of turns) {
        const input = program.tokenize(turn.messages, generation);
        whole.pipeline.reset();
        const context = [...input], steps = [];
        let cache = null, prefillMs = null, stopReason = null;
        try {
          for (let step = 0; step < maxTokens; step++) {
            const started = now();
            const output = step === 0
              ? await whole.pipeline.prefillWithLogits(turn.messages, { inputIds: input, useChatTemplate: false })
              : await whole.pipeline.decodeStepLogits(context, { useChatTemplate: false });
            const elapsed = now() - started;
            if (step === 0) { cache = output.cache; prefillMs = elapsed; } else steps.push(elapsed);
            const tokenId = sampleCapsuleLogits(output.logits, context, generation, tokenContract);
            context.push(tokenId);
            stopReason = stoppingReason(tokenId, step + 1, generation, tokenContract, () => '') || null;
            if (stopReason) break;
          }
        } finally { cache?.destroy?.(); }
        report.turns.push({ label: turn.label, promptTokens: input.length, tokens: steps.length + 1, stopReason,
          prefillMs, decode: summarize(steps), decodeTokensPerSecond: steps.length / (steps.reduce((a, b) => a + b, 0) / 1000) });
        console.log(JSON.stringify({ mode, ...report.turns.at(-1) }));
      }
    } finally { await whole.handle.unload(); }
  } else {
    const stages = plan.partitions.map(partition => ({ index: partition.index,
      participantId: 'peer:amd-host-ladder-stage-' + partition.index, transportId: randomUUID(),
      residentId: 'amd-host-ladder-' + partition.index + '-resident', executionId: 'amd-host-ladder-' + partition.index + '-ordinary' }));
    const residents = [], programs = [];
    const opening = new AbortController();
    try {
      let loadMs = 0;
      for (const stage of stages) {
        const opened = await openProgram(stage.index, capsuleRuntimeConfig);
        loadMs += opened.loadMs;
        opened.program = createCapsuleProgramAdapter(opened.handle, capsule, targetPlan);
        programs.push(opened);
        const allocation = resolveResidentPartitionAllocation(manifest, manifestIdentity, { model: { id: manifest.modelId,
          identity: manifestIdentity }, plan, planId, index: stage.index, participantId: stage.participantId, limits, generation });
        residents.push(await createResidentPartitionSession(opened.pipeline, allocation, opened.program,
          () => opened.handle.unload(), opening.signal));
      }
      report.loadMs = loadMs;
      for (const turn of turns) {
        const identity = { schema: 'doppler.resident-partition-attempt/v2', modelId: manifest.modelId,
          modelIdentity: manifestIdentity, planId, threadId: 'speed-ladder-' + turn.label, attemptId: randomUUID(),
          requesterId: 'peer:amd-host-ladder-requester', placementGeneration: 0, stages };
        const signal = new AbortController().signal;
        const tokenized = await residents[0].tokenize({ messages: turn.messages, identity, signal });
        const continuations = [null, null, null];
        const perStage = [[], [], []], frames = [], stepTotals = [];
        let input = [...tokenized.tokenIds], position = 0, prefill = null, stopReason = null, tokens = 0;
        for (let step = 0; step < maxTokens; step++) {
          const base = { identity, step, tokenPosition: position, inputTokenCount: input.length,
            maxTokens: generation.maxTokens, generationDigest, generation, inputTokenIds: [...input], signal };
          let activation, final;
          const stageMs = [0, 0, 0]; let frameMs = 0;
          const stepStarted = now();
          for (let stage = 0; stage < 3; stage++) {
            const started = now();
            const result = await residents[stage].executeStage({ ...base, partitionIndex: stage,
              continuation: continuations[stage], ...(stage ? { activation } : {}) });
            stageMs[stage] = now() - started;
            continuations[stage] = result.continuation;
            if (stage === 2) { final = result; break; }
            const frameStarted = now();
            const frame = serializeActivationFrame({ ...result.activationTensor, metadata: { fromStage: stage, toStage: stage + 1 } });
            activation = validateActivationFrameForPlan(structuredClone(frame), plan);
            frameMs += now() - frameStarted;
          }
          const total = now() - stepStarted;
          tokens++;
          if (step === 0) prefill = { totalMs: total, stageMs, frameMs };
          else { stageMs.forEach((value, index) => perStage[index].push(value)); frames.push(frameMs); stepTotals.push(total); }
          position += input.length;
          input = [final.tokenId];
          if (final.done) { stopReason = final.stopReason; break; }
        }
        await Promise.all(residents.map((resident, index) => resident.closeAttempt({ identity, partitionIndex: index })));
        report.turns.push({ label: turn.label, promptTokens: tokenized.tokenIds.length, tokens, stopReason, prefill,
          decode: { step: summarize(stepTotals), stages: perStage.map(summarize), frames: summarize(frames) },
          decodeTokensPerSecond: stepTotals.length / (stepTotals.reduce((a, b) => a + b, 0) / 1000) });
        console.log(JSON.stringify({ mode, label: turn.label, promptTokens: tokenized.tokenIds.length, tokens, prefill,
          decodeMedianMs: report.turns.at(-1).decode.step?.medianMs, stageMedians: perStage.map(v => summarize(v)?.medianMs) }));
      }
    } finally {
      const closed = await Promise.allSettled(residents.map(resident => resident.close()));
      report.cleanup = closed.map(row => row.status);
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(outPath, JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
