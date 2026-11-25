// @vitest-environment node
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { inspectNativeAdapter, readHostMemory, runDoctor } from '../../server/native-node-doctor.js';

const { requestAdapter, requestDevice, create } = vi.hoisted(() => {
  const requestAdapter = vi.fn(), requestDevice = vi.fn();
  return { requestAdapter, requestDevice, create: vi.fn(() => ({ requestAdapter })) };
});
vi.mock('webgpu', () => ({ create }));
afterEach(() => { vi.resetAllMocks(); create.mockImplementation(() => ({ requestAdapter })); });

it('checks an actual signaling handshake with participant origin and enumerates the adapter without allocating a device', async () => {
  const origins = [];
  const messages = [];
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  server.on('connection', (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    expect(url.searchParams.get('scope')).toBe('public');
    expect(url.searchParams.get('roomId')).toBe('reploid-swarm-public');
    origins.push(req.headers.origin);
    socket.on('message', data => messages.push(data));
  });
  await once(server, 'listening');
  try {
    requestAdapter.mockResolvedValue({ info: { description: 'Test adapter' }, requestDevice });
    const result = await runDoctor({ signalingUrl: `ws://127.0.0.1:${server.address().port}/swarm`, origin: 'https://test.invalid' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('matches the pinned version');
    expect(result.text).toContain('Test adapter');
    expect(result.text).toContain('WebSocket handshake succeeded');
    expect(origins).toEqual(['https://test.invalid']);
    expect(messages).toEqual([]);
    expect(requestDevice).not.toHaveBeenCalled();
    expect(readHostMemory().totalBytes).toBeGreaterThan(0);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});

it('reports independent GPU and signaling failures while preserving successful local checks', async () => {
  requestAdapter.mockResolvedValue(null);
  const result = await runDoctor({ signalingUrl: 'https://unused.invalid' });
  expect(result.ok).toBe(false);
  expect(result.text).toMatch(/OK +Host RAM/);
  expect(result.text).toMatch(/FAIL +WebGPU adapter +no .* adapter found/);
  expect(result.text).toMatch(/FAIL +Signaling +expected a ws:/);
});


it('reads physical adapter limits without creating a device or treating a binding limit as total memory', async () => {
  requestAdapter.mockResolvedValue({ info: { description: 'Fixture' }, features: new Set(['shader-f16']),
    limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 1073741824, maxStorageBuffersPerShaderStage: 8 }, requestDevice });
  expect(await inspectNativeAdapter()).toMatchObject({ shaderF16: true, maxBufferSize: 2147483648,
    maxStorageBufferBindingSize: 1073741824, maxStorageBuffersPerShaderStage: 8 });
  expect(requestDevice).not.toHaveBeenCalled();
});

it('reports every backend tried, the features each lacks for the model and the one chosen', async () => {
  // Bee: Direct3D 12 on the integrated Radeon lacks shader-f16; Vulkan has it.
  const adapters = { d3d12: { info: { description: 'AMD Radeon(TM) Graphics' }, features: new Set(['subgroups']), limits: {} },
    vulkan: { info: { description: 'AMD Radeon(TM) Graphics' }, features: new Set(['shader-f16', 'subgroups']), limits: {} } };
  create.mockImplementation(([flag]) => ({ requestAdapter: async () => adapters[flag.slice('backend='.length)] ?? null }));
  const needs = { modelId: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16', required: ['shader-f16', 'subgroups'], remappable: ['shader-f16', 'subgroups'] };
  const report = await inspectNativeAdapter({ model: { id: needs.modelId }, platform: 'win32', resolveNeeds: async () => needs });
  expect(report).toMatchObject({ backend: 'vulkan', remap: [], unmet: [], tried: [
    { backend: 'd3d12', adapter: 'AMD Radeon(TM) Graphics', missing: ['shader-f16'] },
    { backend: 'vulkan', adapter: 'AMD Radeon(TM) Graphics', missing: [] }] });
  expect(create.mock.calls.map(([flags]) => flags[0])).toEqual(['backend=d3d12', 'backend=vulkan']);
  delete adapters.vulkan;
  const remapped = await inspectNativeAdapter({ model: { id: needs.modelId }, platform: 'win32', resolveNeeds: async () => needs });
  expect(remapped).toMatchObject({ backend: 'd3d12', remap: ['shader-f16'], tried: [{ backend: 'd3d12' }, { backend: 'vulkan', adapter: null }] });
  expect(requestDevice).not.toHaveBeenCalled();
});

it('prints each backend line in doctor output for the default model', async () => {
  requestAdapter.mockResolvedValue({ info: { description: 'Fixture GPU' }, features: new Set(['shader-f16', 'subgroups']), limits: {}, requestDevice });
  const result = await runDoctor({ signalingUrl: 'https://unused.invalid', model: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16' });
  expect(result.text).toContain('qwen-3-5-0-8b-q4k-ef16-af32-vf16 requires shader-f16, subgroups');
  expect(result.text).toMatch(/tried (metal|vulkan|d3d12): Fixture GPU, has every required feature/);
  expect(result.text).toMatch(/chosen (metal|vulkan|d3d12)/);
});
