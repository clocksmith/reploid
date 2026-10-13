import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = pathToFileURL(resolve(process.argv[2]) + '/');
const { BufferPool, BufferUsage, PersistentBufferSet } = await import(new URL('src/memory/buffer-pool.js', root));
const { DEFAULT_BUFFER_POOL_CONFIG } = await import(new URL('src/config/schema/buffer-pool.schema.js', root));
const { setDeviceMemoryBudget, markDeviceWeights, getDeviceMemorySnapshot } = await import(new URL('src/memory/device-budget.js', root));
const device = {
  lost: new Promise(() => {}), limits: { maxBufferSize: 4096, maxStorageBufferBindingSize: 4096 },
  queue: { onSubmittedWorkDone: async () => {} },
  createBuffer({ size, usage }) { return { size, usage, destroy() {} }; }
};
setDeviceMemoryBudget(device, 1024);
const pool = new BufferPool(false, structuredClone(DEFAULT_BUFFER_POOL_CONFIG), device);
const weight = pool.acquire(256, BufferUsage.STORAGE, 'synthetic-weight');
const retained = new PersistentBufferSet([weight]);
markDeviceWeights(device, [weight]);
assert.equal(pool.getStats().resources.retainedModel.bytes, 256);
// Exact loader.unload ordering: release active buffer, then remove persistence.
pool.release(weight);
retained.delete(weight);
await device.queue.onSubmittedWorkDone();
const released = { device: getDeviceMemorySnapshot(device), resources: pool.getStats().resources };
assert.equal(released.resources.retainedModel.count, 0);
assert.equal(released.resources.active.count, 0);
assert.equal(released.resources.deferredCleanup.count, 0);
assert.equal(released.resources.reusable.bytes, 256);
assert.equal(released.device.categories.weights, 256);
const reused = pool.acquire(256, BufferUsage.STORAGE, 'next-unrelated-owner');
assert.equal(reused, weight, 'Released weight storage is actually available to a new owner');
pool.release(reused);
pool.destroy();
await pool.settleDeferredDestruction();
assert.equal(getDeviceMemorySnapshot(device).liveBytes, 0);
console.log(JSON.stringify({ scope: 'CPU mock device, exact frozen archive modules; category is allocation provenance, not current model ownership', released, actualReuseIdentity: true, finalAllocatedBytes: 0 }, null, 2));
