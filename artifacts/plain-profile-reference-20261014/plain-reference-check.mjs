// Plain (ordinary f32) profile against the approved independent F64 reference, whole model on one
// machine. Same comparison as tests/fixtures/ordered-partition-reference.js: for each of the 55
// teacher-forced steps, every one of the 248,320 f32 logits must be within 0.001 of the F64
// reference, and the selected token and stop reason must equal the reference's. Unlike the
// qualification harness, this run does not stop at the first failure: it records every step.
//
// Usage: node plain-reference-check.mjs <doppler package root> <model dir> <approved-reference.json>
//          <dir holding request-{0,1,2}-contract.json> <out.json> [session overrides JSON]
// Session overrides, when given, are applied to a copy of Doppler's default runtime config
// (inference.session.*) and passed to createPipeline; everything else stays manifest-first.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, modelDir, referencePath, contractsDir, outPath, overridesArg] = process.argv.slice(2);
const sessionOverrides = overridesArg ? JSON.parse(overridesArg) : null;
if (!outPath) throw new Error('Usage: plain-reference-check.mjs PACKAGE MODEL REFERENCE CONTRACTS_DIR OUT');
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim },
  { initDevice, destroyDevice, getKernelCapabilities }, { createPipeline },
  { createNodeFileArtifactStorageContext }, { createModelHandle }, { formatChatMessages }, { DOPPLER_VERSION },
  { getRuntimeConfig }, { createDopplerLoader }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'),
  mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'),
  mod('client/model-host/model-session.js'), mod('inference/pipelines/text/chat-format.js'), mod('version.js'),
  mod('config/runtime.js'), mod('loader/doppler-loader.js'),
]);

const referenceBytes = await fs.readFile(referencePath);
const reference = JSON.parse(referenceBytes);
const contractBytes = await Promise.all(reference.expected.map((_, index) => fs.readFile(path.join(contractsDir, `request-${index}-contract.json`))));
const requests = contractBytes.map(bytes => JSON.parse(bytes));
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestIdentity = 'sha256:' + sha256(manifestBytes);
const report = { schema: 'reploid.plain-profile-reference-check/v1', startedAt: new Date().toISOString(), machine: 'amd-host',
  dopplerVersion: DOPPLER_VERSION, referenceSha256: 'sha256:' + sha256(referenceBytes), referenceModelIdentity: reference.modelIdentity,
  manifestIdentity, manifestMatchesReference: manifestIdentity === reference.modelIdentity,
  runtime: sessionOverrides ? { sessionOverrides } : 'manifest defaults (no runtimeConfig override)', compute: manifest.inference?.session?.compute?.defaults ?? null,
  kvcache: manifest.inference?.session?.kvcache?.kvDtype ?? null, tolerance: reference.numericalReference.tolerance,
  requiredSteps: reference.numericalReference.steps, requestContractSha256: contractBytes.map(bytes => 'sha256:' + sha256(bytes)), requests: [] };

function decodeReferenceLogits(step) {
  const bytes = Buffer.from(step.logits, 'base64');
  const dtype = step.logitsDtype ?? 'f32';
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return dtype === 'f64' ? new Float64Array(buffer) : new Float32Array(buffer);
}
const argmax = values => { let best = 0; for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i; return best; };

const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
const capabilities = getKernelCapabilities();
report.gpu = { adapter: capabilities.adapterInfo ?? null, hasF16: capabilities.hasF16 };

const storage = createNodeFileArtifactStorageContext(pathToFileURL(modelDir + path.sep).href, manifest);
const pipelineOptions = { storage, ownsLoader: true };
if (sessionOverrides) {
  const runtimeConfig = structuredClone(getRuntimeConfig());
  Object.assign(runtimeConfig.inference.session, sessionOverrides);
  Object.assign(pipelineOptions, { runtimeConfig, loader: createDopplerLoader(runtimeConfig.loading) });
}
const pipeline = await createPipeline(manifest, pipelineOptions);
const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: manifestIdentity.slice(7) });
try {
  const thinking = pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined;
  for (let attempt = 0; attempt < reference.expected.length; attempt++) {
    const target = reference.expected[attempt];
    const contract = requests[attempt];
    const ids = handle.advanced.tokenizeText(formatChatMessages(reference.prompts[attempt], manifest.inference.chatTemplate.type, thinking));
    const frozenPrefix = contract?.inputIds?.slice(0, contract.prefixLengths?.[0]) ?? null;
    const row = { attempt, promptTokens: ids.length, promptMatchesFrozenPrefix: frozenPrefix ? JSON.stringify(ids) === JSON.stringify(frozenPrefix) : null,
      steps: [] };
    report.requests.push(row);
    pipeline.reset();
    const context = [...ids];
    let cache = null;
    try {
      for (let step = 0; step < target.steps.length; step++) {
        const started = performance.now();
        const output = step === 0
          ? await pipeline.prefillWithLogits(reference.prompts[attempt], { inputIds: ids, useChatTemplate: false })
          : await pipeline.decodeStepLogits(context, { useChatTemplate: false });
        const elapsedMs = performance.now() - started;
        if (step === 0) cache = output.cache;
        const actual = output.logits, independent = decodeReferenceLogits(target.steps[step]);
        let maxDifference = 0, at = -1, finite = actual.length === independent.length;
        for (let index = 0; index < actual.length; index++) {
          if (!Number.isFinite(actual[index])) { finite = false; continue; }
          const difference = Math.abs(actual[index] - independent[index]);
          if (difference > maxDifference) { maxDifference = difference; at = index; }
        }
        const tokenId = argmax(actual);
        row.steps.push({ step, maxDifference, maxDifferenceAt: at, finite, withinTolerance: finite && maxDifference <= 0.001,
          tokenId, referenceTokenId: target.steps[step].tokenId, tokenMatches: tokenId === target.steps[step].tokenId, elapsedMs });
        context.push(target.steps[step].tokenId); // teacher-forced along the reference tokens
      }
    } finally { cache?.destroy?.(); }
    row.maxDifference = Math.max(...row.steps.map(s => s.maxDifference));
    row.failedSteps = row.steps.filter(s => !s.withinTolerance || !s.tokenMatches).map(s => s.step);
    console.log(JSON.stringify({ attempt, promptTokens: ids.length, promptMatchesFrozenPrefix: row.promptMatchesFrozenPrefix,
      steps: row.steps.length, maxDifference: row.maxDifference, failedSteps: row.failedSteps.length, tokenMismatches: row.steps.filter(s => !s.tokenMatches).length }));
  }
  const all = report.requests.flatMap(r => r.steps);
  report.summary = { comparedSteps: all.length, withinTolerance: all.filter(s => s.withinTolerance).length,
    tokenMatches: all.filter(s => s.tokenMatches).length, maxDifference: Math.max(...all.map(s => s.maxDifference)),
    passed: all.length === reference.numericalReference.steps && all.every(s => s.withinTolerance && s.tokenMatches) };
  console.log(JSON.stringify(report.summary));
} finally {
  await handle.unload();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(outPath, JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
