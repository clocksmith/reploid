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

const ports = vi.hoisted(() => ({ onChange: null, records: [], deliveries: [], mesh: null, wholeGenerate: null }));
vi.mock('../../server/native-whole-model.js', () => ({ createNativeWholeModel: () => {
  let ready = false;
  ports.wholeGenerate = vi.fn(async () => ({ content: 'fixture' }));
  return { getState: () => ({ phase: ready ? 'ready' : 'idle', ready, adapterIdentities: [] }),
    getExecutionState: () => ({ phase: ready ? 'ready' : 'idle', modelIdentity: 'sha256:' + 'a'.repeat(64) }),
    generate: ports.wholeGenerate, contribute: async () => { ready = true; }, stop: async () => { ready = false; }, close: async () => { ready = false; } };
} }));
vi.mock('../../packages/reploid/src/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ onMessage() {}, offMessage() {}, sendToPeer() {}, getConnectedPeers: () => [], disconnect() {} }) }));
vi.mock('../../packages/reploid/src/mesh/index.js', async (original) => ({ ...await original(),
  createPeerGenerationMesh: ({ ports: input }) => { ports.mesh = input; return { connect: async () => { input.createTransport(); }, close: async () => {}, refreshAdvertisement() {}, getSwarmSnapshot: () => ({}) }; },
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

it('owns the explicitly supplied whole-model runtime through contribution, dispatch and cleanup', async () => {
  const whole = { getState: () => ({ ready: true, adapterIdentities: [] }), getExecutionState: () => ({ phase: 'ready' }),
    contribute: vi.fn(async () => {}), generate: vi.fn(async () => ({ content: 'pinned runtime' })),
    stop: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const createWholeModel = vi.fn(() => whole);
  const participant = await open({ executionMode: 'whole-model', createWholeModel });
  expect(createWholeModel).toHaveBeenCalledOnce();
  expect(createWholeModel.mock.calls[0][0]).toMatchObject({ model: { id: 'fixture' }, modelDirectory: '/unused',
    nativeGpu: expect.any(Function), fill: expect.any(Function), onChange: expect.any(Function) });
  await participant.contribute(true);
  expect(whole.contribute).toHaveBeenCalledWith(true);
  const controls = { requestId: 'job', consumer: 'requester', adapterIdentities: [], signal: new AbortController().signal };
  expect(await ports.mesh.generate([], () => {}, controls)).toEqual({ content: 'pinned runtime' });
  await participant.stop(); expect(whole.stop).toHaveBeenCalledOnce();
  await participant.close(); expect(whole.close).toHaveBeenCalledOnce();
});

it('opens the whole-model journal from resolved policy and recovers results after participant restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-generation-restart-')); roots.push(directory);
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  const options = { identity, executionMode: 'whole-model', generationJournalFile: path.join(directory, 'generation.sqlite') };
  const participant = await open(options);
  const journal = ports.mesh.generationJournal;
  const binding = { provider: identity.peerId, consumer: 'requester', requestId: 'recorded-request' };
  expect(await journal.claim(binding)).toBe(true);
  await journal.finish(binding, { content: 'retained result' });
  await participant.close();
  await expect(journal.get(binding)).rejects.toThrow(/closed|not open/);
  await open(options);
  expect(await ports.mesh.generationJournal.get(binding)).toEqual({ binding, outcome: { content: 'retained result' } });
  expect(await ports.mesh.generationJournal.claim(binding)).toBe(false);
});

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

it('accepts whole-model offers before advertising capacity and persists admission before executing', async () => {
  const gate = Promise.withResolvers();
  const earning = { ensureOffer: vi.fn(() => gate.promise), prepareWholeModel: vi.fn(async () => {}),
    recordWholeModelReceipt: vi.fn(async () => {}), observe: vi.fn(async () => ({})) };
  const participant = await open({ executionMode: 'whole-model', earning,
    owner: { waitForAdmission: async () => {}, summary: () => ({}) } });
  const opening = participant.contribute(true);
  await vi.waitFor(() => expect(earning.ensureOffer).toHaveBeenCalled());
  expect(participant.getState().ready).toBe(false);
  expect(ports.mesh.getExecutionState().phase).toBe('idle');
  gate.resolve({ offerId: 'fixture' }); await opening;
  expect(participant.getState().ready).toBe(true);
  const controls = { requestId: 'job', consumer: 'requester', adapterIdentities: [], signal: new AbortController().signal };
  await ports.mesh.generate([], () => {}, controls);
  expect(earning.prepareWholeModel).toHaveBeenCalledWith({ requestId: 'job', consumer: 'requester',
    model: { modelId: 'fixture', modelIdentity: 'sha256:' + 'a'.repeat(64), executionMode: 'whole-model', adapterIdentities: [] } });
  expect(earning.prepareWholeModel.mock.invocationCallOrder[0]).toBeLessThan(ports.wholeGenerate.mock.invocationCallOrder[0]);
  await ports.mesh.onReceipt({ receiptId: 'receipt' });
  expect(earning.recordWholeModelReceipt).toHaveBeenCalledWith({ receiptId: 'receipt' });
  earning.prepareWholeModel.mockRejectedValueOnce(Error('no accepted offer'));
  await expect(ports.mesh.generate([], () => {}, controls)).rejects.toThrow('no accepted offer');
  expect(ports.wholeGenerate).toHaveBeenCalledTimes(1);
});
