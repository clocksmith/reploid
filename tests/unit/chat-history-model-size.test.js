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
