import { afterEach, expect, it, vi } from 'vitest';
import { bindTraining, renderTraining } from '../../self/ui/pool-home/lora-training.js';
import { createTrainingWorker } from '../../self/host/lora-training.js';

const cleanup = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); document.body.replaceChildren(); });
function view(candidate = null) {
  const root = document.createElement('div'); root.innerHTML = renderTraining(); document.body.append(root);
  let listener;
  const training = { policy: { maxInputBytes: 1024 }, getCandidate: () => candidate,
    getState: () => ({ phase: candidate ? 'completed' : 'idle', busy: false }),
    subscribe(fn) { listener = fn; fn(this.getState()); return vi.fn(); },
    run: vi.fn(async input => { if (!input.consent) throw Error('Approve training first'); return { json: '{}', weights: new ArrayBuffer(1) }; }),
    stop: vi.fn(async () => {}), connect: vi.fn(async () => {}), contribute: vi.fn(async () => {}),
    peers: () => [{ id: 'peer-a', name: '<untrusted name>' }] };
  cleanup.push(bindTraining(root, training));
  const find = name => root.querySelector(`[data-lora-${name}]`);
  const selectFile = async (text, size = text.length) => {
    Object.defineProperty(find('file'), 'files', { configurable: true, value: [{ size, text: async () => text }] });
    find('file').dispatchEvent(new Event('change')); await vi.waitFor(() => expect(find('file').disabled).toBe(false));
  };
  return { root, training, find, selectFile, state: value => listener(value) };
}
it('passes explicit consent and selected contributors, and never activates the result', async () => {
  const f = view(); await f.selectFile('[{"inputIds":[1],"targetIds":[2],"supervisedTokenCount":1}]');
  f.find('local').click(); await vi.waitFor(() => expect(f.find('error').textContent).toMatch('Approve'));
  f.find('consent').checked = true; f.find('connect').click();
  await vi.waitFor(() => expect(f.root.querySelector('[data-lora-peer]')).toBeTruthy());
  expect(f.find('peers').textContent).toContain('<untrusted name>');
  f.root.querySelector('[data-lora-peer]').checked = true; f.find('pool').click();
  await vi.waitFor(() => expect(f.training.run).toHaveBeenLastCalledWith(expect.objectContaining({ consent: true, peers: ['peer-a'] })));
  await vi.waitFor(() => expect(f.find('downloads').hidden).toBe(false));
});
it('blocks oversized files and keeps stop available while GPU work settles', async () => {
  const f = view(); await f.selectFile('[]', 2048);
  expect(f.find('error').textContent).toMatch('allowance');
  f.find('local').click(); await vi.waitFor(() => expect(f.find('error').textContent).toMatch('Choose training'));
  expect(f.training.run).not.toHaveBeenCalled();
  f.state({ phase: 'stopping', busy: true });
  expect(f.find('local').disabled).toBe(true); expect(f.find('stop').disabled).toBe(false);
  f.find('stop').click(); await vi.waitFor(() => expect(f.training.stop).toHaveBeenCalledOnce());
});
it('restores export controls when the training view is reopened', () => {
  const f = view({ json: '{}', weights: new ArrayBuffer(1) });
  expect(f.find('downloads').hidden).toBe(false);
});
it('waits for a cancelled worker command to settle before closing its GPU owner', async () => {
  let worker;
  class FakeWorker extends EventTarget {
    constructor() { super(); worker = this; this.messages = []; }
    postMessage(data) { this.messages.push(data); }
    terminate = vi.fn();
    reply(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
  }
  const executor = createTrainingWorker({ WorkerClass: FakeWorker }), controller = new AbortController();
  let settled = false;
  const pending = executor.request('step', {}, { signal: controller.signal }).finally(() => { settled = true; });
  controller.abort(); await Promise.resolve();
  expect(settled).toBe(false); expect(worker.messages.at(-1)).toEqual({ action: 'cancel' });
  worker.reply({ id: 1, result: { loss: 1 } }); await pending;
  const closing = executor.close(); expect(worker.terminate).not.toHaveBeenCalled();
  worker.reply({ id: 2 }); await closing; expect(worker.terminate).toHaveBeenCalledOnce();
});
