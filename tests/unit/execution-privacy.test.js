import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { describe, it, expect, vi } from 'vitest';
import { createExecutionPolicy, requestExecutionPolicy, assertAvailableExecutionPolicy, plaintextExecutionRoute,
  validateExecutionRoute, bindExecutionRoute, executionPrivacyReceipt } from '../../packages/reploid/src/chat/execution-policy.js';
import { eligibleExecutionOffers } from '../../packages/reploid/src/chat/execution-offers.js';
import { remotePermissionNeed, createRemotePermission, remotePermissionCovers } from '../../packages/reploid/src/chat/remote-permission.js';

const hash = c => 'sha256:' + c.repeat(64);
const model = { id: 'tiny', name: 'Tiny', identity: hash('a') };
const request = privacy => ({ model, privacy });
const offer = (id, kind = 'plaintext') => ({ schema: 'reploid.execution-offer/v1', id, kind,
  backend: kind === 'plaintext' ? 'doppler-plaintext/v1' : kind + '/v1', modelIdentities: [model.identity],
  operation: 'generate', protocol: kind === 'cryptographic' ? 'unreviewed/v1' : null, evidence: null });

describe('request privacy at the disclosure boundary', () => {
  it('rejects absent and obsolete request policy without inferring approval from placement', () => {
    for (const request of [{}, { permissions: { sharingScope: 'mesh' } }, { privacy: { schema: 'reploid.execution-policy/v1', profile: 'restricted' } }]) {
      expect(() => requestExecutionPolicy(request)).toThrow('current layered policy required');
    }
    expect(createExecutionPolicy().placement).toBe('local-only');
    expect(() => createExecutionPolicy({ allowDowngrade: true })).toThrow('downgrade');
    for (const ids of [[], [''], [' peer:a '], ['same', 'same'], ['one\ntwo']]) {
      expect(() => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids } })).toThrow('invalid recipient authorization');
    }
    const none = createExecutionPolicy({ placement: 'network-allowed' });
    expect(() => validateExecutionRoute(none, plaintextExecutionRoute(request(none), { recipients: ['entry'] }))).toThrow('unauthorized');
  });
  it('checks every coordinator and stage independently of profile names', () => {
    const policy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['entry', 'last'] } });
    expect(() => validateExecutionRoute(policy, plaintextExecutionRoute(request(policy), { recipients: ['entry', 'middle', 'last'] }))).toThrow('unauthorized');
    expect(validateExecutionRoute(policy, plaintextExecutionRoute(request(policy), { recipients: ['entry', 'last'] })).hops).toHaveLength(2);
    const combined = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['entry'] } });
    expect(() => validateExecutionRoute(combined, plaintextExecutionRoute(request(combined), { recipients: ['last'] }))).toThrow('unauthorized');
  });
  it('refuses cryptographic, attested and unsupported leakage before dispatch', () => {
    const crypto = createExecutionPolicy({ computation: 'cryptographic', protocol: 'fhe/v1', keyContext: 'client-key' });
    expect(() => assertAvailableExecutionPolicy(crypto)).toThrow('unavailable');
    expect(() => assertAvailableExecutionPolicy(createExecutionPolicy({ attestation: hash('b') }))).toThrow('unavailable');
    const narrow = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, leakage: ['model-id', 'timing', 'length'] });
    expect(() => validateExecutionRoute(narrow, plaintextExecutionRoute(request(narrow), { recipients: ['entry'] }))).toThrow('leakage');
    const local = createExecutionPolicy();
    expect(() => validateExecutionRoute(local, plaintextExecutionRoute(request(local), { recipients: ['entry'] }))).toThrow('local-only');
    expect(validateExecutionRoute(local, plaintextExecutionRoute(request(local), { local: true })).hops).toEqual([]);
  });
  it('filters any provider offer combination per exact model without promoting flags', () => {
    const plain = offer('plain'), attested = offer('tee', 'attested'), encrypted = offer('fhe', 'cryptographic');
    const policy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
    for (const offers of [[], [plain], [attested], [encrypted], [plain, attested], [plain, encrypted], [attested, encrypted], [plain, attested, encrypted]]) {
      expect(eligibleExecutionOffers(request(policy), offers, ['entry']).map(row => row.id)).toEqual(offers.includes(plain) ? ['plain'] : []);
    }
    expect(() => eligibleExecutionOffers(request(createExecutionPolicy({ computation: 'cryptographic', protocol: 'fhe/v1', keyContext: 'client-key' })), [plain], ['entry'])).toThrow('unavailable');
    expect(eligibleExecutionOffers({ model: { ...model, identity: hash('c') }, privacy: policy }, [plain], ['entry'])).toEqual([]);
    const restricted = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['mine'] } });
    expect(eligibleExecutionOffers(request(restricted), [plain], ['other'])).toEqual([]);
  });
  it('binds permissions to policy and route and emits a content-free validation receipt', async () => {
    const policy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
    const binding = await bindExecutionRoute(request(policy), plaintextExecutionRoute(request(policy), { recipients: ['entry'] }));
    const need = remotePermissionNeed({ networkId: 'mesh', sharingScope: 'mesh', disclosure: 'public', model,
      policyId: binding.policyId, routeId: binding.routeId });
    const permission = createRemotePermission({ id: 'one', need, wording: { id: 'send', version: '1', text: 'Authorize this disclosure' }, grantedAt: 1 });
    expect(remotePermissionCovers(permission, need)).toBe(true);
    expect(remotePermissionCovers(permission, { ...need, routeId: hash('d') })).toBe(false);
    expect(remotePermissionCovers(permission, { ...need, policyId: hash('d') })).toBe(false);
    const receipt = executionPrivacyReceipt(binding);
    expect(receipt.recipients).toEqual(['entry']);
    expect(receipt).not.toHaveProperty('messages');
    expect(receipt).not.toHaveProperty('inputHash');
    expect(receipt.cryptographic).toBe('unavailable');
    expect(Object.isFrozen(binding.route.hops)).toBe(true);
  });
});

it('sends no prompt to any execution port for cryptographic or attested requests', async () => {
  for (const privacy of [createExecutionPolicy({ computation: 'cryptographic', protocol: 'fhe/v1', keyContext: 'client-key' }),
    createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, attestation: hash('b') })]) {
    const execute = vi.fn();
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'local', store: { load() {}, save() {} }, execute });
    const thread = app.createThread({ model, privacy });
    expect(() => app.send(thread, 'secret prompt')).toThrow('unavailable');
    expect(execute).not.toHaveBeenCalled();
    expect(app.getState().threads[0].attempts).toEqual([]);
    await app.close();
  }
});

it('refuses an unapproved downstream hop before disclosure approval can send plaintext', async () => {
  const bob = 'peer:' + 'b'.repeat(24), carol = 'peer:' + 'c'.repeat(24), sent = [];
  const app = createChatWorkspace({ meshId: 'mesh', participantId: 'local', store: { load() {}, save() {} },
    execute: async (request, controls) => {
      const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
      const attempted = { ...request, privacy };
      const privacyBinding = await bindExecutionRoute(attempted, plaintextExecutionRoute(attempted, { recipients: [carol] }));
      if (await controls.requestApproval({ id: 'approval', threadId: request.threadId, attemptId: request.attemptId,
        peerId: 'connection', recipientIdentity: carol, operation: 'generate', disclosure: 'public', modelId: model.id,
        modelIdentity: model.identity, adapterIdentities: [], privacyBinding, expiresAt: Date.now() + 10000 })) sent.push(request.messages);
      throw new Error('request declined');
    } });
  const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [bob] } });
  const thread = app.createThread({ model, privacy, permissions: { sharingScope: 'mesh' } });
  const result = await app.send(thread, 'secret prompt', { authorizeDisclosure: () => true });
  expect(result.status).toBe('failed'); expect(result.error).toContain('unauthorized'); expect(sent).toEqual([]);
  await app.close();
});

it('pins retry requirements even when the conversation privacy changes', async () => {
  const requests = [];
  const app = createChatWorkspace({ meshId: 'mesh', participantId: 'local', store: { load() {}, save() {} },
    execute: async request => { requests.push(request); throw new Error('Unavailable'); } });
  const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['bob'] } });
  const thread = app.createThread({ model, privacy });
  const failed = await app.send(thread, 'private prompt');
  app.setExecutionPrivacy(thread, createExecutionPolicy());
  await app.retry(thread, failed.id);
  expect(requests[1].privacy).toEqual(requests[0].privacy);
  expect(requests[1].privacy.recipients.ids).toEqual(['bob']);
  expect(requests[1].attemptId).not.toBe(requests[0].attemptId);
  await app.close();
});

it('resets obsolete stored settings to device-only without carrying over approval', async () => {
  let state;
  const store = { load: () => state, save: value => { state = value; } };
  const execute = vi.fn(async () => { throw new Error('Unavailable'); });
  const options = { meshId: 'mesh', participantId: 'local', store, execute };
  const original = createChatWorkspace(options);
  const thread = original.createThread({ model });
  const failed = await original.send(thread, 'historical');
  await original.close();
  state.threads[0].privacy = { schema: 'reploid.execution-policy/v1', profile: 'provider-visible' };
  state.threads[0].attempts[0].request.privacy = state.threads[0].privacy;
  const reopened = createChatWorkspace(options);
  expect(reopened.getState().threads[0]).toMatchObject({ executionSettingsReset: true, privacy: createExecutionPolicy(), grants: [] });
  expect(() => reopened.retry(thread, failed.id)).toThrow('current layered policy required');
  expect(execute).toHaveBeenCalledOnce();
  await reopened.close();
});
