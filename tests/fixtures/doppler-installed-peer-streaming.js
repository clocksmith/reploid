// Installed Doppler, real Reploid signatures and verification; synthetic execution and message bus.
import assert from 'node:assert/strict';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { verifyPackPeerEpisode } from '../../self/pool/peer-pack-episode.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';
import { operationCapabilities, operationResources, packPeerIdentity } from './peer-pack-operation.js';

export async function checkInstalledPeerStreaming({ api, service, session, binding, makeRequest }) {
  const registry = createPackOperationRegistry();
  const model = { modelId: session.modelId, modelHash: binding.semanticRoot, manifestHash: binding.envelopeDigest,
    runtime: 'doppler', backend: 'browser-webgpu', executionMode: 'complete_pack_browser', workload: registry.generate.workload,
    runtimeVersion: api.DOPPLER_VERSION, executablePack: binding };
  const providerIdentity = await packPeerIdentity(), requesterIdentity = await packPeerIdentity();
  const requestListeners = new Set(), providerListeners = new Set();
  const responses = [], requests = [], errors = [], records = new Map();
  let calls = 0, dropped = false;
  const requesterBus = { subscribe(fn) { requestListeners.add(fn); return () => requestListeners.delete(fn); }, async send(message) {
    requests.push(message); for (const listener of providerListeners) listener(structuredClone(message));
  } };
  const providerBus = { subscribe(fn) { providerListeners.add(fn); return () => providerListeners.delete(fn); }, async send(message) {
    responses.push(message);
    if (!dropped && message.body.status === 'completed') { dropped = true; return; }
    for (const listener of requestListeners) listener(structuredClone(message));
  } };
  const key = value => JSON.stringify([value.requesterId, value.jobId, value.attemptId]);
  const journal = {
    async claim(value, owner) { const old = records.get(key(value)); const record = old ?? { ...value, owner, status: 'accepted', updates: [] };
      records.set(key(value), record); return { created: !old, record: structuredClone(record) }; },
    async markRunning(value) { records.get(key(value)).status = 'running'; },
    async append(value, owner, message) { const record = records.get(key(value)); assert.equal(record.owner, owner);
      record.updates.push(structuredClone(message)); record.status = message.body.status === 'partial' ? 'running' : message.body.status; },
    async cancel(value) { const record = records.get(key(value)); if (record) record.status = 'cancelled'; }, close() {},
  };
  const executor = { async run({ input, options, assignment, limits, requestSchema, signal, onPartial, beforeExecute }) {
    calls++;
    return runPackOperation({ binding, session, request: { schema: requestSchema, operation: { name: 'generate', version: 1 }, input, options, assignment, limits },
      runtimeVersion: api.DOPPLER_VERSION, runtimeService: service, signal, onPartial, beforeExecute });
  }, async close() {} };
  const provider = createPackPeerProvider({ identity: providerIdentity, bus: providerBus, models: [model], registry,
    executor, journal, runtimeService: service, authorize: () => true, onError: error => errors.push(error.message) });
  const requester = createPackPeerRequester({ identity: requesterIdentity, bus: requesterBus, models: [model], registry,
    runtimeService: service, onError: error => errors.push(error.message) });
  try {
    const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 30000 };
    const advert = await provider.createAdvert({ limits, capabilities: await operationCapabilities(model), expiresAt: Date.now() + 30000 });
    const request = makeRequest({ maxTokens: 3, presencePenalty: 2, repetitionPenaltyWindow: 1 });
    const updates = [];
    const result = await requester.run({ advert, model, input: request.input, options: request.options,
      requestSchema: 'doppler.capsule-operation-request/v2', limits: { ...limits, deadlineAt: Date.now() + 30000 },
      consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [providerIdentity.keyId] },
      acceptanceMode: 'execution', comparisonPolicy: null, reference: null, resources: operationResources,
      onPartial: event => updates.push(event.delta) });
    assert.equal(calls, 1, 'retry replays completion without running the model again');
    assert.deepEqual(result.execution.output.tokenIds, [0, 1, 0]);
    assert.equal(updates.map(delta => delta.text).join(''), '0,1,0');
    assert.equal(result.execution.receipt.schema, 'doppler.capsule-operation-receipt/v2');
    const replay = await verifyPackPeerEpisode({ job: result.job, updates: result.updates, acceptance: result.acceptance,
      reference: null, models: [model], registry, runtimeService: service });
    assert.equal(replay.accepted, true);
    assert.deepEqual(errors, []);
    return { passed: true, calls, receivedPartials: updates.length, deliveries: result.accounting.deliveries,
      outputHash: result.execution.receipt.outputHash, finalEventDigest: result.execution.finalEventDigest,
      replayClaim: replay.assessment.claim, receivedBytes: result.accounting.receivedBytes };
  } finally { requester.close(); await provider.close(); }
}
