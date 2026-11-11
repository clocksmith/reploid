// @vitest-environment node
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { residentRoute } from '../helpers/resident-route.js';
import { createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { acceptFleetOutputLimitPolicy } from '../../server/fleet/terminal-policy.js';
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
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: true, wholeModelTerminalCharge: 0 } });
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

it.each([false, true])('settles cancellation after cleanup, retaining lost HTTP replies for recovery (%s)', async loseReply => {
  const cleanup = [], entered = Promise.withResolvers(), release = Promise.withResolvers();
  let dropped = false;
  const provider = createFleetClient({ url: service.url, identity: keys[1], outboxFile: path.join(root, 'provider-outbox.json'),
    fetchImpl: async (url, options) => {
      const response = await fetch(url, options);
      if (loseReply && !dropped && JSON.parse(options.body).operation === 'collect') {
        dropped = true; throw Error('Lost terminal settlement response');
      }
      return response;
    } });
  const admission = createFleetExecutionAdmission({ credits: provider, model: { ...model, generation: { maxTokens: 10 } } });
  let wholeRequester;
  const mesh = await createRecoveryMesh(cleanup, { identities: keys.slice(0, 2), modelId: model.id, modelIdentity: model.identity,
    authorize: async input => {
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    execute: async (_messages, update, controls) => {
      entered.resolve(); update('partial, unmetered text'); await release.promise; controls.signal.throwIfAborted();
    }, onGenerationTerminal: proof => admission.terminal(proof) });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const requester = createFleetRequester({ participant: wholeRequester, identity: keys[0], credits: client, maxOutputTokens: 10 });
  const controller = new AbortController();
  try {
    const running = requester.generate({ model, messages: mesh.messages },
      { signal: controller.signal, requestApproval: async () => true });
    const rejected = expect(running).rejects.toThrow('Stopped');
    await entered.promise;
    controller.abort(Error('Stopped')); await rejected;
    expect(credits.snapshot().accounts[0].held).toBe(10);
    expect(await mesh.recover()).toEqual({ status: 'unresolved' });
    release.resolve();
    await vi.waitFor(() => expect(credits.snapshot().accounts[0].held).toBe(0));
    const row = credits.request(`service:${keys[0].peerId}:${mesh.reference.requestId}`);
    expect(row.outcome).toMatchObject({ charge: 0, status: 'cancelled', outputTokens: null, usage: null });
    expect(row.evidence).toMatchObject({ schema: 'reploid.generation-terminal/v1', cleanup: 'settled' });
    expect(mesh.executions).toBe(1);
    const journalLength = credits.snapshot().journal.length;
    await vi.waitFor(() => expect(mesh.wire.some(row => row.payload.terminal)).toBe(true));
    const recovered = await provider.reconcile();
    expect(recovered).toHaveLength(loseReply ? 1 : 0);
    expect(credits.snapshot().journal).toHaveLength(journalLength);
    expect(mesh.errors).toEqual([]);
  } finally { release.resolve(); for (const close of cleanup.reverse()) await close(); }
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
    const retained = await client.call('request', { id: answer.serviceCredit.id });
    expect(retained.evidence.receipts).toHaveLength(2);
    expect(retained.evidence.acknowledgment.count).toBe(3);
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

async function chargedRoute(options = {}) {
  const route = await residentRoute({ participants: keys.slice(1).map(key => key.peerId), requesterId: keys[0].peerId,
    signers: keys.slice(1).map(identity => createAttemptEvidenceSigner({ identity })), ...options });
  await service.close();
  service = await startFleetService({ credits, models: [{ ...route.model, plans: [{ id: route.model.partition.planId, creditWeights: [1, 1] }] }],
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  client = createFleetClient({ url: service.url, identity: keys[0], outboxFile: path.join(root, 'outbox.json') });
  return route;
}
const routeRequest = (route, attemptId) => ({ model: route.model, threadId: 'thread', attemptId, messages: [{ role: 'user', content: 'test' }] });

it.each(['0', '2'])('settles the acknowledged prefix when cancellation races with delta %s', async delta => {
  const route = await chargedRoute();
  try {
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 10 });
    for (const attemptId of ['cancel-1', 'cancel-2']) {
      const controller = new AbortController();
      await expect(requester.generate(routeRequest(route, attemptId), { signal: controller.signal, requestApproval: async () => true,
        onDelta: ({ text }) => { if (text === delta) controller.abort(Error('Stopped')); } })).rejects.toThrow('Stopped');
      await client.reconcile();
      const row = credits.request(`service:${keys[0].peerId}:${attemptId}`);
      expect(row.state).toBe('settled');
      expect(row.outcome.outputTokens).toBe(Number(delta) + 1);
      expect(credits.snapshot().accounts[0].held).toBe(0);
    }
    expect((await requester.generate(routeRequest(route, 'after-cancels'), {
      signal: new AbortController().signal, requestApproval: async () => true })).serviceCredit.charge).toBe(3);
  } finally { await route.close(); }
});

it.each([false, true])('recovers a dropped final output acknowledgment (all attempts: %s)', async dropAll => {
  const route = await chargedRoute();
  try {
    let dropped = false;
    const participant = { generate(request, controls) {
      const approve = controls.requestApproval;
      controls.requestApproval = async disclosure => {
        const ok = await approve(disclosure), observe = controls.onOutput;
        controls.onOutput = record => {
          if (record.done && (dropAll || !dropped)) { dropped = true; return Promise.reject(Error('Lost output RPC')); }
          return observe(record);
        };
        return ok;
      };
      return route.requester.generate(request, controls);
    } };
    const requester = createFleetRequester({ participant, identity: keys[0], credits: client, maxOutputTokens: 10 });
    const answer = await requester.generate(routeRequest(route, 'drop-final'), { signal: new AbortController().signal, requestApproval: async () => true });
    expect(dropped).toBe(true); expect(answer.content).toBe('012'); expect(answer.serviceCredit.charge).toBe(3);
    expect(await client.reconcile()).toEqual([]);
  } finally { await route.close(); }
});

it('accepts a verified re-signature of the same work without a second economic effect', async () => {
  const route = await chargedRoute();
  try {
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 10 });
    const answer = await requester.generate(routeRequest(route, 'resigned'), { signal: new AbortController().signal, requestApproval: async () => true });
    const retained = credits.request(answer.serviceCredit.id).evidence;
    const { publicJwk: _key, signature: _signature, ...body } = retained.acknowledgment;
    const acknowledgment = await createAttemptEvidenceSigner({ identity: keys[0] }).sign(body.schema,
      { ...body, signedAt: new Date(Date.parse(body.signedAt) + 1).toISOString() });
    expect(await client.settle(answer.serviceCredit.id, { ...retained, acknowledgment })).toEqual(answer.serviceCredit);
    expect(credits.snapshot().accounts.map(row => row.balance)).toEqual([-3, 1, 2]);
    expect(credits.snapshot().journal).toHaveLength(3);
  } finally { await route.close(); }
});

it('clamps output to the held budget and admits each stage using that request’s actual bound', async () => {
  let route;
  route = await chargedRoute({ steps: 3, beforeReserve: async (request, index) => {
    const provider = createFleetClient({ url: service.url, identity: keys[index + 1] });
    const admission = createFleetExecutionAdmission({ credits: provider, model: { ...route.model, generation: { maxTokens: 16 } } });
    await admission.partition(request);
  } });
  try {
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 2 });
    const answer = await requester.generate({ ...routeRequest(route, 'bounded'), generationRequest: {
      schema: 'reploid.partition-generation-request/v1', usage: 'raw-model-tokens/v1', maxOutputTokens: 9 } },
    { signal: new AbortController().signal, requestApproval: async () => true });
    expect(answer.content).toBe('01'); expect(answer.serviceCredit.outputTokens).toBe(2);
    expect(route.admissions(0)[0].evidence.receipts[0].steps).toBe(2);
    expect(credits.snapshot().accounts[0].held).toBe(0);
  } finally { await route.close(); }
});

it('fences a post-dispatch refusal before any provider admitted work and rejects subsequent admission', async () => {
  const participant = { async generate(request, controls) {
    await controls.requestApproval({ requestId: 'not-started', recipientIdentity: keys[1].peerId });
    throw Error('No provider started');
  } };
  const requester = createFleetRequester({ participant, identity: keys[0], credits: client, maxOutputTokens: 10 });
  await expect(requester.generate({ model, messages: [{ role: 'user', content: 'test' }] },
    { signal: new AbortController().signal, requestApproval: async () => true })).rejects.toThrow('No provider started');
  expect(credits.snapshot().accounts[0].held).toBe(0);
  const id = `service:${keys[0].peerId}:not-started`;
  expect(credits.request(id).state).toBe('settled');
  expect(() => credits.admit(id, 0)).toThrow('closed');
  expect(() => credits.dispatch(id, keys[0].peerId)).toThrow();
});

it('keeps a hold when an admitted stage disappears without a signed closing receipt', async () => {
  let route;
  route = await chargedRoute({ beforeReserve: async (request, index) => {
    const provider = createFleetClient({ url: service.url, identity: keys[index + 1] });
    await createFleetExecutionAdmission({ credits: provider, model: { ...route.model, generation: { maxTokens: 16 } } }).partition(request);
  } });
  try {
    route.loseStage(1, 0);
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 10 });
    await expect(requester.generate(routeRequest(route, 'lost'), {
      signal: new AbortController().signal, requestApproval: async () => true })).rejects.toThrow();
    await client.reconcile();
    expect(credits.request(`service:${keys[0].peerId}:lost`).state).toBe('closing');
    expect(credits.snapshot().accounts[0].held).toBe(3);
    expect(credits.snapshot().journal).toHaveLength(0);
  } finally { await route.close(); }
});

it('rejects sparse and non-finite evidence before signing or retaining an outbox entry', async () => {
  const sparse = { identity: {}, receipts: [undefined] };
  await expect(client.settle('bad', sparse)).rejects.toThrow('Undefined array');
  await expect(client.call('observe', { observedAt: NaN })).rejects.toThrow('Non-finite');
  expect(await client.reconcile()).toEqual([]);
});

it('recovers credited work from durable provider outboxes after the requester and ledger restart', async () => {
  let route;
  const providerClients = keys.slice(1).map((identity, index) => createFleetClient({ url: service.url, identity,
    outboxFile: path.join(root, `provider-${index}.json`) }));
  route = await chargedRoute({
    beforeReserve: (request, index) => createFleetExecutionAdmission({ credits: providerClients[index],
      model: { ...route.model, generation: { maxTokens: 16 } } }).partition(request),
    onEvidence: bundle => providerClients[bundle.receipts[0].partitionIndex].collect(bundle.reservationId, bundle)
  });
  // Admission works, but each closing proof is durably written locally before its HTTP call fails.
  for (let index = 0; index < 2; index++) providerClients[index] = createFleetClient({ url: service.url, identity: keys[index + 1],
    outboxFile: path.join(root, `provider-${index}.json`), fetchImpl: (url, options) => {
      if (JSON.parse(options.body).operation === 'collect') throw Error('Service unavailable during cleanup');
      return fetch(url, options);
    } });
  try {
    const { openOutputAcknowledgments } = await import('../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js');
    const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'crashed', requesterId: keys[0].peerId,
      placementGeneration: 0, route: route.route };
    const id = `service:${keys[0].peerId}:crashed`;
    const acknowledgments = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity: keys[0] }), identity, reservationId: id });
    await client.reserve({ id, executionId: 'crashed', consumer: keys[0].peerId, mode: 'partition', route: identity,
      model: { id: route.model.id, identity: route.model.identity, adapterIdentities: [] }, inputDigest: await hashJson([{ role: 'user', content: 'test' }]),
      maxOutputTokens: 3, providers: keys.slice(1).map(key => ({ participantId: key.peerId, weight: 1 })) });
    await client.collect(id, { identity, receipts: [], acknowledgment: acknowledgments.charge });
    await client.dispatch(id);
    await route.requester.generate(routeRequest(route, 'crashed'), { signal: new AbortController().signal,
      requestApproval: async () => true, charge: acknowledgments.charge, onOutput: record => acknowledgments.observe(record) });
    // The requester disappears without sending settlement or a fence. No answer is regenerated.
    expect(credits.request(id).state).toBe('dispatched');
    await service.close(); credits.close();
    const policy = credits.policy;
    credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), policy,
      computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: 'owner',
        providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] })), now: () => Date.now() + policy.maxRequestMs + 1 });
    service = await startFleetService({ credits, models: [route.model],
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
    for (let index = 0; index < 2; index++) {
      const resumed = createFleetClient({ url: service.url, identity: keys[index + 1], outboxFile: path.join(root, `provider-${index}.json`) });
      await resumed.reconcile();
      expect(await resumed.reconcile()).toEqual([]);
    }
    expect(credits.request(id).state).toBe('settled');
    expect(credits.snapshot().accounts.map(row => row.balance)).toEqual([-3, 1, 2]);
    expect(credits.snapshot().accounts[0].held).toBe(0);
  } finally { await route.close(); }
});

it('propagates the earlier authorization deadline and settles zero-output cleanup', async () => {
  const route = await chargedRoute();
  try {
    route.hold(0, 0);
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 10 });
    const expires = Date.now() + 50;
    await expect(requester.generate(routeRequest(route, 'deadline'), { signal: new AbortController().signal,
      requestApproval: async () => true, authorizationExpiresAt: () => expires })).rejects.toMatchObject({ code: 'ANSWER_DEADLINE_EXCEEDED' });
    const row = credits.request(`service:${keys[0].peerId}:deadline`);
    expect(row.state).toBe('settled'); expect(row.outcome.charge).toBe(0);
    expect(credits.snapshot().accounts[0].held).toBe(0);
  } finally { await route.close(); }
});

it('retains rejected proof for diagnosis without leaving it in the retry queue', async () => {
  const route = await chargedRoute();
  try {
    const requester = createFleetRequester({ participant: route.requester, identity: keys[0], credits: client, maxOutputTokens: 10 });
    const answer = await requester.generate(routeRequest(route, 'bad-retry'), { signal: new AbortController().signal, requestApproval: async () => true });
    const evidence = credits.request(answer.serviceCredit.id).evidence;
    evidence.receipts[0].signature = 'invalid';
    await expect(client.settle(answer.serviceCredit.id, evidence)).rejects.toThrow();
    expect(await client.reconcile()).toEqual([]);
    const { readFile } = await import('node:fs/promises');
    const outbox = JSON.parse(await readFile(path.join(root, 'outbox.json'), 'utf8'));
    expect(outbox[`rejected:settle:${answer.serviceCredit.id}`].payload.evidence).toEqual(evidence);
    expect(credits.snapshot().journal).toHaveLength(3);
  } finally { await route.close(); }
});


it('replays a zero-output fenced partition settlement without inventing stage receipts', async () => {
  const route = await chargedRoute();
  try {
    const participant = { async generate(request, controls) {
      const original = controls.requestApproval;
      controls.requestApproval = async disclosure => { await original(disclosure); throw Error('Stopped before stage admission'); };
      return route.requester.generate(request, controls);
    } };
    const requester = createFleetRequester({ participant, identity: keys[0], credits: client, maxOutputTokens: 3 });
    await expect(requester.generate(routeRequest(route, 'no-stage'), { signal: new AbortController().signal,
      requestApproval: async () => true })).rejects.toThrow('Stopped before stage admission');
    const id = `service:${keys[0].peerId}:no-stage`, row = credits.request(id);
    expect(row.state).toBe('settled'); expect(row.evidence.receipts).toEqual([]);
    expect(await client.settle(id, row.evidence)).toEqual(row.outcome);
    expect(credits.snapshot().accounts[0].held).toBe(0);
  } finally { await route.close(); }
});

it('migrates maxOutputTokens only when all reservations and holds are settled and rate terms are unchanged', async () => {
  const file = path.join(root, 'credits.sqlite');
  const computers = keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: 'owner',
    providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] }));
  const nextPolicy = { ...credits.policy, version: 'test/2-max512', maxOutputTokens: 512 };
  await client.reserve({ id: 'service:open-hold', executionId: 'open-hold', consumer: keys[0].peerId, mode: 'whole-model',
    model: { ...model, adapterIdentities: [] }, inputDigest: 'sha256:' + 'b'.repeat(64), maxOutputTokens: 5,
    providers: [{ participantId: keys[1].peerId, weight: 1 }] });
  credits.close(); credits = null;
  await expect(acceptFleetOutputLimitPolicy({ file, previousVersion: 'test/1', policy: nextPolicy })).rejects.toThrow('zero open reservations');
  credits = await openFleetCredits({ file, computers, policy: { ...nextPolicy, version: 'test/1', maxOutputTokens: 20 } });
  credits.abandonBeforeDispatch('service:open-hold', keys[0].peerId);
  credits.close(); credits = null;
  await expect(acceptFleetOutputLimitPolicy({ file, previousVersion: 'test/1',
    policy: { ...nextPolicy, creditsPerOutputToken: 2 } })).rejects.toThrow('rate');
  const migrated = await acceptFleetOutputLimitPolicy({ file, previousVersion: 'test/1', policy: nextPolicy });
  expect(migrated.acceptance.policy.maxOutputTokens).toBe(512);
  credits = await openFleetCredits({ file, computers, policy: nextPolicy });
  expect(credits.policy.maxOutputTokens).toBe(512);
});

it('settles recoverable over-context whole-model rejections immediately and blocks oversized envelopes before credit reservation', async () => {
  const cleanup = [];
  const provider = createFleetClient({ url: service.url, identity: keys[1], outboxFile: path.join(root, 'provider-overctx.json') });
  const admission = createFleetExecutionAdmission({ credits: provider, model: { ...model, generation: { maxTokens: 10 } } });
  let wholeRequester;
  const mesh = await createRecoveryMesh(cleanup, {
    identities: keys.slice(0, 2),
    modelId: model.id,
    modelIdentity: model.identity,
    authorize: async input => {
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    execute: async messages => {
      if (messages.some(row => row.content.includes('OVER_CONTEXT'))) {
        throw Object.assign(new Error('Conversation exceeds model context limit (2100 >= 2048 tokens)'),
          { code: 'CONTEXT_LENGTH_EXCEEDED', recoverableSession: true });
      }
      return {
        model: model.id, modelIdentity: model.identity, content: 'Still ready.',
        completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 6, generatedTokenCount: 2, stopReason: 'stop-token' },
        adapterIdentities: []
      };
    },
    // Simulate delayed/dropped provider HTTP terminal post so requester settles from the signed WebRTC terminal itself.
    onGenerationTerminal: async () => {}
  });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const requester = createFleetRequester({ participant: wholeRequester, identity: keys[0], credits: client, maxOutputTokens: 10 });
  try {
    // 1. Oversized WebRTC payload (> 65536 bytes) rejects BEFORE reserving any credits.
    const hugeMessages = [{ role: 'user', content: 'x'.repeat(70000) }];
    await expect(requester.generate({ attemptId: 'oversized-1', threadId: 't-long', model, messages: hugeMessages },
      { signal: new AbortController().signal, requestApproval: async () => true }))
      .rejects.toThrow('transport payload limit');
    expect(credits.snapshot().accounts.every(row => row.held === 0 && row.balance === 0)).toBe(true);

    // 2. Over-context conversation signs a failed terminal proof and settles charge=0, held=0 immediately.
    await expect(requester.generate({ attemptId: 'overctx-1', threadId: 't-long', model, messages: [{ role: 'user', content: 'OVER_CONTEXT' }] },
      { signal: new AbortController().signal, requestApproval: async () => true }))
      .rejects.toThrow('context limit');
    expect(credits.snapshot().accounts.every(row => row.held === 0 && row.balance === 0)).toBe(true);

    // 3. Follow-up ordinary turn succeeds cleanly on the same contributor.
    const ok = await requester.generate({ attemptId: 'followup-1', threadId: 't-short', model, messages: [{ role: 'user', content: 'Short question.' }] },
      { signal: new AbortController().signal, requestApproval: async () => true });
    expect(ok.content).toBe('Still ready.');
    expect(ok.serviceCredit.charge).toBe(2);
    expect(credits.snapshot().accounts.every(row => row.held === 0)).toBe(true);
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
});
