import { it, expect, vi } from 'vitest';
import { bindResearchPlugins, renderResearchPlugins } from '../../self/ui/pool-home/research-plugins.js';

function fixture(lock = {}) {
  const models = [
    { id: 'qwen-3-5-0-8b-q4k-ehaf16', name: 'Target', identity: 's', provider: 'doppler' },
    { id: 'qwen-3-5-2b-q4k-ehaf16', name: 'Alternative', identity: 'm', provider: 'doppler' },
    { id: 'qwen3-8-27b-text-q4k-ehaf16', name: 'Imitator', identity: 'l', provider: 'doppler' }
  ];
  let notify, peers = [];
  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const swarm = { getState: () => ({ consumer: { peers } }), generate: vi.fn(async (messages, controls) => {
    const preview = { providerId: controls.modelId, modelId: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [] };
    expect(await controls.approve(preview)).toBe(true);
    await controls.record({ stage: 'approved', preview });
    return { model: controls.modelId, modelIdentity: controls.modelIdentity, peerId: controls.modelId, provider: 'doppler', content: 'fixture answer' };
  }) };
  const host = { swarm, chat: { getState: () => ({ models }), subscribe: cb => { notify = cb; return () => {}; } } };
  const root = document.createElement('main'); root.innerHTML = renderResearchPlugins(); document.body.append(root);
  const dispose = bindResearchPlugins(root, host, { storage, locks: { request: async (name, options, cb) => cb(lock) } });
  return { root, data, swarm, dispose: () => { dispose(); root.remove(); }, ready() {
    peers = models.map(model => ({ model: model.id, modelIdentity: model.identity, peerId: model.id,
      role: 'provider', readiness: 'ready', availableSlots: 1 })); notify();
  }, notify: () => notify() };
}
it('waits for contributors, retains selection, prepares then judges without new inference, and restores', async () => {
  const f = fixture();
  try {
    expect(f.root.querySelector('[data-study-start]').disabled).toBe(true);
    f.ready();
    const select = f.root.querySelector('[data-study-imitator]');
    select.value = 'qwen-3-5-2b-q4k-ehaf16'; select.dispatchEvent(new Event('change'));
    f.notify();
    expect(f.root.querySelector('[data-study-imitator]').value).toBe('qwen-3-5-2b-q4k-ehaf16');
    f.root.querySelector('[data-study-start]').click();
    await vi.waitFor(() => expect(f.root.querySelector('[data-study-judge]')).not.toBeNull());
    expect(f.swarm.generate).toHaveBeenCalledTimes(18);
    f.root.querySelector('[data-study-followup]').click();
    await vi.waitFor(() => expect(f.root.querySelector('[data-study-followup]')).toBeNull());
    for (let i = 0; i < 4; i++) {
      f.root.querySelector('[name=judgment][value=unsure]').checked = true;
      f.root.querySelector('[data-study-judge]').click();
      await vi.waitFor(() => expect(f.root.textContent).toContain(i === 3 ? 'Study complete' : `Round ${i + 2}`));
    }
    expect(f.swarm.generate).toHaveBeenCalledTimes(18);
    f.root.querySelector('[data-study-new]').click();
    f.root.querySelector('[data-study-restore]').click();
    await vi.waitFor(() => expect(f.root.textContent).toContain('Study complete'));
    expect(f.swarm.generate).toHaveBeenCalledTimes(18);
  } finally { f.dispose(); }
});
it('does not start without exclusive storage ownership', () => {
  const f = fixture(null);
  try {
    f.ready();
    expect(f.root.querySelector('[data-study-start]').disabled).toBe(true);
    expect(f.root.textContent).toContain('already open in another tab');
    expect(f.swarm.generate).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});
