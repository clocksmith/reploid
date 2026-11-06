// @vitest-environment node
// Real account, offer, quote, settlement, claim and issuance engines over HTTP.
// All prices and provider output here are explicit test fixtures, not live service.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createEarningComposition } from '../../server/earning-composition/index.js';
import { mountEarningRoutes } from '../../server/earning-routes/mount.js';
import { createTextAccounting, TEXT_ACCOUNTING_COLLECTIONS } from '../../server/text-accounting.js';
import { TRIAL_COLLECTIONS } from '../../server/trial-admission.js';
import { createMemoryLedgerBackend } from '../../server/ledger/memory-store.js';
import { createFirestoreLedgerBackend } from '../../server/ledger/firestore-store.js';
import { createNativeEarningStorage, openNativeEarning } from '../../server/native-earning.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { earningPolicy } from '../helpers/earning-policy-fixture.js';
import { ownerAuthorization, MODEL } from '../helpers/reward-fixture.js';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const model = { modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, executionMode: 'whole-model', adapterIdentities: [] };
async function fixture(kind) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'whole-earning-'));
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  const policy = earningPolicy();
  policy.offers[0].model = model;
  policy.services[0].service.model.deployedRepresentation = model.modelIdentity;
  policy.conversions.records[0].policyVersion = policy.policyVersion;
  await fs.writeFile(path.join(directory, 'policy.json'), JSON.stringify(policy));
  await fs.writeFile(path.join(directory, 'capacity.json'), JSON.stringify({ schema: 'reploid.admitted-capacity-evidence/v1',
    evidenceId: 'fixture-capacity', accountingVersion: policy.ledger.accountingVersion, serviceCredits: 10000, observedAt: new Date().toISOString() }));
  const db = createFakeFirestore(); let accounting;
  const composition = await createEarningComposition({ env: { REPLOID_EARNING_POLICY_FILE: path.join(directory, 'policy.json'),
    REPLOID_EARNING_STORE: kind, REPLOID_EARNING_FIRESTORE_PREFIX: 'whole_test', REPLOID_EARNING_TEST_SIGN_IN: 'enabled',
    REPLOID_EARNING_TEST_PROCESSOR: 'enabled', REPLOID_EARNING_CAPACITY_FILE: path.join(directory, 'capacity.json') },
  ports: { firestore: db, readWholeModelExecution: id => accounting?.getRecord(id),
    resolveWholeModelContribution: ref => accounting?.resolveContribution(ref), log: { warn() {} } } });
  const app = express();
  await mountEarningRoutes(app, { env: { REPLOID_EARNING_ROUTES: 'enabled' }, composition, log: { error() {} } });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const keys = new Map(), stores = new Map(); let loseClaim = false;
  async function native(subject, restart = false, slot = subject) {
    if (!keys.has(slot)) keys.set(slot, await createSigningIdentity({ algorithm: 'Ed25519' }));
    if (!stores.has(slot)) stores.set(slot, createNativeEarningStorage(path.join(directory, slot + '.json')));
    const instance = await openNativeEarning({ identity: keys.get(slot), storage: stores.get(slot), ownerAuthorization,
      settings: { client: { schema: 'reploid.earning-client/v1', enabled: true, baseUrl: base + '/v1', providerId: 'local-test' }, signIn: { subject } },
      fetch: async (...args) => {
        const response = await fetch(...args);
        if (loseClaim && String(args[0]).endsWith('/claims') && response.ok) { loseClaim = false; await response.text(); throw Error('lost claim response'); }
        return response;
      } });
    if (!restart) expect(instance.participantId).toBe(keys.get(slot).peerId);
    return instance;
  }
  const requester = await native('requester'), provider = await native('provider');
  const topup = await requester.client.send({ opId: 'fixture-topup', path: '/payments/checkouts', body: { topUpId: 'test-topup' } });
  expect((await fetch(base + topup.checkout.url + '/complete', { method: 'POST' })).ok).toBe(true);
  const collections = mapping => kind === 'memory' ? createMemoryLedgerBackend({ collections: mapping })
    : createFirestoreLedgerBackend({ firestore: db, collections: mapping, collectionPrefix: 'whole_test' });
  let accepted;
  accounting = createTextAccounting({ ledger: composition.ledger, backend: collections(TEXT_ACCOUNTING_COLLECTIONS),
    trialBackend: collections(TRIAL_COLLECTIONS), policyVersion: policy.policyVersion, production: false,
    trialPolicy: { trialId: 'fixture', currency: 'USD', totalMinor: 200, accountMinor: 100, maxConcurrent: 1 },
    resolveAcceptedRequest: async () => ({ ...accepted, accountId: requester.session.accountId,
      requesterId: requester.participantId, conversionId: policy.conversions.records[0].conversionId }),
    assessQuality: async () => ({ outcome: 'full', policyVersion: policy.services[0].service.qualityPolicyVersion, decisionId: 'fixture-quality' }) });
  const request = { threadId: 'thread', attemptId: 'attempt', model: { id: model.modelId, identity: model.modelIdentity },
    messages: [{ role: 'user', content: 'private fixture prompt' }] };
  async function execute({ beforeSettle } = {}) {
    const quote = await requester.client.send({ opId: 'quote', path: '/quotes', body: { request: policy.services[0].request } });
    accepted = await requester.client.send({ opId: 'accept', path: `/quotes/${quote.quoteId}/accept`, body: { quoteHash: quote.quoteHash } });
    return accounting.run(request, { principal: { subject: requester.session.accountId }, signal: new AbortController().signal, requestApproval: async () => true }, async (_request, controls) => {
      await controls.requestApproval({ ...request, modelId: model.modelId, modelIdentity: model.modelIdentity, adapterIdentities: [],
        recipientIdentity: provider.participantId, input: { messages: request.messages } });
      await provider.prepareWholeModel({ model, requestId: 'mesh-request', consumer: requester.participantId });
      const result = { threadId: request.threadId, attemptId: request.attemptId, modelId: model.modelId, modelIdentity: model.modelIdentity,
        adapterIdentities: [], ownerPolicyDigest: ownerAuthorization.digest, content: 'private fixture answer',
        usage: { schema: 'raw-model-tokens/v1', inputTokens: 7, outputTokens: 3 },
        execution: { completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } } };
      const measured = await measureWholeModelReceipt(request.messages, { ...result, completion: result.execution.completion });
      result.execution.receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
        model: model.modelId, provider: provider.participantId, consumer: requester.participantId, jobHash: 'request:mesh-request' }), keys.get('provider')), keys.get('requester'));
      await provider.recordWholeModelReceipt(result.execution.receipt);
      await beforeSettle?.(result.execution.receipt);
      return result;
    });
  }
  return { composition, requester, provider, execute, native, stores, request, accounting, loseClaim: () => { loseClaim = true; } };
}

describe.each(['memory', 'firestore'])('whole-model native earning on %s', kind => {
  it('accepts a variant offer before execution, waits for settlement, and claims once after restart', async () => {
    const f = await fixture(kind); await f.provider.ensureOffer(model);
    let ref;
    await f.execute({ beforeSettle: async receipt => {
      ref = { wholeModel: { receiptId: receipt.receiptId, jobHash: receipt.jobHash } };
      expect((await f.provider.observe()).wholeModels).toMatchObject([{ status: 'open' }]);
      const pending = JSON.stringify(await f.stores.get('provider').get('whole-model-work'));
      expect(pending).not.toContain('private fixture prompt'); expect(pending).not.toContain('private fixture answer');
      expect((await f.composition.ledger.getAccount(f.provider.session.accountId)).byProvenance.earned.issued).toBe(0);
    } });
    f.loseClaim();
    expect((await f.provider.observe()).wholeModels).toMatchObject([{ status: 'pending' }]);
    const restarted = await f.native('provider', true);
    expect((await restarted.observe()).wholeModels).toMatchObject([{ status: 'done', outcome: 'accepted', issuance: 'issued' }]);
    expect((await restarted.observe()).wholeModels).toEqual([]);
    await expect(restarted.prepareWholeModel({ model, requestId: 'mesh-request', consumer: f.requester.participantId })).rejects.toThrow('already recorded');
    expect((await f.composition.ledger.getAccount(restarted.session.accountId)).byProvenance.earned.issued).toBe(4);
    const record = await f.stores.get('provider').get('whole-model-work'); expect(record).toEqual([]);
    const ownOffer = (await restarted.offers())[0].offerId;
    const other = await f.native('intruder');
    await expect(other.client.send({ opId: 'stolen', path: `/offers/${ownOffer}/claims`, body: ref })).rejects.toMatchObject({ code: 'offer_not_found' });
    const sameAccount = await f.native('provider', false, 'other-device');
    expect(sameAccount.session.accountId).toBe(restarted.session.accountId);
    await expect(sameAccount.client.send({ opId: 'wrong-device', path: `/offers/${ownOffer}/claims`, body: ref }))
      .rejects.toMatchObject({ code: 'contributor_identity_mismatch' });
    await expect(restarted.client.send({ opId: 'authored-charge', path: `/offers/${ownOffer}/claims`, body: { ...ref, reservationId: 'invented' } }))
      .rejects.toMatchObject({ code: 'invalid_body' });
  });
  it('does not retroactively accept an offer for already-dispatched work', async () => {
    const f = await fixture(kind);
    await expect(f.provider.prepareWholeModel({ model, requestId: 'early', consumer: f.requester.participantId })).rejects.toThrow('before admitting');
    expect(await f.provider.offers()).toEqual([]);
    const adapted = { ...model, adapterIdentities: ['sha256:' + 'b'.repeat(64)] };
    await expect(f.provider.ensureOffer(adapted)).rejects.toMatchObject({ code: 'offer_not_available' });
    await f.provider.ensureOffer(model);
    await expect(f.provider.prepareWholeModel({ model: adapted, requestId: 'wrong-adapter', consumer: f.requester.participantId })).rejects.toThrow('before admitting');
  });
});
