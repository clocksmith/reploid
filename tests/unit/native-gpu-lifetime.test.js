// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ device: null, destroyPool: vi.fn() }));
vi.mock('doppler-gpu/tooling', () => ({ getDevice: () => state.device, destroyBufferPool: state.destroyPool }));
import { createNativeGpuHost } from '../../server/native-participant.js';
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
