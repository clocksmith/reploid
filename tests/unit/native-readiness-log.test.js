// @vitest-environment node
// The native host's opt-in readiness log: an absolute JSONL path, owner-only on creation, records in order, a line a
// crash cut short kept apart from the next record; and the participant passing each partition state and prepared
// resident to the recorder. Transport and partitions are injected.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openNativeReadinessLog } from '../../server/native-readiness-log.js';

const ports = vi.hoisted(() => ({ onChange: null }));
vi.mock('../../packages/reploid/src/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ onMessage() {}, offMessage() {}, sendToPeer() {}, getConnectedPeers: () => [], disconnect() {} }) }));
vi.mock('../../packages/reploid/src/mesh/index.js', async (original) => ({ ...await original(),
  createLegacyGenerationMesh: ({ ports: input }) => ({ connect: async () => { input.createTransport(); }, close: async () => {}, getSwarmSnapshot: () => ({}) }),
  createAutomaticPartitions: ({ onChange }) => {
    ports.onChange = onChange;
    return { getState: () => ({ phase: 'idle' }), contribute: async () => {}, stop: async () => {}, close: async () => {} };
  }
}));
vi.mock('../../server/native-model-files.js', () => ({ createNativeModelFiles: async () => ({
  close: async () => {}, announce: () => {}, custodyCertificate: async () => null, getState: () => ({}), getDeliveryEvidence: () => []
}) }));
const { createNativeParticipant } = await import('../../server/native-participant.js');

const roots = [], cleanups = [];
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((close) => close()));
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const directory = async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-readiness-')); roots.push(root); return root; };

it('appends records in order to an owner-only file and ends a line a crash cut short', async () => {
  await expect(openNativeReadinessLog({ file: 'relative.jsonl' })).rejects.toThrow('absolute file path');
  const file = path.join(await directory(), 'readiness.jsonl');
  const log = await openNativeReadinessLog({ file });
  for (let index = 0; index < 50; index++) log.write({ index });
  await log.close();
  if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  await fs.appendFile(file, '{"index":');
  const errors = [];
  const reopened = await openNativeReadinessLog({ file, onError: error => errors.push(error.message) });
  reopened.write({ index: 50 });
  await reopened.close();
  reopened.write({ index: 51 });
  expect(errors).toEqual(['Readiness log is closed']);
  const lines = (await fs.readFile(file, 'utf8')).split('\n');
  expect(lines.slice(0, 50).map(line => JSON.parse(line).index)).toEqual([...Array(50).keys()]);
  expect(lines.slice(50)).toEqual(['{"index":', '{"index":50}', '']);
});

it('passes every partition state to the readiness recorder and refuses an incomplete one', async () => {
  const options = { identity: await createSigningIdentity({ algorithm: 'Ed25519' }), rtc: { RTCPeerConnection() {} }, WebSocket() {},
    model: { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64) }, modelDirectory: '/unused', cacheDirectory: await directory(),
    nativeGpu: async () => {}, signalingUrl: 'ws://localhost:1', roomId: 'mesh', roomToken: 's'.repeat(32) };
  await expect(createNativeParticipant({ ...options, readiness: { observe() {} } })).rejects.toThrow('requires a readiness recorder');
  const readiness = { observe: vi.fn(), watchResident: vi.fn() }, changes = [];
  const participant = await createNativeParticipant({ ...options, readiness, onChange: state => changes.push(state) });
  cleanups.push(() => participant.close());
  ports.onChange({ phase: 'ready', offering: true });
  expect(changes).toEqual([{ phase: 'ready', offering: true }]);
  expect(readiness.observe).toHaveBeenCalledWith({ phase: 'ready', offering: true });
});
