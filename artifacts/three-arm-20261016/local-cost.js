// Three-arm cost experiment. Adapted from speed-isolation-20261014/speed-ladder.mjs.
// Only paired whole/local arms run; archive, manifest, workloads and acceptance are in contract.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, modelDir, catalogPath, policyPath, observedPath, mode, maxTokensArg, outPath, ordinaryModelDir] = process.argv.slice(2);
const MODES = ['paired-unsplit', 'paired-three-stage'];
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
  machine: 'amd-host', dopplerVersion: DOPPLER_VERSION, inputs: {}, verification: {}, turns: [], clock: 'performance.now, milliseconds'  };

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
  const bytes = await fs.readFile(path.join(modelDir, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!bytes) { absent.push(name); continue; }
  checks.push({ file: name, match: 'sha256:' + sha256(bytes) === artifact.hash });
}
report.verification.modelArtifacts = { checked: checks.length, allMatch: checks.every(row => row.match), absent };
if (!report.verification.modelArtifacts.allMatch) throw new Error('Model bytes do not match the installed catalog.');
if (absent.some(name => name === 'manifest.json' || /^shard_\d+\.bin$/.test(name))) throw new Error('Model weights or manifest absent: ' + absent.join(', '));
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestIdentity = 'sha256:' + sha256(manifestBytes);
if (manifestIdentity !== catalog.identity) throw new Error('Manifest identity differs from catalog identity.');

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
const originalTurns = observed.runs['run-5'].turns.map(turn => ({ label: turn.label, messages: turn.requestMessages }));
const turns = Array.from({length: 4}, (_, repeat) => originalTurns.map(turn => ({...turn, label: `${repeat}:${turn.label}`, repeat}))).flat();
const { getBufferPool } = await mod('memory/buffer-pool.js');
const memory = () => ({process: process.memoryUsage(), processPeakRssKiB: process.resourceUsage().maxRSS, pool: getBufferPool().getStats()});
const executionStarted = now();

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
  if (mode === 'paired-unsplit') {
    const whole = await openProgram(null, capsuleRuntimeConfig);
    report.loadMs = whole.loadMs;
    const program = createCapsuleProgramAdapter(whole.handle, capsule, targetPlan);
    const identity = await program.getInitialExecutionIdentity();
    try { assertInitialExecutionIdentity(targetPlan.initialExecutionIdentity, identity); report.verification.executionIdentity = { match: true }; }
    catch (error) { report.verification.executionIdentity = { match: false, error: error.message }; throw error; }
    const tokenContract = program.getTokenContract();
    try {
      for (const turn of turns) {
        const memoryBefore = memory(), turnStarted = now();
        const input = program.tokenize(turn.messages, generation);
        whole.pipeline.reset();
        const context = [...input], steps = [];
        const generatedTokenIds = [];
        let firstTokenMs = null;
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
            context.push(tokenId); generatedTokenIds.push(tokenId);
            if (step === 0) firstTokenMs = now() - turnStarted;
            stopReason = stoppingReason(tokenId, step + 1, generation, tokenContract, () => '') || null;
            if (stopReason) break;
          }
        } finally { cache?.destroy?.(); }
        report.turns.push({ label: turn.label, repeat: turn.repeat, promptTokens: input.length, promptTokenIds: input, tokens: generatedTokenIds.length, generatedTokenIds, answer: whole.handle.advanced.decodeTokenIds(generatedTokenIds), stopReason, prefillMs, firstTokenMs, decode: summarize(steps), completeAnswerMs: now() - turnStarted, memoryBefore, memoryAfter: memory() });
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
        const memoryBefore = memory(), turnStarted = now();
        const tokenized = await residents[0].tokenize({ messages: turn.messages, identity, signal });
        const continuations = [null, null, null];
        const perStage = [[], [], []], frames = [], stepTotals = [];
        let input = [...tokenized.tokenIds], position = 0, prefill = null, stopReason = null, tokens = 0;
        const generatedTokenIds = [];
        let firstTokenMs = null;
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
          tokens++; generatedTokenIds.push(final.tokenId);
          if (step === 0) firstTokenMs = now() - turnStarted;
          if (step === 0) prefill = { totalMs: total, stageMs, frameMs };
          else { stageMs.forEach((value, index) => perStage[index].push(value)); frames.push(frameMs); stepTotals.push(total); }
          position += input.length;
          input = [final.tokenId];
          if (final.done) { stopReason = final.stopReason; break; }
        }
        const completeAnswerMs = now() - turnStarted, cleanupStarted = now();
        await Promise.all(residents.map((resident, index) => resident.closeAttempt({ identity, partitionIndex: index })));
        report.turns.push({ label: turn.label, repeat: turn.repeat, promptTokens: tokenized.tokenIds.length, promptTokenIds: tokenized.tokenIds, tokens, generatedTokenIds, answer: programs[0].handle.advanced.decodeTokenIds(generatedTokenIds), stopReason, prefill, firstTokenMs, completeAnswerMs, attemptCleanupMs: now() - cleanupStarted, memoryBefore, memoryAfter: memory(),
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
  report.totalExecutionMs = now() - executionStarted;
  report.memoryAtCleanup = memory();
  for (const turn of report.turns) {
    const prefill = turn.prefillMs ?? turn.prefill?.totalMs;
    const decode = turn.decode?.totalMs ?? turn.decode?.step?.totalMs;
    turn.accounting = {prefillMs: prefill, decodeMs: decode, unaccountedMs: turn.completeAnswerMs - prefill - decode, scope: 'non-overlapping wall intervals; GPU/driver subphases unavailable'};
  }
  await fs.writeFile(outPath, JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
