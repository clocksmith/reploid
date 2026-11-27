// @vitest-environment node
// The native participant's sendMeshOperation, the port the fleet requester (server/fleet/requester.js executeOperation)
// sends a non-generation mesh operation through: it must hand the requester's signed settlement terms to the wire
// protocol, so the provider is asked for its admission (no payload) with those terms. The transport and the mesh are
// injected; mesh-operation-dispatch.test.js covers the protocol itself and tests/fixtures/scoring-rollout/run.js the
// same path between real host processes.
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../shared/vendor/reploid/artifacts/identity.js';
import { MESH_OPERATION_CANCEL, MESH_OPERATION_REQUEST, MESH_OPERATION_GRANT_SCHEMA, createMeshOperationEnvelope }
  from '../../shared/vendor/reploid/mesh/operation-envelope.js';

const PROVIDER = 'peer:' + 'c'.repeat(24);
const sent = vi.hoisted(() => []);
vi.mock('../../shared/vendor/reploid/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ onMessage() {}, offMessage() {}, getConnectedPeers: () => [{ id: 'provider-transport' }],
    getPeerBinding: peer => peer === 'provider-transport' ? { local: 'cert-local', remote: 'cert-remote' } : null,
    sendToPeer: (peer, type, payload) => { sent.push({ peer, type, payload: structuredClone(payload) }); return true; }, disconnect() {} }) }));
vi.mock('../../shared/vendor/reploid/mesh/index.js', async original => ({ ...await original(),
  createPeerGenerationMesh: ({ ports: input }) => ({ connect: async () => { input.createTransport(); }, close: async () => {}, refreshAdvertisement() {},
    getSwarmSnapshot: () => ({ peers: [] }), verifyPeerIdentity: async peer => peer === 'provider-transport' ? PROVIDER : null,
    getVerifiedPeerIdentity: peer => peer === 'provider-transport' ? PROVIDER : null }),
  createAutomaticPartitions: () => ({ getState: () => ({ phase: 'idle', models: [] }), contribute: async () => {}, stop: async () => {}, close: async () => {} })
}));
vi.mock('../../server/native-model-files.js', () => ({ createNativeModelFiles: async () => ({ close: async () => {}, announce: () => {},
  custodyCertificate: async () => null, getState: () => ({}) }) }));
const { createNativeParticipant } = await import('../../server/native-participant.js');

const roots = [];
afterEach(async () => { sent.length = 0; for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

it('sends the admission with the requester\'s signed settlement terms, and no payload', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-mesh-operation-')); roots.push(directory);
  const model = { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64) };
  const participant = await createNativeParticipant({ identity: await createSigningIdentity({ algorithm: 'Ed25519' }),
    rtc: { RTCPeerConnection() {} }, WebSocket() {}, model, modelDirectory: '/unused', cacheDirectory: directory, nativeGpu: async () => {},
    signalingUrl: 'ws://localhost:1', roomId: 'mesh', roomToken: 's'.repeat(32) });
  try {
    const envelope = await createMeshOperationEnvelope({ requestId: 'request-0001', operation: 'scoreTargetSequence', modelId: model.id,
      manifestDigest: model.identity, execution: { protection: 'plaintext', route: 'remote' }, maxCostUnits: 1,
      payload: { messages: [{ role: 'user', content: 'Say one two three.' }], target: 'one two three' },
      recipientGrant: { schema: MESH_OPERATION_GRANT_SCHEMA, recipient: PROVIDER, grantedAt: 1, revokedAt: null } });
    // The terms and the charge binding openMeshOperationCharge signs; their content is the protocol's concern, not this port's.
    const settlement = { terms: { schema: 'reploid.settlement-terms/v1', marker: 'signed-terms' }, charge: { marker: 'charge-binding' },
      accept: vi.fn(async () => true), close: vi.fn(async () => true) };
    const controller = new AbortController();
    const pending = participant.sendMeshOperation(envelope, { signal: controller.signal, settlement });
    const operationFrames = () => sent.filter(frame => frame.type.startsWith('reploid:mesh-operation'));
    await vi.waitFor(() => expect(operationFrames().length).toBeGreaterThan(0));
    const [admission] = operationFrames();
    expect(admission.type).toBe(MESH_OPERATION_REQUEST);
    expect(Object.hasOwn(admission.payload.envelope, 'payload')).toBe(false);
    expect(admission.payload.settlement).toEqual({ terms: settlement.terms, charge: settlement.charge });
    controller.abort(new Error('done'));
    const ended = await pending.catch(error => error);
    expect(ended.payloadSent).toBe(false);
    expect(operationFrames().map(frame => frame.type)).toEqual([MESH_OPERATION_REQUEST, MESH_OPERATION_CANCEL]);
  } finally { await participant.close(); }
});
