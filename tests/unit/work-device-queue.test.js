// @vitest-environment node
import { it, expect } from 'vitest';
import { withWorkDevice, getWorkDeviceQueue } from '../../apps/poolday/providers/work-device.js';
it('reports only actual serial device occupancy and cancelled waiters, without exposing mutable state', async () => {
  const service = {}, signal = new AbortController().signal;
  expect(getWorkDeviceQueue(service)).toEqual({ capacity: 1, active: 0, queued: 0 });
  let finish;
  const running = withWorkDevice(service, signal, () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  const cancel = new AbortController();
  const waiting = withWorkDevice(service, cancel.signal, () => { throw Error('must not enter'); });
  const rejected = expect(waiting).rejects.toThrow('cancel waiter');
  expect(getWorkDeviceQueue(service)).toEqual({ capacity: 1, active: 1, queued: 1 });
  getWorkDeviceQueue(service).queued = 999;
  expect(getWorkDeviceQueue(service).queued).toBe(1);
  expect(getWorkDeviceQueue({}).active).toBe(0);
  cancel.abort(new Error('cancel waiter')); await rejected;
  expect(getWorkDeviceQueue(service)).toEqual({ capacity: 1, active: 1, queued: 0 });
  finish(); await running;
  expect(getWorkDeviceQueue(service)).toEqual({ capacity: 1, active: 0, queued: 0 });
});
