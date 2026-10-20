// @vitest-environment node
// Real participant, automatic retirement and SQLite epochs; transport/GPU are injected.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openNativeCanonicalEpochs } from '../../server/native-canonical-epochs.js';
const ports = vi.hoisted(() => ({ resident: null, mesh: null, networks: [], files: null }));
vi.mock('doppler-gpu/partitions', () => ({
  canonicalGenerationIdentity: () => ({ executionIdentity: 'execution' }), metadataDigest: () => 'stage',
  tokenDigest() {}, validateResidentAttemptIdentity() {}, residentAttemptDigest() {}, residentPublicationDecisionDigest() {},
  validateExecutionPublication() {}, validateAdmissionPublication() {}, configureDeviceMemoryBudget() {},
  createLayerPartitionPlan: () => ({ vocabSize: 100 }), hashLayerPartitionPlan: () => 'plan',
  createManifestResidentPartitionFactory: value => value, inspectDeviceMemory: () => ({})
}));
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery: ({ catalog }) => ({ getModels: () => [], refresh: async () => {}, close: async () => {},
    getSnapshot: () => [{ available: true, participantId: 'peer:' + '0'.repeat(24), transportId: 'remote',
      description: { phase: 'ready', index: 0, offer: { id: catalog[0].id, identity: catalog[0].identity } } }] })
}));
vi.mock('../../packages/reploid/src/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ onMessage() {}, offMessage() {}, sendToPeer() {}, getConnectedPeers: () => [], disconnect() {} }) }));
vi.mock('../../packages/reploid/src/mesh/index.js', async original => ({ ...await original(),
  createLegacyGenerationMesh: ({ ports: input }) => { ports.mesh.connect.mockImplementation(async () => { input.createTransport(); }); return ports.mesh; },
  createPartitionNetwork: () => { const network = { close: vi.fn(async () => {}) }; ports.networks.push(network); return network; },
  createResidentPartition: () => ports.resident,
  createPartitionStageCommitAuthority: () => ({ close() {} })
}));
vi.mock('../../server/native-model-files.js', () => ({ createNativeModelFiles: async () => ports.files }));
import { createNativeParticipant } from '../../server/native-participant.js';
const roots = [], cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(close => close())); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-owner-retry-')); roots.push(directory);
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  ports.networks = []; ports.mesh = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  ports.files = { close: vi.fn(async () => {}), custodyCertificate: async () => null, preparePartitionSource: async () => ({
    manifest: { modelId: 'fixture', architecture: {}, inference: { session: { compute: { defaults: { activationDtype: 'f32' } } } } },
    storage: { close: vi.fn(async () => {}) }, getReceipt: () => ({}) }) };
  ports.resident = { index: 1, prepare: vi.fn(async () => {}), close: vi.fn(async () => {}),
    getState: () => ({ descriptor: { ready: true }, reservations: { active: 0, availableSlots: 1, closed: false } }) };
  const participant = await createNativeParticipant({ identity, rtc: { RTCPeerConnection() {} }, WebSocket() {},
    model: { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64), partitionSplitLayer: 2,
      canonicalGeneration: { policy: {}, executionIdentity: 'execution' } },
    modelDirectory: '/unused', cacheDirectory: directory, nativeGpu: async () => {},
    canonical: { epochDirectory: directory }, signalingUrl: 'ws://localhost:1', roomId: 'mesh', roomToken: 's'.repeat(32) });
  cleanups.push(() => participant.close()); await participant.contribute(true);
  expect(participant.getState().phase).toBe('ready');
  const scope = { directory, participantId: identity.peerId, meshId: 'mesh' };
  const record = () => { const db = new DatabaseSync(path.join(directory, 'canonical-epochs.sqlite')); try { return JSON.parse(db.prepare('SELECT record FROM epochs WHERE id=1').get().record); } finally { db.close(); } };
  return { participant, scope, record };
}
it('retains epoch owner after failed participant close, coalesces overlap and retries retirement', async () => {
  const f = await fixture(); const pendingOwner = f.record().pendingOwner; expect(pendingOwner).toMatch(/^[a-f0-9]{32}$/);
  ports.resident.close.mockRejectedValueOnce(Error('resident cleanup unknown'));
  const first = f.participant.close(); expect(f.participant.close()).toBe(first);
  await expect(first).rejects.toThrow('did not settle');
  expect(f.record().pendingOwner).toBe(pendingOwner);
  await expect(openNativeCanonicalEpochs(f.scope)).rejects.toThrow('ownership is unsettled');
  await f.participant.close(); expect(f.record().pendingOwner).toBeNull();
  const replacement = await openNativeCanonicalEpochs(f.scope); replacement.close();
  expect(ports.resident.close).toHaveBeenCalledTimes(2);
  expect(ports.files.close).toHaveBeenCalledOnce(); expect(ports.mesh.close).toHaveBeenCalledOnce();
});
it('a synchronous owner close cannot skip other owners or resident settlement', async () => {
  const f = await fixture(); ports.networks[0].close.mockImplementationOnce(() => { throw Error('sync transport close'); });
  await expect(f.participant.close()).rejects.toThrow('did not settle');
  expect(ports.resident.close).toHaveBeenCalledOnce(); expect(f.record().pendingOwner).toBeNull();
  expect(ports.files.close).toHaveBeenCalledOnce(); expect(ports.mesh.close).toHaveBeenCalledOnce();
  await f.participant.close(); expect(ports.resident.close).toHaveBeenCalledOnce();
});

it('keeps file and mesh owners open until pending resident cleanup completes', async () => {
  const f = await fixture(); let release;
  ports.resident.close.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const closing = f.participant.close();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(ports.files.close).not.toHaveBeenCalled(); expect(ports.mesh.close).not.toHaveBeenCalled();
  release(); await closing;
  expect(ports.files.close).toHaveBeenCalledOnce(); expect(ports.mesh.close).toHaveBeenCalledOnce();
});
it('reconciles a committed settlement on explicit participant retry without reclosing the resident', async () => {
  const f = await fixture(), owner = f.record().pendingOwner;
  const prepare = DatabaseSync.prototype.prepare; let fail = true;
  const spy = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (sql) {
    const statement = prepare.call(this, sql);
    if (sql !== 'COMMIT' || !fail) return statement;
    return { run(...args) { statement.run(...args); fail = false; throw Error('commit acknowledgement lost'); } };
  });
  try { await expect(f.participant.close()).rejects.toThrow('did not settle'); }
  finally { spy.mockRestore(); }
  expect(f.record()).toMatchObject({ pendingOwner: null, settledOwner: owner });
  await f.participant.close(); expect(ports.resident.close).toHaveBeenCalledOnce();
  const replacement = await openNativeCanonicalEpochs(f.scope); replacement.close();
});
