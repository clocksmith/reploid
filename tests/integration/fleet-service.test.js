// @vitest-environment node
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { startFleetTextApi } from '../../server/fleet/text-api.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { residentRoute } from '../helpers/resident-route.js';
import { createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { acceptFleetOutputLimitPolicy } from '../../server/fleet/terminal-policy.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';

const model = { id: 'test-model', identity: 'sha256:' + 'a'.repeat(64) };
let root, credits, service, keys, client;
const policyFor = index => createExecutionPolicy({ placement: 'network-allowed',
  recipients: { kind: 'named', ids: [keys[index].peerId] } });
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet-service-'));
  keys = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'),
    computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: `machine-${index}`,
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
  const requestApproval = vi.fn(async disclosure => {
    expect(disclosure.serviceCreditQuote).toEqual({ schema: 'reploid.service-credit-quote/v1',
      unit: 'noncash-service-credit', policyVersion: 'test/1', creditsPerOutputToken: 1,
      maxOutputTokens: 10, maximum: 10, terminalCharge: 0 });
    expect(credits.snapshot().accounts[0].held).toBe(0);
    return true;
  });
  const result = await requester.generate({ model, messages: [{ role: 'user', content: 'Test.' }] },
    { signal: new AbortController().signal, requestApproval });
  expect(requestApproval).toHaveBeenCalledTimes(1);
  expect(credits.request(result.serviceCredit.id).binding.acceptedQuote.maximum).toBe(10);
  expect(dispatched).toBe(true); expect(result.serviceCredit.charge).toBe(3);
  expect((await client.call('snapshot', {})).accounts.map(row => row.balance)).toEqual([-3, 3, 0]);
  const consumerStatement = await client.statement();
  const providerClient = createFleetClient({ url: service.url, identity: keys[1] });
  const providerStatement = await providerClient.statement();
  expect(await verifyCreditStatement(consumerStatement, { participantIds: [keys[0].peerId] }))
    .toMatchObject({ ok: true, accountId: 'machine-0', statedBalance: -3, recomputedBalance: -3, uncheckedCount: 0 });
  expect(await verifyCreditStatement(providerStatement, { participantIds: [keys[1].peerId] }))
    .toMatchObject({ ok: true, accountId: 'machine-1', statedBalance: 3, recomputedBalance: 3, uncheckedCount: 0 });
});

it('rejects a changed accepted credit ceiling before reserving or dispatching', async () => {
  const terms = await client.call('terms', model);
  const binding = { id: 'stale-quote', executionId: 'stale-quote', consumer: keys[0].peerId,
    mode: 'whole-model', model: { ...model, adapterIdentities: [] },
    inputDigest: await hashJson([{ role: 'user', content: 'Test.' }]), maxOutputTokens: 10,
    providers: [{ participantId: keys[1].peerId, weight: 1 }],
    acceptedQuote: { schema: 'reploid.service-credit-quote/v1', unit: terms.policy.unit,
      policyVersion: terms.policy.version, creditsPerOutputToken: 1, maxOutputTokens: 10,
      maximum: 9, terminalCharge: 0 } };
  await expect(client.reserve(binding)).rejects.toThrow('quote changed');
  expect(credits.request(binding.id)).toBeNull();
  expect(credits.snapshot().accounts.every(row => row.held === 0)).toBe(true);
});

it('sends a requester cap below the provider’s model limit as the request limit, and names the mismatch otherwise', async () => {
  const provider = createFleetClient({ url: service.url, identity: keys[1] });
  const admission = createFleetExecutionAdmission({ credits: provider, model: { ...model, generation: { maxTokens: 10 } } });
  const messages = [{ role: 'user', content: 'Test.' }], consumer = keys[0].peerId;
  let sent = null;
  const participant = { async generate(request, controls) {
    sent = request.settings;
    expect(await controls.requestApproval({ requestId: 'capped-1', recipientIdentity: keys[1].peerId, input: { messages } })).toBe(true);
    // Without the requester's limit the provider admits for its own ceiling of 10, past the 4 reserved.
    await expect(admission.whole({ consumer, request: { consumer, requestId: 'capped-1', messages } }))
      .rejects.toThrow('exceeds the requester\'s reserved limit of 4');
    expect(await admission.whole({ consumer, request: { consumer, requestId: 'capped-1', messages, settings: request.settings,
      modelIdentity: model.identity, adapterIdentities: [] } })).toBe(true);
    throw Error('Provider admitted; the answer is not needed here');
  } };
  const requester = createFleetRequester({ participant, identity: keys[0], credits: client, maxOutputTokens: 4 });
  await expect(requester.generate({ model: { ...model, generation: { maxTokens: 10 } }, messages },
    { signal: new AbortController().signal, requestApproval: async () => true })).rejects.toThrow('not needed');
  expect(sent).toMatchObject({ maxOutputTokens: 4 });
  expect(credits.request(`service:${consumer}:capped-1`).binding).toMatchObject({ maxOutputTokens: 4, settingsDigest: expect.stringMatching(/^sha256:/) });
});

it('settles the person’s Stop after the provider finished on the requester’s signed stop; a lost connection stays recoverable', async () => {
  const messages = [{ role: 'user', content: 'Test.' }];
  // The provider has finished; nothing more arrives, and this requester never countersigns a receipt.
  const finishedThenStopped = requestId => ({ async generate(request, controls) {
    expect(await controls.requestApproval({ requestId, recipientIdentity: keys[1].peerId, input: { messages: request.messages } })).toBe(true);
    credits.admit(`service:${keys[0].peerId}:${requestId}`, 0);
    await new Promise(resolve => controls.signal.addEventListener('abort', resolve, { once: true }));
    throw controls.signal.reason;
  }, recoverGeneration() { throw Error('A stop never asks the provider again'); } });
  const held = () => credits.snapshot().accounts[0].held;
  const stopper = createFleetRequester({ participant: finishedThenStopped('stopped-1'), identity: keys[0], credits: client, maxOutputTokens: 10 });
  const stop = new AbortController();
  const stopped = stopper.generate({ model, messages }, { signal: stop.signal, requestApproval: async () => true }).catch(error => error);
  await vi.waitFor(() => expect(held()).toBe(10));
  stop.abort(Object.assign(new DOMException('Stopped by owner', 'AbortError'), { requesterStop: true }));
  expect((await stopped).serviceCredit).toMatchObject({ status: 'cancelled', charge: 0, outputTokens: null });
  expect(held()).toBe(0);
  expect(credits.request(`service:${keys[0].peerId}:stopped-1`).evidence).toMatchObject({ schema: 'reploid.settlement-stop/v1', acknowledged: 0 });
  // A lost connection is not a Stop: the hold stays so the answer can still be recovered and paid for ...
  const lost = createFleetRequester({ participant: finishedThenStopped('lost-1'), identity: keys[0], credits: client, maxOutputTokens: 10 });
  const drop = new AbortController();
  const dropped = lost.generate({ model, messages }, { signal: drop.signal, requestApproval: async () => true }).catch(error => error);
  await vi.waitFor(() => expect(held()).toBe(10));
  drop.abort(Error('Connection lost'));
  expect((await dropped).serviceCredit).toMatchObject({ status: 'pending' });
  expect(held()).toBe(10);
  // ... or stopped later through recovery, which signs the same stop.
  const reservationId = `service:${keys[0].peerId}:lost-1`;
  await expect(lost.recover({ reservationId, messages: [{ role: 'user', content: 'Other.' }], stop: true }, { signal: AbortSignal.timeout(5000) }))
    .rejects.toThrow('Recovery input differs');
  expect(await lost.recover({ reservationId, messages, stop: true }, { signal: AbortSignal.timeout(5000) }))
    .toMatchObject({ status: 'cancelled', serviceCredit: { charge: 0, status: 'cancelled' } });
  expect(held()).toBe(0);
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
      if (input.action === 'mesh.admit') return admission.preadmit({ request: input.request, consumer: keys[0].peerId });
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
    const running = requester.generate({ model, messages: mesh.messages, privacy: policyFor(1) },
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
  await provider.call('observe', { id: 'machine-1', participantId: keys[1].peerId, observedAt: Date.now(), activeRequests: 1,
    preferences: { enabled: false, models: [model] }, measurements: [] });
  const next = { ...request, requestId: 'after-withdrawal' };
  const nextBinding = { ...binding, id: `service:${request.consumer}:${next.requestId}`, executionId: next.requestId };
  await client.reserve(nextBinding); await client.dispatch(nextBinding.id);
  await expect(admission.whole({ request: next, consumer: next.consumer })).rejects.toThrow('no longer allows');
  // Withdrawal fences new admission; already admitted output can still settle.
  const completion = { schema: 'doppler.generation-completion/v1', promptTokenCount: 3, generatedTokenCount: 1, stopReason: 'eos' };
  const measured = await measureWholeModelReceipt(request.messages, { model: model.id, modelIdentity: model.identity,
    adapterIdentities: [], content: 'OK', completion });
  const receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
    provider: keys[1].peerId, consumer: keys[0].peerId, model: model.id, jobHash: 'request:guarded' }), keys[1]), keys[0]);
  expect((await client.settle(binding.id, receipt)).charge).toBe(1);
  await client.fence(nextBinding.id);
  expect((await client.call('recover', { id: nextBinding.id })).charge).toBe(0);
  expect(credits.snapshot().accounts.every(row => row.held === 0)).toBe(true);
  await provider.call('observe', { id: 'machine-1', participantId: keys[1].peerId, observedAt: Date.now(), activeRequests: 0,
    preferences: { enabled: true, models: [model] }, measurements: [] });
  const returned = { ...request, requestId: 'after-return' };
  const returnedBinding = { ...binding, id: `service:${request.consumer}:${returned.requestId}`, executionId: returned.requestId };
  await client.reserve(returnedBinding); await client.dispatch(returnedBinding.id);
  expect(await admission.whole({ request: returned, consumer: returned.consumer })).toBe(true);
  const returnedReceipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
    provider: keys[1].peerId, consumer: keys[0].peerId, model: model.id,
    jobHash: `request:${returned.requestId}` }), keys[1]), keys[0]);
  expect((await client.settle(returnedBinding.id, returnedReceipt)).charge).toBe(1);
  expect(credits.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[-2, 0], [2, 0], [0, 0]]);
});

it('checks a reservation from the request’s commitment before the prompt is disclosed, and changes nothing', async () => {
  const served = { ...model, generation: { maxTokens: 8 } };
  const admission = createFleetExecutionAdmission({ credits: createFleetClient({ url: service.url, identity: keys[1] }), model: served });
  const messages = [{ role: 'user', content: 'not sent before admission' }];
  const commitment = 'sha256:' + 'c'.repeat(64);
  const details = { requestId: 'pre', consumer: keys[0].peerId, modelIdentity: model.identity, adapterIdentities: [], promptCommitment: commitment };
  const ask = (changes = {}, consumer = keys[0].peerId) => admission.preadmit({ request: { ...details, ...changes }, consumer });
  // No reservation yet, then one that has not been dispatched.
  await expect(ask()).rejects.toThrow('live credit admission');
  const binding = { id: `service:${details.consumer}:pre`, executionId: 'pre', consumer: details.consumer, mode: 'whole-model',
    model: { ...model, adapterIdentities: [] }, inputDigest: await hashJson(messages), maxOutputTokens: 8,
    admission: { schema: 'reploid.credit-preadmission/v1', commitment }, providers: [{ participantId: keys[1].peerId, weight: 1 }] };
  expect((await client.reserve(binding)).admission).toEqual({ schema: 'reploid.credit-preadmission/v1', commitment });
  await expect(ask()).rejects.toThrow('live credit admission');
  await client.dispatch(binding.id);
  const before = credits.snapshot().accounts.map(row => [row.balance, row.held]);
  expect(await ask()).toBe(true);
  // Another commitment, another consumer, another model variant, a prompt in the question, or another provider: refused.
  await expect(ask({ promptCommitment: 'sha256:' + 'd'.repeat(64) })).rejects.toThrow('does not bind this pre-disclosure commitment');
  await expect(ask({}, keys[2].peerId)).rejects.toThrow('authenticated peer');
  await expect(ask({ modelIdentity: 'sha256:' + 'b'.repeat(64) })).rejects.toThrow('another model variant');
  await expect(ask({ messages })).rejects.toThrow('carries no prompt');
  const stranger = createFleetExecutionAdmission({ credits: createFleetClient({ url: service.url, identity: keys[2] }), model: served });
  await expect(stranger.preadmit({ request: details, consumer: keys[0].peerId })).rejects.toThrow('live credit admission');
  // The check moved nothing, and admission with the prompt still follows it.
  expect(credits.snapshot().accounts.map(row => [row.balance, row.held])).toEqual(before);
  expect(credits.request(binding.id).state).toBe('dispatched');
  expect(await admission.whole({ request: { requestId: 'pre', consumer: keys[0].peerId, messages }, consumer: keys[0].peerId })).toBe(true);
  // A reservation made without a commitment keeps the earlier version and cannot be checked this way.
  const plain = { ...binding, id: `service:${details.consumer}:plain`, executionId: 'plain' };
  delete plain.admission;
  expect((await client.reserve(plain)).admission).toBeUndefined();
  await client.dispatch(plain.id);
  await expect(ask({ requestId: 'plain' })).rejects.toThrow('does not bind this pre-disclosure commitment');
  await expect(client.reserve({ ...binding, id: `service:${details.consumer}:bad`, executionId: 'bad',
    admission: { schema: 'reploid.credit-preadmission/v1', commitment: 'not-a-digest' } })).rejects.toThrow('Invalid credit reservation');
  // An unsupported or malformed ledger response is a refusal, never a disclosure fallback.
  const older = createFleetExecutionAdmission({ credits: { call: async () => { throw Error('Unknown fleet operation'); } }, model: served });
  await expect(older.preadmit({ request: details, consumer: keys[0].peerId })).rejects.toThrow('Unknown fleet operation');
  const malformed = createFleetExecutionAdmission({ credits: { call: async () => true }, model: served });
  await expect(malformed.preadmit({ request: details, consumer: keys[0].peerId })).rejects.toThrow('Exact credit preadmission');
  const failing = createFleetExecutionAdmission({ credits: { call: async () => { throw Error('Fleet request failed'); } }, model: served });
  await expect(failing.preadmit({ request: details, consumer: keys[0].peerId })).rejects.toThrow('Fleet request failed');
});

it('releases an undispatched hold once however often the release is repeated', async () => {
  const binding = { id: `service:${keys[0].peerId}:twice`, executionId: 'twice', consumer: keys[0].peerId, mode: 'whole-model',
    model: { ...model, adapterIdentities: [] }, inputDigest: await hashJson([{ role: 'user', content: 'never dispatched' }]),
    maxOutputTokens: 8, providers: [{ participantId: keys[1].peerId, weight: 1 }] };
  const held = () => credits.snapshot().accounts.find(row => row.id === 'machine-0').held;
  await client.reserve(binding);
  expect(held()).toBe(8);
  await client.abandonBeforeDispatch(binding.id);
  expect(held()).toBe(0);
  // The reply to the first release may have been lost; asking again releases nothing further.
  await client.abandonBeforeDispatch(binding.id);
  await client.abandonBeforeDispatch(binding.id);
  expect(held()).toBe(0);
  expect(credits.request(binding.id).state).toBe('abandoned');
  // Another computer cannot release it, and a dispatched request is not released this way.
  await expect(createFleetClient({ url: service.url, identity: keys[2] }).abandonBeforeDispatch(binding.id)).rejects.toThrow('consumer differs');
  const sent = { ...binding, id: `service:${keys[0].peerId}:sent`, executionId: 'sent' };
  await client.reserve(sent); await client.dispatch(sent.id);
  await expect(client.abandonBeforeDispatch(sent.id)).rejects.toThrow('already closed');
  expect(held()).toBe(8);
  // Fencing a dispatched request that nobody admitted settles it at zero, and fencing again changes nothing.
  expect((await client.fence(sent.id)).charge).toBe(0);
  expect((await client.fence(sent.id)).charge).toBe(0);
  expect(held()).toBe(0);
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
async function privateSplitApi() {
  let route;
  route = await chargedRoute({ beforeReserve: async (request, index) => {
    const provider = createFleetClient({ url: service.url, identity: keys[index + 1] });
    await createFleetExecutionAdmission({ credits: provider, model: route.model }).partition(request);
  } });
  const selected = route.model;
  const approval = { modelId: selected.id, modelIdentity: selected.identity, adapterIdentities: [],
    partition: structuredClone(selected.partition), evidence: 'fixture://two-signed-residents' };
  let advertised = selected, replaceAtDispatch = false;
  const generate = vi.fn(route.requester.generate);
  const token = 'test-only-private-fleet-authorization-token';
  const host = { identity: keys[0], allowsModel: model => model.identity === selected.identity,
    enrolledRecipients: async () => new Set(keys.slice(1).map(key => key.peerId)),
    textParticipant: { roomId: 'private-split-test', executionClass: 'private-pool', partitionOutputLimit: () => 3, getState: () => ({ models: [advertised] }), generate },
    // The plan's charge cap, quoted from the same credit terms as the accounted requester (the real host's port).
    chargeCeiling: request => createFleetRequester({ participant: { generate }, identity: keys[0], credits: client, maxOutputTokens: 3 }).chargeCeiling(request),
    runAccountedGeneration(request, controls, execute) {
      if (replaceAtDispatch) advertised = { ...selected, partition: { ...selected.partition, planId: 'another-plan' } };
      return createFleetRequester({ participant: { generate: execute }, identity: keys[0], credits: client, maxOutputTokens: 3 }).generate(request, controls);
    } };
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const api = await startFleetTextApi({ host, token, privatePartitionApprovals: [approval] });
  const send = (body, options) => fetch(api.url + '/chat/completions', { method: 'POST', headers,
    body: JSON.stringify({ model: selected.id, messages: [{ role: 'user', content: 'test' }], ...body }), ...options });
  return { route, generate, send, url: api.url, headers, replace() { replaceAtDispatch = true; },
    list: async () => (await (await fetch(api.url + '/models', { headers })).json()).data,
    async close() { await api.close(); await route.close(); } };
}

it('lists and streams an operator-approved split with a single signed settlement and a plain chat default', async () => {
  const f = await privateSplitApi();
  const { send, generate } = f;
  try {
    expect((await f.list()).map(row => row.id)).toEqual([f.route.model.id]);
    const response = await send({ stream: true, max_completion_tokens: 2 });
    const stream = await response.text();
    expect(response.status, stream).toBe(200);
    expect(stream).toContain('[DONE]');
    expect(stream.split('\n\n').filter(frame => frame.startsWith('data: {')).map(frame =>
      JSON.parse(frame.slice(6)).choices[0].delta.content || '').join('')).toBe('01');
    const reservationId = response.headers.get('x-reploid-reservation-id');
    const settled = await client.call('request', { id: reservationId });
    expect(settled.evidence.receipts).toHaveLength(2);
    expect(settled.outcome.charge).toBe(2);
    expect((await client.call('recover', { id: reservationId })).charge).toBe(2);
    expect(credits.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[-2, 0], [1, 0], [1, 0]]);

    expect((await send({ max_completion_tokens: 4 })).status).toBe(400);
    expect(generate).toHaveBeenCalledTimes(1);
    const plain = await send({});
    const answer = await plain.json();
    expect(plain.status, JSON.stringify(answer)).toBe(200);
    expect(answer.choices[0].message.content).toBe('012');

    f.replace();
    expect((await send({})).status).toBe(503);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await f.list()).toEqual([]);
  } finally { await f.close(); }
});

it('streams execution evidence and settles once for a Responses request bound to two stages', async () => {
  const f = await privateSplitApi();
  try {
    const model = f.route.model;
    const named = keys.slice(0, 3).map(key => key.peerId);
    const binding = { poolId: 'private-split-test', model: { identity: model.identity, adapterIdentities: [], planIdentity: model.partition.planId },
      execution: { protection: 'plaintext', route: 'split',
        participants: { kind: 'named', ids: named }, allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] } };
    const response = await fetch(f.url + '/responses', { method: 'POST', headers: f.headers,
      body: JSON.stringify({ model: model.selectionId || model.id, input: [{ role: 'user', content: 'test' }],
        store: false, stream: true, max_output_tokens: 2, reploid: binding }) });
    const stream = await response.text();
    expect(response.status, stream).toBe(200);
    const events = stream.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const final = events.at(-1);
    expect(final.type, stream).toBe('response.completed');
    expect(final.response.usage.output_tokens).toBe(2);
    expect(final.response.output[0].content[0].text).toBe('01');
    const receipt = final.response.reploid.executionReceipt;
    expect(receipt).toMatchObject({ schema: 'reploid.execution-receipt/v2', status: 'completed', protection: 'plaintext',
      routeKind: 'split',
      requested: { model: { identity: model.identity, adapterIdentities: [] }, execution: binding.execution },
      route: { shape: 'split', backend: 'doppler-partition-plaintext/v1', protocol: null } });
    // Every stage that read the content is named in the route, and every one of them was named by the caller.
    expect(receipt.route.participants.length).toBeGreaterThan(0);
    expect(receipt.route.participants.every(id => named.includes(id))).toBe(true);
    expect(receipt.evidence.privacy.contentReadBy.participants).toEqual(receipt.route.participants);
    const reservation = response.headers.get('x-reploid-reservation-id');
    expect(reservation).toBeTruthy();
    const settled = await client.call('request', { id: reservation });
    expect(settled.evidence.receipts).toHaveLength(2);
    expect((await client.call('recover', { id: reservation })).charge).toBe(2);
    expect(credits.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[-2, 0], [1, 0], [1, 0]]);
  } finally { await f.close(); }
});

it.each(['resident', 'adapters'])('rejects changed %s at disclosure even when both physical peers remain enrolled', async change => {
  const f = await privateSplitApi();
  try {
    f.generate.mockImplementationOnce((request, controls) => f.route.requester.generate(request, {
      ...controls, requestApproval(preview) {
        const changed = structuredClone(preview);
        if (change === 'resident') changed.route.stages[1].residentId = 'new-resident';
        else changed.adapterIdentities = ['sha256:' + '5'.repeat(64)];
        return controls.requestApproval(changed);
      }
    }));
    const response = await f.send({});
    expect(response.status).toBe(403);
    expect(credits.snapshot().accounts.every(row => row.balance === 0 && row.held === 0)).toBe(true);
    expect(f.route.residents.map(stage => stage.getState().reservations.active)).toEqual([0, 0]);
  } finally { await f.close(); }
});

it('releases both residents after an HTTP disconnect and charges only the acknowledged token', async () => {
  const f = await privateSplitApi();
  const gate = f.route.hold(1, 1);
  try {
    const abort = new AbortController();
    const response = await f.send({ stream: true }, { signal: abort.signal });
    const id = response.headers.get('x-reploid-reservation-id');
    const reader = response.body.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('0');
    await gate.entered;
    abort.abort();
    await vi.waitFor(() => expect(credits.request(id).state).toBe('settled'));
    expect(credits.request(id).outcome.outputTokens).toBe(1);
    expect(f.route.residents.map(stage => stage.getState().reservations.active)).toEqual([0, 0]);
    const next = await f.send({});
    expect(next.status, await next.text()).toBe(200);
  } finally { gate.release(); await f.close(); }
});

it('fails a dropped stage over HTTP and admits a later request while missing closing evidence is reconciled', async () => {
  const f = await privateSplitApi();
  try {
    f.route.loseStage(1, 0);
    const failed = await f.send({});
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toMatchObject({ code: 'connection_lost' });
    const id = failed.headers.get('x-reploid-reservation-id');
    expect(credits.request(id).state).toBe('closing');
    expect(credits.snapshot().journal).toHaveLength(0);
    expect(f.route.residents[0].getState().reservations.active).toBe(0);
    const next = await f.send({});
    expect(next.status, await next.text()).toBe(200);
  } finally { await f.close(); }
});

it('ends a partial HTTP stream with its stage-loss code and keeps the attempt recoverable', async () => {
  const f = await privateSplitApi();
  try {
    f.route.loseStage(1, 1);
    const response = await f.send({ stream: true });
    const stream = await response.text();
    expect(response.status).toBe(200);
    const events = stream.trim().split('\n\n').map(frame => JSON.parse(frame.slice(6)));
    expect(events.some(event => event.choices?.[0]?.delta?.content === '0')).toBe(true);
    expect(events.at(-1).error).toMatchObject({ code: 'connection_lost' });
    const id = response.headers.get('x-reploid-reservation-id');
    expect(credits.request(id).state).toBe('closing');
    expect(f.route.residents[0].getState().reservations.active).toBe(0);
  } finally { await f.close(); }
});

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
    const lostId = `service:${keys[0].peerId}:lost`;
    expect(credits.request(lostId).state).toBe('closing');
    const sameProvider = createFleetClient({ url: service.url, identity: keys[2] });
    await expect(sameProvider.call('closeStageOwner', { id: lostId, partitionIndex: 1, owner: 'a'.repeat(64), receipt: null }))
      .rejects.toThrow('Historical admission has no matching exclusive owner');
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
      computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: `machine-${index}`,
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
  const computers = keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: `machine-${index}`,
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
      if (input.action === 'mesh.admit') return admission.preadmit({ request: input.request, consumer: keys[0].peerId });
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    execute: async messages => {
      if (messages.some(row => row.content.includes('OVER_CONTEXT'))) {
        throw Object.assign(new Error('Conversation plus output budget exceeds model context limit (1645 + 512 > 2048 tokens)'),
          { code: 'CONTEXT_LENGTH_EXCEEDED', recoverableSession: true, status: 400 });
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
    await expect(requester.generate({ attemptId: 'oversized-1', privacy: policyFor(1), threadId: 't-long', model, messages: hugeMessages },
      { signal: new AbortController().signal, requestApproval: async () => true }))
      .rejects.toThrow('transport payload limit');
    expect(credits.snapshot().accounts.every(row => row.held === 0 && row.balance === 0)).toBe(true);

    // 2. Over-context conversation signs a failed terminal proof and settles charge=0, held=0 immediately.
    await expect(requester.generate({ attemptId: 'overctx-1', privacy: policyFor(1), threadId: 't-long', model, messages: [{ role: 'user', content: 'OVER_CONTEXT' }] },
      { signal: new AbortController().signal, requestApproval: async () => true }))
      .rejects.toThrow('context limit');
    expect(credits.snapshot().accounts.every(row => row.held === 0 && row.balance === 0)).toBe(true);

    // 3. Follow-up ordinary turn succeeds cleanly on the same contributor.
    const ok = await requester.generate({ attemptId: 'followup-1', privacy: policyFor(1), threadId: 't-short', model, messages: [{ role: 'user', content: 'Short question.' }] },
      { signal: new AbortController().signal, requestApproval: async () => true });
    expect(ok.content).toBe('Still ready.');
    expect(ok.serviceCredit.charge).toBe(2);
    expect(credits.snapshot().accounts.every(row => row.held === 0)).toBe(true);
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
});

it('retains interrupted native output and requires fresh disclosure before retrying with another supplier', async () => {
  // Real native requester, signed mesh and credit service; generation is deterministic test output, not GPU inference.
  const cleanup = [], release = Promise.withResolvers(), firstDelta = Promise.withResolvers();
  const attempts = new Map([['interrupted', []], ['replacement', []]]), outcomes = [];
  const controllers = [new AbortController(), new AbortController()];
  const messages = [{ role: 'user', content: 'Keep the same request across suppliers.' }];
  async function supplier(index, execute) {
    const provider = createFleetClient({ url: service.url, identity: keys[index] });
    const admission = createFleetExecutionAdmission({ credits: provider, model: { ...model, generation: { maxTokens: 10 } } });
    let whole;
    const mesh = await createRecoveryMesh(cleanup, {
      identities: [keys[0], keys[index]], modelId: model.id, modelIdentity: model.identity, messages,
      authorize: async input => input.action === 'mesh.dispatch' ? whole.authorize(input)
        : input.action === 'mesh.admit' ? admission.preadmit({ request: input.request, consumer: keys[0].peerId })
        : input.action === 'mesh.execute' ? admission.whole({ request: input.request, consumer: keys[0].peerId }) : true,
      execute, onGenerationTerminal: proof => admission.terminal(proof)
    });
    whole = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
    return { mesh, requester: createFleetRequester({ participant: whole, identity: keys[0], credits: client,
      maxOutputTokens: 10, onOutcome: outcome => outcomes.push(outcome) }) };
  }
  const first = await supplier(1, async (_messages, update, controls) => {
    update('Preserved partial answer');
    await release.promise;
    controls.signal.throwIfAborted();
  });
  const second = await supplier(2);
  const request = (attemptId, supplier) => ({ model, messages, threadId: 'same-conversation', attemptId, privacy: policyFor(supplier) });
  const approvals = [];
  const approve = allowed => async disclosure => {
    approvals.push(disclosure);
    expect(disclosure.input.messages).toEqual(messages);
    expect(disclosure.modelIdentity).toBe(model.identity);
    expect(disclosure.serviceCreditQuote.maximum).toBe(10);
    return allowed;
  };
  try {
    const running = first.requester.generate(request('interrupted', 1), {
      signal: controllers[0].signal, requestApproval: approve(true), onDelta: delta => {
        attempts.get(delta.attemptId).push(delta.text); firstDelta.resolve();
      }
    });
    const stopped = expect(running).rejects.toThrow('Supplier interrupted');
    await firstDelta.promise;
    controllers[0].abort(Error('Supplier interrupted'));
    await stopped;
    expect(attempts.get('interrupted').join('')).toBe('Preserved partial answer');
    expect(credits.snapshot().accounts[0].held).toBe(10);
    expect(second.mesh.executions).toBe(0);

    await expect(second.requester.generate(request('denied-replacement', 2), {
      signal: controllers[1].signal, requestApproval: approve(false)
    })).rejects.toThrow();
    expect(second.mesh.executions).toBe(0);
    expect(credits.snapshot().accounts[0].held).toBe(10);

    release.resolve();
    await vi.waitFor(() => expect(credits.snapshot().accounts[0].held).toBe(0));
    const oldId = `service:${keys[0].peerId}:${first.mesh.reference.requestId}`;
    expect(credits.request(oldId).outcome).toMatchObject({ status: 'cancelled', charge: 0 });
    const result = await second.requester.generate(request('replacement', 2), {
      signal: controllers[1].signal, requestApproval: approve(true),
      onDelta: delta => attempts.get(delta.attemptId).push(delta.text)
    });
    expect(result.content).toBe('actual answer');
    expect(result.serviceCredit.charge).toBe(3);
    expect(approvals.map(value => value.recipientIdentity)).toEqual([keys[1].peerId, keys[2].peerId, keys[2].peerId]);
    expect(new Set(approvals.map(value => value.requestId)).size).toBe(3);
    expect(first.mesh.executions).toBe(1);
    expect(second.mesh.executions).toBe(1);
    expect(attempts.get('interrupted').join('')).toBe('Preserved partial answer');
    expect(outcomes.find(value => value.attemptId === 'interrupted').acknowledged.outputCharacters).toBe(24);
    expect(credits.request(oldId).outcome).toMatchObject({ status: 'cancelled', charge: 0 });
    expect(credits.snapshot().accounts.map(row => row.balance)).toEqual([-3, 0, 3]);
    expect(credits.snapshot().accounts.every(row => row.held === 0)).toBe(true);
    expect([...first.mesh.errors, ...second.mesh.errors]).toEqual([]);
  } finally {
    release.resolve();
    controllers.forEach(controller => controller.abort());
    for (const close of cleanup.reverse()) await close();
  }
});

it.each([
  { index: 1, name: 'after admission', executed: 0, acknowledged: 0, lostReply: false },
  { index: 1, name: 'after partial delivery', executed: 2, acknowledged: 1, lostReply: false },
  { index: 0, name: 'during a partial nonfinal stage', executed: 2, acknowledged: 1, lostReply: false },
  { index: 1, name: 'after losing the terminal HTTP reply', executed: 1, acknowledged: 1, lostReply: true }
])('recovers the enrolled stage process killed $name, once', async ({ index, executed, acknowledged, lostReply }) => {
  const { openOutputAcknowledgments, openStageReceipts } = await import('../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js');
  const { openFleetNativeHost } = await import('../../server/fleet/native-host.js');
  const { openStageOwner } = await import('../../server/fleet/stage-owner.js');
  const route = await chargedRoute();
  const sibling = 1 - index, workerKey = keys[index + 1];
  const cfg = { identityFile: path.join(root, 'stage.key'), roomId: 'private-process-recovery',
    serviceUrl: service.url, index, model: { ...route.model, generation: { maxTokens: 3 } } };
  await writeFile(cfg.identityFile, JSON.stringify(workerKey), { mode: 0o600 });
  const configFile = path.join(root, 'child.json'), roomTokenFile = path.join(root, 'room.token');
  await writeFile(configFile, JSON.stringify(cfg), { mode: 0o600 });
  await writeFile(roomTokenFile, 'test-only-private-local-pool-token-abcdefghijklmnopqrstuvwxyz12345', { mode: 0o600 });
  const child = fork(fileURLToPath(new URL('../fixtures/stage-owner-process.mjs', import.meta.url)), [configFile],
    { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ask = async (op, payload) => {
    const message = once(child, 'message');
    child.send({ op, payload });
    const [reply] = await message;
    if (reply.error) throw Error(reply.error);
    return reply.result;
  };
  let host, requesterHost, api;
  try {
    await ask('open');
    const id = 'service:' + keys[0].peerId + ':child-exit';
    const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'private-thread', attemptId: 'child-exit',
      requesterId: keys[0].peerId, placementGeneration: 0, route: route.route };
    const signer = ix => createAttemptEvidenceSigner({ identity: keys[ix] });
    const acks = await openOutputAcknowledgments({ signer: signer(0), identity, reservationId: id });
    const siblingTally = await openStageReceipts({ signer: signer(sibling + 1), identity, partitionIndex: sibling, charge: acks.charge });
    const req = { identity, charge: acks.charge, maxTokens: 3 };
    await client.reserve({ id, executionId: identity.attemptId, consumer: keys[0].peerId, mode: 'partition', route: identity,
      model: { id: cfg.model.id, identity: cfg.model.identity, adapterIdentities: [] }, inputDigest: await hashJson([{ role: 'user', content: 'test' }]),
      maxOutputTokens: 3, providers: keys.slice(1).map(key => ({ participantId: key.peerId, weight: 1 })) });
    await client.collect(id, { identity, receipts: [], acknowledgment: acks.charge });
    await client.dispatch(id);
    await createFleetExecutionAdmission({ credits: createFleetClient({ url: service.url, identity: keys[sibling + 1] }), model: cfg.model })
      .partition({ ...req, partitionIndex: sibling });
    await ask('reserve', req);
    const scope = { participantId: workerKey.peerId, roomId: cfg.roomId, serviceUrl: cfg.serviceUrl };
    await expect(openStageOwner({ file: cfg.identityFile + '.stage-owner.sqlite', ...scope })).rejects.toThrow(/locked|busy/i);
    // An independent profile with the same enrolled key also cannot reserve this work.
    const other = await openStageOwner({ file: path.join(root, 'competing.sqlite'), ...scope });
    try {
      await expect(createFleetExecutionAdmission({ credits: createFleetClient({ url: service.url, identity: workerKey }), model: cfg.model, stageOwner: other })
        .partition({ ...req, partitionIndex: index })).rejects.toThrow(/owner/i);
    } finally { await other.close(); }
    for (let step = 0; step < executed; step++) {
      const otherReceipt = await siblingTally.step({ step, inputTokenCount: 1, delta: 'x' });
      const result = await ask('step', { identity, step, done: lostReply });
      if (step < acknowledged) {
        const pair = await acks.observe({ step, delta: result.delta, receipt: index === 1 ? result.receipt : otherReceipt });
        await client.collect(id, { identity, receipts: [], acknowledged: pair });
      }
    }
    if (lostReply) await expect(ask('lose-reply')).rejects.toThrow('dropped');
    if (!executed) {
      // Releasing a handle while its original process is still alive is insufficient evidence.
      await ask('close');
      const replay = await openStageOwner({ file: cfg.identityFile + '.stage-owner.sqlite', ...scope });
      try {
        const early = await replay.recover(createFleetClient({ url: service.url, identity: workerKey }));
        expect(early).toHaveLength(1);
        expect(early[0].error).toMatch(/death is unconfirmed/i);
      } finally { await replay.close(); }
      const copy = path.join(root, 'copied.sqlite');
      await copyFile(cfg.identityFile + '.stage-owner.sqlite', copy);
      await expect(openStageOwner({ file: copy, ...scope })).rejects.toThrow(/moved|scope/i);
    }
    const dead = once(child, 'exit');
    child.kill('SIGKILL');
    expect((await dead)[1]).toBe('SIGKILL');
    await siblingTally.close({ failed: true });
    await client.collect(id, siblingTally.evidence());
    const requesterKey = path.join(root, 'requester.key');
    await writeFile(requesterKey, JSON.stringify(keys[0]), { mode: 0o600 });
    const sockets = { loadRtc: async () => ({ RTCPeerConnection: class {} }), loadSocket: async () => ({ WebSocket: class {} }),
      loadGpu: () => { throw Error('Recovery attempted to open a GPU'); } };
    requesterHost = await openFleetNativeHost({ configuration: { schema: 'reploid.fleet-native/v1', computerId: 'machine-0',
      name: 'Recovery requester', maxOutputTokens: 3, identityFile: requesterKey, roomId: cfg.roomId, roomTokenFile, serviceUrl: cfg.serviceUrl,
      models: [{ model: cfg.model, mode: 'partition', ordered: { stage: null } }] }, ...sockets });
    const token = 'private-recovery-fixture-authorization-bearer-2026';
    api = await startFleetTextApi({ host: requesterHost, token });
    async function httpRecover(content = 'test') {
      const response = await fetch(api.url + '/reploid/recover', { method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({
        reservationId: id, messages: [{ role: 'user', content }] }) });
      return { status: response.status, body: await response.json() };
    }
    const initial = await httpRecover();
    expect(initial.status, JSON.stringify(initial.body)).toBe(200);
    const before = initial.body.serviceCredit;
    if (!lostReply) expect(before).toMatchObject({ status: 'pending', heldCredits: 3, acknowledgedOutputTokens: acknowledged, awaitingStages: [index] });
    if (executed && !lostReply) {
      const replay = await openStageOwner({ file: cfg.identityFile + '.stage-owner.sqlite', ...scope });
      try {
        const withoutReply = createFleetClient({ url: service.url, identity: workerKey, fetchImpl: async (url, options) => {
          const response = await fetch(url, options);
          await response.arrayBuffer();
          throw Error('Dropped interrupted-owner response after committing');
        } });
        expect((await replay.recover(withoutReply))[0].error).toMatch(/Dropped interrupted-owner response/);
      } finally { await replay.close(); }
      const proof = credits.request(id).evidence;
      const signed = proof.interruptedOwners[0];
      await expect(credits.closeStageOwner({ ...signed, payload: { ...signed.payload, receipt: null } })).rejects.toThrow(/signature/);
    }
    const configuration = { schema: 'reploid.fleet-native/v1', computerId: 'machine-' + (index + 1), name: 'Recovered stage',
      identityFile: cfg.identityFile, roomId: cfg.roomId, roomTokenFile, serviceUrl: cfg.serviceUrl,
      models: [{ model: cfg.model, mode: 'partition', ordered: { stage: { index } } }] };
    const boot = () => openFleetNativeHost({ configuration, ...sockets });
    host = await boot(); // Normal startup recovers before connecting to peers or starting the model.
    await host.reconcileCredits();
    const result = await client.call('recover', { id });
    // With only the reply lost, the stage closed normally. A stage owner that vanished forfeits its own share under the
    // failed-stage rules, and the stage that closed is paid its share of the acknowledged output: one credit split
    // equally goes to the later stage by the stage-order rule, so the requester pays it only when stage 0 vanished.
    const charged = lostReply || index === 0 ? acknowledged : 0, spent = charged ? -charged : 0;
    expect(result).toMatchObject({ charge: charged, outputTokens: acknowledged });
    expect(await httpRecover()).toMatchObject({ status: 200, body: { status: lostReply ? 'completed' : 'failed',
      serviceCredit: { charge: charged, outputTokens: acknowledged }, outcome: { acknowledged: { acknowledgedOutputTokens: acknowledged } } } });
    expect((await httpRecover('different input')).status).toBe(409);
    const proof = credits.request(id).evidence;
    if (lostReply) expect(proof.receipts[1]).toMatchObject({ status: 'settled', steps: executed });
    else {
      expect(proof.interruptedOwners).toHaveLength(1);
      expect(proof.interruptedOwners[0]).toMatchObject({ participantId: workerKey.peerId, operation: 'closeStageOwner',
        payload: { partitionIndex: index, receipt: executed ? expect.objectContaining({ status: 'executing', steps: executed }) : null } });
      expect(proof.receipts.find(r => r.partitionIndex === index)?.timing.closedAt ?? null).toBeNull();
    }
    const snapshot = await client.call('snapshot', {});
    // Equal stage weights split one indivisible credit by the existing stage-order rule.
    expect(snapshot.accounts.map(({ id, balance, held }) => [id, balance, held])).toEqual([
      ['machine-0', spent, 0], ['machine-1', 0, 0], ['machine-2', charged, 0]
    ]);
    expect(snapshot.journal.map(({ account_id, delta }) => [account_id, delta])).toEqual([
      ['machine-0', spent], ['machine-1', 0], ['machine-2', charged]
    ]);
    const firstRecovery = await httpRecover();
    await host.close(); host = await boot(); await host.reconcileCredits();
    // The observation timestamp is fresh on each HTTP read; the accepted settlement is immutable.
    expect(await httpRecover()).toEqual({ ...firstRecovery, body: { ...firstRecovery.body,
      outcome: { ...firstRecovery.body.outcome, recordedAt: expect.any(Number) } } });
    expect(await client.call('recover', { id })).toEqual(result);
    expect(await client.call('snapshot', {})).toEqual(snapshot);
    expect(await verifyCreditStatement(await client.statement(), { participantIds: [keys[0].peerId] }))
      .toMatchObject({ ok: true, accountId: 'machine-0', statedBalance: spent, recomputedBalance: spent, uncheckedCount: 0 });
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const dead = once(child, 'exit'); child.kill('SIGKILL'); await dead; }
    await api?.close(); await requesterHost?.close(); await host?.close(); await route.close();
  }
}, 30000);
