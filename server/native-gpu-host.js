import { copyFile, readFile, rename, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { requireValue } from './native-host-utils.js';
import { modelGpuNeeds } from './native-gpu-features.js';

const BACKENDS = ['metal', 'vulkan', 'd3d12'];

/** The backends Dawn is asked for, in order. Windows tries Direct3D 12 first (always present), then Vulkan: some
 * Windows drivers expose shader-f16 only through Vulkan (Bee's AMD RDNA 2 integrated GPU reports it on Vulkan, not on
 * Direct3D 12). REPLOID_GPU_BACKEND names exactly one backend and turns the search off. */
export const nativeGpuBackends = (platform = process.platform, override = process.env.REPLOID_GPU_BACKEND) => {
  if (override) {
    requireValue(BACKENDS.includes(override), 'REPLOID_GPU_BACKEND must be metal, vulkan or d3d12');
    return [override];
  }
  return platform === 'darwin' ? ['metal'] : platform === 'win32' ? ['d3d12', 'vulkan'] : ['vulkan'];
};

const adapterName = adapter => adapter?.info?.description || adapter?.info?.device || adapter?.info?.vendor || 'adapter available';

/** Doppler asks for a high-performance adapter first, then the default; a probe asks the same way. */
export async function requestNativeAdapter(gpu) {
  for (const options of [{ powerPreference: 'high-performance' }, undefined]) {
    const adapter = await gpu.requestAdapter(options);
    if (adapter) return adapter;
  }
  return null;
}

/**
 * Tries `backends` in order with `probe(backend)` (resolving `{ adapter }`, adapter null when there is none) and picks
 * the first adapter with every feature in `needs.required`. When none has them all it picks the first adapter whose
 * missing features Doppler's capability remap can do without (`needs.remappable`), so an adapter with the features
 * natively is preferred over a remap even on a later backend; failing that, the first adapter at all (Doppler then
 * reports what it cannot run). Probing stops at the first full match. Returns `{ chosen, remap, unmet, tried, probed }`:
 * `tried` lists every backend probed with its adapter and the required features it lacks, or why it has none.
 * Throws with that list when no backend has an adapter.
 */
export async function selectNativeGpuBackend({ backends, probe, needs = null }) {
  const tried = [], probes = new Map();
  for (const backend of backends) {
    let probed = null, failure = null;
    try { probed = await probe(backend); } catch (error) { failure = error?.message || String(error); }
    const adapter = probed?.adapter ?? null;
    const missing = adapter ? (needs?.required ?? []).filter(feature => !adapter.features?.has?.(feature)) : [];
    tried.push({ backend, adapter: adapter ? adapterName(adapter) : null, missing,
      ...(adapter ? {} : { error: failure ?? `no ${backend} adapter found` }) });
    probes.set(backend, probed);
    if (adapter && missing.length === 0) return { chosen: backend, remap: [], unmet: [], tried, probed };
  }
  const remappable = row => row.missing.every(feature => needs?.remappable?.includes(feature));
  const row = tried.find(row => row.adapter && remappable(row)) ?? tried.find(row => row.adapter);
  if (!row) {
    throw Object.assign(new Error(`No GPU adapter found: ${describeNativeGpuTries(tried)}`), { code: 'GPU_ADAPTER_UNAVAILABLE', tried });
  }
  const remap = row.missing.filter(feature => needs?.remappable?.includes(feature));
  return { chosen: row.backend, remap, unmet: row.missing.filter(feature => !remap.includes(feature)), tried, probed: probes.get(row.backend) };
}

export const describeNativeGpuTries = tried => tried.map(row => `${row.backend} ${row.adapter
  ? `(${row.adapter}) ${row.missing.length ? 'lacks ' + row.missing.join(', ') : 'has every required feature'}`
  : `has no adapter: ${row.error}`}`).join('; ');

/** The Vulkan loader Dawn needs on Windows. Dawn opens `vulkan-1.dll` from its own directory and then by bare name
 * with LoadLibraryEx(LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS); Windows refuses a bare name
 * with those flags (error 87, invalid parameter), so the system loader is never reached and no environment variable,
 * PATH entry or DLL directory changes that. The node `webgpu` binding exposes no Dawn runtime search path either.
 * The one reliable route is the system loader's bytes beside the Dawn binary, which `npm ci` removes again. */
export function windowsVulkanLoader({ env = process.env, dawnDirectory = defaultDawnDirectory() } = {}) {
  const from = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'vulkan-1.dll');
  const to = dawnDirectory ? path.join(dawnDirectory, 'vulkan-1.dll') : null;
  return { from, to, fix: to ? `copy "${from}" "${to}"` : null };
}

function defaultDawnDirectory() {
  try { return path.join(path.dirname(createRequire(import.meta.url).resolve('webgpu')), 'dist'); }
  catch { return null; }
}

/** Copies the system Vulkan loader beside Dawn when the copy there is absent or differs; idempotent. Resolves
 * `{ state: 'present' | 'copied' | 'no-system-loader' | 'failed', from, to, fix, error? }` and never throws: Direct3D
 * 12 still works without it, and the backend report says why Vulkan had no adapter. */
export async function ensureWindowsVulkanLoader(options = {}) {
  const loader = windowsVulkanLoader(options), fs = options.fs ?? { copyFile, readFile, rename, unlink };
  if (!loader.to) return { state: 'failed', ...loader, error: 'the webgpu package is not installed' };
  try {
    const source = await fs.readFile(loader.from).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!source) return { state: 'no-system-loader', ...loader };
    const present = await fs.readFile(loader.to).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (present && Buffer.from(present).equals(Buffer.from(source))) return { state: 'present', ...loader };
    const temporary = `${loader.to}.${process.pid}.${Date.now()}.tmp`;
    try { await fs.copyFile(loader.from, temporary); await fs.rename(temporary, loader.to); }
    finally { await fs.unlink(temporary).catch(() => {}); }
    return { state: 'copied', ...loader };
  } catch (error) { return { state: 'failed', ...loader, error: error.message }; }
}

/** The standalone host owns the Node provider and the only device in this process. Final close follows resident
 * settlement; stopping contribution alone keeps the provider reusable. No private Doppler imports are needed.
 * `open({ model, mode, manifestBytes })` picks the backend once, for the first model it opens: the first candidate
 * whose adapter has the features that model's manifest requires (native-gpu-features.js). `backend` (or
 * REPLOID_GPU_BACKEND) fixes one backend; `backends` replaces the platform's candidate list. */
export function createNativeGpuHost(loadProvider, { backend = null, backends = null, platform = process.platform,
  resolveNeeds = modelGpuNeeds, prepareBackend = name => platform === 'win32' && name === 'vulkan' ? ensureWindowsVulkanLoader() : null,
  onBackend = () => {}, loadTooling = () => import('dopplerx/tooling') } = {}) {
  if (backend !== null) requireValue(BACKENDS.includes(backend), 'Native GPU backend must be metal, vulkan or d3d12');
  const candidates = backend !== null ? [backend] : backends ?? nativeGpuBackends(platform);
  requireValue(candidates.length > 0 && candidates.every(name => BACKENDS.includes(name)), 'Native GPU backends must be metal, vulkan or d3d12');
  let opening = null, closing = null, restore = null, retirement = null, stopped = false, selection = null;
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
    /** `request` names the model about to load (`{ model, mode, manifestBytes }`); without one, or when its needs
     * cannot be read, the first candidate with an adapter is used. */
    open(request = {}) {
      if (stopped) throw new Error('Native GPU host is closing');
      if (!opening) opening = (async () => {
        requireValue(!globalThis.navigator?.gpu, 'Native GPU host cannot replace a borrowed provider');
        const provider = await loadProvider();
        // Unreadable needs (an operator model without a bundled manifest, an older Doppler) pick the first adapter.
        let needs = null, needsError = null;
        if (request?.model) try { needs = await resolveNeeds(request); } catch (error) { needsError = error.message; }
        const loaders = {};
        // A single candidate (macOS, Linux, the override) is still probed: the report names its adapter and what it lacks.
        selection = await selectNativeGpuBackend({ backends: candidates, needs,
          probe: async name => {
            const prepared = await prepareBackend(name);
            if (prepared) loaders[name] = prepared;
            const gpu = provider.create(['backend=' + name]);
            return { gpu, adapter: await requestNativeAdapter(gpu) };
          } }).catch(error => { error.loaders = loaders; throw error; });
        const report = { chosen: selection.chosen, remap: selection.remap, unmet: selection.unmet, tried: selection.tried, needs,
          ...(needsError ? { needsError } : {}), loaders };
        selection.report = report; onBackend(structuredClone(report));
        const saved = new Map(Object.keys(provider.globals).concat('navigator')
          .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
        restore = () => { for (const [key, descriptor] of saved) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        } };
        try {
          Object.assign(globalThis, provider.globals);
          Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: watchProvider(selection.probed.gpu) } });
        } catch (error) { restore(); restore = null; throw error; }
        return access;
      })().catch(error => { opening = null; selection = null; throw error; });
      return opening;
    },
    /** What `open` tried and chose, or null before it has opened. */
    backendReport: () => (selection?.report ? structuredClone(selection.report) : null),
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
