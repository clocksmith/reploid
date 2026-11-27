import { afterEach, expect, it, vi } from 'vitest';
import { createTrainingWorker } from '../../apps/poolday/host/lora-training.js';

const cleanup = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); document.body.replaceChildren(); });
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
