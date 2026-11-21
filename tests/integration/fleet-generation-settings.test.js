// @vitest-environment node
// Generation settings through real HTTP, bearer auth, SQLite credits, the fleet service and two
// meshes joined in memory. Provider execution is a function: this shows the contract binding and
// the refusals, not model inference or a physical peer.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt, verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { signGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { GENERATION_SETTINGS_CAPABILITY, effectiveRequestDigest, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { startFleetTextApi } from '../../server/fleet/text-api.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';

const model = { id: 'qwen-3-5-2b-q4k-ef16-af32', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler', generation: { maxTokens: 16 } };
const token = 'synthetic-fleet-api-bearer-secret-0123456789abcdef';
const roomId = 'reploid-swarm-fleet-fixture';
const messages = [{ role: 'user', content: 'Count upward from one.' }];
const limitOnly = { ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true };
const otherDigest = 'sha256:' + 'e'.repeat(64);
const loadedAdapter = 'sha256:' + 'b'.repeat(64);
const completion = (generatedTokenCount, stopReason) => ({ schema: 'doppler.generation-completion/v1', promptTokenCount: 11, generatedTokenCount, stopReason });
const answer = (content, tokens, stopReason, extra = {}) => ({ model: model.id, modelIdentity: model.identity, adapterIdentities: [],
  content, completion: completion(tokens, stopReason), ...extra });
const amounts = () => credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }));

let root, keys, credits, service, requesterCredits, providerCredits;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet-generation-settings-'));
  keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  credits = await openFleetCredits({
    file: path.join(root, 'credits.sqlite'),
    computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: 'owner',
      providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] })),
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: 1, maxDebt: 100, maxOutputTokens: 16, maxPendingPerComputer: 2,
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: true, wholeModelTerminalCharge: 0 }
  });
  service = await startFleetService({ credits, models: [model],
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  requesterCredits = createFleetClient({ url: service.url, identity: keys[0] });
  providerCredits = createFleetClient({ url: service.url, identity: keys[1] });
});
afterEach(async () => {
  await service?.close();
  credits?.close();
  await rm(root, { recursive: true, force: true });
});

/** The whole path: HTTP edge, accounted requester, requester mesh, provider mesh, provider credit admission. */
async function fixture({ execute, capability = limitOnly, intercept = null, expectedConstraintIdentity = null, alterAdmit = null, loadedAdapters = [] } = {}) {
  const cleanup = [], admits = [], executed = [], authorizations = [], reservations = [];
  const observedCredits = { ...providerCredits, call: async (operation, payload) => {
    if (operation === 'admit') { if (alterAdmit) payload = alterAdmit(structuredClone(payload)); admits.push(structuredClone(payload)); }
    return providerCredits.call(operation, payload);
  } };
  const admission = createFleetExecutionAdmission({ credits: observedCredits, model });
  let wholeRequester;
  const mesh = await createRecoveryMesh(cleanup, {
    identities: keys, modelId: model.id, modelIdentity: model.identity, intercept,
    authorize: async input => {
      authorizations.push(structuredClone(input));
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.admit') return admission.preadmit({ request: input.request, consumer: keys[0].peerId });
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    execute: async (received, update, controls) => {
      executed.push({ messages: structuredClone(received), settings: controls.settings });
      return execute(received, update, controls);
    },
    onGenerationTerminal: proof => admission.terminal(proof),
    ports: index => index
      ? { ...(capability ? { getGenerationSettingsCapability: () => capability } : {}),
        // Adapters the provider's runtime has loaded beside the base variant its credit admission serves.
        ...(loadedAdapters.length ? { getExecutionState: () => ({ phase: 'ready', modelIdentity: model.identity, adapterIdentities: loadedAdapters }) } : {}) }
      : { ...(expectedConstraintIdentity ? { expectedConstraintIdentity } : {}) }
  });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const allowsModel = vi.fn(candidate => candidate?.id === model.id && candidate?.identity === model.identity);
  const host = {
    identity: keys[0], credits: requesterCredits, allowsModel,
    async enrolledRecipients() {
      const network = await requesterCredits.call('computers', {});
      return new Set((network.computers || []).flatMap(row => row.participantIds || []));
    },
    textParticipant: { roomId, executionClass: 'private-pool', getState: () => ({ models: wholeRequester.getModels() }),
      generate: (request, controls) => wholeRequester.generate(request, controls),
      recoverGeneration: (request, reference, controls) => wholeRequester.recover(request, reference, controls) },
    async runAccountedGeneration(request, controls, run) {
      const requester = createFleetRequester({ participant: { generate: run }, identity: keys[0], credits: requesterCredits, maxOutputTokens: 16 });
      const result = await requester.generate(request, { ...controls, onReservation(id) { reservations.push(id); controls.onReservation?.(id); } });
      return { ...result, execution: { ...result.execution, serviceCredit: result.serviceCredit } };
    },
    recoverAccountedGeneration(input, controls, recoverExecution) {
      return createFleetRequester({ participant: host.textParticipant, identity: keys[0], credits: requesterCredits, maxOutputTokens: 16 })
        .recover(input, controls, recoverExecution);
    }
  };
  const api = await startFleetTextApi({ host, token, allowedRecipients: [keys[1].peerId] });
  cleanup.push(() => api.close());
  const post = body => fetch(`${api.url}/chat/completions`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model.id, messages, ...body }) });
  const sent = type => mesh.wire.filter(item => item.type === type).map(item => item.payload);
  const recover = body => fetch(`${api.url}/reploid/recover`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { mesh, admits, executed, authorizations, reservations, wholeRequester, allowsModel, post, sent, recover, api,
    row: () => credits.request(reservations.at(-1)),
    close: async () => { for (const close of cleanup.reverse()) await close(); } };
}

it('completes a request with an output limit, binds one digest in the reservation, admission and receipt, and settles once', async () => {
  const settings = normalizeGenerationSettings({ maxOutputTokens: 5 });
  const expected = await effectiveRequestDigest({ modelIdentity: model.identity, adapterIdentities: [], messages, settings });
  const held = [];
  const f = await fixture({ execute: async (_messages, update) => {
    held.push(credits.snapshot().accounts[0].held);
    update('1 2 3 4 5');
    return answer('1 2 3 4 5', 5, 'max-tokens');
  } });
  try {
    expect(f.wholeRequester.getModels()[0].generationSettings).toEqual(limitOnly);
    const response = await f.post({ max_completion_tokens: 5 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0]).toMatchObject({ message: { content: '1 2 3 4 5' }, finish_reason: 'length' });
    expect(body.usage).toEqual({ prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 });

    // The provider's host port received the canonical settings: this is where the limit is enforced.
    expect(f.executed).toEqual([{ messages, settings }]);
    // The credit hold is sized by the caller's limit, not the model ceiling of 16.
    expect(held).toEqual([5]);
    const row = f.row();
    expect(row.binding).toMatchObject({ settingsDigest: expected, maxOutputTokens: 5, maximum: 5, inputDigest: await hashJson(messages) });
    expect(f.admits).toEqual([expect.objectContaining({ settingsDigest: expected, outputLimit: 5, inputDigest: row.binding.inputDigest })]);
    expect(f.sent('reploid:generation-request')[0].settings).toEqual(settings);
    expect(f.authorizations.find(input => input.action === 'mesh.dispatch').settings).toEqual(settings);

    const receipt = f.sent('reploid:receipt')[0].receipt;
    expect(receipt).toMatchObject({ version: 3, settingsDigest: expected, outputTokens: 5, stopReason: 'max-tokens',
      provider: keys[1].peerId, consumer: keys[0].peerId });
    expect(receipt).not.toHaveProperty('constraintIdentity');
    expect(await verifyReceipt(receipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
    // The digest is inside both signatures: removing or changing it invalidates them.
    expect((await verifyReceipt({ ...receipt, settingsDigest: otherDigest })).valid).toBe(false);
    await expect(verifyReceipt({ ...receipt, version: 2, settingsDigest: undefined })).resolves.toMatchObject({ valid: false });

    expect(row.state).toBe('settled');
    expect(row.outcome).toMatchObject({ charge: 5, outputTokens: 5 });
    expect(amounts()).toEqual([{ balance: -5, held: 0 }, { balance: 5, held: 0 }]);
    expect(credits.snapshot().journal).toHaveLength(2);
    // Presenting the same receipt again has no second economic effect.
    expect(await providerCredits.settle(row.id, receipt)).toEqual(row.outcome);
    expect(credits.snapshot().journal).toHaveLength(2);
    expect(amounts()).toEqual([{ balance: -5, held: 0 }, { balance: 5, held: 0 }]);
  } finally { await f.close(); }
});

it('requires current authorization for a request without adding generation settings or a settings digest', async () => {
  // Current policy and commitment are mandatory even when generation settings are omitted.
  const f = await fixture({ execute: async (_messages, update) => { update('one'); return answer('one', 4, 'eos-token', { constraintIdentity: otherDigest }); } });
  try {
    const response = await f.post({});
    expect(response.status).toBe(200);
    expect((await response.json()).choices[0].finish_reason).toBe('stop');
    expect(f.executed[0].settings).toBeUndefined();
    const [preflight] = f.sent('reploid:generation-admit');
    expect(preflight).toMatchObject({ privacy: { schema: 'reploid.execution-policy/v2', recipients: { kind: 'named', ids: [keys[1].peerId] } },
      promptCommitment: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    expect(preflight).not.toHaveProperty('messages');
    expect(preflight).not.toHaveProperty('settings');
    const [payload] = f.sent('reploid:generation-request');
    expect(payload).toMatchObject({ messages, privacy: preflight.privacy, privacyBinding: preflight.privacyBinding });
    expect(payload).not.toHaveProperty('settings');
    expect(f.authorizations.find(input => input.action === 'mesh.dispatch')).not.toHaveProperty('settings');
    expect(Object.keys(f.admits[0]).sort()).toEqual(['consumer', 'executionId', 'id', 'inputDigest', 'mode', 'model', 'outputLimit']);
    expect(f.admits[0].outputLimit).toBe(16);
    const row = f.row();
    expect(row.binding.admission).toEqual({ schema: 'reploid.credit-preadmission/v1', commitment: preflight.promptCommitment });
    expect(row.binding).not.toHaveProperty('settingsDigest');
    const receipt = f.sent('reploid:receipt')[0].receipt;
    // A host that reports a constraint for a request without settings does not get it into the receipt.
    expect(Object.keys(receipt).sort()).toEqual(['adapterIdentities', 'cleanup', 'consumer', 'consumerKey', 'consumerSignature', 'inputDigest',
      'inputTokens', 'jobHash', 'model', 'modelIdentity', 'outputDigest', 'outputTokens', 'ownerPolicyDigest', 'provider', 'providerKey',
      'providerSignature', 'receiptId', 'status', 'stopReason', 'timestamp', 'usage', 'version']);
    expect(receipt.version).toBe(2);
    expect(row.state).toBe('settled');
    expect(amounts()).toEqual([{ balance: -4, held: 0 }, { balance: 4, held: 0 }]);
  } finally { await f.close(); }
});

it.each([
  ['settings altered on the wire', payload => { payload.settings.maxOutputTokens = 3; }, 'Execution admission rejected'],
  ['a message altered on the wire', payload => { payload.messages[0].content = 'Count downward from nine.'; }, 'Execution admission rejected'],
  ['the model identity altered on the wire', payload => { payload.modelIdentity = 'sha256:' + 'b'.repeat(64); }, 'Requested model is unavailable'],
  // Removing settings invalidates the already-approved commitment.
  ['settings removed on the wire', payload => { delete payload.settings; }, 'Execution admission rejected'],
  ['settings no longer canonical on the wire', payload => { delete payload.settings.thinking; }, 'Generation settings are not canonical'],
  // The provider has this adapter loaded, but the bound execution route names the base variant.
  ['the adapter altered on the wire', payload => { payload.adapterIdentities = [loadedAdapter]; }, 'Execution privacy binding rejected',
    { loadedAdapters: [loadedAdapter] }]
])('refuses %s before inference and without settlement', async (_label, alter, reason, options = {}) => {
  const execute = vi.fn();
  const f = await fixture({ execute, ...options, intercept: (type, payload) => { if (type === 'reploid:generation-request') alter(payload); } });
  try {
    const response = await f.post({ max_completion_tokens: 5 });
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain(reason);
    expect(execute).not.toHaveBeenCalled();
    expect(f.mesh.executions).toBe(0);
    expect(f.sent('reploid:receipt')).toEqual([]);
    // No provider was admitted, so the hold is released with no charge and no credit.
    await vi.waitFor(() => expect(amounts()).toEqual([{ balance: 0, held: 0 }, { balance: 0, held: 0 }]));
    expect(credits.snapshot().journal).toEqual([]);
    expect(f.row().outcome).toMatchObject({ charge: 0, outputTokens: 0, credits: [] });
  } finally { await f.close(); }
});

it('refuses a provider that admits with another digest, or with none, before inference', async () => {
  for (const alterAdmit of [payload => ({ ...payload, settingsDigest: otherDigest }), ({ settingsDigest: _dropped, ...payload }) => payload]) {
    const execute = vi.fn();
    const f = await fixture({ execute, alterAdmit });
    try {
      const response = await f.post({ max_completion_tokens: 5 });
      expect(response.status).toBe(502);
      expect((await response.json()).error.message).toContain('Generation settings differ from credit admission');
      expect(execute).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(amounts()).toEqual([{ balance: 0, held: 0 }, { balance: 0, held: 0 }]));
      expect(credits.snapshot().journal).toEqual([]);
    } finally { await f.close(); }
  }
});

/** A dispatched reservation made directly at the service, as the requester would make it. */
async function reserve(executionId, settingsDigest) {
  const binding = { id: `service:${keys[0].peerId}:${executionId}`, executionId, consumer: keys[0].peerId, mode: 'whole-model',
    model: { id: model.id, identity: model.identity, adapterIdentities: [] }, inputDigest: await hashJson(messages),
    ...(settingsDigest ? { settingsDigest } : {}), maxOutputTokens: 5, providers: [{ participantId: keys[1].peerId, weight: 1 }] };
  await requesterCredits.reserve(binding);
  await requesterCredits.dispatch(binding.id);
  return binding;
}
const admit = (binding, settingsDigest) => providerCredits.call('admit', { id: binding.id, executionId: binding.executionId, consumer: binding.consumer,
  mode: 'whole-model', model: binding.model, inputDigest: binding.inputDigest, outputLimit: 5, ...(settingsDigest ? { settingsDigest } : {}) });
const signedReceipt = async (binding, bound) => countersignReceipt(await signReceiptDraft(await createReceiptDraft({
  provider: keys[1].peerId, consumer: keys[0].peerId, jobHash: `request:${binding.executionId}`, model: model.id, inputTokens: 0, outputTokens: 0,
  ...await measureWholeModelReceipt(messages, answer('1 2 3 4', 4, 'eos-token'), bound) }), keys[1]), keys[0]);
const terminalBinding = (binding, settingsDigest) => ({ requestId: binding.executionId, provider: keys[1].peerId, consumer: keys[0].peerId, model: model.id,
  modelIdentity: model.identity, adapterIdentities: [], inputDigest: binding.inputDigest, ...(settingsDigest ? { settingsDigest } : {}) });

it('admits a provider only with the reserved digest: both absent, or equal', async () => {
  const digest = await effectiveRequestDigest({ modelIdentity: model.identity, adapterIdentities: [], messages, settings: { maxOutputTokens: 5 } });
  expect(() => credits.reserve({ id: 'x', executionId: 'x', consumer: keys[0].peerId, mode: 'whole-model', model: { id: model.id, identity: model.identity, adapterIdentities: [] },
    inputDigest: digest, settingsDigest: 'sha256:short', maxOutputTokens: 5, providers: [{ participantId: keys[1].peerId, weight: 1 }] })).toThrow('Invalid credit reservation');
  const bound = await reserve('bound-request', digest), legacy = await reserve('legacy-request');
  await expect(admit(bound, otherDigest)).rejects.toThrow('Generation settings differ from credit admission');
  await expect(admit(bound)).rejects.toThrow('Generation settings differ from credit admission');
  await expect(admit(legacy, digest)).rejects.toThrow('Generation settings differ from credit admission');
  // The model is part of the accepted terms too: a provider serving another artifact is not admitted.
  await expect(providerCredits.call('admit', { id: bound.id, executionId: bound.executionId, consumer: bound.consumer, mode: 'whole-model',
    model: { ...bound.model, identity: 'sha256:' + 'b'.repeat(64) }, inputDigest: bound.inputDigest, outputLimit: 5, settingsDigest: digest }))
    .rejects.toThrow('No matching live credit admission');
  await expect(admit(bound, digest)).resolves.toMatchObject({ admitted: true, maximum: 5 });
  await expect(admit(legacy)).resolves.toMatchObject({ admitted: true });
});

it('refuses a receipt or a terminal that carries another digest at settlement', async () => {
  const digest = await effectiveRequestDigest({ modelIdentity: model.identity, adapterIdentities: [], messages, settings: { maxOutputTokens: 5 } });
  const bound = await reserve('bound-request', digest), legacy = await reserve('legacy-request');
  await admit(bound, digest); await admit(legacy);
  const refused = 'Completed receipt does not match the accepted request';
  // Each of these is validly signed by the enrolled provider and countersigned by the requester.
  await expect(requesterCredits.settle(bound.id, await signedReceipt(bound, { settingsDigest: otherDigest }))).rejects.toThrow(refused);
  await expect(requesterCredits.settle(bound.id, await signedReceipt(bound))).rejects.toThrow(refused);
  await expect(requesterCredits.settle(legacy.id, await signedReceipt(legacy, { settingsDigest: digest }))).rejects.toThrow(refused);
  const cleanup = 'Terminal cleanup does not match the accepted request';
  await expect(providerCredits.collect(bound.id, { terminal: await signGenerationTerminal(terminalBinding(bound, otherDigest), 'failed', keys[1]) })).rejects.toThrow(cleanup);
  await expect(providerCredits.collect(bound.id, { terminal: await signGenerationTerminal(terminalBinding(bound), 'failed', keys[1]) })).rejects.toThrow(cleanup);
  await expect(providerCredits.collect(legacy.id, { terminal: await signGenerationTerminal(terminalBinding(legacy, digest), 'cancelled', keys[1]) })).rejects.toThrow(cleanup);
  expect(amounts()).toEqual([{ balance: 0, held: 10 }, { balance: 0, held: 0 }]);
  expect(credits.snapshot().journal).toEqual([]);

  // The matching evidence still settles: a receipt for the bound request, a terminal for the other.
  const receipt = await signedReceipt(bound, { settingsDigest: digest, constraintIdentity: otherDigest });
  expect(receipt).toMatchObject({ version: 3, settingsDigest: digest, constraintIdentity: otherDigest });
  // The reservation does not know the constraint identity, so settlement does not compare it.
  expect(await requesterCredits.settle(bound.id, receipt)).toMatchObject({ charge: 4, outputTokens: 4 });
  const terminal = await signGenerationTerminal(terminalBinding(legacy), 'cancelled', keys[1]);
  expect(terminal.schema).toBe('reploid.generation-terminal/v1');
  expect(await providerCredits.collect(legacy.id, { terminal })).toMatchObject({ status: 'cancelled', charge: 0 });
  expect(amounts()).toEqual([{ balance: -4, held: 0 }, { balance: 4, held: 0 }]);
});

it('settles signed cleanup for a failed request with settings only when it binds the same digest', async () => {
  const f = await fixture({ execute: async () => { throw Error('sampler failed'); } });
  try {
    const response = await f.post({ max_completion_tokens: 5 });
    expect(response.status).toBe(502);
    await vi.waitFor(() => expect(f.row().state).toBe('settled'));
    const row = f.row();
    expect(row.evidence).toMatchObject({ schema: 'reploid.generation-terminal/v2', status: 'failed', settingsDigest: row.binding.settingsDigest });
    expect(row.outcome).toMatchObject({ status: 'failed', charge: 0 });
    expect(amounts()).toEqual([{ balance: 0, held: 0 }, { balance: 0, held: 0 }]);
  } finally { await f.close(); }
});

it.each([
  ['no capability', null, 'Generation settings are not supported by this route'],
  ['a capability without the output limit', GENERATION_SETTINGS_CAPABILITY, 'Generation setting maxOutputTokens is not supported by this route']
])('refuses settings at the requester when the providers advertise %s, before any approval or disclosure', async (_label, capability, reason) => {
  const execute = vi.fn();
  const f = await fixture({ execute, capability });
  try {
    expect(f.wholeRequester.getModels()[0]).not.toHaveProperty('generationSettings', limitOnly);
    const response = await f.post({ max_completion_tokens: 5 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ message: reason, type: 'invalid_request_error' });
    // Neither execution authorization nor a disclosure preview was requested, and nothing left this computer.
    expect(f.allowsModel).not.toHaveBeenCalled();
    expect(f.authorizations.filter(input => input.action !== 'mesh.connect')).toEqual([]);
    expect(f.sent('reploid:generation-request')).toEqual([]);
    expect(f.reservations).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(amounts()).toEqual([{ balance: 0, held: 0 }, { balance: 0, held: 0 }]);
    // The same route still serves a request without settings.
    execute.mockImplementation(async (_messages, update) => { update('one'); return answer('one', 1, 'eos-token'); });
    expect((await f.post({})).status).toBe(200);
  } finally { await f.close(); }
});

it('refuses a caller limit above the prepared model ceiling before disclosure', async () => {
  const execute = vi.fn();
  const f = await fixture({ execute });
  try {
    const response = await f.post({ max_completion_tokens: 17 });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain('Caller output limit exceeds');
    expect(f.sent('reploid:generation-request')).toEqual([]);
    expect(f.reservations).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('refuses a provider result that exceeds the caller limit and does not settle it as completed', async () => {
  // A host that ignores the limit: the provider mesh refuses to sign it, and cleanup evidence settles with no charge.
  const f = await fixture({ execute: async (_messages, update) => { update('1 2 3 4 5 6'); return answer('1 2 3 4 5 6', 6, 'eos-token'); } });
  try {
    const response = await f.post({ max_completion_tokens: 5 });
    expect(response.status).toBe(502);
    expect(f.sent('reploid:receipt')).toEqual([]);
    await vi.waitFor(() => expect(f.row().state).toBe('settled'));
    expect(f.row().outcome).toMatchObject({ status: 'failed', charge: 0 });
    expect(credits.snapshot().journal.every(entry => entry.delta === 0)).toBe(true);
  } finally { await f.close(); }
});

/** What a dishonest provider delivers in place of its result: `response`, with a receipt it validly signs over it. */
const resign = async (payload, response, bound) => {
  payload.response = response;
  payload.receipt = await signReceiptDraft(await createReceiptDraft({ provider: keys[1].peerId, consumer: keys[0].peerId,
    jobHash: payload.receipt.jobHash, model: model.id, ...await measureWholeModelReceipt(messages, response, bound) }), keys[1]);
  return payload.receipt;
};

it('refuses a validly signed receipt from a provider that exceeded the caller limit, and does not settle it', async () => {
  // A provider that misbehaves: it returns six tokens for a limit of five and signs a well-formed
  // version 3 receipt for them over the reserved digest, instead of refusing its own result.
  let forged;
  const f = await fixture({ execute: async (_messages, update) => { update('1 2 3'); return answer('1 2 3', 3, 'eos-token'); },
    intercept: async (type, payload) => {
      if (type === 'reploid:generation-result') forged = await resign(payload, answer('1 2 3 4 5 6', 6, 'eos-token'), { settingsDigest: payload.receipt.settingsDigest });
    } });
  try {
    const response = await f.post({ max_completion_tokens: 5 });
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain('Receipt does not bind the generation settings of this request');
    expect(forged).toMatchObject({ version: 3, outputTokens: 6, settingsDigest: f.row().binding.settingsDigest });
    expect((await verifyReceipt(forged)).providerValid).toBe(true);
    // The requester never countersigned, so the provider holds nothing the ledger accepts as completion.
    expect(f.sent('reploid:receipt')).toEqual([]);
    expect(f.row().state).not.toBe('settled');
    expect(amounts()).toEqual([{ balance: 0, held: 5 }, { balance: 0, held: 0 }]);
    expect(credits.snapshot().journal).toEqual([]);
    await expect(providerCredits.settle(f.row().id, forged)).rejects.toThrow();
    expect(f.row().state).not.toBe('settled');
  } finally { await f.close(); }
});

it('signs the applied output constraint identity and settles when it is the one the requester expects', async () => {
  const constraintIdentity = 'sha256:' + 'c'.repeat(64);
  const expectedConstraintIdentity = vi.fn(() => constraintIdentity);
  const f = await fixture({ expectedConstraintIdentity,
    execute: async (_messages, update) => { update('1 2 3'); return answer('1 2 3', 3, 'eos-token', { constraintIdentity }); } });
  try {
    expect((await f.post({ max_completion_tokens: 5 })).status).toBe(200);
    expect(expectedConstraintIdentity).toHaveBeenCalledWith(normalizeGenerationSettings({ maxOutputTokens: 5 }));
    const receipt = f.sent('reploid:receipt')[0].receipt;
    expect(receipt).toMatchObject({ version: 3, constraintIdentity, settingsDigest: f.row().binding.settingsDigest });
    expect(await verifyReceipt(receipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
    expect((await verifyReceipt({ ...receipt, constraintIdentity: otherDigest })).valid).toBe(false);
    expect(f.row().state).toBe('settled');
    expect(amounts()).toEqual([{ balance: -3, held: 0 }, { balance: 3, held: 0 }]);
  } finally { await f.close(); }
});

it.each([
  ['names another constraint identity than expected', { constraintIdentity: otherDigest }],
  ['names no constraint identity although one is expected', {}]
])('refuses a result whose receipt %s, and does not settle it', async (_label, reported) => {
  const f = await fixture({ expectedConstraintIdentity: () => 'sha256:' + 'c'.repeat(64),
    execute: async (_messages, update) => { update('1 2 3'); return answer('1 2 3', 3, 'eos-token', reported); } });
  try {
    const response = await f.post({ max_completion_tokens: 5 });
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toContain('Receipt does not bind the generation settings of this request');
    // The requester never countersigned, so there is nothing the ledger would accept as completion.
    expect(f.sent('reploid:generation-result')).toHaveLength(1);
    expect(f.sent('reploid:receipt')).toEqual([]);
    expect(f.row().state).not.toBe('settled');
    expect(amounts()).toEqual([{ balance: 0, held: 5 }, { balance: 0, held: 0 }]);
    expect(credits.snapshot().journal).toEqual([]);
    const unsigned = f.sent('reploid:generation-result')[0].receipt;
    await expect(providerCredits.settle(f.row().id, unsigned)).rejects.toThrow();
    expect(f.row().state).not.toBe('settled');
  } finally { await f.close(); }
});

it('refuses a receipt that names a constraint identity or a settings digest for a request without settings', async () => {
  for (const stray of [{ constraintIdentity: otherDigest }, { settingsDigest: otherDigest }]) {
    const f = await fixture({ execute: async (_messages, update) => { update('one'); return answer('one', 1, 'eos-token'); },
      intercept: (type, payload) => { if (type === 'reploid:generation-result') Object.assign(payload.receipt, stray); } });
    try {
      const response = await f.post({});
      expect(response.status).toBe(502);
      expect(f.sent('reploid:receipt')).toEqual([]);
      expect(credits.snapshot().journal).toEqual([]);
    } finally { await f.close(); }
  }
});

it('refuses a validly signed receipt that names a settings digest or a constraint identity for a request without settings', async () => {
  // Only version 3 can sign either claim. The receipt verifies; it is refused as not binding this request.
  for (const bound of [{ settingsDigest: otherDigest }, { settingsDigest: otherDigest, constraintIdentity: 'sha256:' + 'c'.repeat(64) }]) {
    let forged;
    const f = await fixture({ execute: async (_messages, update) => { update('one'); return answer('one', 1, 'eos-token'); },
      intercept: async (type, payload) => { if (type === 'reploid:generation-result') forged = await resign(payload, payload.response, bound); } });
    try {
      const response = await f.post({});
      expect(response.status).toBe(502);
      expect((await response.json()).error.message).toContain('Receipt does not bind the generation settings of this request');
      expect((await verifyReceipt(forged)).providerValid).toBe(true);
      expect(f.sent('reploid:receipt')).toEqual([]);
      expect(credits.snapshot().journal).toEqual([]);
    } finally { await f.close(); }
  }
});

it('recovers a completed request only for the same effective request, and settles it once', async () => {
  const f = await fixture({ execute: async (_messages, update) => { update('1 2 3'); return answer('1 2 3', 3, 'eos-token'); } });
  try {
    f.mesh.drop();
    const controller = new AbortController();
    const pending = fetch(`${f.api.url}/chat/completions`, { method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: model.id, messages, max_completion_tokens: 5 }) });
    pending.catch(() => {});
    await vi.waitFor(() => expect(f.sent('reploid:generation-result')).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(f.row()?.state).toBe('closing'));
    expect(amounts()).toEqual([{ balance: 0, held: 5 }, { balance: 0, held: 0 }]);
    const reservationId = f.row().id, settings = { maxOutputTokens: 5 };
    await f.mesh.restartProvider();
    const providerId = f.mesh.reference.providerId;

    // Recovery reads an outcome only for the accepted messages and settings.
    const other = await f.recover({ reservationId, messages, providerId, settings: { maxOutputTokens: 4 } });
    expect(other.status).toBe(409);
    expect((await other.json()).error.message).toBe('Recovery settings differ from the accepted request');
    expect((await f.recover({ reservationId, messages, providerId })).status).toBe(409);
    expect((await f.recover({ reservationId, messages, providerId, settings: { temperature: 1 } })).status).toBe(400);
    expect(amounts()).toEqual([{ balance: 0, held: 5 }, { balance: 0, held: 0 }]);

    const recovered = await f.recover({ reservationId, messages, providerId, settings });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: 'completed', content: '1 2 3',
      serviceCredit: { id: reservationId, charge: 3, outputTokens: 3 },
      execution: { receipt: { version: 3, settingsDigest: f.row().binding.settingsDigest } } });
    expect(f.mesh.executions).toBe(1);
    expect(amounts()).toEqual([{ balance: -3, held: 0 }, { balance: 3, held: 0 }]);
    expect(credits.snapshot().journal).toHaveLength(2);
  } finally { await f.close(); }
});
