// Single-machine Doppler run for the answer regression harness (target kind doppler-single-machine).
// Automated regression evaluation — not independent acceptance.
//
// Runs a given Doppler package unmodified against a signed Capsule's model bytes, with the installed catalog's
// generation settings, on one host's GPU through Node WebGPU (Dawn). Self-contained: the harness copies this file
// and a plan to the host, runs it there, and copies back only out.json. Modeled on
// artifacts/answer-cause-20261014/scripts/doppler-reproduce.mjs, which reproduced delivered tokens on mac-host:
//   unsplit              one whole-model pipeline, prefillWithLogits/decodeStepLogits, sampleCapsuleLogits;
//   ordered-three-stage  the catalog plan's resident partitions in one process, driven step by step with activation
//                        frames serialized and validated between stages.
// --preflight verifies identities and tokenizes every turn-1 prompt through the application text path; it opens no GPU.
//
// Usage: node doppler-run.mjs --package-root DIR [--archive TGZ] --capsule DIR --catalog FILE --policy FILE
//          --model-id ID --placement unsplit|ordered-three-stage --plan plan.json --out out.json [--host-label NAME] [--preflight]
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

for (const name of ['log', 'info', 'debug', 'warn']) {
  console[name] = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');
}
const LABEL = 'automated regression evaluation — not independent acceptance';
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = name => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : undefined; };
const required = name => { const value = option(name); if (!value) throw new Error(`--${name} is required`); return value; };
const packageRoot = path.resolve(required('package-root'));
const capsuleDir = required('capsule'), catalogPath = required('catalog'), policyPath = required('policy');
const modelId = required('model-id'), placement = required('placement'), planPath = required('plan'), outPath = required('out');
const archivePath = option('archive'), hostLabel = option('host-label') || 'unnamed-host', preflight = flag('preflight');
if (!['unsplit', 'ordered-three-stage'].includes(placement)) throw new Error('placement must be unsplit or ordered-three-stage');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const started = Date.now();

async function filesUnder(root, skip = new Set(['node_modules'])) {
  const out = [];
  const visit = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full); else if (entry.isFile()) out.push(path.relative(root, full));
    }
  };
  await visit(root);
  return out.sort();
}

/** The package root must hold exactly the archive's files (dependencies under node_modules excepted). */
async function verifyPackage() {
  const version = (await readJson(path.join(packageRoot, 'package.json'))).version;
  if (!archivePath) return { version, archive: null, treeCheck: 'no archive given; package identity is its version only' };
  const archiveSha = sha256(await fs.readFile(archivePath));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-arx-package-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', temp]);
    const extracted = path.join(temp, 'package');
    const files = await filesUnder(extracted), mismatched = [];
    for (const file of files) {
      const expected = sha256(await fs.readFile(path.join(extracted, file)));
      let actual = null;
      try { actual = sha256(await fs.readFile(path.join(packageRoot, file))); } catch { /* missing */ }
      if (actual !== expected) mismatched.push(file);
    }
    if (mismatched.length) throw new Error(`Package root differs from the archive in ${mismatched.length} files: ${mismatched.slice(0, 5).join(', ')}`);
    return { version, archive: { sha256: archiveSha, bytes: (await fs.stat(archivePath)).size },
      treeCheck: `all ${files.length} archive files equal under the package root (node_modules not compared)` };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

const [{ Tokenizer }, { formatChatMessages }, { DOPPLER_VERSION }, { resolveGenerationOptions },
  { resolveResidentPartitionAllocation, hashPartitionGeneration }, { hashLayerPartitionPlan, serializeActivationFrame,
    validateActivationFrameForPlan }] = await Promise.all([
  mod('inference/tokenizer.js'), mod('inference/pipelines/text/chat-format.js'), mod('version.js'), mod('config/generation-contract.js'),
  mod('inference/pipelines/text/resident-partition-contract.js'), mod('inference/pipelines/text/layer-partition-contract.js')]);

// ---- Identities ------------------------------------------------------------------------------
const plan = await readJson(planPath);
const catalogBytes = await fs.readFile(catalogPath);
const entry = JSON.parse(catalogBytes).find(item => item.id === modelId);
if (!entry) throw new Error(`Model ${modelId} is not in the catalog`);
const capsule = entry.capsule, targetPlan = capsule.targetPlans[0];
const modelDir = path.join(capsuleDir, 'artifacts', 'model');
const artifacts = [];
for (const artifact of capsule.artifacts.filter(a => a.path.startsWith('artifacts/model/'))) {
  const digest = 'sha256:' + sha256(await fs.readFile(path.join(capsuleDir, artifact.path)));
  artifacts.push({ path: artifact.path, role: artifact.role, hash: digest, match: digest === artifact.hash });
}
if (!artifacts.every(row => row.match)) throw new Error('Capsule model bytes do not match the signed catalog');
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes), manifestIdentity = 'sha256:' + sha256(manifestBytes);
if (manifestIdentity !== entry.identity) throw new Error('Manifest identity differs from the catalog identity');
const template = manifest.inference?.chatTemplate;
const templateOptions = template?.thinking === true ? { thinking: true } : undefined;
const generation = resolveGenerationOptions(entry.generation);
const generationDigest = hashPartitionGeneration(generation);
const policy = await readJson(policyPath);
const runtimeConfig = structuredClone(targetPlan.initialExecutionIdentity.programLoadPolicy.runtimeConfig);
const partitionPlan = entry.partitionPlan ? structuredClone(entry.partitionPlan) : null;
const planId = partitionPlan ? hashLayerPartitionPlan(partitionPlan) : null;
const tokenizer = new Tokenizer();
await tokenizer.initialize(manifest, { loadTokenizerJson: async () => JSON.parse(await fs.readFile(path.join(modelDir, 'tokenizer.json'), 'utf8')) });
const textIds = messages => Array.from(tokenizer.encode(formatChatMessages(messages, template.type, templateOptions)));

const identities = {
  package: { ...(await verifyPackage()), dopplerVersion: DOPPLER_VERSION },
  model: { catalogId: entry.id, modelId: manifest.modelId, manifestIdentity },
  capsule: { capsuleId: capsule.capsuleId, catalogSha256: sha256(catalogBytes),
    entrySha256: sha256(JSON.stringify(entry)), modelArtifacts: artifacts.length, artifactsMatch: true,
    targetPlanDigest: targetPlan.initialExecutionIdentity.digest },
  placement: { kind: placement, host: hostLabel, planId, splitLayers: partitionPlan?.splitLayers ?? null,
    runtimeConfigSha256: sha256(JSON.stringify(runtimeConfig)), runtime: 'Node WebGPU (Dawn)' },
  sampling: { ...generation, generationDigest, chatTemplate: template },
  limits: { maxTokens: generation.maxTokens, maxSeqLen: generation.maxSeqLen,
    partitionPolicySha256: sha256(await fs.readFile(policyPath)) },
  runtime: { node: process.version, platform: `${os.platform()} ${os.release()}` }
};
const write = async report => fs.writeFile(outPath, JSON.stringify({ schema: 'reploid.answer-regression.doppler-out/v1', label: LABEL,
  host: hostLabel, ...report, seconds: Math.round((Date.now() - started) / 100) / 10 }, null, 1) + '\n', { flag: 'wx' });

if (preflight) {
  const prompts = plan.items.filter(item => item.turns[0]?.dispatch)
    .map(item => ({ id: item.id, turn1PromptTokens: textIds([{ role: 'user', content: item.turns[0].send }]).length }));
  await write({ identities, preflight: { gpu: 'not opened', prompts } });
  process.exit(0);
}

// ---- GPU -----------------------------------------------------------------------------------------
const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim }, { initDevice, destroyDevice, getKernelCapabilities },
  { createPipeline }, { createNodeFileArtifactStorageContext }, { createModelHandle }, { createCapsuleProgramAdapter },
  { createResidentPartitionSession }, { sampleCapsuleLogits, stoppingReason }, { createDopplerLoader },
  { assertInitialExecutionIdentity }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'), mod('inference/pipelines/text.js'),
  mod('storage/artifact-storage-context.js'), mod('client/model-host/model-session.js'), mod('client/runtime/capsule-program-adapter.js'),
  mod('inference/pipelines/text/resident-partition.js'), mod('inference/generation-step.js'), mod('loader/doppler-loader.js'),
  mod('config/initial-execution-identity.js')]);

function margin(logits, padTokenId) {
  let best = -Infinity, second = -Infinity;
  for (let index = 0; index < logits.length; index++) {
    const value = logits[index];
    if (index === padTokenId || !Number.isFinite(value)) continue;
    if (value > best) { second = best; best = value; } else if (value > second) second = value;
  }
  return Number.isFinite(second) ? Math.round((best - second) * 1e4) / 1e4 : null;
}

async function openProgram(index) {
  const storage = createNodeFileArtifactStorageContext(pathToFileURL(modelDir + path.sep).href, manifest);
  if (!storage) throw new Error('Node file storage context unavailable');
  const pipeline = await createPipeline(manifest, { ...(index === null ? {} : { partition: { plan: partitionPlan, index } }),
    storage, runtimeConfig: structuredClone(runtimeConfig), loader: createDopplerLoader(runtimeConfig.loading), ownsLoader: true });
  const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: manifestIdentity.slice(7) });
  const program = createCapsuleProgramAdapter(handle, capsule, targetPlan);
  const identity = await program.getInitialExecutionIdentity();
  assertInitialExecutionIdentity(targetPlan.initialExecutionIdentity, identity);
  return { pipeline, handle, program, executionIdentity: identity.digest };
}

const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
const capabilities = getKernelCapabilities();
const gpu = { provider: bootstrap.provider, adapter: capabilities.adapterInfo ?? null, hasF16: capabilities.hasF16,
  hasSubgroups: capabilities.hasSubgroups };
const items = [];
const finishTurn = (row, tokens, margins, content, stopReason, turnStarted) => {
  const minimum = margins.length ? margins.reduce((at, value, index) => (value !== null && (at < 0 || value < margins[at]) ? index : at), -1) : -1;
  return { ...row, outputTokenIds: tokens, output: content, stopReason, decodeSteps: tokens.length,
    seconds: Math.round((Date.now() - turnStarted) / 10) / 100, minMarginTop1Top2: minimum >= 0 ? margins[minimum] : null,
    minMarginStep: minimum >= 0 ? minimum : null };
};

async function runItems(generate) {
  const cache = new Map();
  for (const item of plan.items) {
    let messages = [];
    const turns = [];
    for (const [index, turn] of item.turns.entries()) {
      if (!turn.dispatch) break;
      messages = [...messages, { role: 'user', content: turn.send }];
      const rendered = formatChatMessages(messages, template.type, templateOptions);
      const row = { turn: index + 1, messages, renderedPromptSha256: sha256(rendered) };
      const key = JSON.stringify(messages);
      let result;
      if (cache.has(key)) result = { ...cache.get(key).result, reusedFrom: cache.get(key).itemId };
      else { result = await generate(messages, row); cache.set(key, { itemId: item.id, result }); }
      if (JSON.stringify(result.promptTokenIds) !== JSON.stringify(textIds(messages))) {
        throw new Error(`${item.id} turn ${index + 1}: Doppler's prompt tokens differ from the application text path`);
      }
      turns.push({ ...row, ...result });
      console.log(JSON.stringify({ item: item.id, turn: index + 1, steps: result.decodeSteps, stop: result.stopReason }));
      if (index + 1 < item.turns.length) {
        if (!result.output.trim()) break;
        messages = [...messages, { role: 'assistant', content: result.output }];
      }
    }
    items.push({ id: item.id, category: item.category, turns });
  }
}

try {
  if (placement === 'unsplit') {
    const whole = await openProgram(null);
    identities.placement.executionIdentity = whole.executionIdentity;
    const contract = whole.program.getTokenContract();
    identities.sampling.tokenContract = contract;
    try {
      await runItems(async messages => {
        const input = whole.program.tokenize(messages, generation);
        whole.pipeline.reset();
        const context = [...input], decoder = whole.program.createIncrementalDecoder(), tokens = [], margins = [];
        let content = '', cache = null, stopReason = null;
        const turnStarted = Date.now();
        try {
          for (let step = 0; step < generation.maxTokens; step++) {
            const output = step === 0
              ? await whole.pipeline.prefillWithLogits(messages, { inputIds: input, useChatTemplate: false })
              : await whole.pipeline.decodeStepLogits(context, { useChatTemplate: false });
            if (step === 0) cache = output.cache;
            margins.push(margin(output.logits, contract.padTokenId));
            const tokenId = sampleCapsuleLogits(output.logits, context, generation, contract);
            context.push(tokenId); tokens.push(tokenId);
            let delta = decoder.push(tokenId);
            const reason = stoppingReason(tokenId, step + 1, generation, contract, () => content + delta + decoder.pendingText());
            if (reason) delta += decoder.finish({ stopReason: reason });
            content += delta;
            if (reason) { stopReason = reason; break; }
          }
        } finally { cache?.destroy?.(); }
        return finishTurn({ promptTokenIds: input, promptTokenCount: input.length }, tokens, margins, content, stopReason, turnStarted);
      });
    } finally { await whole.handle.unload(); }
  } else {
    if (!partitionPlan) throw new Error('The catalog entry has no partition plan');
    const stages = partitionPlan.partitions.map(partition => ({ index: partition.index,
      participantId: `peer:${hostLabel}-regression-stage-${partition.index}`, transportId: randomUUID(),
      residentId: `${hostLabel}-regression-${partition.index}-resident`, executionId: `${hostLabel}-regression-${partition.index}-ordinary` }));
    const residents = [], programs = [], opening = new AbortController();
    try {
      for (const stage of stages) {
        const opened = await openProgram(stage.index);
        programs.push(opened);
        const allocation = resolveResidentPartitionAllocation(manifest, manifestIdentity, { model: { id: manifest.modelId,
          identity: manifestIdentity }, plan: partitionPlan, planId, index: stage.index, participantId: stage.participantId,
        limits: structuredClone(policy.limits), generation });
        residents.push(await createResidentPartitionSession(opened.pipeline, allocation, opened.program, () => opened.handle.unload(), opening.signal));
      }
      identities.placement.executionIdentities = programs.map(p => p.executionIdentity);
      const contract = programs.at(-1).program.getTokenContract();
      identities.sampling.tokenContract = contract;
      const last = stages.length - 1;
      await runItems(async messages => {
        const identity = { schema: 'doppler.resident-partition-attempt/v2', modelId: manifest.modelId, modelIdentity: manifestIdentity,
          planId, threadId: 'answer-regression-' + randomUUID(), attemptId: randomUUID(), requesterId: `peer:${hostLabel}-regression-requester`,
          placementGeneration: 0, stages };
        const signal = new AbortController().signal;
        const tokenized = await residents[0].tokenize({ messages, identity, signal });
        if (hashPartitionGeneration(tokenized.generation) !== generationDigest) throw new Error('Tokenizer returned a different generation');
        const continuations = stages.map(() => null), tokens = [], margins = [];
        let input = [...tokenized.tokenIds], position = 0, content = '', stopReason = null;
        const turnStarted = Date.now();
        try {
          for (let step = 0; step < generation.maxTokens; step++) {
            const base = { identity, step, tokenPosition: position, inputTokenCount: input.length, maxTokens: generation.maxTokens,
              generationDigest, generation, inputTokenIds: [...input], signal };
            let activation, final;
            for (let stage = 0; stage <= last; stage++) {
              const result = await residents[stage].executeStage({ ...base, partitionIndex: stage, continuation: continuations[stage],
                ...(stage ? { activation } : {}) });
              continuations[stage] = result.continuation;
              if (stage === last) { final = result; break; }
              const frame = serializeActivationFrame({ ...result.activationTensor, metadata: { fromStage: stage, toStage: stage + 1 } });
              activation = validateActivationFrameForPlan(structuredClone(frame), partitionPlan);
            }
            content += final.delta;
            tokens.push(final.tokenId);
            margins.push(margin(final.logits, contract.padTokenId));
            position += input.length;
            input = [final.tokenId];
            if (final.done) { stopReason = final.stopReason; break; }
          }
        } finally {
          await Promise.all(residents.map((resident, index) => resident.closeAttempt({ identity, partitionIndex: index })));
        }
        return finishTurn({ promptTokenIds: tokenized.tokenIds, promptTokenCount: tokenized.tokenIds.length }, tokens, margins,
          content, stopReason, turnStarted);
      });
    } finally { await Promise.allSettled(residents.map(resident => resident.close())); }
  }
  await write({ identities, gpu, items });
} finally {
  destroyDevice();
  await releaseNodeWebGPU();
}
