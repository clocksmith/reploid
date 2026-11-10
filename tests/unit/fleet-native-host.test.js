// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { activeProviderRequests, openComputerIdentity, openFleetNativeHost } from '../../server/fleet/native-host.js';
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
