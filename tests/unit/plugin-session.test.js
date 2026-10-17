import { describe, it, expect, vi } from 'vitest';
import { openPluginSession } from '../../packages/reploid/src/plugins/session.js';

const definition = {
  manifest: { id: 'dice-game', version: '1', apiVersion: 1, capabilities: ['game.roll'],
    limits: { maxEffects: 2, maxRecordBytes: 20000, effectTimeoutMs: 1000 } },
  initialize: () => ({ score: 0 }),
  transition(state, event) {
    if (event.type === 'roll') return { state, effects: [{ capability: 'game.roll', input: { sides: 6 } }] };
    state.score += event.output; return { state, effects: [] };
  },
  project: state => ({ score: state.score })
};
function fixture() {
  const records = new Map();
  const store = { load: async id => structuredClone(records.get(id)), save: vi.fn(async (id, value) => records.set(id, structuredClone(value))) };
  return { records, store, options: { definition, config: { seed: 1 }, sessionId: 's1', store,
    capabilities: { 'game.roll': vi.fn(async () => 3) } } };
}
describe('shared plugin lifecycle, with a game capability', () => {
  it('persists intent before a call, snapshots configuration and records effects without replay on restore', async () => {
    const f = fixture();
    f.options.capabilities['game.roll'] = vi.fn(async () => {
      expect(f.records.get('s1').effects[0].status).toBe('running'); return 4;
    });
    const session = await openPluginSession(f.options);
    f.options.config.seed = 99;
    await session.dispatch({ type: 'roll' });
    expect(session.view().content.score).toBe(4);
    expect(session.export().config.seed).toBe(1);
    await session.close();
    const restored = await openPluginSession({ ...f.options, config: undefined });
    expect(restored.view().content.score).toBe(4);
    expect(f.options.capabilities['game.roll']).toHaveBeenCalledTimes(1);
  });
  it('does not invoke a capability when intent persistence fails', async () => {
    const f = fixture(), session = await openPluginSession(f.options);
    f.store.save.mockRejectedValue(new Error('full'));
    await expect(session.dispatch({ type: 'roll' })).rejects.toThrow('full');
    expect(f.options.capabilities['game.roll']).not.toHaveBeenCalled();
  });
  it('bounds effects and refuses plugin/version/config mismatches', async () => {
    const f = fixture(), session = await openPluginSession(f.options);
    await session.dispatch({ type: 'roll' }); await session.dispatch({ type: 'roll' });
    await expect(session.dispatch({ type: 'roll' })).rejects.toThrow('budget');
    expect(f.options.capabilities['game.roll']).toHaveBeenCalledTimes(2);
    await expect(openPluginSession({ ...f.options, config: { seed: 2 } })).rejects.toThrow('configuration');
    await expect(openPluginSession({ ...f.options, definition: { ...definition, manifest: { ...definition.manifest, version: '2' } } })).rejects.toThrow('version');
  });
  it('retains cancellation and settles close without advancing a late response', async () => {
    const f = fixture(); let finish;
    f.options.capabilities['game.roll'] = () => new Promise(resolve => { finish = resolve; });
    const session = await openPluginSession(f.options), running = session.dispatch({ type: 'roll' });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    let closed = false; const closing = session.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    finish(6); await expect(running).rejects.toThrow('closed'); await closing;
    expect(session.export().effects[0]).toMatchObject({ status: 'cancelled', output: 6 });
    expect(session.view().content.score).toBe(0);
  });
  it('marks crashed work interrupted and never auto-retries it', async () => {
    const f = fixture(), session = await openPluginSession(f.options);
    const saved = session.export(); saved.status = 'running'; saved.effects.push({ status: 'running' }); f.records.set('s1', saved);
    const restored = await openPluginSession(f.options);
    expect(restored.view().status).toBe('interrupted');
    await expect(restored.dispatch({ type: 'roll' })).rejects.toThrow('cannot replay');
    expect(f.options.capabilities['game.roll']).not.toHaveBeenCalled();
  });
  it('rejects undeclared capabilities and forged internal events', async () => {
    const f = fixture();
    const session = await openPluginSession({ ...f.options, definition: { ...definition,
      transition: state => ({ state, effects: [{ capability: 'network.fetch', input: {} }] }) } });
    await expect(session.dispatch({ type: 'effect.completed', output: 999 })).rejects.toThrow('Reserved');
    await expect(session.dispatch({ type: 'roll' })).rejects.toThrow('undeclared');
    expect(f.options.capabilities['game.roll']).not.toHaveBeenCalled();
  });
});
