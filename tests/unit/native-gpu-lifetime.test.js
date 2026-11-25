// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ device: null, destroyPool: vi.fn() }));
vi.mock('dopplerx/tooling', () => ({ getDevice: () => state.device, destroyBufferPool: state.destroyPool }));
import { createNativeGpuHost } from '../../server/native-participant.js';
import { withGpuMemoryCheck } from '../../server/native-gpu-host.js';
import { classifySoloFailure } from '../../scripts/stage1/solo-failure.js';
const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
afterEach(() => {
  vi.useRealTimers(); state.device = null; state.destroyPool.mockReset();
  if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
async function fixture() {
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{hostMarker:true}});
  const lost = deferred(), provider = { requestAdapter(){} };
  const device = {queue:{onSubmittedWorkDone:vi.fn(async()=>{})},lost:lost.promise,destroy:vi.fn()};
  state.device = device;
  const host = createNativeGpuHost(async()=>({globals:{},create:()=>provider})); await host.open();
  return {host,provider,device,lost};
}
it('keeps the provider reachable until the exact owned device lost event settles', async () => {
  const f = await fixture(); let completed = false;
  const first = f.host.close(); expect(f.host.close()).toBe(first); first.then(()=>{completed=true;});
  await vi.waitFor(()=>expect(f.device.destroy).toHaveBeenCalledOnce());
  state.device = null; // Runtime invalidation cannot replace the already captured promise.
  expect(completed).toBe(false); expect(navigator.gpu).toBe(f.provider);
  f.lost.resolve({reason:'destroyed'}); await first;
  expect(navigator.hostMarker).toBe(true); expect(navigator.gpu).toBeUndefined();
});
it('times out without removing provider reachability and explicitly retries after later settlement', async () => {
  vi.useFakeTimers(); const f = await fixture();
  const first = f.host.close(), outcome = first.then(value => ({value}), error => ({error}));
  await vi.advanceTimersByTimeAsync(10001); expect((await outcome).error?.message).toMatch(/settlement/);
  expect(navigator.gpu).toBe(f.provider); expect(f.device.destroy).toHaveBeenCalledOnce();
  expect(()=>f.host.open()).toThrow('closing');
  f.lost.resolve({reason:'destroyed'}); await Promise.resolve();
  expect(navigator.gpu).toBe(f.provider);
  await f.host.close(); expect(navigator.hostMarker).toBe(true);
  expect(f.device.destroy).toHaveBeenCalledOnce(); expect(state.destroyPool).toHaveBeenCalledOnce();
});
it('retains provider after queue rejection and retries that boundary before destroying device', async () => {
  const f = await fixture(); f.device.queue.onSubmittedWorkDone.mockRejectedValueOnce(Error('queue unknown'));
  await expect(f.host.close()).rejects.toThrow('queue unknown');
  expect(navigator.gpu).toBe(f.provider); expect(f.device.destroy).not.toHaveBeenCalled();
  const retry = f.host.close();
  await vi.waitFor(()=>expect(f.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2));
  f.lost.resolve({reason:'destroyed'}); await retry;
  expect(f.device.destroy).toHaveBeenCalledOnce(); expect(navigator.hostMarker).toBe(true);
});
it('never substitutes another runtime device for rejected owned loss settlement', async () => {
  const f = await fixture();
  f.device.lost = Promise.reject(Error('lost settlement rejected'));
  await expect(f.host.close()).rejects.toThrow('lost settlement rejected');
  state.device = {lost:Promise.resolve({reason:'destroyed'}),queue:{onSubmittedWorkDone:vi.fn()},destroy:vi.fn()};
  await expect(f.host.close()).rejects.toThrow('lost settlement rejected');
  expect(navigator.gpu).toBe(f.provider);
  expect(f.device.destroy).toHaveBeenCalledOnce(); expect(state.device.destroy).not.toHaveBeenCalled();
});

it('retains the first queue failure but explicit retry can retire the confirmed lost owner', async () => {
  const f = await fixture(); const primary = Error('queue permanently rejects');
  f.device.queue.onSubmittedWorkDone.mockRejectedValue(primary);
  f.lost.resolve({reason:'unknown',message:'actual device loss'});
  await expect(f.host.close()).rejects.toBe(primary);
  expect(navigator.gpu).toBe(f.provider); expect(f.device.destroy).not.toHaveBeenCalled();
  await f.host.close();
  expect(navigator.hostMarker).toBe(true);
  expect(f.device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
  expect(f.device.destroy).toHaveBeenCalledOnce(); expect(state.destroyPool).toHaveBeenCalledOnce();
});

it('records an allocation the device refused, from the first device the provider creates', async () => {
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{}});
  class GPUOutOfMemoryError extends Error {}
  class GPUValidationError extends Error {}
  const device = Object.assign(new EventTarget(), {queue:{onSubmittedWorkDone:vi.fn(async()=>{})}});
  const adapter = {requestDevice: async () => device};
  const provider = {requestAdapter: async () => adapter};
  const host = createNativeGpuHost(async()=>({globals:{},create:()=>provider}));
  const gpu = await host.open();
  expect(navigator.gpu).toBe(provider);
  expect(await (await navigator.gpu.requestAdapter()).requestDevice()).toBe(device);
  await (await navigator.gpu.requestAdapter()).requestDevice(); // The same device is watched once.
  const report = error => device.dispatchEvent(Object.assign(new Event('uncapturederror'), {error}));
  // The invalid-buffer errors that follow a refusal are consequences, not memory failures.
  report(new GPUValidationError('[Invalid Buffer] is invalid due to a previous error.'));
  await expect(withGpuMemoryCheck(gpu, async () => 'loaded')).resolves.toBe('loaded');
  await expect(withGpuMemoryCheck(gpu, async () => {
    report(new GPUOutOfMemoryError('\nvkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY\n - While calling [Device].CreateBuffer'));
  })).rejects.toMatchObject({ code: 'GPU_OUT_OF_MEMORY',
    detail: 'vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY\n- While calling [Device].CreateBuffer' });
  expect(host.outOfMemory()).toEqual({ count: 1, message: 'vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY\n- While calling [Device].CreateBuffer', liveBytes: null });
  expect(device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
});

it('latches the first refusal on a device with every line and the bytes then allocated', async () => {
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{}});
  class GPUOutOfMemoryError extends Error {}
  const device = Object.assign(new EventTarget(), {queue:{onSubmittedWorkDone:async()=>{}},
    createBuffer: descriptor => ({size: descriptor.size, destroy() {}})});
  const host = createNativeGpuHost(async()=>({globals:{},create:()=>({requestAdapter: async () => ({requestDevice: async () => device})})}));
  const gpu = await host.open();
  await (await navigator.gpu.requestAdapter()).requestDevice();
  const report = message => device.dispatchEvent(Object.assign(new Event('uncapturederror'), {error: new GPUOutOfMemoryError(message)}));
  const first = 'Out of memory\n - While calling [Device].CreateBuffer([BufferDescriptor "weights"] size: 4096)';
  await expect(withGpuMemoryCheck(gpu, async () => {
    device.createBuffer({size: 1024}).destroy();
    device.createBuffer({size: 2048});
    device.createBuffer({size: 4096}); // Refused, but Dawn still returns a buffer.
    report(first);
    device.createBuffer({size: 1 << 20}); // The loader keeps going; the latch does not move.
    report('Out of memory\n - a later refusal');
  })).rejects.toMatchObject({ code: 'GPU_OUT_OF_MEMORY', liveBytesAtFailure: 6144,
    detail: 'Out of memory\n- While calling [Device].CreateBuffer([BufferDescriptor "weights"] size: 4096)' });
  expect(host.outOfMemory()).toMatchObject({ count: 2, liveBytes: 6144 });
  const failure = classifySoloFailure(Object.assign(await withGpuMemoryCheck(gpu, async () => report('again')).catch(error => error),
    { stage1During: 'whole-model-load', stage1Memory: { peakBytes: 1 << 30 } }), { requiredBytes: 1 << 30 });
  expect(failure).toMatchObject({ failedBufferBytes: 4096, allocatedBeforeFailureBytes: 2048 });
  expect(host.outOfMemory().message.length).toBeLessThanOrEqual(500);
});

it('asks Dawn for Direct3D 12 on Windows, Metal on macOS and Vulkan elsewhere', async () => {
  const { nativeGpuBackend, createNativeGpuHost: createHost } = await import('../../server/native-gpu-host.js');
  expect(['win32', 'darwin', 'linux'].map(platform => nativeGpuBackend(platform, ''))).toEqual(['d3d12', 'metal', 'vulkan']);
  expect(nativeGpuBackend('win32', 'vulkan')).toBe('vulkan');
  expect(() => nativeGpuBackend('win32', 'opengl')).toThrow('REPLOID_GPU_BACKEND must be metal, vulkan or d3d12');
  let asked = null;
  const host = createHost(async () => ({ globals: {}, create: args => { asked = args; return {}; } }), { backend: 'd3d12' });
  await host.open();
  expect(asked).toEqual(['backend=d3d12']);
  expect(() => createHost(async () => ({}), { backend: 'opengl' })).toThrow('metal, vulkan or d3d12');
});

