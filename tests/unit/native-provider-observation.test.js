import { test, expect } from 'vitest';
import { observeNativeProviderLibraries } from '../fixtures/native-provider-observation.js';
test('kernel vDSO is retained separately while every file-backed native library is hashed', async () => {
  const reads = [];
  const observed = await observeNativeProviderLibraries(['linux-vdso.so.1', '/app/webgpu/linux.node', '/lib/libvulkan.so'], async path => {
    reads.push(path); return Buffer.from('actual library bytes');
  });
  expect(reads).toEqual(['/app/webgpu/linux.node', '/lib/libvulkan.so']);
  expect(observed.libraries.every(row => row.sha256.length === 64 && row.bytes > 0)).toBe(true);
  expect(observed.virtualLibraries).toEqual([{ name: 'linux-vdso.so.1', kind: 'kernel-virtual-dso', fileHashAvailable: false }]);
});
test('missing file-backed library and unknown relative library fail closed', async () => {
  await expect(observeNativeProviderLibraries(['/app/webgpu/missing.node'], async () => { throw Error('ENOENT'); })).rejects.toThrow('ENOENT');
  await expect(observeNativeProviderLibraries(['unresolved.so'], async () => Buffer.from('x'))).rejects.toThrow('Unresolved');
  await expect(observeNativeProviderLibraries(['linux-vdso.so.1'])).rejects.toThrow('WebGPU library');
});
