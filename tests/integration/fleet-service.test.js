// @vitest-environment node
import { afterEach, beforeEach, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { residentRoute } from '../helpers/resident-route.js';
import { createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';

const model = { id: 'test-model', identity: 'sha256:' + 'a'.repeat(64) };
let root, credits, service, keys, client;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet-service-'));
  keys = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'),
    computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: 'owner',
      providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] })),
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: 1, maxDebt: 100, maxOutputTokens: 20, maxPendingPerComputer: 2,
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: true } });
  service = await startFleetService({ credits, models: [model],
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  client = createFleetClient({ url: service.url, identity: keys[0] });
});
afterEach(async () => { await service?.close(); credits?.close(); await rm(root, { recursive: true, force: true }); });

it('meters a request through signed HTTP admission, disclosure and countersigned settlement', async () => {
  let dispatched = false;
  const participant = {
    async generate(request, controls) {
      expect(await controls.requestApproval({ requestId: 'request-1', recipientIdentity: keys[1].peerId,
        input: { messages: request.messages } })).toBe(true);
      expect(credits.snapshot().accounts[0].held).toBe(10); dispatched = true;
      const completion = { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount: 3, stopReason: 'eos' };
      const output = { model: model.id, modelIdentity: model.identity, content: 'A real protocol fixture.', completion, adapterIdentities: [] };
      const measured = await measureWholeModelReceipt(request.messages, output);
      const receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
        provider: keys[1].peerId, consumer: keys[0].peerId, model: model.id, jobHash: 'request:request-1' }), keys[1]), keys[0]);
      return { content: output.content, execution: { receipt } };
    }
  };
  const requester = createFleetRequester({ participant, identity: keys[0], credits: client, maxOutputTokens: 10 });
  const result = await requester.generate({ model, messages: [{ role: 'user', content: 'Test.' }] },
    { signal: new AbortController().signal, requestApproval: async () => true });
  expect(dispatched).toBe(true); expect(result.serviceCredit.charge).toBe(3);
  expect((await client.call('snapshot', {})).accounts.map(row => row.balance)).toEqual([-3, 3, 0]);
});

it('refuses unenrolled keys and signed requests for another computer’s account', async () => {
  const stranger = createFleetClient({ url: service.url, identity: await createSigningIdentity({ algorithm: 'Ed25519' }) });
  await expect(stranger.call('snapshot', {})).rejects.toThrow('signature');
  await expect(client.reserve({ consumer: keys[1].peerId })).rejects.toThrow('another computer');
});

it('rejects unsigned mutations rather than trusting a claimed machine name', async () => {
  const response = await fetch(service.url, { method: 'POST', body: JSON.stringify({ participantId: keys[0].peerId,
    operation: 'reserve', payload: {}, at: Date.now(), nonce: 'fake', schema: 'reploid.fleet-service-request/v1' }) });
  expect(response.status).toBe(400); expect(credits.snapshot().journal).toEqual([]);
});

it('accepts bounded clock skew but rejects stale and reordered capacity observations', async () => {
  const observation = { id: 'machine-0', participantId: keys[0].peerId, observedAt: Date.now() + 5000,
    activeRequests: 0, preferences: { enabled: false, models: [] }, measurements: [] };
  expect(await client.call('observe', observation)).toEqual({ accepted: true });
  await expect(client.call('observe', { ...observation, observedAt: observation.observedAt - 1 })).rejects.toThrow('Older observation');
  await expect(client.call('observe', { ...observation, observedAt: Date.now() - 60000 })).rejects.toThrow('clock-skew');
});

it('refuses execution without held credit, changed inputs, or another consumer’s authorization', async () => {
  const provider = createFleetClient({ url: service.url, identity: keys[1] });
  const admission = createFleetExecutionAdmission({ credits: provider, model: { ...model, generation: { maxTokens: 8 } } });
  const request = { requestId: 'guarded', consumer: keys[0].peerId, messages: [{ role: 'user', content: 'admitted input' }] };
  const execution = { request, consumer: keys[0].peerId };
  await expect(admission.whole(execution)).rejects.toThrow('live credit admission');
  const binding = { id: `service:${request.consumer}:guarded`, executionId: 'guarded', consumer: request.consumer,
    mode: 'whole-model', model: { ...model, adapterIdentities: [] }, inputDigest: await hashJson(request.messages),
    maxOutputTokens: 8, providers: [{ participantId: keys[1].peerId, weight: 1 }] };
  await client.reserve(binding);
  await expect(admission.whole(execution)).rejects.toThrow('live credit admission');
  await client.dispatch(binding.id);
  expect(await admission.whole(execution)).toBe(true);
  await expect(admission.whole({ ...execution, consumer: keys[2].peerId })).rejects.toThrow('authenticated peer');
  await expect(admission.whole({ ...execution, request: { ...request, messages: [{ role: 'user', content: 'different' }] } }))
    .rejects.toThrow('Input differs');
  await provider.call('observe', { id: 'machine-1', participantId: keys[1].peerId, observedAt: Date.now(), activeRequests: 0,
    preferences: { enabled: false, models: [model] }, measurements: [] });
  await expect(admission.whole(execution)).rejects.toThrow('no longer allows');
});

it('charges the requester and credits every settled resident stage through the actual requester wrapper', async () => {
  const route = await residentRoute({ participants: keys.slice(1).map(key => key.peerId), requesterId: keys[0].peerId,
    signers: keys.slice(1).map(identity => createAttemptEvidenceSigner({ identity })) });
  try {
    await service.close();
    service = await startFleetService({ credits, models: [{ ...route.model, plans: [{ id: route.model.partition.planId, creditWeights: [1, 1] }] }],
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
    client = createFleetClient({ url: service.url, identity: keys[0], outboxFile: path.join(root, 'outbox.json') });
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 10 });
    const answer = await requester.generate({ model: route.model, threadId: 'thread', attemptId: 'attempt', messages: [{ role: 'user', content: 'test' }] },
      { signal: new AbortController().signal, requestApproval: async () => true });
    expect(answer.content).toBe('012');
    expect(answer.serviceCredit.charge).toBe(3);
    expect(credits.snapshot().accounts.map(row => row.balance)).toEqual([-3, 1, 2]);
    expect(await client.reconcile()).toEqual([]);
  } finally { await route.close(); }
});

it('retains an answer and recovers a lost settlement reply from a durable outbox without generating again', async () => {
  const route = await residentRoute({ participants: keys.slice(1).map(key => key.peerId), requesterId: keys[0].peerId,
    signers: keys.slice(1).map(identity => createAttemptEvidenceSigner({ identity })) });
  try {
    await service.close();
    service = await startFleetService({ credits, models: [{ ...route.model, plans: [{ id: route.model.partition.planId, creditWeights: [1, 1] }] }],
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
    const outboxFile = path.join(root, 'outbox.json');
    const flaky = createFleetClient({ url: service.url, identity: keys[0], outboxFile, fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (JSON.parse(options.body).operation === 'settle') throw Error('Lost settlement response');
      return response;
    } });
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: flaky, maxOutputTokens: 10 });
    const answer = await requester.generate({ model: route.model, threadId: 'thread', attemptId: 'attempt', messages: [{ role: 'user', content: 'test' }] },
      { signal: new AbortController().signal, requestApproval: async () => true });
    expect(answer.content).toBe('012'); expect(answer.serviceCredit.status).toBe('pending');
    const resumed = createFleetClient({ url: service.url, identity: keys[0], outboxFile });
    expect((await resumed.reconcile())[0].charge).toBe(3);
    expect(await resumed.reconcile()).toEqual([]);
    expect(credits.snapshot().accounts.map(row => row.balance)).toEqual([-3, 1, 2]);
    expect(credits.snapshot().journal).toHaveLength(3);
  } finally { await route.close(); }
});

it('bills only the remote share when the requester also executes a local partition stage', async () => {
  const route = await residentRoute({ participants: keys.slice(0, 2).map(key => key.peerId), requesterId: keys[0].peerId,
    signers: keys.slice(0, 2).map(identity => createAttemptEvidenceSigner({ identity })) });
  try {
    await service.close();
    service = await startFleetService({ credits, models: [{ ...route.model, plans: [{ id: route.model.partition.planId, creditWeights: [1, 1] }] }],
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
    client = createFleetClient({ url: service.url, identity: keys[0] });
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 10 });
    const answer = await requester.generate({ model: route.model, threadId: 'thread', attemptId: 'attempt', messages: [{ role: 'user', content: 'test' }] },
      { signal: new AbortController().signal, requestApproval: async () => true });
    expect(answer.serviceCredit).toMatchObject({ charge: 2, ownComputeUnits: 1 });
    expect(answer.serviceCredit.credits).toHaveLength(1);
    expect(credits.snapshot().accounts.map(row => row.balance)).toEqual([-2, 2, 0]);
  } finally { await route.close(); }
});
