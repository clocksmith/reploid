// @vitest-environment node
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
// Generation settings between two meshes joined in memory, without credit admission: what the
// mesh itself advertises, refuses, signs and recovers. Provider execution is a function.
import { afterEach, expect, it, vi } from 'vitest';
import { GENERATION_SETTINGS_CAPABILITY, effectiveRequestDigest, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { createReceiptDraft, signReceiptDraft, verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { verifyGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const modelIdentity = 'sha256:' + 'a'.repeat(64);
const limitOnly = { ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true };
const settings = normalizeGenerationSettings({ maxOutputTokens: 4 });
const provider = capability => index => index && capability ? { getGenerationSettingsCapability: () => capability } : {};
const fixture = (options = {}) => createRecoveryMesh(cleanup, { ports: provider(limitOnly), ...options });
const sent = (f, type) => f.wire.filter(item => item.type === type).map(item => item.payload);
const otherDigest = 'sha256:' + 'e'.repeat(64), constraint = 'sha256:' + 'c'.repeat(64);
const unbound = 'Receipt does not bind the generation settings of this request';
const longer = (response, tokens) => ({ ...response, content: 'one two three four five six', completion: { ...response.completion, generatedTokenCount: tokens } });

// A dishonest provider signs whatever receipt it likes with its own enrolled key. Such a receipt
// verifies, so only the requester's binding checks stand between it and a countersignature.
const forge = async (f, payload, { bound, response = payload.response } = {}) => {
  payload.response = response;
  payload.receipt = await signReceiptDraft(await createReceiptDraft({ provider: f.identities[1].peerId, consumer: f.identities[0].peerId,
    jobHash: payload.receipt.jobHash, model: response.model, ...await measureWholeModelReceipt(f.messages, response, bound) }), f.identities[1]);
  expect((await verifyReceipt(payload.receipt)).providerValid).toBe(true);
};
/** A fixture whose provider result is replaced in transit by `alter(f, payload)`; `options.type` picks another message. */
const forging = async (alter, { type = 'reploid:generation-result', ...options } = {}) => {
  let f;
  f = await fixture({ ...options, intercept: (kind, payload) => kind === type ? alter(f, payload) : undefined });
  return f;
};

it('advertises the capability only from a host that declares it, and copies only a well-formed one', async () => {
  const f = await fixture();
  expect(f.requesterMesh.getSwarmSnapshot().peers[0].generationSettings).toEqual(limitOnly);
  // The requester has no model and so no generate port to speak for: it advertises nothing.
  expect(sent(f, 'reploid:peer-advertisement').filter(payload => payload.generationSettings).every(payload => payload.readiness !== 'idle')).toBe(true);
  const plain = await createRecoveryMesh(cleanup);
  expect(sent(plain, 'reploid:peer-advertisement').some(payload => 'generationSettings' in payload)).toBe(false);
  expect(plain.requesterMesh.getSwarmSnapshot().peers[0]).not.toHaveProperty('generationSettings');
  const malformed = await createRecoveryMesh(cleanup, { ports: provider({ maxOutputTokens: true }) });
  expect(malformed.requesterMesh.getSwarmSnapshot().peers[0]).not.toHaveProperty('generationSettings');
});

it('signs the effective-request digest into a version 3 receipt and hands the settings to the host', async () => {
  const controls = [];
  const f = await fixture({ execute: async (_messages, _update, received) => { controls.push(received.settings); return f.response; } });
  const result = await f.run(undefined, { maxOutputTokens: 4 });
  const digest = await effectiveRequestDigest({ modelIdentity, adapterIdentities: [], messages: f.messages, settings });
  expect(controls).toEqual([settings]);
  expect(Object.isFrozen(controls[0])).toBe(true);
  expect(sent(f, 'reploid:generation-request')[0].settings).toEqual(settings);
  expect(result.executionReceipt).toMatchObject({ version: 3, settingsDigest: digest, outputTokens: 3 });
  expect(await verifyReceipt(result.executionReceipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
  expect(f.errors).toEqual([]);
});

it('refuses settings before disclosure when the chosen provider does not advertise them', async () => {
  const authorize = vi.fn(async () => true);
  const f = await createRecoveryMesh(cleanup, { authorize });
  await expect(f.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow('Generation settings are not supported by this route');
  const partial = await fixture({ authorize });
  await expect(partial.run(undefined, { thinking: 'on' })).rejects.toThrow('Generation setting thinking is not supported by this route');
  await expect(partial.run(undefined, { temperature: 1 })).rejects.toThrow('unknown key temperature');
  expect(authorize.mock.calls.filter(([input]) => input.action !== 'mesh.connect')).toEqual([]);
  expect([...sent(f, 'reploid:generation-request'), ...sent(partial, 'reploid:generation-request')]).toEqual([]);
  expect(f.executions + partial.executions).toBe(0);
});

it('refuses, as a provider, settings it does not enforce or that are not canonical, before authorization', async () => {
  const authorize = vi.fn(async () => true);
  const f = await fixture({ authorize });
  await f.run();
  const before = authorize.mock.calls.length;
  for (const [requestId, changes] of [['unsupported', { settings: normalizeGenerationSettings({ thinking: 'on' }) }],
    ['partial', { settings: { maxOutputTokens: 4 } }], ['null', { settings: null }]]) {
    await f.replay({ requestId, recoverable: false, ...changes });
    expect(sent(f, 'reploid:generation-error').find(payload => payload.requestId === requestId).error).toContain('Generation settings rejected');
  }
  expect(authorize.mock.calls.length).toBe(before);
  expect(f.executions).toBe(1);
});

it('refuses a settings request whose provider returns no measured completion or no receipt', async () => {
  const unmeasured = await fixture({ execute: async () => ({ model: 'model', modelIdentity, adapterIdentities: [], content: 'answer' }) });
  await expect(unmeasured.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow('Generation settings require a measured completion');
  // The same unmeasured host still serves a request without settings, as an unmetered version 1 receipt.
  expect((await unmeasured.requesterMesh.generate(unmeasured.messages, null, { modelId: 'model', modelIdentity, privacy })).executionReceipt.version).toBe(1);
  const stripped = await fixture({ intercept: (type, payload) => { if (type === 'reploid:generation-result') delete payload.receipt; } });
  await expect(stripped.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow('Remote execution receipt is missing');
  // A provider that signs a well-formed version 2 receipt for the request, as if it had carried no settings.
  const downgraded = await forging((f, payload) => forge(f, payload));
  await expect(downgraded.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow(unbound);
  expect(sent(downgraded, 'reploid:generation-result')[0].receipt.version).toBe(3);
  expect(sent(downgraded, 'reploid:receipt')).toEqual([]);
  // The same, with a version 3 receipt signed over another effective request.
  const rebound = await forging((f, payload) => forge(f, payload, { bound: { settingsDigest: otherDigest } }));
  await expect(rebound.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow(unbound);
  expect(sent(rebound, 'reploid:receipt')).toEqual([]);
});

it('refuses a validly signed version 3 receipt that reports more output than the caller limit', async () => {
  const sign = tokens => (f, payload) => forge(f, payload, { bound: { settingsDigest: payload.receipt.settingsDigest }, response: longer(payload.response, tokens) });
  // The same re-signed receipt at the limit is accepted: only the reported count separates the two.
  const within = await forging(sign(4));
  expect((await within.run(undefined, { maxOutputTokens: 4 })).executionReceipt).toMatchObject({ version: 3, outputTokens: 4 });
  const over = await forging(sign(6));
  await expect(over.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow(unbound);
  expect(sent(over, 'reploid:receipt')).toEqual([]);
  expect(over.errors).toEqual([]);
});

it('refuses, for a request without settings, a validly signed receipt that names a settings digest or a constraint', async () => {
  // Version 3 is the only version that can sign either field, so both forgeries are version 3.
  for (const bound of [{ settingsDigest: otherDigest }, { settingsDigest: otherDigest, constraintIdentity: constraint }]) {
    const f = await forging((fixture, payload) => forge(fixture, payload, { bound }));
    await expect(f.run()).rejects.toThrow(unbound);
    expect(sent(f, 'reploid:receipt')).toEqual([]);
  }
  // An unmetered version 1 receipt signs neither field, so one added in transit leaves the signature valid.
  for (const stray of [{ settingsDigest: otherDigest }, { constraintIdentity: constraint }]) {
    const f = await forging((_fixture, payload) => { Object.assign(payload.receipt, stray); },
      { execute: async () => ({ model: 'model', modelIdentity, adapterIdentities: [], content: 'answer' }) });
    await expect(f.run()).rejects.toThrow(unbound);
    expect(sent(f, 'reploid:generation-result')[0].receipt.version).toBe(1);
    expect(sent(f, 'reploid:receipt')).toEqual([]);
  }
});

it('refuses a response whose constraint identity is not the one its receipt signs', async () => {
  // Added in transit: the receipt signs no constraint, and this requester states no expectation.
  const added = await forging((_fixture, payload) => { payload.response.constraintIdentity = constraint; });
  await expect(added.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow(unbound);
  expect(sent(added, 'reploid:receipt')).toEqual([]);
  // Removed in transit: the provider's host reported one and its receipt signs it.
  const removed = await forging((_fixture, payload) => { delete payload.response.constraintIdentity; },
    { execute: async () => ({ model: 'model', modelIdentity, adapterIdentities: [], content: 'actual answer', constraintIdentity: constraint,
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } }) });
  await expect(removed.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow(unbound);
  expect(sent(removed, 'reploid:generation-result')[0].receipt.constraintIdentity).toBe(constraint);
  expect(sent(removed, 'reploid:receipt')).toEqual([]);
});

it('countersigns only what the provider signed: unsigned fields on its receipt object are dropped', async () => {
  const f = await forging((_fixture, payload) => { payload.receipt.maxOutputTokens = 9999; payload.receipt.note = 'unsigned'; });
  const receipt = (await f.run(undefined, { maxOutputTokens: 4 })).executionReceipt;
  for (const kept of [receipt, sent(f, 'reploid:receipt')[0].receipt]) {
    expect(kept).not.toHaveProperty('maxOutputTokens');
    expect(kept).not.toHaveProperty('note');
    expect(await verifyReceipt(kept)).toEqual({ valid: true, providerValid: true, consumerValid: true });
  }
});

it('refuses to send when the chosen provider withdraws the capability while the host authorizes', async () => {
  let capability = limitOnly, f;
  f = await createRecoveryMesh(cleanup, { ports: index => index ? { getGenerationSettingsCapability: () => capability } : {},
    authorize: async input => {
      if (input.action !== 'mesh.dispatch') return true;
      capability = null; f.readvertise();
      await vi.waitFor(() => expect(f.requesterMesh.getSwarmSnapshot().peers[0]).not.toHaveProperty('generationSettings'));
      return true;
    } });
  await expect(f.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow('Selected contributor is no longer ready; retry requires new placement');
  expect(sent(f, 'reploid:generation-request')).toEqual([]);
  expect(f.executions).toBe(0);
});

it('binds the digest into replay admission, signed cleanup and recovery', async () => {
  const f = await fixture(); f.drop(); const controller = new AbortController();
  const running = f.run(controller.signal, { maxOutputTokens: 4 }); const rejected = expect(running).rejects.toThrow('disconnected');
  await vi.waitFor(() => expect(f.wire.some(item => item.type === 'reploid:generation-result')).toBe(true));
  controller.abort(Error('disconnected')); await rejected;
  // The same request id with other settings, or none, is a different binding and is not executed.
  // Without delivery fields the replay reaches the binding checks; with them it is a repeat of a request
  // already received and is dropped before them. Neither runs again.
  await f.replay({ settings: normalizeGenerationSettings({ maxOutputTokens: 3 }) }, ['delivery']);
  await f.replay({}, ['settings', 'delivery']);
  expect(sent(f, 'reploid:generation-error').map(payload => payload.error)).toEqual(['Execution admission rejected', 'Execution admission rejected']);
  await f.replay({ settings: normalizeGenerationSettings({ maxOutputTokens: 3 }) });
  expect(f.executions).toBe(1);
  await f.restartProvider();
  await expect(f.recover()).rejects.toThrow('Unverified recovered completion');
  await expect(f.recover({ maxOutputTokens: 3 })).rejects.toThrow('Unverified recovered completion');
  const recovered = await f.recover({ maxOutputTokens: 4 });
  expect(recovered).toMatchObject({ status: 'completed', response: { content: 'actual answer', executionReceipt: { version: 3, outputTokens: 3 } } });
  expect(f.executions).toBe(1);

  // A provider that answers recovery with a validly signed receipt over the caller limit, or with a
  // version 2 receipt, is refused before anything is countersigned; its honest answer is then accepted.
  let answer = null;
  const dishonest = await forging((fixture, payload) => answer?.(fixture, payload.outcome?.payload), { type: 'reploid:generation-recovery' });
  dishonest.drop(); const lost = new AbortController();
  const dropped = expect(dishonest.run(lost.signal, { maxOutputTokens: 4 })).rejects.toThrow('disconnected');
  await vi.waitFor(() => expect(dishonest.wire.some(item => item.type === 'reploid:generation-result')).toBe(true));
  lost.abort(Error('disconnected')); await dropped;
  answer = (fixture, result) => result?.receipt && forge(fixture, result, { bound: { settingsDigest: result.receipt.settingsDigest }, response: longer(result.response, 6) });
  await expect(dishonest.recover({ maxOutputTokens: 4 })).rejects.toThrow('Unverified recovered completion');
  answer = (fixture, result) => result?.receipt && forge(fixture, result);
  await expect(dishonest.recover({ maxOutputTokens: 4 })).rejects.toThrow('Unverified recovered completion');
  expect(sent(dishonest, 'reploid:receipt')).toEqual([]);
  answer = null;
  expect(await dishonest.recover({ maxOutputTokens: 4 })).toMatchObject({ status: 'completed', response: { executionReceipt: { version: 3, outputTokens: 3 } } });
  expect(dishonest.errors).toEqual([]);

  const failing = await fixture({ execute: async () => { throw Error('sampler failed'); } });
  const failure = await failing.run(undefined, { maxOutputTokens: 4 }).catch(error => error);
  const digest = await effectiveRequestDigest({ modelIdentity, adapterIdentities: [], messages: failing.messages, settings });
  expect(failure.generationTerminal).toMatchObject({ schema: 'reploid.generation-terminal/v2', status: 'failed', settingsDigest: digest });
  const binding = { requestId: failure.generationTerminal.requestId, provider: failing.identities[1].peerId, consumer: failing.identities[0].peerId,
    model: 'model', modelIdentity, adapterIdentities: [], inputDigest: await hashJson(failing.messages) };
  expect(await verifyGenerationTerminal(failure.generationTerminal, { ...binding, settingsDigest: digest })).toBe(true);
  expect(await verifyGenerationTerminal(failure.generationTerminal, binding)).toBe(false);
  expect(await verifyGenerationTerminal(failure.generationTerminal, { ...binding, settingsDigest: 'sha256:' + 'e'.repeat(64) })).toBe(false);
  // The digest and the schema are signed: neither can be removed to pass as cleanup for a request without settings.
  const { settingsDigest: _removed, ...relabelled } = { ...failure.generationTerminal, schema: 'reploid.generation-terminal/v1' };
  expect(await verifyGenerationTerminal(relabelled, binding)).toBe(false);
  // A request without settings still signs the unchanged v1 terminal.
  const legacy = await failing.run().catch(error => error);
  expect(legacy.generationTerminal.schema).toBe('reploid.generation-terminal/v1');
  expect(legacy.generationTerminal).not.toHaveProperty('settingsDigest');
});

/** One requester (index 0) and one provider per listed capability, all serving the same model. */
async function placement(capabilities) {
  const count = capabilities.length + 1;
  const identities = await Promise.all(Array.from({ length: count }, () => createSigningIdentity({ algorithm: 'Ed25519' })));
  const handlers = Array.from({ length: count }, () => new Map()), requests = [], disclosures = [];
  const send = (from, to, type, payload) => {
    payload = structuredClone(payload);
    if (type === 'reploid:generation-request') requests.push(to);
    queueMicrotask(() => Promise.resolve(handlers[to].get(type)?.('connection-' + from, payload)).catch(() => {}));
    return true;
  };
  const meshes = identities.map((identity, i) => {
    const listeners = new Map(), events = {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name).delete(fn); },
      emit(name, value) { for (const fn of listeners.get(name) || []) fn(value); }
    };
    return createPeerGenerationMesh({ config: resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId: 'settings-placement', generationTimeoutMs: 300 } } }), ports: {
      instanceId: 'instance-' + i, modelConfig: i ? { id: 'model' } : null, admitsBeforeDisclosure: true,
      getExecutionState: () => ({ phase: i ? 'ready' : 'idle', modelIdentity, adapterIdentities: [] }),
      ...(i && capabilities[i - 1] ? { getGenerationSettingsCapability: () => capabilities[i - 1] } : {}),
      authorize: async input => { if (input.action === 'mesh.dispatch') disclosures.push(input); return true; },
      events, eventBus: events, utils: { generateId: () => crypto.randomUUID() },
      identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} },
      generate: async () => ({ model: 'model', modelIdentity, adapterIdentities: [], content: 'answer from ' + i,
        completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 1, generatedTokenCount: 1, stopReason: 'eos-token' } }),
      createTransport: () => ({ init: async () => true, disconnect() {}, getPeerId: () => 'connection-' + i,
        getPeerBinding: peer => ({ local: 'certificate-' + i, remote: 'certificate-' + String(peer).split('-')[1] }),
        onMessage: (type, fn) => handlers[i].set(type, fn),
        broadcast: (type, payload) => { for (let to = 0; to < count; to++) if (to !== i) send(i, to, type, payload); return true; },
        sendToPeer: (peer, type, payload) => send(i, Number(String(peer).split('-')[1]), type, payload) })
    } });
  });
  cleanup.push(() => Promise.all(meshes.map(mesh => mesh.close())));
  for (const mesh of meshes) await mesh.connect();
  for (const mesh of meshes.slice(1)) mesh.refreshAdvertisement();
  await vi.waitFor(() => expect(meshes[0].getSwarmSnapshot().peers.filter(peer => peer.readiness === 'ready')).toHaveLength(capabilities.length));
  const ask = requested => meshes[0].generate([{ role: 'user', content: 'prompt' }], null, { modelId: 'model', modelIdentity, privacy, ...(requested ? { settings: requested } : {}) });
  return { ask, requests, disclosures };
}

it('sends a request with settings to a provider that advertises them, and one without settings in the unchanged order', async () => {
  // The default order is by connection id, so the provider without the capability comes first.
  const f = await placement([null, limitOnly]);
  expect((await f.ask()).content).toBe('answer from 1');
  const bound = await f.ask({ maxOutputTokens: 4 });
  expect(bound).toMatchObject({ content: 'answer from 2', executionReceipt: { version: 3 } });
  expect((await f.ask()).content).toBe('answer from 1');
  expect(f.requests).toEqual([1, 2, 1]);
  // The host is told which providers were eligible: for the settings request, only the one that enforces them.
  expect(f.disclosures.map(input => input.placement.candidates.map(candidate => candidate.peerId)))
    .toEqual([['connection-1', 'connection-2'], ['connection-2'], ['connection-1', 'connection-2']]);
});

it('refuses a request with settings before any disclosure when no single provider advertises them', async () => {
  const thinkingOnly = { ...GENERATION_SETTINGS_CAPABILITY, thinking: true };
  const none = await placement([null, GENERATION_SETTINGS_CAPABILITY]);
  await expect(none.ask({ maxOutputTokens: 4 })).rejects.toThrow('Generation settings are not supported by this route');
  // Each setting is advertised by some provider, but no provider enforces both.
  const split = await placement([limitOnly, thinkingOnly]);
  await expect(split.ask({ maxOutputTokens: 4, thinking: 'on' })).rejects.toThrow('Generation setting thinking is not supported by this route');
  expect((await split.ask({ thinking: 'on' })).content).toBe('answer from 2');
  for (const f of [none, split]) expect((await f.ask()).content).toBe('answer from 1');
  expect(none.requests).toEqual([1]);
  expect(split.requests).toEqual([2, 1]);
  const disclosed = f => f.disclosures.map(input => [input.peerId, input.settings?.thinking ?? null]);
  expect(disclosed(none)).toEqual([['connection-1', null]]);
  expect(disclosed(split)).toEqual([['connection-2', 'on'], ['connection-1', null]]);
});

// The early input count: a provider host that knows its prompt token count before its first text
// reports it, and one update carries it to a requester that asked. No request key is involved.
const ask = (f, controls = {}, onUpdate = null) => f.requesterMesh.generate(f.messages, onUpdate, { modelId: 'model', modelIdentity, privacy, ...controls });
const mismatch = 'Provider input token count differs from its early observation';

it('sends one early input count ahead of the text, drops any other report, and adds no key to the request', async () => {
  const f = await fixture({ execute: async (_messages, update, controls) => {
    for (const report of [undefined, {}, { inputTokens: 0 }, { inputTokens: -7 }, { inputTokens: 7.5 }, { inputTokens: '7' }]) controls.onUsage(report);
    controls.onUsage({ inputTokens: 7 });
    controls.onUsage({ inputTokens: 8 });
    update('actual ');
    controls.onUsage({ inputTokens: 9 });
    update('answer');
    return f.response;
  } });
  // A caller that takes no observation gets its text and result as before; the update it does not read changes nothing.
  const plain = [];
  expect((await ask(f, {}, chunk => plain.push(chunk))).executionReceipt).toMatchObject({ version: 2, inputTokens: 7 });
  expect(plain).toEqual(['actual ', 'answer']);
  const seen = [];
  const result = await ask(f, { onUsage: usage => seen.push(usage) }, chunk => seen.push(chunk));
  expect(seen).toEqual([{ inputTokens: 7 }, 'actual ', 'answer']);
  expect(result.executionReceipt).toMatchObject({ version: 2, inputTokens: 7 });
  expect(await verifyReceipt(result.executionReceipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
  const [first, second] = sent(f, 'reploid:generation-request');
  expect(sent(f, 'reploid:generation-update').filter(update => update.requestId === second.requestId)).toEqual([
    { requestId: second.requestId, usage: { inputTokens: 7 } }, { requestId: second.requestId, chunk: 'actual ' }, { requestId: second.requestId, chunk: 'answer' }]);
  expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
  expect(Object.keys(second).sort()).toEqual(['adapterIdentities', 'admission', 'admissionProtocol', 'consumer', 'delivery', 'messages', 'model', 'modelContract', 'modelIdentity', 'offerId', 'privacy', 'privacyBinding', 'provider', 'requestId']);
  expect(f.errors).toEqual([]);
});

it('sends no early input count once text has been sent, or from a host that reports none', async () => {
  const late = await fixture({ execute: async (_messages, update, controls) => { update('actual answer'); controls.onUsage({ inputTokens: 7 }); return late.response; } });
  const told = [];
  await ask(late, { onUsage: usage => told.push(usage) });
  const silent = await fixture();
  await ask(silent, { onUsage: usage => told.push(usage) });
  expect(told).toEqual([]);
  for (const f of [late, silent]) expect(sent(f, 'reploid:generation-update').some(update => 'usage' in update)).toBe(false);
});

it('refuses, before countersigning, a completion or receipt whose input count differs from the early observation', async () => {
  // The completion and the receipt sign 7; the host reported 8 before it generated.
  const f = await fixture({ execute: async (_messages, _update, controls) => { controls.onUsage({ inputTokens: 8 }); return f.response; } });
  const told = [];
  await expect(ask(f, { onUsage: usage => told.push(usage) })).rejects.toThrow(mismatch);
  expect(told).toEqual([{ inputTokens: 8 }]);
  expect(sent(f, 'reploid:generation-result')[0].receipt).toMatchObject({ version: 2, inputTokens: 7 });
  expect(sent(f, 'reploid:receipt')).toEqual([]);
  // A caller that was told nothing has nothing to bind: the same provider is accepted as before.
  expect((await ask(f)).executionReceipt.inputTokens).toBe(7);
  expect(sent(f, 'reploid:receipt')).toHaveLength(1);

  // A response edited to agree with the early count does not help: the signed receipt still reports another.
  const edited = await forging((_f, payload) => { payload.response.completion.promptTokenCount = 8; },
    { execute: async (_messages, _update, controls) => { controls.onUsage({ inputTokens: 8 }); return edited.response; } });
  await expect(ask(edited, { onUsage() {} })).rejects.toThrow(mismatch);
  expect(sent(edited, 'reploid:receipt')).toEqual([]);
});
