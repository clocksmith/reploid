// @vitest-environment node
// Generation settings between two meshes joined in memory, without credit admission: what the
// mesh itself advertises, refuses, signs and recovers. Provider execution is a function.
import { afterEach, expect, it, vi } from 'vitest';
import { GENERATION_SETTINGS_CAPABILITY, effectiveRequestDigest, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { verifyGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const modelIdentity = 'sha256:' + 'a'.repeat(64);
const limitOnly = { ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true };
const settings = normalizeGenerationSettings({ maxOutputTokens: 4 });
const provider = capability => index => index && capability ? { getGenerationSettingsCapability: () => capability } : {};
const fixture = (options = {}) => createRecoveryMesh(cleanup, { ports: provider(limitOnly), ...options });
const sent = (f, type) => f.wire.filter(item => item.type === type).map(item => item.payload);

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
  expect((await unmeasured.requesterMesh.generate(unmeasured.messages, null, { modelId: 'model', modelIdentity })).executionReceipt.version).toBe(1);
  const stripped = await fixture({ intercept: (type, payload) => { if (type === 'reploid:generation-result') delete payload.receipt; } });
  await expect(stripped.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow('Remote execution receipt is missing');
  const downgraded = await fixture({ intercept: (type, payload) => { if (type === 'reploid:generation-result') { payload.receipt.version = 2; delete payload.receipt.settingsDigest; } } });
  await expect(downgraded.run(undefined, { maxOutputTokens: 4 })).rejects.toThrow('does not bind');
});

it('binds the digest into replay admission, signed cleanup and recovery', async () => {
  const f = await fixture(); f.drop(); const controller = new AbortController();
  const running = f.run(controller.signal, { maxOutputTokens: 4 }); const rejected = expect(running).rejects.toThrow('disconnected');
  await vi.waitFor(() => expect(f.wire.some(item => item.type === 'reploid:generation-result')).toBe(true));
  controller.abort(Error('disconnected')); await rejected;
  // The same request id with other settings, or none, is a different binding and is not executed.
  await f.replay({ settings: normalizeGenerationSettings({ maxOutputTokens: 3 }) });
  await f.replay({}, ['settings']);
  expect(sent(f, 'reploid:generation-error').map(payload => payload.error)).toEqual(['Generation replay binding changed', 'Generation replay binding changed']);
  expect(f.executions).toBe(1);
  await f.restartProvider();
  await expect(f.recover()).rejects.toThrow('Unverified recovered completion');
  await expect(f.recover({ maxOutputTokens: 3 })).rejects.toThrow('Unverified recovered completion');
  const recovered = await f.recover({ maxOutputTokens: 4 });
  expect(recovered).toMatchObject({ status: 'completed', response: { content: 'actual answer', executionReceipt: { version: 3, outputTokens: 3 } } });
  expect(f.executions).toBe(1);

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
