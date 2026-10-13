import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority, orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';

const [dopplerArgument, reportArgument] = process.argv.slice(2);
assert(dopplerArgument && reportArgument, 'Usage: node run.mjs /absolute/doppler /new/report.json');
const doppler = await fs.realpath(dopplerArgument), reportPath = path.resolve(reportArgument);
await fs.access(reportPath).then(() => { throw Error('Report already exists'); }, error => { if (error.code !== 'ENOENT') throw error; });
const load = name => import(pathToFileURL(path.join(doppler, name)).href);
const report = { scope: 'CPU source integration: real ordered Reploid facade, WebCrypto v4 grants and runner and Doppler resident state/sampling/decoder; injected numerical kernels and private cache allocation; real grant signatures only; no signed execution publication, GPU, physical capacity or answer-quality claim',
  startedAt: new Date().toISOString(), doppler, cases: [], grants: [], sources: {}, tokenizations: [], states: [] };
const sources = ['src/inference/pipelines/text/resident-partition.js', 'src/inference/pipelines/text/resident-partition-contract.js',
  'src/inference/pipelines/text/layer-partition-contract.js', 'src/partitions.js', 'src/inference/generation-step.js', 'src/inference/token-sampling.js',
  'src/config/generation-contract.js', 'src/inference/tokenizers/bundled/incremental-decoder.js'];
for (const file of sources) report.sources[file] = createHash('sha256').update(await fs.readFile(path.join(doppler, file))).digest('hex');
report.reploidSources = {};
for (const name of ['packages/reploid/src/mesh/partitions/partition-route-execution.js', 'packages/reploid/src/mesh/partitions/partition-contract.js', 'packages/reploid/src/mesh/partitions/partition-runner.js', 'packages/reploid/src/mesh/partitions/resident-partition.js', 'packages/reploid/src/mesh/partitions/resident-route.js', 'packages/reploid/src/mesh/partitions/partition-grants.js']) {
  report.reploidSources[name] = createHash('sha256').update(await fs.readFile(new URL('../../' + name, import.meta.url))).digest('hex');
}
report.toolSha256 = createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');
const layer = await load('src/inference/pipelines/text/layer-partition-contract.js');
const { resolveResidentPartitionAllocation, assertResidentPartitionIdentity } = await load('src/inference/pipelines/text/resident-partition-contract.js');
const { resolveGenerationOptions } = await load('src/config/generation-contract.js');
const { computeCanonicalSha256 } = await load('src/formats/canonical-hash.js');
const { createBundledIncrementalDecoder } = await load('src/inference/tokenizers/bundled/incremental-decoder.js');
const target = pathToFileURL(path.join(doppler, 'src/inference/pipelines/text/resident-partition.js')).href;
let pause = null, closes = 0, dispatched = 0;
globalThis.orderedIntegrationNumerics = {
  create(owner) {
    const state = { index: owner.modelPartition.index, plan: owner.modelPartition.plan, currentSeqLen: 0, decodeStepCount: 0 };
    report.states.push(state);
    let closed = false;
    return { state, close() { assert(!closed, 'Private state released twice'); closed = true; closes++; } };
  },
  async execute(state, input) {
    dispatched++;
    if (pause && state.index === 1 && state.decodeStepCount === 0) {
      const current = pause; pause = null; current.entered.resolve(); await current.release.promise;
    }
    if (!state.index) assert(input.tokenIds && !input.activationBytes);
    else assert(input.activationBytes && !input.tokenIds);
    if (state.index < state.plan.stageCount - 1) return {
      activationBytes: new ArrayBuffer(input.numTokens * state.plan.hiddenSize * state.plan.activationElementStrideBytes), timing: {} };
    const logits = new Float32Array(state.plan.vocabSize).fill(-100); logits[3 + state.decodeStepCount] = 10;
    return { logits: { logitsBuffer: logits, vocabSize: logits.length }, timing: {} };
  }
};
const substitutions = {
  './partition-execution.js': 'export const assertPartitionExecutionSupported = () => {}; export const executePartitionLayers = (...args) => orderedIntegrationNumerics.execute(...args);',
  './partition-attempt.js': 'export const createPartitionAttempt = owner => orderedIntegrationNumerics.create(owner);',
  '../../../memory/buffer-pool.js': 'export const readBuffer = async row => row.buffer; export const releaseBuffer = () => {};'
};
const hooks = registerHooks({ resolve(name, context, next) {
  if (context.parentURL === target && substitutions[name]) return { url: 'data:text/javascript,' + encodeURIComponent(substitutions[name]), shortCircuit: true };
  return next(name, context);
} });
const sessions = [], residents = [];
let authority;
let runner;
try {
  const { createResidentPartitionSession } = await import(target);
  const plan = layer.createOrderedLayerPartitionPlan({ modelId: 'ordered-integration', numLayers: 9, hiddenSize: 4,
    vocabSize: 16, splitLayers: [2, 6], activationPrecision: 'f32' });
  report.plan = plan;
  const planId = layer.hashLayerPartitionPlan(plan), model = { id: plan.modelId, identity: 'sha256:' + 'a'.repeat(64) };
  const generation = resolveGenerationOptions({ maxTokens: 3, maxSeqLen: 64, temperature: 0, topK: 1, topP: 1,
    repetitionPenalty: 1, repetitionPenaltyWindow: 0, useChatTemplate: false });
  report.generation = generation; report.expectedGenerationDigest = computeCanonicalSha256(generation);
  const limits = { maxTokens: 3, maxPromptTokens: 32, maxActivationBytes: 2048, maxOutputCharacters: 128,
    maxAttempts: 32, maxConcurrentAttempts: 2, maxStages: 8 };
  const signer = await createSigningIdentity({ algorithm: 'ECDSA' });
  authority = createPartitionGrantAuthority({ identity: signer, meshId: 'cpu-ordered-integration', maxGrants: 20, maxTtlMs: 60000 });
  model.generation = generation;
  const runtime = await load('src/partitions.js');
  const stages = plan.partitions.map(({ index }) => ({ index, participantId: index === 0 ? signer.peerId : `node-${index}`, transportId: `link-${index}`,
    residentId: `resident-${index}`, executionId: 'sha256:' + 'b'.repeat(64) }));
  const route = { schema: 'reploid.partition-route/v1', modelId: model.id, modelIdentity: model.identity, planId,
    stages, activation: layer.getPartitionActivationContract(plan) };
  for (const stage of stages) {
    const { index, participantId } = stage;
    const factory = { async openResidentPartition(input) {
      const allocation = resolveResidentPartitionAllocation({ modelId: model.id,
        architecture: { numLayers: 9, hiddenSize: 4, vocabSize: 16 } }, model.identity,
      { ...input, generation: input.model.generation });
      const session = await createResidentPartitionSession({ modelPartition: { plan, index }, gpuContext: null,
        modelConfig: {}, dopplerLoader: { gpuBuffers: [{ size: 64 }] } }, allocation, {
        tokenize(messages) { report.tokenizations.push(structuredClone(messages)); return messages.length === 1 ? [1, 2] : [1, 2, 3, 4, 5, 6]; },
        getTokenContract() { assert.equal(index, 2); return { eosTokenId: 5 }; },
        createIncrementalDecoder() { assert.equal(index, 2); return createBundledIncrementalDecoder({
          tokenForId: id => String(id), byteLevel: false, byteDecoder: new Map(), wordPiece: false,
          splitEveryCharacter: false, wordPiecePrefix: '##' }); }
      }, async () => {});
      sessions.push(session); return session;
    } };
    const resident = createResidentPartition({ runtime: factory, model, plan, planId, index, participantId,
      limits, ordered: { runtime, stage } });
    residents.push(resident);
    const early = { schema: 'reploid.partition-attempt/v2', attemptId: 'before-ready', threadId: 'before-ready',
      requesterId: 'requester', placementGeneration: 0, route };
    await assert.rejects(resident.reserve({ identity: early, partitionIndex: index }), /not ready/);
    assert.equal(resident.getState().ready, false);
    await resident.prepare({ approved: true }); assert.equal(resident.getState().ready, true);
  }
  runner = createLayerPartitionRunner({ runtime, plan, route, stages: residents, limits,
    authorize: request => authority.verify(request.grant, request),
    transport: { transferActivation: async frame => structuredClone(frame) } });
  const request = async (attemptId, threadId = 'conversation') => {
    const identity = { schema: 'reploid.partition-attempt/v2', attemptId, threadId, requesterId: 'requester', placementGeneration: 0, route };
    const grant = await authority.issueOrdered(identity, limits, { approved: true, ttlMs: 60000,
      disclosure: orderedPartitionDisclosure(identity), generationDigest: runtime.hashPartitionGeneration(generation) });
    report.grants.push(structuredClone(grant));
    return { identity, generation, maxTokens: 3, grants: { execution: stages.map(() => grant),
      tokenContext: stages.map(() => grant), activation: stages.slice(1).map(() => grant), output: grant } };
  };
  async function run(attemptId, messages) {
    const input = await request(attemptId), signal = new AbortController().signal;
    const tokenized = await residents[0].tokenize({ identity: input.identity, messages, signal });
    const deltas = [];
    const result = await runner.execute({ ...input, tokenIds: tokenized.tokenIds, signal, onDelta: delta => deltas.push(delta) });
    assert.equal(result.content, '345'); assert.deepEqual(result.tokenIds, [3, 4, 5]);
    assert.equal(result.stopReason, 'eos-token'); assert.equal(deltas.join(''), result.content);
    assert(deltas.length > 1); assert(residents.every(owner => owner.getState().reservations.active === 0));
    report.cases.push({ attemptId, messages, deltas, result }); return result;
  }
  const tampered = await request('tampered');
  const signature = tampered.grants.output.signature;
  tampered.grants.output.signature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  const beforeDispatch = dispatched;
  await assert.rejects(runner.execute({ ...tampered, tokenIds: [1, 2], signal: new AbortController().signal }), /authorization declined/);
  assert.equal(dispatched, beforeDispatch);
  assert(residents.every(owner => owner.getState().reservations.active === 0));
  report.cases.push({ tamperedSignatureRejectedBeforeNumerics: true });
  const first = await run('first', [{ role: 'user', content: 'Synthetic prompt' }]);
  const followup = [{ role: 'user', content: 'Synthetic prompt' }, { role: 'assistant', content: first.content },
    { role: 'user', content: 'Follow up on that output' }];
  await run('followup', followup); assert.deepEqual(report.tokenizations[1], followup);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), controller = new AbortController();
  pause = { entered, release };
  const failed = runner.execute({ ...await request('cancel', 'cancel-thread'), tokenIds: [1, 2], signal: controller.signal })
    .then(() => { throw Error('Cancellation unexpectedly completed'); }, error => error);
  await entered.promise;
  const survivor = runner.execute({ ...await request('survive', 'other-thread'), tokenIds: [1, 2], signal: new AbortController().signal });
  controller.abort(new Error('Cancel only this request')); release.resolve();
  const failure = await failed, surviving = await survivor;
  assert.match(failure.message, /Cancel only this request/); assert.equal(surviving.content, '345');
  assert.equal(surviving.stopReason, 'eos-token'); assert(residents.every(owner => owner.getState().reservations.active === 0));
  report.cases.push({ cancellation: failure.message, survivor: surviving });
  assert.deepEqual(runner.getState().active, 0); assert.equal(runner.getState().unsettled, 0);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = String(error.stack || error); }
finally {
  const cleanup = await Promise.allSettled([runner?.close(), ...residents.map(resident => resident.close())]);
  report.cleanup = cleanup.map(row => ({ status: row.status, error: row.reason?.message ?? null }));
  report.dispatched = dispatched; report.privateStatesCreated = report.states.length; report.privateStatesClosed = closes;
  report.reservations = residents.map(owner => owner.getState().reservations);
  authority?.close();
  if (cleanup.some(row => row.status === 'rejected') || closes !== report.states.length) report.passed = false;
  report.states = report.states.map(({ index, currentSeqLen, decodeStepCount }) => ({ index, currentSeqLen, decodeStepCount }));
  report.sourcesUnchanged = true;
  for (const [name, expected] of Object.entries(report.sources)) {
    if (createHash('sha256').update(await fs.readFile(path.join(doppler, name))).digest('hex') !== expected) report.sourcesUnchanged = false;
  }
  for (const [name, expected] of Object.entries(report.reploidSources)) {
    if (createHash('sha256').update(await fs.readFile(new URL('../../' + name, import.meta.url))).digest('hex') !== expected) report.sourcesUnchanged = false;
  }
  if (!report.sourcesUnchanged) report.passed = false;
  report.finishedAt = new Date().toISOString();
  hooks.deregister(); delete globalThis.orderedIntegrationNumerics;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, dispatched, closes, failure: report.failure?.split('\n')[0] }));
  if (!report.passed) process.exitCode = 1;
}
