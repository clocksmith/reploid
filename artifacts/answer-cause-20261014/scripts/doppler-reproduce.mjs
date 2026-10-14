// Single-machine Doppler reproduction of the two failed answers on mac-host.
//
// Runs the Doppler 0.6.28 candidate archive (sha256:2df37d88...) unmodified, against
// the signed Capsule `-c` model bytes, with the installed catalog's generation settings
// and three-stage ordered plan. Two modes, both on one Mac GPU in one process:
//   A. "ordered-three-stage": three resident partitions (layers 0-7, 8-15, 16-23) opened
//      through Doppler's own createResidentPartitionSession, driven step by step exactly
//      as Reploid's partition-route-execution.js drives them (activation frames serialized
//      and validated between stages; sampling by the final stage's sampleCapsuleLogits).
//   B. "unsplit": one whole-model pipeline, prefillWithLogits/decodeStepLogits, sampled by
//      the same sampleCapsuleLogits (pattern of reploid tests/contracts/doppler-partition-
//      installed-physical.js).
// Both load with the Capsule TargetPlan's programLoadPolicy.runtimeConfig, as the signed
// opener does, and the observed initial execution identity is checked against the
// TargetPlan before any token is produced.
//
// Usage:
//   node doppler-reproduce.mjs <doppler package root> <capsule dir> <installed catalog>
//        <partition policy> <distributed-observed.json> <out.json>
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, capsuleDir, catalogPath, policyPath, observedPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('Usage: doppler-reproduce.mjs PACKAGE CAPSULE CATALOG POLICY OBSERVED OUT');
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

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
  mod('config/initial-execution-identity.js'), mod('inference/pipelines/text/chat-format.js'),
  mod('version.js'),
]);

const report = { schema: 'reploid.answer-cause.doppler-single-machine/v1', startedAt: new Date().toISOString(),
  machine: 'mac-host', dopplerVersion: DOPPLER_VERSION, packageRoot, inputs: {}, verification: {}, modes: {} };

// ---- Inputs and byte identity -------------------------------------------------------
const catalog = (await readJson(catalogPath)).find(entry => entry.id === 'qwen-3-5-0-8b-q4k-ehaf16');
const capsule = catalog.capsule;
const targetPlan = capsule.targetPlans[0];
const policy = await readJson(policyPath);
const observed = await readJson(observedPath);
const modelDir = path.join(capsuleDir, 'artifacts', 'model');
const archivePackageJson = await readJson(path.join(packageRoot, 'package.json'));
report.inputs = { catalog: { path: catalogPath, sha256: sha256(await fs.readFile(catalogPath)) },
  partitionPolicy: { path: policyPath, sha256: sha256(await fs.readFile(policyPath)) },
  capsuleDir, capsuleId: capsule.capsuleId, archivePackageVersion: archivePackageJson.version };

const artifactChecks = [];
for (const artifact of capsule.artifacts.filter(a => a.path.startsWith('artifacts/model/'))) {
  const file = path.join(capsuleDir, artifact.path);
  const digest = 'sha256:' + sha256(await fs.readFile(file));
  artifactChecks.push({ path: artifact.path, role: artifact.role, expected: artifact.hash, actual: digest, match: digest === artifact.hash });
}
report.verification.capsuleModelArtifacts = { count: artifactChecks.length,
  allMatch: artifactChecks.every(row => row.match), rows: artifactChecks };
if (!report.verification.capsuleModelArtifacts.allMatch) throw new Error('Capsule model bytes do not match the signed catalog.');

const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestIdentity = 'sha256:' + sha256(manifestBytes);
if (manifestIdentity !== catalog.identity) throw new Error('Manifest identity differs from catalog identity.');

const plan = structuredClone(catalog.partitionPlan);
const planId = hashLayerPartitionPlan(plan);
const frozenPlanId = observed.runs['run-5'].freeze.planId;
report.verification.plan = { planId, frozenPlanId, match: planId === frozenPlanId, splitLayers: plan.splitLayers };
if (planId !== frozenPlanId) throw new Error('Partition plan differs from the frozen journey plan.');

const generation = resolveGenerationOptions(catalog.generation);
const generationDigest = hashPartitionGeneration(generation);
report.inputs.generation = generation;
report.inputs.generationDigest = generationDigest;
report.inputs.seed = Object.hasOwn(generation, 'seed') ? generation.seed : null;
report.inputs.chatTemplate = manifest.inference.chatTemplate;
const limits = structuredClone(policy.limits);
const runtimeConfig = structuredClone(targetPlan.initialExecutionIdentity.programLoadPolicy.runtimeConfig);
report.inputs.runtimeConfigSource = 'capsule.targetPlans[0].initialExecutionIdentity.programLoadPolicy.runtimeConfig';
report.inputs.runtimeConfigSha256 = sha256(JSON.stringify(runtimeConfig));

const turns = observed.runs['run-5'].turns.map(turn => ({ label: turn.label, messages: turn.requestMessages,
  distributed: { output: turn.output, decodeSteps: turn.decodeSteps, stopReason: turn.stopReason,
    deltas: turn.streamedDeltas.map(delta => delta.text), impliedPromptTokens: turn.impliedPromptTokens } }));

// ---- Helpers ----------------------------------------------------------------------------
function topK(logits, k = 5) {
  const best = [];
  for (let index = 0; index < logits.length; index++) {
    const value = logits[index];
    if (!Number.isFinite(value)) continue;
    if (best.length < k || value > best[best.length - 1].logit) {
      best.push({ tokenId: index, logit: value });
      best.sort((a, b) => b.logit - a.logit || a.tokenId - b.tokenId);
      if (best.length > k) best.pop();
    }
  }
  return best;
}
function describeStep(step, tokenId, delta, logits, decode) {
  const top = topK(logits);
  return { step, tokenId, text: delta, top5: top.map(row => ({ ...row, text: decode([row.tokenId]) })),
    marginTop1Top2: top.length > 1 ? top[0].logit - top[1].logit : null };
}
function firstDeltaDivergence(expected, actual) {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index++) {
    if (expected[index] !== actual[index]) return { step: index, distributed: expected[index] ?? null, reproduced: actual[index] ?? null };
  }
  return null;
}
async function openProgram(index) {
  const storage = createNodeFileArtifactStorageContext(pathToFileURL(modelDir + path.sep).href, manifest);
  if (!storage) throw new Error('Node file storage context unavailable.');
  const pipeline = await createPipeline(manifest, { ...(index === null ? {} : { partition: { plan, index } }),
    storage, runtimeConfig: structuredClone(runtimeConfig), loader: createDopplerLoader(runtimeConfig.loading), ownsLoader: true });
  const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: manifestIdentity.slice(7) });
  const program = createCapsuleProgramAdapter(handle, capsule, targetPlan);
  const identity = await program.getInitialExecutionIdentity();
  let identityCheck;
  try { assertInitialExecutionIdentity(targetPlan.initialExecutionIdentity, identity); identityCheck = { match: true }; }
  catch (error) { identityCheck = { match: false, error: error.message }; }
  return { pipeline, handle, program, identityCheck: { ...identityCheck, expected: targetPlan.initialExecutionIdentity.digest,
    observed: identity.digest, executionGraphHash: identity.executionGraphHash } };
}

// ---- GPU ----------------------------------------------------------------------------------
const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
const capabilities = getKernelCapabilities();
report.gpu = { provider: bootstrap.provider, adapter: capabilities.adapterInfo ?? null,
  hasF16: capabilities.hasF16, hasSubgroups: capabilities.hasSubgroups };

try {
  // ---- Mode A: ordered three-stage resident route on one machine --------------------------
  const stages = plan.partitions.map(partition => ({ index: partition.index,
    participantId: 'peer:mac-host-repro-stage-' + partition.index, transportId: randomUUID(),
    residentId: 'mac-host-repro-' + partition.index + '-resident', executionId: 'mac-host-repro-' + partition.index + '-ordinary' }));
  const residents = [], programs = [];
  const opening = new AbortController();
  try {
    for (const stage of stages) {
      const opened = await openProgram(stage.index);
      programs.push(opened);
      const allocation = resolveResidentPartitionAllocation(manifest, manifestIdentity, { model: { id: manifest.modelId,
        identity: manifestIdentity }, plan, planId, index: stage.index, participantId: stage.participantId, limits, generation });
      residents.push(await createResidentPartitionSession(opened.pipeline, allocation, opened.program,
        () => opened.handle.unload(), opening.signal));
    }
    report.verification.orderedExecutionIdentity = programs.map((p, index) => ({ partitionIndex: index, ...p.identityCheck }));
    const decode = ids => programs[0].handle.advanced.decodeTokenIds(ids);
    report.modes.orderedThreeStage = { turns: [] };
    for (const turn of turns) {
      const identity = { schema: 'doppler.resident-partition-attempt/v2', modelId: manifest.modelId,
        modelIdentity: manifestIdentity, planId, threadId: 'answer-cause-' + turn.label, attemptId: randomUUID(),
        requesterId: 'peer:mac-host-repro-requester', placementGeneration: 0, stages };
      const signal = new AbortController().signal;
      const tokenized = await residents[0].tokenize({ messages: turn.messages, identity, signal });
      const rendered = formatChatMessages(turn.messages, manifest.inference.chatTemplate.type,
        programs[0].pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined);
      const renderedTokenIds = programs[0].handle.advanced.tokenizeText(rendered);
      const sameTokens = JSON.stringify(renderedTokenIds) === JSON.stringify(tokenized.tokenIds);
      if (!sameTokens) throw new Error('Rendered template text does not tokenize to the resident prompt.');
      if (hashPartitionGeneration(tokenized.generation) !== generationDigest) throw new Error('Tokenizer returned different generation.');
      const continuations = [null, null, null], steps = [];
      let input = [...tokenized.tokenIds], position = 0, activationBytes = 0, content = '', stopReason = null;
      for (let step = 0; step < generation.maxTokens; step++) {
        const base = { identity, step, tokenPosition: position, inputTokenCount: input.length,
          maxTokens: generation.maxTokens, generationDigest, generation, inputTokenIds: [...input], signal };
        let activation, final;
        for (let stage = 0; stage < 3; stage++) {
          const result = await residents[stage].executeStage({ ...base, partitionIndex: stage,
            continuation: continuations[stage], ...(stage ? { activation } : {}) });
          continuations[stage] = result.continuation;
          if (stage === 2) { final = result; break; }
          const frame = serializeActivationFrame({ ...result.activationTensor, metadata: { fromStage: stage, toStage: stage + 1 } });
          activationBytes += frame.byteLength;
          activation = validateActivationFrameForPlan(structuredClone(frame), plan);
        }
        content += final.delta;
        steps.push(describeStep(step, final.tokenId, final.delta, final.logits, decode));
        position += input.length;
        input = [final.tokenId];
        if (final.done) { stopReason = final.stopReason; break; }
      }
      await Promise.all(residents.map((resident, index) => resident.closeAttempt({ identity, partitionIndex: index })));
      const deltas = steps.map(step => step.text).filter(text => text.length > 0);
      report.modes.orderedThreeStage.turns.push({ label: turn.label, renderedPrompt: rendered,
        promptTokenIds: tokenized.tokenIds, promptTokenCount: tokenized.tokenIds.length,
        promptTokenCountMatchesDistributedActivationBytes: tokenized.tokenIds.length === turn.distributed.impliedPromptTokens,
        tokenIds: steps.map(step => step.tokenId), output: content, stopReason, decodeSteps: steps.length,
        activationBytes, outputEqualsDistributed: content === turn.distributed.output,
        decodeStepsEqualDistributed: steps.length === turn.distributed.decodeSteps,
        firstDeltaDivergenceFromDistributed: firstDeltaDivergence(turn.distributed.deltas, deltas), steps });
      console.log(JSON.stringify({ mode: 'ordered', turn: turn.label, promptTokens: tokenized.tokenIds.length,
        steps: steps.length, stopReason, output: content }));
    }
  } finally {
    const closed = await Promise.allSettled(residents.map(resident => resident.close()));
    report.cleanup = { orderedResidents: closed.map(row => row.status) };
  }

  // ---- Mode B: unsplit single pipeline -----------------------------------------------------
  const whole = await openProgram(null);
  report.verification.unsplitExecutionIdentity = whole.identityCheck;
  report.modes.unsplit = { turns: [] };
  const tokenContract = whole.program.getTokenContract();
  report.inputs.tokenContract = tokenContract;
  try {
    for (const turn of turns) {
      const input = whole.program.tokenize(turn.messages, generation);
      whole.pipeline.reset();
      const context = [...input], decoder = whole.program.createIncrementalDecoder(), steps = [];
      let content = '', cache = null, stopReason = null;
      try {
        for (let step = 0; step < generation.maxTokens; step++) {
          const output = step === 0
            ? await whole.pipeline.prefillWithLogits(turn.messages, { inputIds: input, useChatTemplate: false })
            : await whole.pipeline.decodeStepLogits(context, { useChatTemplate: false });
          if (step === 0) cache = output.cache;
          const tokenId = sampleCapsuleLogits(output.logits, context, generation, tokenContract);
          context.push(tokenId);
          let delta = decoder.push(tokenId);
          const reason = stoppingReason(tokenId, step + 1, generation, tokenContract, () => content + delta + decoder.pendingText());
          if (reason) delta += decoder.finish({ stopReason: reason });
          content += delta;
          steps.push(describeStep(step, tokenId, delta, output.logits, ids => whole.handle.advanced.decodeTokenIds(ids)));
          if (reason) { stopReason = reason; break; }
        }
      } finally { cache?.destroy?.(); }
      const deltas = steps.map(step => step.text).filter(text => text.length > 0);
      report.modes.unsplit.turns.push({ label: turn.label, promptTokenIds: input, promptTokenCount: input.length,
        tokenIds: steps.map(step => step.tokenId), output: content, stopReason, decodeSteps: steps.length,
        outputEqualsDistributed: content === turn.distributed.output,
        decodeStepsEqualDistributed: steps.length === turn.distributed.decodeSteps,
        firstDeltaDivergenceFromDistributed: firstDeltaDivergence(turn.distributed.deltas, deltas), steps });
      console.log(JSON.stringify({ mode: 'unsplit', turn: turn.label, promptTokens: input.length,
        steps: steps.length, stopReason, output: content }));
    }
  } finally { await whole.handle.unload(); }
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(outPath, JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
