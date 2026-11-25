// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createNativeGpuHost, ensureWindowsVulkanLoader, nativeGpuBackends, selectNativeGpuBackend, windowsVulkanLoader } from '../../server/native-gpu-host.js';
import { dopplerGpuDeclarations, manifestGpuNeeds, modelGpuNeeds, remapAllowed } from '../../server/native-gpu-features.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const roots = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

const F16 = { modelId: 'fixture-f16', required: ['shader-f16', 'subgroups'], remappable: [] };
const adapter = (name, features) => ({ info: { description: name }, features: new Set(features), limits: {} });
// A Dawn stand-in: `create(['backend=X'])` gives a GPU whose adapter is `adapters[X]` (absent: none).
function provider(adapters) {
  const created = [];
  const create = args => {
    const backend = args[0].slice('backend='.length), gpu = { backend, requestAdapter: async () => adapters[backend] ?? null };
    created.push(gpu); return gpu;
  };
  return { created, load: async () => ({ globals: {}, create }) };
}
const open = async (adapters, options, request = { model: { id: 'fixture' } }) => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const fake = provider(adapters), reports = [];
  const host = createNativeGpuHost(fake.load, { resolveNeeds: async () => F16, prepareBackend: () => null, onBackend: report => reports.push(report), ...options });
  await host.open(request);
  return { host, fake, reports, chosen: navigator.gpu.backend };
};

it('tries the platform candidates in order: macOS Metal, Windows Direct3D 12 then Vulkan, Linux Vulkan', () => {
  expect(nativeGpuBackends('darwin', '')).toEqual(['metal']);
  expect(nativeGpuBackends('win32', '')).toEqual(['d3d12', 'vulkan']);
  expect(nativeGpuBackends('linux', '')).toEqual(['vulkan']);
  expect(nativeGpuBackends('win32', 'vulkan')).toEqual(['vulkan']);
  expect(() => nativeGpuBackends('win32', 'opengl')).toThrow('REPLOID_GPU_BACKEND must be metal, vulkan or d3d12');
});

it('on Windows keeps Direct3D 12 when it has every feature the model requires and does not probe Vulkan', async () => {
  const { fake, reports, chosen } = await open({ d3d12: adapter('Radeon', ['shader-f16', 'subgroups']), vulkan: adapter('Radeon', ['shader-f16', 'subgroups']) },
    { platform: 'win32' });
  expect(chosen).toBe('d3d12');
  expect(fake.created.map(gpu => gpu.backend)).toEqual(['d3d12']);
  expect(reports[0]).toMatchObject({ chosen: 'd3d12', remap: [], tried: [{ backend: 'd3d12', adapter: 'Radeon', missing: [] }] });
});

it('on Windows moves to Vulkan when Direct3D 12 lacks shader-f16 (Bee), even though Doppler could remap', async () => {
  const needs = { ...F16, remappable: ['shader-f16', 'subgroups'] };
  const { host, chosen } = await open({ d3d12: adapter('AMD Radeon(TM) Graphics', ['subgroups']), vulkan: adapter('AMD Radeon(TM) Graphics', ['shader-f16', 'subgroups']) },
    { platform: 'win32', resolveNeeds: async () => needs });
  expect(chosen).toBe('vulkan');
  expect(host.backendReport()).toMatchObject({ chosen: 'vulkan', remap: [], unmet: [], tried: [
    { backend: 'd3d12', missing: ['shader-f16'] }, { backend: 'vulkan', missing: [] }] });
});

it('takes the first adapter Doppler\'s remap can satisfy when none has the features, and the first adapter when none can be remapped', async () => {
  const lacking = { d3d12: adapter('D3D', ['subgroups']), vulkan: adapter('Vk', []) };
  const remapped = await open(lacking, { platform: 'win32', resolveNeeds: async () => ({ ...F16, remappable: ['shader-f16'] }) });
  expect(remapped.chosen).toBe('d3d12');
  expect(remapped.reports[0]).toMatchObject({ remap: ['shader-f16'], unmet: [] });
  const fixed = await open(lacking, { platform: 'win32' });
  expect(fixed.chosen).toBe('d3d12');
  expect(fixed.reports[0]).toMatchObject({ remap: [], unmet: ['shader-f16'], tried: [{ missing: ['shader-f16'] }, { missing: ['shader-f16', 'subgroups'] }] });
});

it('on macOS and Linux opens the one platform backend and reports what its adapter lacks', async () => {
  const mac = await open({ metal: adapter('Apple M3', ['shader-f16', 'subgroups']) }, { platform: 'darwin' });
  expect(mac.chosen).toBe('metal');
  const linux = await open({ vulkan: adapter('Radeon RX', ['subgroups']) }, { platform: 'linux' });
  expect(linux.chosen).toBe('vulkan');
  expect(linux.reports[0]).toMatchObject({ unmet: ['shader-f16'], tried: [{ backend: 'vulkan', missing: ['shader-f16'] }] });
});

it('keeps REPLOID_GPU_BACKEND and an explicit backend as the only candidate', async () => {
  vi.stubEnv('REPLOID_GPU_BACKEND', 'vulkan');
  const both = { d3d12: adapter('D3D', ['shader-f16', 'subgroups']), vulkan: adapter('Vk', []) };
  const overridden = await open(both, { platform: 'win32' });
  expect(overridden.chosen).toBe('vulkan');
  expect(overridden.fake.created.map(gpu => gpu.backend)).toEqual(['vulkan']);
  vi.unstubAllEnvs();
  const explicit = await open(both, { platform: 'win32', backend: 'vulkan' });
  expect(explicit.fake.created.map(gpu => gpu.backend)).toEqual(['vulkan']);
  expect(() => createNativeGpuHost(async () => ({}), { backend: 'opengl' })).toThrow('metal, vulkan or d3d12');
});

it('without a model, or when its needs cannot be read, opens the first candidate with an adapter', async () => {
  const none = await open({ d3d12: adapter('D3D', []), vulkan: adapter('Vk', ['shader-f16']) }, { platform: 'win32' }, {});
  expect(none.chosen).toBe('d3d12');
  expect(none.reports[0].needs).toBeNull();
  const unreadable = await open({ d3d12: adapter('D3D', []) }, { platform: 'win32', resolveNeeds: async () => { throw new Error('no registry'); } });
  expect(unreadable.chosen).toBe('d3d12');
  expect(unreadable.reports[0].needsError).toBe('no registry');
});

it('fails to open with every backend tried when no adapter exists at all, and can retry', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const adapters = {}, fake = provider(adapters);
  const host = createNativeGpuHost(fake.load, { platform: 'win32', resolveNeeds: async () => F16, prepareBackend: () => null });
  await expect(host.open({ model: { id: 'fixture' } })).rejects.toMatchObject({ code: 'GPU_ADAPTER_UNAVAILABLE',
    message: 'No GPU adapter found: d3d12 has no adapter: no d3d12 adapter found; vulkan has no adapter: no vulkan adapter found' });
  expect(navigator.gpu).toBeUndefined();
  adapters.vulkan = adapter('Vk', ['shader-f16', 'subgroups']);
  await host.open({ model: { id: 'fixture' } });
  expect(navigator.gpu.backend).toBe('vulkan');
  await expect(selectNativeGpuBackend({ backends: ['vulkan'], probe: async () => { throw new Error('Dawn failed'); } }))
    .rejects.toMatchObject({ tried: [{ backend: 'vulkan', adapter: null, error: 'Dawn failed' }] });
});

it('prepares the Windows Vulkan loader before Dawn opens Vulkan, and only there', async () => {
  const prepared = [];
  const prepareBackend = name => { prepared.push(name); return name === 'vulkan' ? { state: 'copied' } : null; };
  const { reports } = await open({ d3d12: adapter('D3D', []), vulkan: adapter('Vk', ['shader-f16', 'subgroups']) }, { platform: 'win32', prepareBackend });
  expect(prepared).toEqual(['d3d12', 'vulkan']);
  expect(reports[0].loaders).toEqual({ vulkan: { state: 'copied' } });
});

it('copies the system Vulkan loader beside Dawn once and leaves a matching copy alone', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-vulkan-')); roots.push(root);
  const system = path.join(root, 'Windows'), dawn = path.join(root, 'dist');
  await fs.mkdir(path.join(system, 'System32'), { recursive: true }); await fs.mkdir(dawn);
  const env = { SystemRoot: system };
  // path.win32 joins with backslashes; map them to this file system for the test.
  const local = name => name.replaceAll('\\', path.sep);
  const fsPort = { readFile: name => fs.readFile(local(name)), copyFile: (a, b) => fs.copyFile(local(a), local(b)),
    rename: (a, b) => fs.rename(local(a), local(b)), unlink: name => fs.unlink(local(name)) };
  const loader = windowsVulkanLoader({ env, dawnDirectory: dawn });
  expect(loader.fix).toBe(`copy "${loader.from}" "${loader.to}"`);
  expect(await ensureWindowsVulkanLoader({ env, dawnDirectory: dawn, fs: fsPort })).toMatchObject({ state: 'no-system-loader' });
  await fs.writeFile(local(loader.from), 'loader v1');
  expect(await ensureWindowsVulkanLoader({ env, dawnDirectory: dawn, fs: fsPort })).toMatchObject({ state: 'copied' });
  expect(await ensureWindowsVulkanLoader({ env, dawnDirectory: dawn, fs: fsPort })).toMatchObject({ state: 'present' });
  // A system loader updated by a driver install is copied again.
  await fs.writeFile(local(loader.from), 'loader v2');
  expect(await ensureWindowsVulkanLoader({ env, dawnDirectory: dawn, fs: fsPort })).toMatchObject({ state: 'copied' });
  expect(await fs.readFile(path.join(dawn, 'vulkan-1.dll'), 'utf8')).toBe('loader v2');
  expect(await fs.readdir(dawn)).toEqual(['vulkan-1.dll']);
  const refused = { ...fsPort, rename: async () => { throw Object.assign(new Error('in use'), { code: 'EBUSY' }); } };
  await fs.writeFile(local(loader.from), 'loader v3');
  expect(await ensureWindowsVulkanLoader({ env, dawnDirectory: dawn, fs: refused })).toMatchObject({ state: 'failed', error: 'in use' });
  expect(await fs.readdir(dawn)).toEqual(['vulkan-1.dll']);
});

it('reads required features from Doppler\'s kernel registry and its remap from the capability rules and kernel path policy', async () => {
  const declarations = dopplerGpuDeclarations(
    { ops: { a: { variants: { f16: { wgsl: 'gather_f16.wgsl', entryPoint: 'main', requires: ['shader-f16'] } } },
      b: { wgsl: 'q4.wgsl', entryPoint: 'gemv', requires: ['subgroups'] }, c: { wgsl: 'plain.wgsl', entryPoint: 'main', requires: [] } } },
    { capabilityTransforms: [{ kind: 'hardware-compatibility', match: { hasSubgroups: true, hasF16: false }, transforms: ['widenToF32Activations'] },
      { kind: 'explicit-lane', match: { hasSubgroups: false }, transforms: ['removeSubgroups'] }] });
  const manifest = { modelId: 'm', inference: { execution: { kernels: { embed: { kernel: 'gather_f16.wgsl', entry: 'main' },
    decode: { kernel: 'q4.wgsl', entry: 'gemv' }, norm: { kernel: 'plain.wgsl', entry: 'main' } } } } };
  expect(manifestGpuNeeds(manifest, declarations, null)).toEqual({ modelId: 'm', required: ['shader-f16', 'subgroups'], remappable: ['shader-f16'] });
  expect(manifestGpuNeeds(manifest, declarations, { onIncompatible: 'error' }).remappable).toEqual([]);
  expect(remapAllowed({ sourceScope: ['config'] })).toBe(false);
  expect(manifestGpuNeeds({ modelId: 'no-graph' }, declarations, null)).toBeNull();
  // The installed Doppler, on the catalog's 0.8B: f16 and subgroup kernels, remappable under its default policy;
  // the 27B's catalog policy refuses the remap.
  const small = await modelGpuNeeds({ model: catalog.find(model => model.id === 'qwen-3-5-0-8b-q4k-ef16-af32-vf16') });
  expect(small).toMatchObject({ required: ['shader-f16', 'subgroups'], remappable: ['shader-f16', 'subgroups'] });
  const large = await modelGpuNeeds({ model: catalog.find(model => model.id === 'qwen-3-8-27b-text-q4k-ef16-af32'), mode: 'partition' });
  expect(large).toMatchObject({ required: ['shader-f16', 'subgroups'], remappable: [] });
  expect(await modelGpuNeeds({ model: { id: 'unknown', identity: 'sha256:' + '0'.repeat(64), source: { files: [] } } })).toBeNull();
});
