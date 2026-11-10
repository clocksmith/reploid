// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { runFleetNativeCommands, includeRequesterPresence, activeProviderRequests, openComputerIdentity, openFleetNativeHost } from '../../server/fleet/native-host.js';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

it('retains a signing identity across process launches and refuses linked secret files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-native-')); roots.push(root);
  const file = path.join(root, 'identity.json'), first = await openComputerIdentity(file);
  expect((await openComputerIdentity(file)).peerId).toBe(first.peerId);
  await fs.symlink(file, path.join(root, 'linked.json'));
  await expect(openComputerIdentity(path.join(root, 'linked.json'))).rejects.toThrow('symbolic link');
});

it('keeps queued or unsettled stage work on its host and permits settled histories to stay idle', () => {
  expect(activeProviderRequests({ phase: 'executing' })).toBe(1);
  expect(activeProviderRequests({ reservations: { active: 1, records: [{ settledAt: null }] } })).toBe(1);
  expect(activeProviderRequests({ queue: { queued: 2 } })).toBe(2);
  expect(activeProviderRequests({ attempts: [{ phase: 'failed', cleanupSettledAt: null }] })).toBe(1);
  expect(activeProviderRequests({ unknownAttempts: [{}] })).toBe(1);
  expect(activeProviderRequests({ phase: 'ready', reservations: { active: 0, records: [{ settledAt: 123 }] },
    attempts: [{ phase: 'completed', cleanupSettledAt: 123 }] })).toBe(0);
});

it('refuses operator model configurations in the public pool before loading native modules', async () => {
  await expect(openFleetNativeHost({ configuration: { schema: 'reploid.fleet-native/v1', computerId: 'machine', name: 'Machine',
    models: [{ mode: 'whole-model' }], roomId: 'reploid-swarm-public' }, loadRtc: () => { throw Error('should not load'); } }))
    .rejects.toThrow('explicit private room');
});

it('reports a live requester without inventing local GPU capacity or another computer’s presence', () => {
  const rows = includeRequesterPresence([{ id: 'mac', online: false }, { id: 'miles', online: false }],
    { computerId: 'mac', activeRequests: 1, preparing: false, hardware: { freeHostBytes: 123 } }, 456);
  expect(rows[0]).toMatchObject({ online: true, requester: true, resident: null, activeRequests: 1, observedAt: 456 });
  expect(rows[0].freeGpuBytes).toBeUndefined(); expect(rows[1].online).toBe(false);
});

it('drains a daemon after stdin reaches EOF during asynchronous startup', async () => {
  const input = new PassThrough(), signals = new EventEmitter(); let closed = false;
  const host = { async select() { input.end(); await delay(10); }, async close() { closed = true; } };
  const running = runFleetNativeCommands({ host, input, signals, config: { initialModel: 0, daemon: true } });
  await delay(30); signals.emit('SIGTERM');
  await running; expect(closed).toBe(true); expect(signals.listenerCount('SIGTERM')).toBe(0);
});

it('closes and rejects immediately when daemon startup fails instead of hanging on the stop signal', async () => {
  const input = new PassThrough(), signals = new EventEmitter(); let closed = false;
  const host = { async select() { throw Error('startup failed'); }, async close() { closed = true; } };
  await expect(runFleetNativeCommands({ host, input, signals, config: { initialModel: 0, daemon: true } }))
    .rejects.toThrow('startup failed');
  expect(closed).toBe(true); expect(signals.listenerCount('SIGTERM')).toBe(0);
});
