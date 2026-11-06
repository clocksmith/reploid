// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createTextApi } from '../../server/text-api.js';
import { createTextAccounting, TEXT_ACCOUNTING_COLLECTIONS } from '../../server/text-accounting.js';
import { TRIAL_COLLECTIONS } from '../../server/trial-admission.js';
import { createMemoryLedgerBackend } from '../../server/ledger/memory-store.js';
import { createFirestoreLedgerBackend } from '../../server/ledger/firestore-store.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { harnesses, fund, quoteInput, clock, fx, START, MODEL, identity, offerAndAccept, OWNER_DIGEST } from '../helpers/reward-fixture.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { signGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';

// All monetary figures and decisions below are fictional test fixtures.
const policyVersion = 'fixture-http-policy/1';
const trialPolicy = { trialId: 'fixture-http', currency: 'USD', totalMinor: 200, accountMinor: 100, maxConcurrent: 1 };
async function fixture(storage, adapters = []) {
  fx.nowMs = START;
  fx.links = []; fx.participants = new Map();
  fx.capacity = { evidenceId: 'fixture-capacity', serviceCredits: 10000, observedAt: clock() };
  let accounting;
  const h = harnesses[storage](), { ledger, rewards } = h.open({
    identity: { ...identity, participantDevice: async () => 'device' },
    readWholeModelExecution: id => accounting?.getRecord(id)
  });
  const db = createFakeFirestore();
  const backend = storage === 'memory' ? createMemoryLedgerBackend({ collections: TEXT_ACCOUNTING_COLLECTIONS })
    : createFirestoreLedgerBackend({ firestore: db, collections: TEXT_ACCOUNTING_COLLECTIONS });
  const trialBackend = storage === 'memory' ? createMemoryLedgerBackend({ collections: TRIAL_COLLECTIONS })
    : createFirestoreLedgerBackend({ firestore: db, collections: TRIAL_COLLECTIONS });
  const provider = await createSigningIdentity({ algorithm: 'Ed25519' });
  const consumer = await createSigningIdentity({ algorithm: 'Ed25519' });
  fx.participants.set(provider.peerId, 'contributor'); fx.participants.set(consumer.peerId, 'requester');
  await ledger.openAccount({ accountId: 'requester', ownerId: 'owner-requester' });
  await ledger.openAccount({ accountId: 'contributor', ownerId: 'owner-contributor' });
  await fund(ledger, 'requester', 500);
  fx.nowMs++;
  const conversion = await ledger.publishConversion({ conversionId: 'http-fixture', currency: 'USD', policyVersion,
    rate: { credits: 2, perMinorUnits: 1 }, rounding: 'ceil', effectiveFrom: clock(),
    authority: { actorId: 'pricing_admin_test', decisionId: 'http-fixture' }, idempotencyKey: 'http-fixture' });
  let sequence = 0, chosen, qualityCalls = 0;
  async function accept(settlement = {}) {
    const input = quoteInput({ quoteId: 'quote-' + ++sequence, accountId: 'requester' });
    input.service.model.deployedRepresentation = MODEL.modelIdentity;
    input.service.model.adapters = adapters.map(adapter => adapter.identity);
    input.pricing.basis.policyVersion = policyVersion;
    Object.assign(input.terms.settlement, settlement);
    const quote = await ledger.createQuote({ ...input, idempotencyKey: input.quoteId });
    const accepted = await ledger.acceptQuote({ quoteId: quote.quoteId, quoteHash: quote.quoteHash,
      accountId: 'requester', deviceId: 'device', idempotencyKey: quote.quoteId });
    chosen = { ...accepted, accountId: 'requester', requesterId: consumer.peerId, conversionId: conversion.conversionId };
    return chosen;
  }
  await accept();
  const request = { threadId: 'thread', attemptId: 'attempt', model: { id: MODEL.modelId, identity: MODEL.modelIdentity, ...(adapters.length ? { adapters } : {}) },
    messages: [{ role: 'user', content: 'Long text deliberately unlike the measured count of seven.' }] };
  const controller = new AbortController();
  const controls = { principal: { subject: 'authenticated-user' }, signal: controller.signal, requestApproval: async () => true };
  const open = (overrides = {}) => accounting = createTextAccounting({ ledger, backend, trialBackend, trialPolicy, policyVersion,
    production: false, clock,
    resolveAcceptedRequest: async ({ principal }) => principal.subject === 'authenticated-user' ? chosen : null,
    assessQuality: async () => { qualityCalls++; return { outcome: 'full', policyVersion: 'quality-policy-test/1', decisionId: 'independent-fixture-acceptance' }; },
    ...overrides });
  const preview = { ...request, modelId: request.model.id, modelIdentity: request.model.identity,
    input: { messages: request.messages }, recipientIdentity: provider.peerId, adapterIdentities: adapters.map(adapter => adapter.identity) };
  async function result(job = 'request:fixture', signingProvider = provider, signingConsumer = consumer) {
    const value = { ...request, modelId: request.model.id, modelIdentity: request.model.identity, adapterIdentities: adapters.map(adapter => adapter.identity), content: 'answer', ownerPolicyDigest: OWNER_DIGEST,
      usage: { schema: 'raw-model-tokens/v1', inputTokens: 7, outputTokens: 3 },
      execution: { completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } } };
    const measured = await measureWholeModelReceipt(request.messages, { ...value, completion: value.execution.completion });
    value.execution.receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
      provider: signingProvider.peerId, consumer: signingConsumer.peerId, model: request.model.id, jobHash: job }), signingProvider), signingConsumer);
    return value;
  }
  const execute = async (_request, scoped) => { expect(await scoped.requestApproval(preview)).toBe(true); return result(); };
  const offer = (offerId = 'whole-offer') => offerAndAccept(rewards, { offerId, accountId: 'contributor', participantId: provider.peerId,
    work: { category: 'demanded_inference', participantId: provider.peerId, model: {
      modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, executionMode: 'whole-model', adapterIdentities: [] } } });
  return { ledger, rewards, backend, trialBackend, h, open, accept, request, controls, controller, preview, result, execute, offer, provider, consumer,
    get accepted() { return chosen; }, get qualityCalls() { return qualityCalls; } };
}

describe.each(['memory', 'firestore'])('whole-model accounting on %s', storage => {
  it('refuses missing authorities and mismatched policy before dispatch', async () => {
    const f = await fixture(storage);
    expect(() => f.open({ policyVersion: null })).toThrow('Explicit pricing');
    expect(() => f.open({ assessQuality: null })).toThrow('quality authorities');
    if (storage === 'memory') expect(() => f.open({ production: true })).toThrow('durable shared storage');
    await expect(f.open({ policyVersion: 'unapproved' }).run(f.request, f.controls, f.execute)).rejects.toThrow('Quote policy');
    await expect(f.open({ resolveAcceptedRequest: async () => null }).run(f.request, f.controls, f.execute)).rejects.toThrow('authorized accepted quote');
    expect((await f.ledger.getReservation(f.accepted.reservationId)).attempts).toEqual([]);
  });
  it('allows only one instance to execute a concurrently claimed acceptance', async () => {
    const f = await fixture(storage); let executions = 0;
    const execute = (...args) => { executions++; return f.execute(...args); };
    const outcomes = await Promise.allSettled([f.open().run(f.request, f.controls, execute), f.open().run(f.request, f.controls, execute)]);
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(executions).toBe(1);
    expect((await f.ledger.getAccount('requester')).byProvenance.purchased.spent).toBe(12);
  });
  it.each(['/v1/chat/completions', '/v1/responses'])('settles measured usage through the actual %s handler', async route => {
    const f = await fixture(storage);
    const model = { ...f.request.model, availability: 'ready', providerIds: ['connection-fixture'] };
    const participant = { getState: () => ({ models: [model] }), async generate(request, controls) {
      const ids = { threadId: request.threadId, attemptId: request.attemptId };
      await controls.requestApproval({ ...f.preview, ...ids });
      const value = await f.result();
      return { ...value, ...ids, execution: { ...value.execution, stopReason: 'eos-token' } };
    } };
    const api = createTextApi({ participant, accounting: f.open(), authenticate: async () => f.controls.principal,
      authorize: async () => true, production: false });
    const server = http.createServer((req, res) => api.handle(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const body = route.endsWith('responses') ? { input: f.request.messages[0].content, store: false } : { messages: f.request.messages };
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, model: model.id }) });
      const value = await response.json(); expect(response.status, JSON.stringify(value)).toBe(200);
      expect(value.usage).toEqual(route.endsWith('responses') ? { input_tokens: 7, output_tokens: 3, total_tokens: 10 }
        : { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
      expect((await f.ledger.getReservation(f.accepted.reservationId)).settlement.charge).toBe(12);
    } finally { await api.close(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  it('charges measured usage under accepted terms and retains replayable evidence without prompt text', async () => {
    const f = await fixture(storage), a = f.open(), id = f.accepted.reservationId;
    const result = await a.run(f.request, f.controls, f.execute);
    expect(result.accounting.settlement).toMatchObject({ charge: 12, metering: { context: 7, output: 3 } });
    expect(f.qualityCalls).toBe(1);
    expect(await a.getTrialState()).toMatchObject({ spentMinor: 6, reservedMinor: 0, active: 0 });
    const record = await a.getRecord(id);
    expect(JSON.stringify(record)).not.toContain(f.request.messages[0].content);
    expect(record.receipt).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect((await f.open().reconcile(id)).settlement.charge).toBe(12);
    await expect(f.open().run(f.request, f.controls, () => { throw Error('must never execute'); })).rejects.toThrow('unavailable');
    expect((await f.ledger.getAccount('requester')).byProvenance.purchased.spent).toBe(12);
  });
  it('settles cancellation before disclosure without charging or retaining the slot', async () => {
    const f = await fixture(storage), a = f.open(); f.controller.abort(Error('cancelled'));
    await expect(a.run(f.request, f.controls, f.execute)).rejects.toThrow('cancelled');
    expect((await f.ledger.getReservation(f.accepted.reservationId)).settlement).toMatchObject({ charge: 0, phase: 'queued' });
    expect(await a.getTrialState()).toMatchObject({ active: 0, spentMinor: 0 });
  });
  it('keeps uncertain cancellation held across restart and refuses a duplicate execution', async () => {
    const f = await fixture(storage), a = f.open(), id = f.accepted.reservationId;
    await expect(a.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval(f.preview); throw Error('connection lost');
    })).rejects.toThrow('connection lost');
    expect(await f.open().reconcile(id)).toEqual({ settled: false });
    expect(await f.open().getTrialState()).toMatchObject({ active: 1, reservedMinor: 30, spentMinor: 0 });
    await expect(f.open().run(f.request, f.controls, f.execute)).rejects.toThrow('unavailable');
    await f.accept();
    await expect(f.open().run(f.request, f.controls, f.execute)).rejects.toThrow('concurrency');
    expect((await f.ledger.getReservation(f.accepted.reservationId)).settlement.charge).toBe(0);
  });
  it('recovers a lost completion through authenticated HTTP after restart without dispatch or a second charge', async () => {
    const f = await fixture(storage), a = f.open(), id = f.accepted.reservationId;
    await expect(a.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval({ ...f.preview, requestId: 'fixture', providerId: 'old-connection' });
      throw Error('lost completion');
    })).rejects.toThrow('lost completion');
    let calls = 0;
    const participant = { getState: () => ({ models: [] }), generate() { throw Error('must never redispatch'); },
      async recoverGeneration(request, reference) {
        calls++; expect(request).toMatchObject({ attemptId: 'attempt', messages: f.request.messages });
        expect(reference).toEqual({ requestId: 'fixture', providerId: 'reconnected-peer', providerIdentity: f.provider.peerId });
        return { status: 'completed', result: await f.result() };
      } };
    const api = createTextApi({ participant, accounting: f.open(), authenticate: async () => f.controls.principal,
      authorize: async ({ action }) => action === 'chat.recover', production: false });
    const server = http.createServer((req, res) => api.handle(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const recover = async messages => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/reploid/recover`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reservationId: id, messages, providerId: 'reconnected-peer' }) });
      return { code: res.status, body: await res.json() };
    };
    try {
      expect((await recover([{ role: 'user', content: 'changed' }])).code).toBe(409); expect(calls).toBe(0);
      const first = await recover(f.request.messages); expect(first.code, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({ status: 'completed', content: 'answer', accounting: { settled: true, settlement: { charge: 12 } } });
      expect((await recover(f.request.messages)).body).toMatchObject({ status: 'settled', accounting: { settled: true } });
      expect(calls).toBe(1); expect((await f.ledger.getAccount('requester')).byProvenance.purchased.spent).toBe(12);
      expect(await f.open().getTrialState()).toMatchObject({ active: 0, spentMinor: 6 });
    } finally { await api.close(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  it.each([true, false])('settles cleanup only when accepted terms allow missing meters (fixed=%s)', async fixed => {
    const f = await fixture(storage);
    if (fixed) await f.accept({ cancellationDispatched: { kind: 'fixed', amount: 2 } });
    const a = f.open(), id = f.accepted.reservationId;
    await expect(a.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval({ ...f.preview, requestId: 'cancelled-job', providerId: 'peer' }); throw Error('disconnected');
    })).rejects.toThrow('disconnected');
    const terminal = await signGenerationTerminal({ requestId: 'cancelled-job', provider: f.provider.peerId, consumer: f.consumer.peerId,
      model: f.request.model.id, modelIdentity: f.request.model.identity, adapterIdentities: [], inputDigest: await hashJson(f.request.messages) }, 'cancelled', f.provider);
    const input = { reservationId: id, messages: f.request.messages };
    await expect(f.open().recover(input, f.controls, async () => ({ status: 'cancelled', terminal: { ...terminal, requestId: 'other-job' } })))
      .rejects.toThrow('Unverified recovery cleanup');
    expect(await a.getTrialState()).toMatchObject({ active: 1, spentMinor: 0 });
    const recovered = await f.open().recover(input, f.controls, async () => ({ status: 'cancelled', terminal }));
    expect(recovered.accounting.settled).toBe(fixed);
    if (fixed) {
      expect(recovered.accounting.settlement.charge).toBe(2);
      expect(await f.open().getTrialState()).toMatchObject({ active: 0, spentMinor: 1 });
    } else expect(await f.open().getTrialState()).toMatchObject({ active: 1, spentMinor: 0 });
  });
  it('keeps unknown execution held and refuses another account during recovery', async () => {
    const f = await fixture(storage), a = f.open(), id = f.accepted.reservationId;
    await expect(a.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval({ ...f.preview, requestId: 'unknown', providerId: 'peer' }); throw Error('disconnected');
    })).rejects.toThrow('disconnected');
    const input = { reservationId: id, messages: f.request.messages };
    await expect(f.open().recover(input, { ...f.controls, principal: { subject: 'other' } }, () => { throw Error('must not query'); }))
      .rejects.toThrow('another accepted account');
    expect(await f.open().recover(input, f.controls, async () => ({ status: 'unresolved' }))).toEqual({ status: 'unresolved', accounting: { settled: false } });
    expect(await a.getTrialState()).toMatchObject({ active: 1, spentMinor: 0 });
  });
  it('retains the exact adapter variant across recovery and rejects a base-model substitution', async () => {
    const adapter = { identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: MODEL.modelIdentity };
    const f = await fixture(storage, [adapter]), a = f.open(), id = f.accepted.reservationId;
    await expect(a.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval({ ...f.preview, requestId: 'fixture', providerId: 'peer' }); throw Error('disconnected');
    })).rejects.toThrow('disconnected');
    const input = { reservationId: id, messages: f.request.messages };
    await expect(f.open().recover(input, f.controls, async () => {
      const result = await f.result(); result.adapterIdentities = []; return { status: 'completed', result };
    })).rejects.toThrow('execution receipt');
    const recovered = await f.open().recover(input, f.controls, async request => {
      expect(request.model.adapters).toEqual([adapter]); return { status: 'completed', result: await f.result() };
    });
    expect(recovered.accounting.settled).toBe(true);
  });
  it('recovers the real mesh result through the HTTP API and rewards its measured work once', async () => {
    const f = await fixture(storage), cleanup = [], a = f.open(), id = f.accepted.reservationId;
    let requester;
    const mesh = await createRecoveryMesh(cleanup, { identities: [f.consumer, f.provider], modelId: f.request.model.id,
      modelIdentity: f.request.model.identity, messages: f.request.messages,
      authorize: input => input.action === 'mesh.dispatch' ? requester.authorize(input) : true,
      result: { model: f.request.model.id, modelIdentity: f.request.model.identity, adapterIdentities: [], content: 'answer', ownerPolicyDigest: OWNER_DIGEST,
        completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } } });
    requester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [f.request.model] });
    const participant = { getState: () => ({ models: requester.getModels() }), generate: requester.generate, recoverGeneration: requester.recover };
    const api = createTextApi({ participant, accounting: a, authenticate: async () => f.controls.principal,
      authorize: async () => true, production: false });
    const server = http.createServer((req, res) => api.handle(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      await f.offer(); mesh.drop(); const controller = new AbortController();
      const pending = fetch(base + '/v1/chat/completions', { method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: f.request.model.id, messages: f.request.messages }) });
      const rejected = expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(mesh.wire.some(item => item.type === 'reploid:generation-result')).toBe(true));
      controller.abort(); await rejected;
      await mesh.restartProvider();
      const response = await fetch(base + '/v1/reploid/recover', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reservationId: id, messages: f.request.messages, providerId: mesh.reference.providerId }) });
      const recovered = await response.json(); expect(response.status, JSON.stringify(recovered)).toBe(200);
      expect(recovered).toMatchObject({ status: 'completed', content: 'answer', accounting: { settled: true, settlement: { charge: 12 } } });
      expect(mesh.executions).toBe(1); expect(await a.getTrialState()).toMatchObject({ active: 0, spentMinor: 6 });
      const claim = await f.rewards.validateWork({ offerId: 'whole-offer', reservationId: id,
        attemptId: (await a.getRecord(id)).attemptId, idempotencyKey: 'recovered-claim' });
      expect(claim.outcome).toBe('accepted');
      await f.rewards.issueReward({ validationId: claim.validationId });
      await f.rewards.issueReward({ validationId: claim.validationId });
      expect((await f.ledger.getAccount('contributor')).byProvenance.earned.issued).toBe(4);
    } finally { await api.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      for (const close of cleanup.reverse()) await close(); }
  });
  it.each(['count', 'content', 'signature', 'provider', 'quality'])('does not charge unvalidated %s evidence', async changed => {
    const f = await fixture(storage), a = f.open(changed === 'quality' ? { assessQuality: async () => null } : {});
    await expect(a.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval(f.preview); const value = await f.result();
      if (changed === 'count') value.usage.outputTokens++;
      if (changed === 'content') value.content = 'tampered';
      if (changed === 'signature') delete value.execution.receipt.consumerSignature;
      if (changed === 'provider') value.execution.receipt.provider = 'other';
      return value;
    })).rejects.toThrow(changed === 'quality' ? 'quality decision' : 'execution receipt');
    expect((await f.ledger.getReservation(f.accepted.reservationId)).settlement).toBeNull();
    expect(await a.getTrialState()).toMatchObject({ active: 1, spentMinor: 0 });
  });
  it('refuses a reused provider execution under a new accepted quote', async () => {
    const f = await fixture(storage); await f.open().run(f.request, f.controls, f.execute); await f.accept();
    await expect(f.open().run(f.request, f.controls, f.execute)).rejects.toThrow('already used');
    expect((await f.ledger.getAccount('requester')).byProvenance.purchased.spent).toBe(12);
  });
  it('recovers a lost settlement response without repeating inference or the charge', async () => {
    const f = await fixture(storage), original = f.ledger.settleReservation.bind(f.ledger);
    let fault = true;
    f.ledger.settleReservation = async input => { const value = await original(input); if (fault) { fault = false; throw Error('lost response'); } return value; };
    await expect(f.open().run(f.request, f.controls, f.execute)).rejects.toThrow('lost response');
    expect((await f.open().reconcile(f.accepted.reservationId)).settlement.charge).toBe(12);
    expect(await f.open().getTrialState()).toMatchObject({ active: 0, spentMinor: 6 });
    expect((await f.ledger.getAccount('requester')).byProvenance.purchased.spent).toBe(12);
  });
  it('issues one earned lot for validated whole-model work, then redeems it with another provider', async () => {
    const f = await fixture(storage); await f.offer(); const a = f.open();
    await a.run(f.request, f.controls, f.execute);
    const claim = { offerId: 'whole-offer', reservationId: f.accepted.reservationId, attemptId: f.request.attemptId, idempotencyKey: 'claim' };
    const validation = await f.rewards.validateWork(claim);
    expect(validation.reasons).toEqual([]); expect(validation.outcome).toBe('accepted');
    expect((await f.rewards.issueReward({ validationId: validation.validationId })).amount).toBe(4);
    await f.rewards.issueReward({ validationId: validation.validationId });
    expect((await f.ledger.getAccount('contributor')).byProvenance.earned.available).toBe(4);
    const duplicate = await f.rewards.validateWork({ ...claim, idempotencyKey: 'second-claim' });
    expect(duplicate.outcome).toBe('rejected');

    // A new accepted test-only tariff spends exactly the earned lot. The former
    // requester supplies this controlled answer; no physical inference is claimed.
    const input = quoteInput({ quoteId: 'redeem', accountId: 'contributor' });
    input.service.model.deployedRepresentation = MODEL.modelIdentity;
    input.pricing = { basis: { policyVersion, kind: 'fixture-redemption' }, maxCharge: 4 };
    input.terms.settlement.full = { kind: 'fixed', amount: 4 };
    input.terms.settlement.partialDelivery = { kind: 'fixed', amount: 0 };
    input.terms.settlement.cancellationDispatched = { kind: 'fixed', amount: 0 };
    const quote = await f.ledger.createQuote({ ...input, idempotencyKey: 'redeem' });
    const accepted = await f.ledger.acceptQuote({ quoteId: quote.quoteId, quoteHash: quote.quoteHash,
      accountId: 'contributor', deviceId: 'device', idempotencyKey: 'redeem' });
    const redemption = f.open({ resolveAcceptedRequest: async () => ({ ...accepted, accountId: 'contributor',
      requesterId: f.provider.peerId, conversionId: 'http-fixture' }) });
    await redemption.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval({ ...f.preview, recipientIdentity: f.consumer.peerId });
      return f.result('request:redeem', f.consumer, f.provider);
    });
    expect((await f.ledger.getAccount('contributor')).byProvenance.earned).toMatchObject({ available: 0, held: 0, spent: 4, issued: 4 });
  });
  it.each(['owner', 'self', 'unsettled'])('refuses rewards for %s work', async changed => {
    const f = await fixture(storage); await f.offer(); const a = f.open();
    if (changed !== 'unsettled') await a.run(f.request, f.controls, async (_request, scoped) => {
      await scoped.requestApproval(f.preview);
      const value = await f.result();
      if (changed === 'owner') {
        value.ownerPolicyDigest = null;
        const measured = await measureWholeModelReceipt(f.request.messages, { ...value, completion: value.execution.completion });
        value.execution.receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
          provider: f.provider.peerId, consumer: f.consumer.peerId, model: MODEL.modelId, jobHash: 'request:no-owner' }), f.provider), f.consumer);
      }
      return value;
    });
    if (changed === 'self') fx.participants.set(f.consumer.peerId, 'contributor');
    const validation = await f.rewards.validateWork({ offerId: 'whole-offer', reservationId: f.accepted.reservationId,
      attemptId: f.request.attemptId, idempotencyKey: 'reject' });
    expect(validation.outcome).toBe('rejected');
    expect((await f.ledger.getAccount('contributor')).byProvenance.earned.issued).toBe(0);
  });
  it('holds failed quality for operational review before allowing settlement and rewards', async () => {
    const f = await fixture(storage); await f.offer();
    const a = f.open({ assessQuality: async () => ({ outcome: 'failed_quality', reason: 'requires review',
      policyVersion: 'quality-policy-test/1', decisionId: 'fixture-failed' }) });
    const result = await a.run(f.request, f.controls, f.execute);
    expect(result.accounting).toEqual({ settled: false, status: 'under_review' });
    const id = f.accepted.reservationId;
    const claim = { offerId: 'whole-offer', reservationId: id, attemptId: f.request.attemptId, idempotencyKey: 'before-review' };
    expect((await f.rewards.validateWork(claim)).outcome).toBe('rejected');
    const reservation = await f.ledger.getReservation(id);
    await f.ledger.resolveQualityReview({ reviewId: reservation.reviewId, disposition: 'full',
      reviewer: { reviewerId: 'fixture-operator', authority: 'operational_review', decisionId: 'reviewed' }, idempotencyKey: 'review' });
    expect((await a.reconcile(id)).settled).toBe(true);
    expect((await f.rewards.validateWork({ ...claim, idempotencyKey: 'after-review' })).outcome).toBe('accepted');
  });
});
