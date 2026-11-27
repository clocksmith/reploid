// @vitest-environment node
// The scoring rollout against hosts on an OLDER release, replayed from a recorded transcript
// (tests/fixtures/scoring-rollout/old-peer-transcript-91dd22456.json): the frames a 91dd22456 provider and requester sent
// in a real two-process run of tests/fixtures/scoring-rollout/run.js, which runs both releases side by side and is the
// opt-in check of the same cases. Here no old code runs; the transport and the mesh are injected.
//   - An old provider advertises no operations besides generation: a current requester refuses a score for it before
//     anything is held or any frame is sent, and a Daily turn goes on without the score.
//   - An old requester asks for a receipt-bound score with its payload in the first frame and no admission, hold or signed
//     terms: a current provider answers with a refusal and runs nothing; the old requester code (target-scoring.js is the
//     same file in both releases, checked by its digest) rejects at once, so the old Daily path goes on without a score.
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../shared/vendor/reploid/artifacts/identity.js';
import { MESH_OPERATION_GRANT_SCHEMA, createMeshOperationEnvelope, meshOperationOffer } from '../../shared/vendor/reploid/mesh/operation-envelope.js';
import { TARGET_SCORE_REQUEST, TARGET_SCORE_RESULT, requestTargetScore } from '../../shared/vendor/reploid/mesh/target-scoring.js';
import { createFleetRequester } from '../../server/fleet/requester.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const transcript = JSON.parse(await fs.readFile(path.join(repo, 'tests/fixtures/scoring-rollout/old-peer-transcript-91dd22456.json'), 'utf8'));
const wire = vi.hoisted(() => ({ handlers: new Map(), sent: [], deliver: null }));
vi.mock('../../shared/vendor/reploid/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ onMessage: (type, handler) => wire.handlers.set(type, handler), offMessage() {},
    getConnectedPeers: () => [{ id: 'requester-transport' }], getPeerBinding: () => ({ local: 'cert-local', remote: 'cert-remote' }),
    sendToPeer: (peer, type, payload) => { wire.sent.push({ peer, type, payload: structuredClone(payload) }); wire.deliver?.(type, structuredClone(payload)); return true; },
    disconnect() {} }) }));
vi.mock('../../shared/vendor/reploid/mesh/index.js', async original => ({ ...await original(),
  createPeerGenerationMesh: ({ ports: input }) => ({ connect: async () => { input.createTransport(); }, close: async () => {}, refreshAdvertisement() {},
    getSwarmSnapshot: () => ({ peers: [] }), verifyPeerIdentity: async () => 'peer:' + 'd'.repeat(24), getVerifiedPeerIdentity: () => 'peer:' + 'd'.repeat(24) }),
  createAutomaticPartitions: () => ({ getState: () => ({ phase: 'idle', models: [] }), contribute: async () => {}, stop: async () => {}, close: async () => {} })
}));
vi.mock('../../server/native-model-files.js', () => ({ createNativeModelFiles: async () => ({ close: async () => {}, announce: () => {},
  custodyCertificate: async () => null, getState: () => ({}) }) }));
const { createNativeParticipant } = await import('../../server/native-participant.js');

const roots = [];
afterEach(async () => {
  wire.handlers.clear(); wire.sent.length = 0; wire.deliver = null;
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('the transcript is from the release the standing hosts run, whose receipt-bound scoring module is this one', async () => {
  expect(transcript).toMatchObject({ schema: 'reploid.scoring-rollout-old-peer-transcript/v1', old: '91dd22456' });
  const current = createHash('sha256').update(await fs.readFile(path.join(repo, 'packages/reploid/src/mesh/target-scoring.js'))).digest('hex');
  expect(current).toBe(transcript.oldTargetScoringSha256);
});

it('an old provider offers generation only: a score for it is refused before any hold or frame', async () => {
  const advertisement = transcript.oldProviderAdvertisement;
  expect(Object.hasOwn(advertisement, 'supportedOperations')).toBe(false);
  // The requester's view of that peer, as peer-generation.js keeps it from the advertisement.
  const peer = { participantId: advertisement.peerId, identityVerified: true, modelIdentity: advertisement.modelIdentity };
  const model = { id: advertisement.model, identity: advertisement.modelIdentity };
  const envelope = await createMeshOperationEnvelope({ requestId: 'request-0001', operation: 'scoreTargetSequence', modelId: model.id,
    manifestDigest: model.identity, execution: { protection: 'plaintext', route: 'remote' }, maxCostUnits: 1,
    payload: { messages: [{ role: 'user', content: 'Say one two three.' }], target: 'one two three' },
    recipientGrant: { schema: MESH_OPERATION_GRANT_SCHEMA, recipient: advertisement.peerId, grantedAt: 1, revokedAt: null } });
  expect(meshOperationOffer({ models: [model], peers: [peer] }, envelope)).toMatchObject({ supportedOperations: ['generate'] });
  const credits = Object.fromEntries(['call', 'reserve', 'dispatch', 'settle', 'fence', 'abandonBeforeDispatch'].map(name => [name, vi.fn(async () => ({}))]));
  const participant = { generate: vi.fn(), sendMeshOperation: vi.fn() };
  const requester = createFleetRequester({ identity: await createSigningIdentity({ algorithm: 'Ed25519' }), credits, participant, maxOutputTokens: 16 });
  expect(() => requester.executeOperation(envelope, { offer: value => meshOperationOffer({ models: [model], peers: [peer] }, value) }))
    .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_OPERATION' }));
  for (const port of Object.values(credits)) expect(port).not.toHaveBeenCalled();
  expect(participant.sendMeshOperation).not.toHaveBeenCalled();
  expect(participant.generate).not.toHaveBeenCalled();
});

it('an old requester\'s one-shot score request is refused by a current provider, which runs nothing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scoring-rollout-old-peer-')); roots.push(directory);
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  const model = { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64) };
  const whole = { getState: () => ({ ready: true, adapterIdentities: [], modelIdentity: model.identity, supportedOperations: ['generate', 'scoreTargetSequence'] }),
    getExecutionState: () => ({ phase: 'ready' }), contribute: vi.fn(async () => {}), generate: vi.fn(), supportedOperations: () => ['generate', 'scoreTargetSequence'],
    scoreTarget: vi.fn(async () => ({ modelIdentity: model.identity, tokenCount: 3, roundedTotalLogProb: -0.33 })), executeOperation: vi.fn(),
    stop: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const participant = await createNativeParticipant({ identity, rtc: { RTCPeerConnection() {} }, WebSocket() {}, model, modelDirectory: '/unused',
    cacheDirectory: directory, nativeGpu: async () => {}, signalingUrl: 'ws://localhost:1', roomId: 'mesh', roomToken: 's'.repeat(32),
    executionMode: 'whole-model', createWholeModel: () => whole });
  try {
    await participant.contribute(true);
    // The old requester's own code, on its side of the wire: its frame goes to this provider, and this provider's answer back.
    const requesterHandlers = new Map();
    wire.deliver = (type, payload) => requesterHandlers.get(type)?.('provider-transport', payload);
    const requesterTransport = { getPeerBinding: () => ({ local: 'cert-remote', remote: 'cert-local' }), onMessage: (type, handler) => requesterHandlers.set(type, handler),
      sendToPeer: (_peer, type, payload) => { wire.handlers.get(type)?.('requester-transport', structuredClone(payload)); return true; } };
    const recorded = transcript.oldRequesterScoreRequest;
    expect(Object.keys(recorded).sort()).toEqual(['messages', 'receipt', 'requestId', 'target']);
    const startedAt = Date.now();
    const scored = requestTargetScore({ transport: requesterTransport, verifyPeer: async () => identity.peerId, currentPeer: () => identity.peerId,
      providerPeer: 'provider-transport', providerParticipantId: identity.peerId, receipt: { ...recorded.receipt, provider: identity.peerId },
      messages: recorded.messages, target: recorded.target, signal: AbortSignal.timeout(5000) });
    await expect(scored).rejects.toThrow(/admitted mesh operation/);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    // The recorded frame itself, as it arrived from the old requester.
    wire.handlers.get(TARGET_SCORE_REQUEST)('requester-transport', structuredClone(recorded));
    await vi.waitFor(() => expect(wire.sent.filter(frame => frame.type === TARGET_SCORE_RESULT)).toHaveLength(2));
    for (const answer of wire.sent.filter(frame => frame.type === TARGET_SCORE_RESULT)) {
      expect(Object.keys(answer.payload).sort()).toEqual(['error', 'requestId']);
    }
    expect(wire.sent.find(frame => frame.type === TARGET_SCORE_RESULT && frame.payload.requestId === recorded.requestId)).toBeTruthy();
    expect(whole.scoreTarget).not.toHaveBeenCalled();
    expect(whole.executeOperation).not.toHaveBeenCalled();
  } finally { await participant.close(); }
});
