// @vitest-environment node
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { inspectNativeAdapter, readHostMemory, runDoctor } from '../../server/native-node-doctor.js';

const { requestAdapter, requestDevice } = vi.hoisted(() => ({ requestAdapter: vi.fn(), requestDevice: vi.fn() }));
vi.mock('webgpu', () => ({ create: () => ({ requestAdapter }) }));
afterEach(() => vi.resetAllMocks());

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
