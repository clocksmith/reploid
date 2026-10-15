// The one-time remote contributor permission (packages/reploid/src/chat/remote-permission.js) and how the
// workspace applies it before every remote disclosure. Injected execution; no inference.
import { describe, expect, it, vi } from 'vitest';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import policy from '../../packages/reploid/src/chat/policy.json';
import { createRemotePermission, remoteDisclosureKind, remotePermissionCovers, remotePermissionNeed,
  validateRemotePermission } from '../../packages/reploid/src/chat/remote-permission.js';

const digest = c => 'sha256:' + c.repeat(64), PEER = 'peer:' + 'b'.repeat(24);
const modelA = { id: 'model-a', name: 'Model A', identity: digest('a') }, modelB = { id: 'model-b', name: 'Model B', identity: digest('b') };
const adapter = { id: 'adapter', identity: digest('c') };
const need = (overrides = {}) => ({ networkId: 'mesh', sharingScope: 'mesh', disclosure: 'public', modelId: modelA.id, modelIdentity: modelA.identity, adapterIdentities: [], ...overrides });
const WORDING = { id: 'reploid.remote-contributor-permission', version: '1', text: 'Shown text' };
const granted = (overrides = {}) => createRemotePermission({ id: 'permission-1', need: need(), catalog: [modelA], wording: WORDING, grantedAt: 1, ...overrides });

describe('remote permission scope', () => {
  it('defines inside exactly: unrevoked, same sharing scope and disclosure kind, listed model and every adapter', () => {
    const permission = granted();
    expect(remotePermissionCovers(permission, need())).toBe(true);
    const outside = {
      'no permission': [null, need()],
      'revoked': [{ ...permission, revokedAt: 2 }, need()],
      'another sharing scope': [permission, need({ sharingScope: 'thread-members' })],
      'local scope is never remote': [permission, need({ sharingScope: 'local' })],
      'another disclosure kind': [permission, need({ disclosure: 'ordered-partition-activations-and-tokens' })],
      'a model outside its catalog': [permission, need({ modelId: modelB.id, modelIdentity: modelB.identity })],
      'an adapter it does not list': [permission, need({ adapterIdentities: [adapter.identity] })]
    };
    for (const [name, [record, request]] of Object.entries(outside)) expect(remotePermissionCovers(record, request), name).toBe(false);
  });
  it('covers the verified catalog the person chose from, and that catalog\'s adapters', () => {
    const permission = granted({ catalog: [modelA, { ...modelB, availableAdapters: [adapter] }] });
    expect(permission).toMatchObject({ sharingScope: 'mesh', disclosure: 'public', revokedAt: null,
      modelIdentities: [modelA.identity, modelB.identity], adapterIdentities: [adapter.identity] });
    expect(remotePermissionCovers(permission, need({ modelId: modelB.id, modelIdentity: modelB.identity, adapterIdentities: [adapter.identity] }))).toBe(true);
    expect(() => validateRemotePermission({ ...permission, extra: true })).toThrow('Invalid remote contributor permission');
    expect(() => validateRemotePermission({ ...permission, sharingScope: 'local' })).toThrow();
    expect(() => validateRemotePermission({ ...permission, disclosure: 'anything' })).toThrow();
  });
  it('names the disclosure each selection would make', () => {
    expect(remoteDisclosureKind(modelA)).toBe('public');
    expect(remoteDisclosureKind({ partition: { participantA: PEER } })).toBe('partition-activations-and-tokens');
    expect(remoteDisclosureKind({ partition: { schema: 'reploid.partition-selection/v2' } })).toBe('ordered-partition-activations-and-tokens');
    expect(remotePermissionNeed({ networkId: 'mesh', sharingScope: 'mesh', disclosure: 'public', model: { ...modelA, adapters: [adapter] } }))
      .toEqual(need({ adapterIdentities: [adapter.identity] }));
    expect(() => remotePermissionNeed({ sharingScope: 'mesh', disclosure: 'public', model: modelA })).toThrow('network the request is sent on');
  });
  it('covers only the network it was granted on; another network asks again', () => {
    const permission = granted();
    expect(permission.networkId).toBe('mesh');
    expect(remotePermissionCovers(permission, need())).toBe(true);
    expect(remotePermissionCovers(permission, need({ networkId: 'other-room' }))).toBe(false);
    expect(() => validateRemotePermission({ ...permission, networkId: '' })).toThrow('Invalid remote contributor permission');
    const { networkId: _dropped, ...earlier } = permission;
    expect(() => validateRemotePermission({ ...earlier, schema: 'reploid.remote-permission/v1' })).toThrow('Invalid remote contributor permission');
  });
});

/** A workspace whose host stores permissions in `stored`; execute sends only after requestApproval returns true. */
function fixture({ hold = null } = {}) {
  const stored = [], disclosed = [];
  const execute = async (request, controls) => {
    const preview = { id: 'preview-' + request.attemptId, threadId: request.threadId, attemptId: request.attemptId, peerId: PEER, recipientIdentity: PEER,
      operation: 'generate', disclosure: 'public', modelId: request.model.id, modelIdentity: request.model.identity,
      adapterIdentities: (request.model.adapters || []).map(item => item.identity), expiresAt: Date.now() + 10000, input: request.messages };
    if (!await controls.requestApproval(preview)) throw new Error('Disclosure declined');
    disclosed.push(request.messages.at(-1).content);
    if (hold) await hold(request);
    return { threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id, modelIdentity: request.model.identity,
      adapterIdentities: preview.adapterIdentities, content: 'Answer' };
  };
  let data;
  const app = createChatWorkspace({ meshId: 'mesh', participantId: 'peer:' + 'f'.repeat(24), remotePermissions: () => stored,
    store: { load: () => data, save: value => { data = structuredClone(value); } }, execute });
  const statuses = []; app.subscribe(state => statuses.push(...state.threads.map(thread => thread.attempts.at(-1)?.status)));
  return { app, stored, disclosed, statuses, attempt: thread => app.getState().threads.find(item => item.id === thread).attempts.at(-1) };
}
const held = (f, thread) => vi.waitFor(() => { const attempt = f.attempt(thread); expect(attempt.status).toBe('approval'); return attempt; });

describe('workspace under a remote permission', () => {
  it('sends nothing before permission; granting it releases the held request and cites it', async () => {
    const f = fixture(), thread = f.app.createThread({ model: modelA, permissions: { sharingScope: 'mesh' } });
    const completion = f.app.send(thread, 'First');
    const attempt = await held(f, thread);
    expect(attempt.approval.permissionNeed).toEqual(need());
    expect(attempt.authorization).toBeNull(); expect(f.disclosed).toEqual([]);
    expect(f.app.resumePermitted()).toBe(0); // nothing stored yet: still held
    f.stored.push(granted());
    expect(f.app.resumePermitted()).toBe(1);
    expect((await completion).authorization).toMatchObject({ kind: 'permission', source: 'permission', permissionId: 'permission-1',
      recipients: [PEER], recipientIdentity: PEER, disclosure: 'public', modelIdentity: modelA.identity, sharingScope: 'mesh' });
    expect(f.disclosed).toEqual(['First']);
  });
  it('pins the recipients within an admitted attempt even when permission covers both computers', async () => {
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'requester', remotePermissions: () => [granted()],
      store: { load: () => null, save() {} }, execute: async (request, controls) => {
        for (const peer of [PEER, 'peer:' + 'c'.repeat(24)]) {
          await controls.requestApproval({ id: peer, threadId: request.threadId, attemptId: request.attemptId,
            peerId: peer, recipientIdentity: peer, operation: 'generate', disclosure: 'public',
            modelId: modelA.id, modelIdentity: modelA.identity, adapterIdentities: [], expiresAt: Date.now() + 10000 });
        }
        throw Error('Must not reach a replacement recipient');
      } });
    try {
      const thread = app.createThread({ model: modelA, permissions: {sharingScope:'mesh'} });
      expect(await app.send(thread, 'Hello')).toMatchObject({status:'failed', error:'Execution recipients changed. Retry starts a new authorized attempt.'});
    } finally { await app.close(); }
  });

  it('gives a dispatch-held first-use permission a fresh bounded execution window', async () => {
    vi.useFakeTimers();
    const stored = []; let signal, deadline, release;
    const gate = new Promise(resolve => { release = resolve; });
    const app = createChatWorkspace({ meshId:'mesh', participantId:'requester', remotePermissions:()=>stored,
      policy:{...policy,attemptTimeoutMs:1000}, store:{load:()=>null,save(){}}, execute:async(request,controls)=>{
        signal = controls.signal;
        if (!await controls.requestApproval({id:'preview',threadId:request.threadId,attemptId:request.attemptId,
          peerId:PEER,recipientIdentity:PEER,operation:'generate',disclosure:'public',modelId:modelA.id,
          modelIdentity:modelA.identity,adapterIdentities:[],expiresAt:Date.now()+10000,executionTimeoutMs:1000})) throw Error('Expired');
        deadline=controls.authorizationExpiresAt(); await gate;
        return {threadId:request.threadId,attemptId:request.attemptId,modelId:modelA.id,modelIdentity:modelA.identity,adapterIdentities:[],content:'Answer'};
      }});
    try {
      const thread=app.createThread({model:modelA,permissions:{sharingScope:'mesh'}}), pending=app.send(thread,'Hello');
      await vi.advanceTimersByTimeAsync(900); stored.push(granted()); app.resumePermitted();
      await vi.advanceTimersByTimeAsync(900); expect(signal.aborted).toBe(false); expect(deadline).toBeGreaterThan(Date.now());
      await vi.advanceTimersByTimeAsync(101); expect(signal.aborted).toBe(true); release();
      expect((await pending).status).toBe('cancelled');
    } finally { release(); await app.close(); vi.useRealTimers(); }
  });

  it('a covered request is sent with no approval state; the record names its recipients', async () => {
    const f = fixture(), thread = f.app.createThread({ model: modelA, permissions: { sharingScope: 'mesh' } });
    f.stored.push(granted());
    const first = await f.app.send(thread, 'Question'), follow = await f.app.send(thread, 'Follow-up');
    expect(f.statuses).not.toContain('approval');
    expect([first, follow].map(row => [row.status, row.authorization.permissionId, row.authorization.recipients]))
      .toEqual([['completed', 'permission-1', [PEER]], ['completed', 'permission-1', [PEER]]]);
    expect(f.disclosed).toEqual(['Question', 'Follow-up']);
  });
  it('asks again for a request outside the permission and sends nothing until a covering one exists', async () => {
    const f = fixture(); f.stored.push(granted());
    const cases = [['another model', modelB, 'mesh'], ['another sharing scope', modelA, 'thread-members'],
      ['an adapter it does not list', { ...modelA, adapters: [adapter] }, 'mesh']];
    for (const [name, model, sharingScope] of cases) {
      const thread = f.app.createThread({ model, permissions: { sharingScope } }), completion = f.app.send(thread, name);
      const attempt = await held(f, thread);
      expect(f.disclosed, name).not.toContain(name);
      f.stored.push(createRemotePermission({ id: 'for-' + name, need: attempt.approval.permissionNeed, wording: WORDING, grantedAt: 2 }));
      expect(f.app.resumePermitted()).toBe(1);
      expect((await completion).authorization.permissionId).toBe('for-' + name);
    }
    expect(f.disclosed).toEqual(cases.map(([name]) => name));
  });
  it('revocation stops new disclosures and leaves an answer already admitted running', async () => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const f = fixture({ hold: request => request.messages.at(-1).content === 'Long' ? gate : null });
    const thread = f.app.createThread({ model: modelA, permissions: { sharingScope: 'mesh' } });
    f.stored.push(granted());
    const running = f.app.send(thread, 'Long');
    await vi.waitFor(() => expect(f.disclosed).toEqual(['Long']));
    f.stored[0] = { ...f.stored[0], revokedAt: 2 };
    release(); expect((await running).status).toBe('completed');
    const other = f.app.createThread({ model: modelA, permissions: { sharingScope: 'mesh' } }), next = f.app.send(other, 'After');
    await held(f, other);
    expect(f.disclosed).toEqual(['Long']);
    expect(() => f.app.approve(other, f.attempt(other).id, f.attempt(other).approval.id, true)).toThrow('remote contributor permission');
    // Keeping answers local declines only this request.
    f.app.approve(other, f.attempt(other).id, f.attempt(other).approval.id, false);
    expect(await next).toMatchObject({ status: 'cancelled', error: 'Disclosure declined', authorization: null });
    expect(f.attempt(thread).status).toBe('completed'); expect(f.disclosed).toEqual(['Long']);
  });
  it('never holds an unverifiable recipient for permission', async () => {
    const f = fixture(); f.stored.push(granted());
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'peer:' + 'f'.repeat(24), remotePermissions: () => f.stored,
      store: { load: () => null, save: () => {} }, execute: async (request, controls) => {
        await controls.requestApproval({ id: 'p', threadId: request.threadId, attemptId: request.attemptId, peerId: 'unverified',
          operation: 'generate', disclosure: 'public', modelId: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [], expiresAt: Date.now() + 10000 });
        throw new Error('sent');
      } });
    const thread = app.createThread({ model: modelA, permissions: { sharingScope: 'mesh' } });
    expect(await app.send(thread, 'x')).toMatchObject({ status: 'failed', error: 'Peer disclosure does not match the selected model and verified recipients' });
  });
});
