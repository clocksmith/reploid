import { requireValue } from './native-host-utils.js';

/** The standalone host owns the Node provider and the only device in this
 * process. Final close follows resident settlement; stopping contribution alone
 * keeps the provider reusable. No private Doppler imports are needed. */
export function createNativeGpuHost(loadProvider, { backend = process.platform === 'darwin' ? 'metal' : 'vulkan',
  loadTooling = () => import('dopplerx/tooling') } = {}) {
  requireValue(['metal', 'vulkan'].includes(backend), 'Native GPU backend must be metal or vulkan');
  let opening = null, closing = null, restore = null, retirement = null, stopped = false;
  let ownedDevice = null, lost = null, queueSettled = false, queueRejected = false, lossResolved = false, poolDestroyed = false, deviceDestroyed = false;
  // Dawn reports a refused allocation as an uncaptured device error and still returns a buffer object, so a
  // model load can finish with weights missing and keep allocating after the refusal. Every device this provider
  // creates is watched from creation: the first refusal on a device is latched with the bytes then allocated on it,
  // and later errors on that device do not replace it.
  const memory = { count: 0, message: null, liveBytes: null }, watched = new Set(), adapters = new WeakSet();
  const watchDevice = device => {
    if (typeof device?.addEventListener !== 'function' || watched.has(device)) return device;
    watched.add(device);
    // Unknown, not zero, when the device cannot be counted.
    let liveBytes = typeof device.createBuffer === 'function' ? 0 : null, first = null;
    if (liveBytes !== null) {
      const createBuffer = device.createBuffer.bind(device);
      device.createBuffer = descriptor => {
        const buffer = createBuffer(descriptor), size = Number(descriptor?.size);
        if (!buffer || !Number.isSafeInteger(size) || size < 0) return buffer;
        liveBytes += size;
        if (typeof buffer.destroy === 'function') {
          const destroy = buffer.destroy.bind(buffer);
          let live = true;
          buffer.destroy = () => { destroy(); if (live) { live = false; liveBytes -= size; } };
        }
        return buffer;
      };
    }
    device.addEventListener('uncapturederror', event => {
      if (event?.error?.constructor?.name !== 'GPUOutOfMemoryError') return;
      memory.count += 1;
      // Keep every line (bounded): the descriptor line that states the refused size follows the first one.
      first ??= { message: String(event.error.message || '').split('\n').map(line => line.trim()).filter(Boolean).join('\n')
        .slice(0, 500) || 'out of memory', liveBytes };
      memory.message = first.message; memory.liveBytes = first.liveBytes;
    });
    return device;
  };
  const watchProvider = gpu => {
    if (typeof gpu?.requestAdapter !== 'function') return gpu;
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    gpu.requestAdapter = async (...args) => {
      const adapter = await requestAdapter(...args);
      if (typeof adapter?.requestDevice === 'function' && !adapters.has(adapter)) {
        adapters.add(adapter);
        const requestDevice = adapter.requestDevice.bind(adapter);
        adapter.requestDevice = async (...options) => watchDevice(await requestDevice(...options));
      }
      return adapter;
    };
    return gpu;
  };
  const access = Object.freeze({
    outOfMemory: () => ({ ...memory }),
    // Errors for submitted work are delivered by the time the queue reports that work done.
    async settle() { for (const device of watched) await device.queue?.onSubmittedWorkDone?.().catch(() => {}); }
  });
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
          Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: watchProvider(provider.create(['backend=' + backend])) } });
        } catch (error) { restore(); restore = null; throw error; }
        return access;
      })().catch(error => { opening = null; throw error; });
      return opening;
    },
    outOfMemory: access.outOfMemory,
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

/** Runs one model load and fails it when the device refused an allocation meanwhile. `gpu` is what `open()` resolved to. */
export async function withGpuMemoryCheck(gpu, load) {
  const before = gpu?.outOfMemory?.().count ?? 0;
  const result = await load();
  await gpu?.settle?.();
  const after = gpu?.outOfMemory?.();
  if (after && after.count > before) {
    // `liveBytesAtFailure` counts the refused buffer itself (Dawn still returns it) and anything created before the
    // error was delivered; it is the device's allocation when the refusal was reported, not the load's later peak.
    throw Object.assign(new Error('This computer\'s GPU ran out of memory while loading the model'),
      { code: 'GPU_OUT_OF_MEMORY', detail: after.message, liveBytesAtFailure: after.liveBytes ?? null });
  }
  return result;
}
