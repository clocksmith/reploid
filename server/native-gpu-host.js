import { requireValue } from './native-host-utils.js';

/** The standalone host owns the Node provider and the only device in this
 * process. Final close follows resident settlement; stopping contribution alone
 * keeps the provider reusable. No private Doppler imports are needed. */
export function createNativeGpuHost(loadProvider, { backend = process.platform === 'darwin' ? 'metal' : 'vulkan',
  loadTooling = () => import('dopplerx/tooling') } = {}) {
  requireValue(['metal', 'vulkan'].includes(backend), 'Native GPU backend must be metal or vulkan');
  let opening = null, closing = null, restore = null, retirement = null, stopped = false;
  let ownedDevice = null, lost = null, queueSettled = false, queueRejected = false, lossResolved = false, poolDestroyed = false, deviceDestroyed = false;
  const retire = () => retirement ||= (async () => {
    await opening?.catch(() => {});
    if (!restore) return;
    const { getDevice, destroyBufferPool } = await loadTooling();
    ownedDevice ||= getDevice();
    if (!ownedDevice) return;
    // Capture this device's loss completion before destruction can clear the runtime handle.
    if (!lost) {
      requireValue(typeof ownedDevice.lost?.then === 'function', 'Native device loss settlement promise is unavailable');
      lost = Promise.resolve(ownedDevice.lost).then(value => { lossResolved = true; return { value }; }, error => ({ error }));
    }
    if (!queueSettled) {
      // The first queue failure remains observable. An explicit retry may settle
      // an actually lost device even if its queue barrier permanently rejects.
      if (queueRejected && lossResolved) queueSettled = true;
      else {
        try { await ownedDevice.queue.onSubmittedWorkDone(); queueSettled = true; }
        catch (error) { queueRejected = true; throw error; }
      }
    }
    if (!poolDestroyed) { destroyBufferPool(ownedDevice); poolDestroyed = true; }
    if (!deviceDestroyed) { ownedDevice.destroy(); deviceDestroyed = true; }
    const completion = await lost;
    if ('error' in completion) throw completion.error;
  })().catch(error => { retirement = null; throw error; });
  return Object.freeze({
    open() {
      if (stopped) throw new Error('Native GPU host is closing');
      if (!opening) opening = (async () => {
        requireValue(!globalThis.navigator?.gpu, 'Native GPU host cannot replace a borrowed provider');
        const provider = await loadProvider();
        const saved = new Map(Object.keys(provider.globals).concat('navigator')
          .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
        restore = () => { for (const [key, descriptor] of saved) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        } };
        try {
          Object.assign(globalThis, provider.globals);
          Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: provider.create(['backend=' + backend]) } });
        } catch (error) { restore(); restore = null; throw error; }
      })().catch(error => { opening = null; throw error; });
      return opening;
    },
    close() {
      if (closing) return closing;
      stopped = true;
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native GPU ownership settlement exceeded 10000ms; provider retained')), 10000);
      });
      // No forced GC or sleep: navigator.gpu keeps the Dawn instance reachable
      // through queue completion, pool/device destruction and the exact lost promise.
      closing = Promise.race([retire(), deadline]).then(() => {
        restore?.(); restore = null;
      }).catch(error => { closing = null; throw error; }).finally(() => clearTimeout(timer));
      return closing;
    }
  });
}
