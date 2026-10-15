// @vitest-environment node
// The native participant hands its own admission records and custody deliveries to an explicitly
// configured earning port, needs the owner policy for it, and never lets a claim failure stop
// contribution. Transport, partitions and files are injected; earning-execution.test.js covers
// the claims themselves over HTTP.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';

const ports = vi.hoisted(() => ({ onChange: null, records: [], deliveries: [] }));
vi.mock('../../packages/reploid/src/mesh/index.js', async (original) => ({ ...await original(),
  createLegacyGenerationMesh: () => ({ connect: async () => {}, close: async () => {}, getSwarmSnapshot: () => ({}) }),
  createAutomaticPartitions: ({ onChange }) => {
    ports.onChange = onChange;
    return { getState: () => ({ phase: 'ready', reservations: { active: 0, records: structuredClone(ports.records) } }),
      contribute: async () => {}, stop: async () => {}, close: async () => {} };
  }
}));
vi.mock('../../server/native-model-files.js', () => ({ createNativeModelFiles: async () => ({
  close: async () => {}, announce: () => {}, custodyCertificate: async () => null, getState: () => ({}),
  getDeliveryEvidence: () => structuredClone(ports.deliveries)
}) }));
const { createNativeParticipant } = await import('../../server/native-participant.js');

const roots = [], cleanups = [];
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((close) => close()));
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function open(options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-earning-')); roots.push(directory);
  const participant = await createNativeParticipant({ identity: await createSigningIdentity({ algorithm: 'Ed25519' }),
    rtc: { RTCPeerConnection() {} }, WebSocket() {}, model: { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64) },
    modelDirectory: '/unused', cacheDirectory: directory, nativeGpu: async () => {}, signalingUrl: 'ws://localhost:1', roomId: 'mesh',
    roomToken: 's'.repeat(32), ...options });
  cleanups.push(() => participant.close());
  return participant;
}

it('requires the owner policy before an earning port is accepted', async () => {
  await expect(open({ earning: { observe: async () => ({}) } })).rejects.toThrow('Native earning requires the owner policy');
});

it('passes its own admission records and deliveries to the earning port on change and on poll, and survives its failures', async () => {
  const observe = vi.fn(async () => ({ stages: [], deliveries: [] }));
  const changes = [];
  const warn = vi.fn();
  const participant = await open({ owner: { summary: () => ({}) }, earning: { observe }, onChange: (state) => changes.push(state),
    logger: { warn, error() {}, log() {} } });
  ports.records = [{ participantId: 'peer', index: 0, phase: 'settled', identity: { attemptId: 'a1' } }];
  ports.deliveries = [{ role: 'supplier', transferId: 't1' }];
  ports.onChange({ phase: 'ready' });
  expect(changes).toEqual([{ phase: 'ready' }]);
  expect(observe).toHaveBeenLastCalledWith({ admissions: ports.records, deliveries: ports.deliveries });
  participant.announceFiles();
  expect(observe).toHaveBeenCalledTimes(2);
  observe.mockRejectedValueOnce(Object.assign(new Error('service unavailable'), { code: 'network_unavailable' }));
  ports.onChange({ phase: 'ready' });
  await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Earning claims deferred', 'network_unavailable'));
  expect(participant.getState().phase).toBe('ready');
});

it('observes nothing without an earning port', async () => {
  const changes = [];
  const participant = await open({ onChange: (state) => changes.push(state) });
  ports.onChange({ phase: 'ready' });
  participant.announceFiles();
  expect(changes).toEqual([{ phase: 'ready' }]);
});
