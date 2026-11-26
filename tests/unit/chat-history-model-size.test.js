import { describe, expect, it, vi } from 'vitest';

const { opened } = vi.hoisted(() => ({ opened: [] }));
// The local resident is replaced so the test sees the model the scheduler asks it to load; no inference runs.
vi.mock('../../apps/poolday/providers/work-resident-provider.js', () => ({
  createWorkResidentProvider: ({ model }) => {
    opened.push(model);
    return { prepare: async () => {}, getState: () => ({ ready: true }), close: async () => {},
      generate: async () => ({ model: model.id, modelIdentity: model.identity, adapterIdentities: [], provider: 'doppler', content: 'Answer' }) };
  }
}));
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createChatExecution } from '../../apps/poolday/host/chat-execution.js';

// A large catalog entry: the 35B and 177B entries carry about 100 KB of runtime load options.
const loadOptions = { runtimeConfig: { loading: { tensors: Array.from({ length: 2000 }, (_, index) => ({ name: `layer.${index}.weight`, dtype: 'q4_0' })) } } };
const heavy = { id: 'large-model', name: 'Large', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler', adapters: [], contextLength: 4096, loadOptions };
const { loadOptions: _unused, ...light } = heavy;
const result = (request, content) => ({ threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
  modelIdentity: request.model.identity, adapterIdentities: [], content });

/** Sends one answer in each of `threads` new threads, as the pilot does, and returns what one more request copies. */
async function historyCost(model, threads) {
  let data;
  const store = { load: () => data, save: value => { data = structuredClone(value); } };
  const app = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', store, execute: async request => result(request, 'Answer') });
  for (let index = 0; index < threads; index++) {
    const thread = app.createThread({ model });
    expect((await app.send(thread, `Question ${index}`)).status).toBe('completed');
  }
  // Every notification, save and render copies this whole state, so its size is the per-request cost.
  const bytes = JSON.stringify(app.getState()).length + JSON.stringify(data).length;
  await app.close();
  return { bytes, data };
}

describe('conversation history size per thread', () => {
  it('does not copy catalog load options into each thread, so per-request copying stays the size of the model choice', async () => {
    expect(JSON.stringify(loadOptions).length).toBeGreaterThan(80000);
    const few = await historyCost(heavy, 2), many = await historyCost(heavy, 30), plain = await historyCost(light, 30);
    // The history grows by its own messages and attempts only, not by the catalog entry's load configuration.
    const perThread = (many.bytes - few.bytes) / 28;
    expect(perThread).toBeLessThan(8000);
    expect(many.bytes).toBeLessThan(plain.bytes * 1.01);
    const saved = many.data.threads[0];
    expect(saved.model).toEqual(light);
    expect(saved.attempts[0].request.model).toEqual(light);
  });

  it('a transactional history copies only the conversation that changed, for its saves and for its views', async () => {
    const saves = [];
    const unused = async () => { throw Error('not used by a whole-model answer'); };
    const store = { mode: 'transactional', supportsWholeModel: true, writerEpoch: 'e'.repeat(32), load: () => null,
      save: async value => { saves.push(value); }, assertCurrentWriter: async () => {}, publication: unused, project: unused };
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', store, execute: async (request, controls) => {
      for (let sequence = 0; sequence < 20; sequence++) controls.onDelta({ ...result(request, ''), text: 'a', sequence });
      return result(request, 'a'.repeat(20));
    } });
    const seen = [];
    app.observe(state => seen.push(state));
    const ids = [];
    for (let index = 0; index < 3; index++) {
      ids.push(await app.createThread({ model: light }));
      expect((await app.send(ids[index], `Question ${index}`)).status).toBe('completed');
    }
    const before = app.view(), savesBefore = saves.length;
    ids.push(await app.createThread({ model: light }));
    expect((await app.send(ids[3], 'Question 3')).status).toBe('completed');
    const after = app.view();
    // The three finished conversations are the very same frozen records in every later save and view.
    expect(saves.length).toBeGreaterThan(savesBefore);
    for (const saved of saves.slice(savesBefore)) for (let index = 0; index < 3; index++) expect(saved.threads[index]).toBe(saves[savesBefore - 1].threads[index]);
    for (let index = 0; index < 3; index++) expect(after.threads[index]).toBe(before.threads[index]);
    expect(Object.isFrozen(after.threads[0].attempts[0].request)).toBe(true);
    expect(after.threads[3].messages.at(-1).content).toBe('a'.repeat(20));
    // Observers were handed views, and the last one is the current state; getState still returns a copy to change freely.
    expect(seen.at(-1).threads[0]).toBe(before.threads[0]);
    const copied = app.getState();
    expect(copied).toEqual(after);
    expect(copied.threads[0]).not.toBe(after.threads[0]);
    expect(Object.isFrozen(copied.threads[0])).toBe(false);
    // Selecting changes no conversation: every record is reused.
    await app.select(ids[0]);
    expect(saves.at(-1).selectedId).toBe(ids[0]);
    expect(saves.at(-1).threads.every((thread, index) => thread === saves.at(-2).threads[index])).toBe(true);
    // A rename copies that one conversation and no other.
    await app.renameThread(ids[1], 'Renamed');
    expect(saves.at(-1).threads[1].title).toBe('Renamed');
    expect(saves.at(-1).threads[0]).toBe(saves.at(-2).threads[0]);
    await app.close();
  });

  it('drops load options from a history saved before this change on its next save', async () => {
    let data;
    const store = { load: () => data, save: value => { data = structuredClone(value); } };
    const first = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', store, execute: async request => result(request, 'Answer') });
    const thread = first.createThread({ model: light });
    await first.send(thread, 'Question');
    await first.close();
    data.threads[0].model = structuredClone(heavy);
    data.threads[0].attempts[0].request.model = structuredClone(heavy);
    const reloaded = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', store, execute: async request => result(request, 'Again') });
    const [restored] = reloaded.getState().threads;
    expect(restored.model).toEqual(light);
    expect(restored.attempts[0].request.model).toEqual(light);
    expect((await reloaded.send(restored.id, 'Follow-up')).status).toBe('completed');
    expect(JSON.stringify(data).includes('runtimeConfig')).toBe(false);
    await reloaded.close();
  });

  it('still loads a local model with the catalog load options the thread no longer carries', async () => {
    opened.length = 0;
    const execution = createChatExecution({ service: {}, models: [heavy], getModels: () => [heavy],
      profile: { generation: {}, maxOutcomeCharacters: 100 } });
    let data;
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', execute: execution.execute,
      store: { load: () => data, save: value => { data = structuredClone(value); } } });
    const thread = app.createThread({ model: heavy, permissions: { sharingScope: 'local' } });
    expect(app.getState().threads[0].model.loadOptions).toBeUndefined();
    expect((await app.send(thread, 'Question')).status).toBe('completed');
    expect(opened).toHaveLength(1);
    expect(opened[0].loadOptions).toEqual(loadOptions);
    await app.close(); await execution.close();
  });
});
