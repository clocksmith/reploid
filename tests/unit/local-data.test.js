import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatSession } from '../../apps/poolday/host/chat-session.js';
import { createComputerPreferences } from '../../apps/poolday/host/computer-preferences.js';
import { createLocalData, LOCAL_DATA_SCHEMA, LOCAL_DATA_VERSION, LOCAL_DATA_NOTE } from '../../apps/poolday/host/local-data.js';
import { renderLocalData, bindLocalData } from '../../apps/poolday/ui/pool-home/local-data-view.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const key = id => 'peer:' + id.repeat(24);
const storage = () => { const values = new Map(); return { values, getItem: name => values.get(name) ?? null,
  setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) }; };
const HISTORY_KEY = 'reploid.chat-workspace:v1';

/** A browser profile with two answered conversations, one saved computer name and one block. */
async function profile({ conversations = 2 } = {}) {
  const store = storage();
  const chat = createChatSession({ storage: store, service: createChatTestService() });
  const ids = [];
  for (let i = 0; i < conversations; i++) {
    const id = chat.createThread({ sharingScope: 'local' }); ids.push(id);
    expect((await chat.send(id, 'Question ' + i)).status).toBe('completed');
  }
  const computers = createComputerPreferences({ storage: store, verifyPeer: async () => key('a') });
  return { store, chat, computers, ids, data: createLocalData({ chat, computers, now: () => new Date('2026-11-11T12:00:00Z') }),
    close: async () => { await computers.close(); await chat.close(); } };
}
const open = [];
afterEach(async () => { for (const item of open.splice(0)) await item.close(); });
const make = async options => { const item = await profile(options); open.push(item); return item; };

describe('local data export', () => {
  it('produces one versioned document with conversations as stored and per-computer preferences', async () => {
    const source = await make();
    await source.computers.rename('wire', 'Desk');
    await source.computers.block('wire-b', { participantId: key('b') });
    const file = JSON.parse(JSON.stringify(source.data.export()));
    expect(file).toMatchObject({ schema: LOCAL_DATA_SCHEMA, version: LOCAL_DATA_VERSION, note: LOCAL_DATA_NOTE,
      exportedAt: '2026-11-11T12:00:00.000Z', history: { meshId: 'reploid-local-mesh', participantId: 'local-user' },
      computers: { names: { [key('a')]: 'Desk' }, blocked: [key('b')] }, receipts: { stored: false } });
    expect(file.note).toContain('does not contain private keys'); expect(file.note).toContain('model weights');
    const stored = JSON.parse(source.store.values.get(HISTORY_KEY)).threads;
    expect(file.conversations).toEqual(stored);
    expect(file.conversations.map(thread => thread.id)).toEqual(source.ids);
    expect(file.conversations[0].messages.map(message => message.content)).toEqual(['Question 0', 'Fixture: Question 0']);
    expect(file.conversations[0].attempts).toHaveLength(1);
    expect(file.conversations[0].attempts[0]).toMatchObject({ status: 'completed', responseId: file.conversations[0].messages[1].id });
  });

  it('leaves out key material, other stored settings and the GPU baseline', async () => {
    const source = await make({ conversations: 1 });
    // Other things this browser profile keeps: none of them is a conversation or a per-computer preference.
    source.store.setItem('reploid.identity', JSON.stringify({ privateJwk: { kty: 'OKP', d: 'IDENTITY-SECRET' } }));
    source.store.setItem('reploid.remote-permissions:v1', JSON.stringify([{ id: 'PERMISSION-MARKER' }]));
    source.store.setItem('REPLOID_WEB_SEARCH', 'SEARCH-SERVER-MARKER');
    const text = JSON.stringify(source.data.export());
    for (const marker of ['IDENTITY-SECRET', 'PERMISSION-MARKER', 'SEARCH-SERVER-MARKER', 'privateJwk', 'baseline']) expect(text).not.toContain(marker);
    // Should a stored record ever carry a key, the private parts are dropped and the public parts kept.
    const leaky = createLocalData({ computers: null, chat: { importThreads() {}, exportThreads: () => ({ meshId: 'm', participantId: 'p', threads: [{ id: 't',
      attempts: [{ id: 'a', identity: { privateJwk: { kty: 'EC', d: 'SECRET-D' }, privateKey: 'SECRET-PEM',
        publicJwk: { kty: 'EC', crv: 'P-256', x: 'PUBLIC-X', y: 'PUBLIC-Y', d: 'SECRET-IN-JWK' } }, d: 'an ordinary field named d' }] }] }) } }).export();
    const leaked = JSON.stringify(leaky);
    for (const secret of ['SECRET-D', 'SECRET-PEM', 'SECRET-IN-JWK', 'privateJwk', 'privateKey']) expect(leaked).not.toContain(secret);
    expect(leaky.conversations[0].attempts[0]).toEqual({ id: 'a', identity: { publicJwk: { kty: 'EC', crv: 'P-256', x: 'PUBLIC-X', y: 'PUBLIC-Y' } }, d: 'an ordinary field named d' });
  });
});

describe('local data import', () => {
  it('adds conversations into another browser and restores them from storage', async () => {
    const source = await make(), target = await make({ conversations: 1 });
    const file = JSON.stringify(source.data.export());
    const plan = target.data.plan(file);
    expect(plan.counts).toMatchObject({ conversations: 2, conversationsSkipped: 0, names: 0, blocked: 0 });
    expect(plan.summary).toBe('This file adds 2 conversations, 0 computer names and 0 blocked computers.');
    expect(target.chat.getState().threads).toHaveLength(1);
    const selected = target.chat.getState().selectedId;
    expect(plan.apply()).toMatchObject({ conversations: 2 });
    const state = target.chat.getState();
    expect(state.threads.map(thread => thread.id)).toEqual([...target.ids, ...source.ids]);
    expect(state.selectedId).toBe(selected);
    expect(state.threads[1].messages.map(message => message.content)).toEqual(['Question 0', 'Fixture: Question 0']);
    expect(state.threads[1].attempts).toEqual(source.chat.getState().threads[0].attempts);
    const restored = createChatSession({ storage: target.store, service: createChatTestService() });
    try { expect(restored.getState().threads.map(thread => thread.id)).toEqual([...target.ids, ...source.ids]); }
    finally { await restored.close(); }
  });

  it('skips a conversation whose id is already here and never overwrites it', async () => {
    const source = await make(), target = await make({ conversations: 0 });
    const exported = source.data.export();
    target.data.plan(exported).apply();
    target.chat.renameThread(source.ids[0], 'Mine');
    const before = JSON.stringify(target.chat.getState().threads);
    const again = target.data.plan(JSON.stringify(exported));
    expect(again.empty).toBe(true); expect(again.counts).toMatchObject({ conversations: 0, conversationsSkipped: 2 });
    expect(again.summary).toContain('2 conversations already here');
    expect(again.apply()).toMatchObject({ conversations: 0, conversationsSkipped: 2 });
    expect(JSON.stringify(target.chat.getState().threads)).toBe(before);
    // A file whose copy of an existing conversation differs, alongside one new conversation and a repeat of it.
    const changed = structuredClone(exported);
    changed.conversations[0].messages[0].content = 'Rewritten elsewhere'; changed.conversations[0].title = 'Theirs';
    const extra = { ...structuredClone(changed.conversations[1]), id: 'new-conversation' };
    extra.messages = extra.messages.map(message => ({ ...message })); extra.attempts = extra.attempts.map(attempt => ({ ...attempt, threadId: 'elsewhere' }));
    changed.conversations.push(extra, structuredClone(extra));
    const mixed = target.data.plan(changed);
    expect(mixed.counts).toMatchObject({ conversations: 1, conversationsSkipped: 3 });
    mixed.apply();
    const threads = target.chat.getState().threads;
    expect(threads.map(thread => thread.id)).toEqual([...source.ids, 'new-conversation']);
    expect(threads[0].title).toBe('Mine'); expect(threads[0].messages[0].content).toBe('Question 0');
    expect(threads[2].attempts[0].threadId).toBe('new-conversation');
  });

  it('restores no sharing grant and resumes nothing from a file', async () => {
    const source = await make({ conversations: 1 }), target = await make({ conversations: 0 });
    const file = source.data.export();
    file.conversations[0].grants = [{ id: 'grant', threadId: file.conversations[0].id, recipientIdentity: key('c'), revokedAt: null }];
    file.conversations[0].attempts[0].status = 'executing'; file.conversations[0].messages[1].status = 'executing';
    target.data.plan(file).apply();
    const thread = target.chat.getState().threads[0];
    expect(thread.grants).toEqual([]);
    expect(thread.attempts[0]).toMatchObject({ status: 'interrupted', error: 'Imported unfinished. Retry starts a new attempt.' });
    expect(thread.messages[1].status).toBe('interrupted');
    expect(target.chat.getState().runningIds).toEqual([]);
  });

  it('merges computer names and blocks without replacing a name already set here', async () => {
    const source = await make({ conversations: 0 }), target = await make({ conversations: 0 });
    await source.computers.rename('wire', 'Desk');
    await source.computers.block('wire', { participantId: key('b') });
    await target.computers.rename('wire', 'Kitchen');
    await target.computers.block('wire', { participantId: key('c') });
    const file = source.data.export(); file.computers.names[key('d')] = 'Attic';
    const plan = target.data.plan(file);
    expect(plan.counts).toMatchObject({ names: 1, namesSkipped: 1, blocked: 1, blockedSkipped: 0 });
    plan.apply();
    expect(target.computers.getState().names).toEqual({ [key('a')]: 'Kitchen', [key('d')]: 'Attic' });
    expect(target.computers.getBlocked()).toEqual([key('c'), key('b')]);
    expect(createComputerPreferences({ storage: target.store }).getBlocked()).toEqual([key('c'), key('b')]);
  });

  it('refuses another schema or version, malformed files and invalid conversations, changing nothing', async () => {
    const source = await make({ conversations: 1 }), target = await make({ conversations: 0 });
    const file = source.data.export();
    expect(() => target.data.plan('{not json')).toThrow('not valid JSON');
    expect(() => target.data.plan({ ...file, schema: 'something-else/v1' })).toThrow('not a Reploid data export');
    expect(() => target.data.plan({ ...file, version: 2 })).toThrow('export version 2. This build reads version 1 only.');
    expect(() => target.data.plan({ ...file, version: undefined })).toThrow('reads version 1 only');
    expect(() => target.data.plan({ ...file, conversations: null })).toThrow('no conversation list');
    expect(() => target.data.plan({ ...file, conversations: [{ ...file.conversations[0], messages: 'none' }] })).toThrow('Invalid imported conversation');
    expect(() => target.data.plan({ ...file, conversations: [{ ...file.conversations[0], model: { id: 'x', name: 'x', identity: 'unidentified' } }] })).toThrow('identified model');
    expect(() => target.data.plan({ ...file, computers: { names: { 'not-a-key': 'Desk' } } })).toThrow('invalid computer names');
    expect(() => target.data.plan({ ...file, conversations: Array.from({ length: 65 }, (_, i) => ({ ...file.conversations[0], id: 'thread-' + i })) }))
      .toThrow('Conversation limit reached');
    expect(target.chat.getState().threads).toEqual([]);
    expect(target.store.values.has(HISTORY_KEY)).toBe(false);
  });

  it('refuses conversations for a history that is not ordinary browser history, and when storage is too small', async () => {
    const source = await make({ conversations: 1 });
    const file = source.data.export();
    const refused = createChatSession({ storage: storage(), service: createChatTestService(), history: { mode: 'refused', publication: 'ordered', reason: 'owned elsewhere' } });
    try { expect(() => createLocalData({ chat: refused }).plan(file)).toThrow('cannot be imported into this history'); }
    finally { await refused.close(); }
    const small = storage(), write = small.setItem;
    small.setItem = (name, value) => { if (name.endsWith(':import-check')) throw new Error('QuotaExceededError'); write(name, value); };
    const cramped = createChatSession({ storage: small, service: createChatTestService() });
    try {
      expect(() => createLocalData({ chat: cramped }).plan(file)).toThrow('does not have enough storage');
      expect(cramped.getState().storageError).toBeNull();
      expect(cramped.createThread({ sharingScope: 'local' })).toBeTruthy();
    } finally { await cramped.close(); }
  });
});

describe('Settings data controls', () => {
  it('exports a file, previews an import with its counts in a dialog, and imports only on confirmation', async () => {
    const source = await make(), target = await make({ conversations: 0 });
    const mount = item => {
      const root = document.createElement('div'); root.innerHTML = renderLocalData(); document.body.append(root);
      const dialog = root.querySelector('dialog');
      dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
      return { root, find: selector => root.querySelector(selector), binding: bindLocalData(root, item.chat, item.computers, { read: async file => file.contents }) };
    };
    const blobs = [], createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob); return 'blob:fixture'; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const from = mount(source), to = mount(target);
    try {
      expect(from.find('[data-settings-data]').hidden).toBe(false);
      expect(from.find('[data-data-export]').textContent).toBe('Export my data'); expect(from.find('[data-data-import]').textContent).toBe('Import data');
      from.find('[data-data-export]').click(); await settle();
      expect(click).toHaveBeenCalledOnce(); expect(blobs[0].type).toBe('application/json');
      expect(from.find('[data-data-status]').textContent).toBe('Exported 2 conversations.');
      const contents = await blobs[0].text();
      expect(JSON.parse(contents).schema).toBe(LOCAL_DATA_SCHEMA);
      const choose = text => { const input = to.find('[data-data-file]');
        Object.defineProperty(input, 'files', { configurable: true, value: [{ size: text.length, contents: text }] });
        input.dispatchEvent(new Event('change')); return settle(); };
      await choose('{"schema":"other"}');
      expect(to.find('[data-data-status]').textContent).toBe('This file is not a Reploid data export.'); expect(to.find('dialog').open).toBeFalsy();
      await choose(contents);
      expect(to.find('dialog').open).toBe(true);
      expect(to.find('[data-data-summary]').textContent).toBe('This file adds 2 conversations, 0 computer names and 0 blocked computers.');
      expect(target.chat.getState().threads).toHaveLength(0);
      to.find('[data-data-cancel]').click();
      expect(to.find('dialog').open).toBe(false); expect(target.chat.getState().threads).toHaveLength(0);
      await choose(contents); to.find('[data-data-confirm]').click();
      expect(target.chat.getState().threads.map(thread => thread.id)).toEqual(source.ids);
      expect(to.find('[data-data-status]').textContent).toBe('Imported 2 conversations, 0 computer names and 0 blocked computers.');
      await choose(contents);
      expect(to.find('dialog').open).toBe(false); expect(to.find('[data-data-status]').textContent).toContain('Nothing to import.');
    } finally {
      from.binding.dispose(); to.binding.dispose(); from.root.remove(); to.root.remove();
      createObjectURL.mockRestore(); revoke.mockRestore(); click.mockRestore();
    }
  });
});
