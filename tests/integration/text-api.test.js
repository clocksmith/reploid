// @vitest-environment node
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { mountTextApi } from '../../server/text-api-mount.js';
import { createTrialAdmission, TRIAL_COLLECTIONS } from '../../server/trial-admission.js';
import { createMemoryLedgerBackend } from '../../server/ledger/memory-store.js';

const owners = [];
afterEach(async () => { for (const close of owners.splice(0).reverse()) await close(); });
const model = { id: 'whole-fixture', identity: 'sha256:' + 'a'.repeat(64), availability: 'ready', providerIds: ['peer-fixture'] };
const authenticate = async req => req.headers.authorization === 'Bearer fixture' ? { subject: 'account-fixture' } : null;
async function boot({ generate, accounting } = {}) {
  const participant = { getState: () => ({ models: [model] }), generate: generate || vi.fn(async (request, controls) => {
    await controls.requestApproval({ threadId: request.threadId, attemptId: request.attemptId, modelId: model.id,
      modelIdentity: model.identity, providerId: 'peer-fixture', adapterIdentities: [], input: { messages: request.messages } });
    return { threadId: request.threadId, attemptId: request.attemptId, modelId: model.id, modelIdentity: model.identity,
      adapterIdentities: [], content: 'fixture answer', execution: { stopReason: 'eos-token' } };
  }) };
  const app = express();
  const mounted = await mountTextApi(app, { env: { NODE_ENV: 'test', REPLOID_TEXT_API_COMPOSITION: '/tmp/reploid-fixture-composition.mjs' },
    importModule: async () => ({ createTextApiComposition: async () => ({ participant, authenticate,
      authorize: async () => true, accounting, allowUnbilledTest: true, testOnly: true }) }) });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  owners.push(async () => { await mounted.close(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { base, send, participant };
}

it('mounts authenticated models, completions and responses on the same borrowed whole-model requester', async () => {
  const f = await boot();
  expect((await fetch(f.base + '/v1/models')).status).toBe(401);
  expect(await (await f.send('/v1/models')).json()).toMatchObject({ data: [{ id: model.id, model_identity: model.identity, adapter_identities: [] }] });
  const completion = await f.send('/v1/chat/completions', { model: model.id, messages: [{ role: 'user', content: 'hello' }] });
  expect(completion.status).toBe(200);
  expect((await completion.json()).choices[0].message.content).toBe('fixture answer');
  const response = await f.send('/v1/responses', { model: model.id, input: 'hello', store: false });
  expect(response.status).toBe(200);
  expect((await response.json()).output[0].content[0].text).toBe('fixture answer');
});

it('keeps production closed without an accounting owner and refuses in-repo, relative, invalid or test compositions', async () => {
  const app = express(), importModule = vi.fn();
  expect((await mountTextApi(app, { env: {}, importModule })).mounted).toBe(false);
  for (const invalidPath of ['relative/composition.mjs', fileURLToPath(new URL('../../server/text-api.js', import.meta.url))]) {
    await expect(mountTextApi(app, { env: { REPLOID_TEXT_API_COMPOSITION: invalidPath }, importModule }))
      .rejects.toThrow('outside the repository');
  }
  expect(importModule).not.toHaveBeenCalled();
  const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-text-api-'));
  owners.push(() => fs.rm(externalDir, { recursive: true, force: true }));
  const invalidModule = path.join(externalDir, 'invalid-composition.mjs');
  await fs.writeFile(invalidModule, 'export const unused = true;\n');
  await expect(mountTextApi(app, {
    env: { REPLOID_TEXT_API_COMPOSITION: invalidModule }
  })).rejects.toThrow('createTextApiComposition');
  const composition = { participant: { getState() {}, generate() {} }, authenticate, authorize: async () => true, allowUnbilledTest: true, close: vi.fn() };
  const options = { env: { NODE_ENV: 'production', REPLOID_TEXT_API_COMPOSITION: '/tmp/reploid-fixture-composition.mjs' },
    importModule: async () => ({ createTextApiComposition: async () => composition }) };
  await expect(mountTextApi(app, options)).rejects.toThrow('accounted execution');
  composition.testOnly = true;
  await expect(mountTextApi(app, options)).rejects.toThrow('test composition');
  expect(composition.close).toHaveBeenCalledTimes(2);
});

it('applies the same durable trial slot to both protocols before dispatch, then reconciles a fixture ledger receipt', async () => {
  const reservations = new Map(), settlements = new Map();
  const guard = createTrialAdmission({ backend: createMemoryLedgerBackend({ collections: TRIAL_COLLECTIONS }), production: false,
    policy: { trialId: 'http-fixture', currency: 'USD', totalMinor: 90, accountMinor: 30, maxConcurrent: 1 },
    readReservation: async id => reservations.get(id), readSettlement: async id => settlements.get(id) });
  let release, entered;
  const holding = new Promise(resolve => { release = resolve; });
  const admitted = new Promise(resolve => { entered = resolve; });
  const accounting = { async run(request, controls, execute) {
    const reservationId = request.attemptId, accountId = controls.principal.subject;
    reservations.set(reservationId, { reservationId, accountId, accepted: true, currency: 'USD',
      quoteIdentity: 'fixture-quote', maxSubsidyMinor: 5, expiresAt: Date.now() + 10000 });
    const admission = await guard.reserve({ accountId, reservationId });
    if (!admission.admitted) throw Error('Already admitted');
    entered(); await holding;
    const result = await execute();
    settlements.set(reservationId, { reservationId, accountId, settlementId: 'fixture-settlement', currency: 'USD', subsidyMinor: 3, executionSettled: true });
    await guard.reconcile(reservationId);
    return result;
  } };
  const f = await boot({ accounting });
  owners.push(async () => release());
  const first = f.send('/v1/chat/completions', { model: model.id, messages: [{ role: 'user', content: 'hello' }] });
  await admitted;
  const second = await f.send('/v1/responses', { model: model.id, input: 'hello', store: false });
  expect(second.status).toBe(429);
  expect(f.participant.generate).not.toHaveBeenCalled();
  release();
  expect((await first).status).toBe(200);
  expect(f.participant.generate).toHaveBeenCalledTimes(1);
  expect(await guard.getState()).toMatchObject({ active: 0, spentMinor: 3, reservedMinor: 0 });
});

it('hides unapproved distributed routes from the public API and refuses direct requests', async () => {
  const f = await boot();
  const split = { ...model, id: 'unapproved-split', partition: { planId: 'test-plan', participantA: 'a', participantB: 'b' }, qualified: true };
  f.participant.getState = () => ({ models: [model, split] });
  const listed = await (await f.send('/v1/models')).json();
  expect(listed.data.map(row => row.id)).toEqual([model.id]);
  for (const [path, body] of [
    ['/v1/chat/completions', { model: split.id, messages: [{ role: 'user', content: 'hello' }] }],
    ['/v1/responses', { model: split.id, input: 'hello', store: false }]
  ]) expect((await f.send(path, body)).status).toBe(503);
  expect(f.participant.generate).not.toHaveBeenCalled();
});
