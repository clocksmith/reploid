import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { createPartitionChat } from '../../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionEntry, createPartitionRequester } from '../../packages/reploid/src/mesh/partitions/partition-entry.js';
import { createPartitionPeer } from '../../packages/reploid/src/mesh/partitions/partition-peer.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority, orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';

function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true,
    maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1-index].readyState === 'open') pair[1-index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1-index].close()); } }));
  return pair;
}

const [dopplerArgument, reportArgument] = process.argv.slice(2);
assert(dopplerArgument && reportArgument, 'Usage: node run.mjs /absolute/doppler /new/report.json');
const doppler = await fs.realpath(dopplerArgument), reportPath = path.resolve(reportArgument);
await fs.access(reportPath).then(() => { throw Error('Report already exists'); }, error => { if (error.code !== 'ENOENT') throw error; });
const load = name => import(pathToFileURL(path.join(doppler, name)).href);
const report = { scope: 'CPU source integration: real requester entry, chat, ordered Reploid peer ports over synthetic in-process channels, resident facade, WebCrypto v4 grants and runner and Doppler resident state/sampling/decoder; injected numerical kernels and private cache allocation; real grant signatures only; no signed execution publication, GPU, physical capacity or answer-quality claim',
  startedAt: new Date().toISOString(), doppler, cases: [], grants: [], sources: {}, tokenizations: [], states: [] };
const sources = ['src/inference/pipelines/text/resident-partition.js', 'src/inference/pipelines/text/resident-partition-contract.js',
  'src/inference/pipelines/text/layer-partition-contract.js', 'src/partitions.js', 'src/inference/generation-step.js', 'src/inference/token-sampling.js',
  'src/config/generation-contract.js', 'src/inference/tokenizers/bundled/incremental-decoder.js'];
for (const file of sources) report.sources[file] = createHash('sha256').update(await fs.readFile(path.join(doppler, file))).digest('hex');
report.reploidSources = {};
for (const name of ['packages/reploid/src/mesh/partitions/partition-route-execution.js', 'packages/reploid/src/mesh/partitions/partition-contract.js', 'packages/reploid/src/mesh/partitions/partition-runner.js', 'packages/reploid/src/mesh/partitions/resident-partition.js', 'packages/reploid/src/mesh/partitions/resident-route.js', 'packages/reploid/src/mesh/partitions/partition-grants.js', 'packages/reploid/src/mesh/partitions/partition-peer.js', 'packages/reploid/src/mesh/partitions/partition-ordered-peer.js', 'packages/reploid/src/mesh/partitions/partition-step-receiver.js', 'packages/reploid/src/transport/partition-data-channel.js', 'packages/reploid/src/mesh/partitions/partition-entry.js', 'packages/reploid/src/mesh/partitions/partition-chat.js', 'packages/reploid/src/mesh/partitions/partition-ordered-chat.js', 'packages/reploid/src/mesh/partitions/partition-summary.js']) {
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
const sessions = [], residents = [], peers = [], authorities = [];
let authority;
let chat, entryClient, entryServer;
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
  const identities = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
  identities.forEach(identity => authorities.push(createPartitionGrantAuthority({ identity, meshId: 'cpu-ordered-integration', maxGrants: 20, maxTtlMs: 60000 })));
  authority = authorities[0];
  model.generation = generation;
  const runtime = await load('src/partitions.js');
  const stages = plan.partitions.map(({ index }) => ({ index, participantId: identities[index].peerId, transportId: `link-${index}`,
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
  const channelLimits = { maxFrameBytes: 64, maxControlBytes: 131072, maxPayloadBytes: 4096, maxPendingBytes: 16384,
    maxPendingRequests: 8, maxRequestsPerChannel: 256, maxBufferedBytes: 262144, maxTransferBytes: 4194304, timeoutMs: 2000 };
  for (let index = 1; index < stages.length; index++) {
    const pair = channels();
    const common = { runtime, plan, planId, modelIdentity: model.identity, limits: channelLimits,
      receiverLimits: { maxAttempts: 32, maxSteps: 3 }, ordered: { route, partitionIndex: index } };
    const server = createPartitionPeer({ ...common, channel: pair[1], localParticipantId: identities[index].peerId,
      remoteParticipantId: identities[0].peerId, authority: authorities[index], contributor: residents[index] });
    const client = createPartitionPeer({ ...common, channel: pair[0], localParticipantId: identities[0].peerId,
      remoteParticipantId: identities[index].peerId, authority });
    peers.push({ client, server });
    assert.equal((await client.refresh()).ready, true);
  }
  const approvalEvents = report.approvalEvents = [];
  chat = createPartitionChat({ runtime, plan, planId, model, authority, limits, grantTtlMs: 60000,
    ordered: { route, stages: [residents[0], ...peers.map(peer => peer.client)] },
    authorizeRequester: async input => input.participantId === 'requester' });
  const entryChannels = channels();
  const inputLimits = { maxInputCharacters: 4096, maxOutputCharacters: 128, maxAttempts: 32,
    maxConcurrentAttempts: 2, descriptorTtlMs: 60000 };
  const authorize = async (input, { action }) => {
    approvalEvents.push({ action, input: structuredClone(input) });
    return input.requesterId === 'requester' && input.coordinatorId === stages[0].participantId
      && input.modelIdentity === model.identity && JSON.stringify(input.route) === JSON.stringify(route);
  };
  entryServer = createPartitionEntry({ channel: entryChannels[1], localParticipantId: stages[0].participantId,
    remoteParticipantId: 'requester', service: chat, ordered: true, authorize, limits: channelLimits, inputLimits });
  entryClient = createPartitionEntry({ channel: entryChannels[0], localParticipantId: 'requester',
    remoteParticipantId: stages[0].participantId, ordered: true, authorize, limits: channelLimits, inputLimits });
  await entryClient.refresh();
  const request = (attemptId, messages, threadId = 'conversation') => ({ meshId: authority.meshId,
    modelId: model.id, modelIdentity: model.identity, planId, route, coordinatorId: stages[0].participantId,
    threadId, attemptId, placementGeneration: 0, messages });
  async function run(attemptId, messages) {
    const deltas = [];
    const result = await entryClient.generate(request(attemptId, messages), {
      signal: new AbortController().signal, onDelta: text => deltas.push(text) });
    assert.equal(result.content, '345'); assert.equal(deltas.join(''), result.content);
    assert.equal(result.execution.schema, 'reploid.mesh.partition-summary/v2');
    assert.deepEqual(result.execution.identity.route, route);
    assert(deltas.length > 1); assert(residents.every(owner => owner.getState().reservations.active === 0));
    report.cases.push({ attemptId, messages, deltas, result }); return result;
  }
  const tampered = request('tampered', [{ role: 'user', content: 'Must not dispatch' }]);
  tampered.route = structuredClone(route); tampered.route.stages[1].residentId = 'unapproved replacement';
  const beforeDispatch = dispatched;
  await assert.rejects(entryClient.generate(tampered));
  assert.equal(dispatched, beforeDispatch); assert.equal(report.tokenizations.length, 0);
  report.cases.push({ changedRouteRejectedBeforeTokenizerAndNumerics: true });
  const first = await run('first', [{ role: 'user', content: 'Synthetic prompt' }]);
  const followup = [{ role: 'user', content: 'Synthetic prompt' }, { role: 'assistant', content: first.content },
    { role: 'user', content: 'Follow up on that output' }];
  await run('followup', followup); assert.deepEqual(report.tokenizations[1], followup);
  const placementApprovals = [];
  const requester = createPartitionRequester({ ordered: true, entries: () => [entryClient], requesterId: 'requester',
    meshId: authority.meshId, modelId: model.id, modelIdentity: model.identity, planId, maxPlacements: 1,
    newId: () => 'requester-helper', authorize: async placement => {
      placementApprovals.push(structuredClone(placement)); return JSON.stringify(placement.route) === JSON.stringify(route);
    } });
  const helperDeltas = [];
  const helper = await requester.generate({ messages: followup, threadId: 'helper-conversation' },
    { onDelta: event => helperDeltas.push(event) });
  assert.equal(helper.content, '345'); assert.deepEqual(helper.execution.identity.route, route);
  assert.equal(helper.recovery.attempts, 1); assert.deepEqual(report.tokenizations[2], followup);
  assert.deepEqual(placementApprovals[0].route, route);
  assert.equal(helperDeltas.map(event => event.text).join(''), helper.content);
  assert(helperDeltas.every(event => event.threadId === 'helper-conversation' && event.attemptId === 'requester-helper' && event.placementGeneration === 0));
  report.cases.push({ requesterHelper: helper, deltas: helperDeltas, placementApprovals });
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), controller = new AbortController();
  pause = { entered, release };
  const failed = entryClient.generate(request('cancel', [{ role: 'user', content: 'Cancel this' }], 'cancel-thread'), { signal: controller.signal })
    .then(() => { throw Error('Cancellation unexpectedly completed'); }, error => error);
  await entered.promise;
  const survivor = entryClient.generate(request('survive', [{ role: 'user', content: 'Independent request' }], 'other-thread'));
  controller.abort(new Error('Cancel only this request')); release.resolve();
  const failure = await failed, surviving = await survivor;
  await entryServer.drain();
  assert.equal(controller.signal.aborted, true);
  assert.match(failure.message, /Partition request cancelled or timed out/);
  assert.equal(surviving.content, '345');
  const state = chat.getState();
  const cancelled = state.attempts.find(row => row.identity.attemptId === 'cancel');
  assert.equal(cancelled.phase, 'cancelled'); assert(cancelled.cleanup.every(row => row.status === 'settled'));
  assert.equal(state.active, 0); assert.equal(state.unsettled, 0);
  assert.equal(state.pendingInputs, 0); assert.equal(state.unsettledInputs, 0);
  assert(residents.every(owner => owner.getState().reservations.active === 0));
  report.cases.push({ cancellation: failure.message, survivor: surviving, chatState: state });
  report.entryStates = { requester: entryClient.getState(), coordinator: entryServer.getState() };
  report.peerStates = peers.map(({ client, server }) => ({ client: client.getState(), server: server.getState() }));
  assert(report.peerStates.every(({ client, server }) => client.unsettled === 0 && server.unsettled === 0 && client.retainedOutputBytes === 0));
  assert(report.peerStates.every(({ client, server }) => client.receipt.completedRequests > 0
    && client.receipt.sentFrameBytes === server.receipt.receivedFrameBytes
    && server.receipt.sentFrameBytes === client.receipt.receivedFrameBytes));
  assert(report.peerStates[0].server.receipt.completedRequests > 0, 'Middle stage must send binary output back');
  assert.equal(report.peerStates[1].server.receipt.completedRequests, 0, 'Final stage returns token control results, not reverse tensor requests');
  report.passed = true;
} catch (error) { report.passed = false; report.failure = String(error.stack || error); }
finally {
  const cleanup = await Promise.allSettled([entryClient?.close(), entryServer?.close(), chat?.close(), ...peers.flatMap(peer => [peer.client.close(), peer.server.close()]), ...residents.map(resident => resident.close())]);
  report.cleanup = cleanup.map(row => ({ status: row.status, error: row.reason?.message ?? null }));
  report.dispatched = dispatched; report.privateStatesCreated = report.states.length; report.privateStatesClosed = closes;
  report.reservations = residents.map(owner => owner.getState().reservations);
  authorities.forEach(owner => owner.close());
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
