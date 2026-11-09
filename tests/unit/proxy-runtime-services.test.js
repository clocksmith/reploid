// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProxyRuntimeServices } from '../../server/proxy-runtime-services.js';

afterEach(() => vi.useRealTimers());
it('does not start a managed process when shutdown overtakes initialization', async () => {
  vi.useFakeTimers();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-monitor-test-'));
  const status = Promise.withResolvers(), spawnProcess = vi.fn();
  const service = createProxyRuntimeServices({ localEndpoint: 'http://test.invalid', autoStartOllama: true,
    logDirectory: directory, fetchImpl: () => status.promise,
    execCommand: async () => ({ stdout: '{}' }), spawnProcess });
  try {
    expect(spawnProcess).not.toHaveBeenCalled();
    const startup = service.start();
    expect(service.start()).toBe(startup);
    const closed = service.close();
    status.resolve({ ok: false });
    await closed;
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(service.monitoring.enabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => service.start()).toThrow('closed');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
