/**
 * Fixed inputs for the requester contract vectors and the conformance providers.
 *
 * Every key below is a TEST key. It is published on purpose so that a client in
 * another language can reproduce signatures byte for byte. Never use these keys
 * for a real identity.
 */
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };

export const FIXED_IDENTITIES = Object.freeze({
  requesterEd25519: {
    version: 1, algorithm: 'Ed25519', peerId: 'peer:97fc1d680c3eebc54160106e',
    publicJwk: { key_ops: ['verify'], ext: true, alg: 'Ed25519', crv: 'Ed25519', x: 'AnohZBev2orjsCCJkk5sASKy7M8JLjhqHSDlrbPTTuI', kty: 'OKP' },
    privateJwk: { key_ops: ['sign'], ext: true, alg: 'Ed25519', crv: 'Ed25519', d: '-mDfWz7yWCD-5AVK_EzyB3rH3He4_MYy9X-dcJwy3eY', x: 'AnohZBev2orjsCCJkk5sASKy7M8JLjhqHSDlrbPTTuI', kty: 'OKP' }
  },
  providerEd25519: {
    version: 1, algorithm: 'Ed25519', peerId: 'peer:6a8b857f196de4a859dd669d',
    publicJwk: { key_ops: ['verify'], ext: true, alg: 'Ed25519', crv: 'Ed25519', x: 'yO6W0-Z8oxqnNgtxky70qJ7EyUdIrvCfboYEWQGD2e4', kty: 'OKP' },
    privateJwk: { key_ops: ['sign'], ext: true, alg: 'Ed25519', crv: 'Ed25519', d: 'mKWDtq1RqxM0CqR8MYg2YMRKBCiLNdSqGW9Uiz2gamI', x: 'yO6W0-Z8oxqnNgtxky70qJ7EyUdIrvCfboYEWQGD2e4', kty: 'OKP' }
  },
  providerEcdsa: {
    version: 1, algorithm: 'ECDSA', peerId: 'peer:8ad97482606c7162869acbb7',
    publicJwk: { key_ops: ['verify'], ext: true, kty: 'EC', x: 'DYBttchHbdMlbV58NEn6OSCjEbeY4l49Pi1QsMoRtTY', y: 'ubeZknilyFNNFhJujyhzJDuA2FgPEcGeqdKbJ-wJLKQ', crv: 'P-256' },
    privateJwk: { key_ops: ['sign'], ext: true, kty: 'EC', x: 'DYBttchHbdMlbV58NEn6OSCjEbeY4l49Pi1QsMoRtTY', y: 'ubeZknilyFNNFhJujyhzJDuA2FgPEcGeqdKbJ-wJLKQ', crv: 'P-256', d: '-KNQc_EO8kHyS9cDXWpWbJeEQ7tawGGv2wcoeTY7AX0' }
  }
});

/** A deep copy, because the mesh updates the contribution summary of the bundle it is given. */
export const fixedIdentity = name => structuredClone(FIXED_IDENTITIES[name]);

const hexPairs = start => Array.from({ length: 32 }, (_, index) => (start + index).toString(16).padStart(2, '0')).join(':');

/** The whole-model catalog row every fixture serves. It is the real catalog entry. */
export const FIXED_MODEL_ID = 'qwen-3-5-2b-q4k-ef16-af32';
export const fixedModel = () => structuredClone(catalog.find(row => row.id === FIXED_MODEL_ID));

export const FIXED = Object.freeze({
  // A private room: the vectors never touch the public room.
  roomId: 'reploid-swarm-contract-vectors',
  roomToken: 'contract-vectors-room-capability-0123456789abcdef',
  signalingUrl: 'ws://localhost/swarm',
  origin: 'http://localhost:8000',
  // Transport ids are connection names. They are not signing identities.
  requesterTransportId: 'c0ffee00-0000-4000-8000-000000000001',
  providerTransportId: 'c0ffee00-0000-4000-8000-000000000002',
  // DTLS certificate fingerprints as sdp-fingerprint.js returns them (lower case).
  requesterFingerprint: `sha-256 ${hexPairs(0x10)}`,
  providerFingerprint: `sha-256 ${hexPairs(0xa0)}`,
  // Date.now() during the capture: 2026-01-01T00:00:00.000Z.
  now: 1767225600000,
  // crypto.randomUUID() results, in the order the capture consumes them.
  uuids: Array.from({ length: 16 }, (_, index) => `aaaaaaaa-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
  // crypto.getRandomValues(new Uint8Array(32)) for the admission salt: bytes 0x00..0x1f.
  saltBytes: Array.from({ length: 32 }, (_, index) => index),
  requestId: 'd0d0d0d0-0000-4000-8000-000000000001',
  threadId: 'e0e0e0e0-0000-4000-8000-000000000001',
  attemptId: 'e0e0e0e0-0000-4000-8000-000000000002',
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
  answerChunks: ['The capital ', 'of France ', 'is Paris.'],
  completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 9, generatedTokenCount: 7, stopReason: 'eos-token' }
});
