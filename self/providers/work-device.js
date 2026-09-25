/** Shared device admission. Running work owns its slot until cleanup settles. */
// One borrowed GPU operation per runtime service, shared by threads and suppliers.
// Cancellation removes a waiter; a running operation keeps its slot until settlement.
const queues = new WeakMap();
export async function withWorkDevice(service, signal, operation, onProgress = () => {}) {
  signal.throwIfAborted();
  let queue = queues.get(service);
  if (!queue) { queue = { busy: false, waiting: [] }; queues.set(service, queue); }
  await new Promise((resolve, reject) => {
    const waiter = { enter() {
      signal.removeEventListener('abort', abort);
      queue.busy = true; resolve();
    } };
    const remove = error => {
      queue.waiting = queue.waiting.filter(item => item !== waiter);
      signal.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = () => remove(signal.reason);
    if (!queue.busy) waiter.enter();
    else {
      queue.waiting.push(waiter);
      signal.addEventListener('abort', abort, { once: true });
      try { onProgress('Waiting for this device'); }
      catch (error) { remove(error); }
    }
  });
  try { signal.throwIfAborted(); return await operation(); }
  finally {
    queue.busy = false;
    queue.waiting.shift()?.enter();
  }
}
