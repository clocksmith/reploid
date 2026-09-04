/** Explicit source-checkout handoff. Injected program, not physical GPU evidence. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';
import { assertPackSession, assertPackReceipt } from '../../self/pool/executable-pack.js';

const checkout = process.env.DOPPLER_TEST_CHECKOUT;
if (!checkout) throw new Error('DOPPLER_TEST_CHECKOUT is required');
const fromCheckout = (file) => import(pathToFileURL(path.resolve(checkout, file)).href);
const api = await fromCheckout('src/pack.js');
const runtimeApi = await fromCheckout('src/pack-runtime.js');
// Fixture construction is test-only. Production imports use public Doppler APIs.
const fixtureApi = await fromCheckout('tests/helpers/pack-v2-fixture.js');
const fixture = await fixtureApi.createSignedPackFixture();
const keys = generateKeyPairSync('ed25519');
const signer = { authority: 'handoff-fixture', privateKeyJwk: keys.privateKey.export({ format: 'jwk' }), publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) };
const trustedSigners = { [signer.authority]: signer.publicKeyJwk };
const migrated = await api.migratePackV2(fixture.pack, { trustedSigners: { [fixtureApi.TEST_PACK_AUTHORITY]: fixtureApi.TEST_PACK_PUBLIC_KEY }, signer });
const identity = api.getPackIdentity(migrated.pack);
const { schema, semanticRoot, envelopeDigest } = identity;
const event = await api.signPackReleaseEvent({ pack: { schema, semanticRoot, envelopeDigest }, sequence: 1, previousEventDigest: null, issuedAtUtc: '2026-09-01T00:00:00.000Z', expiresAtUtc: '2026-10-01T00:00:00.000Z', action: 'eligible', release: migrated.release, migratedFrom: migrated.migratedFrom, nextSigner: null }, signer);
let checkpoint;
const runtime = runtimeApi.createDopplerRuntime({
  device: { getDevice: () => ({ createBuffer() {}, createCommandEncoder() {} }), getProfile: () => ({ surface: 'test-webgpu', hasF16: false, hasSubgroups: false, maxBufferSize: 1024 }) },
  artifactStore: fixture.artifactStore, trustedSigners,
  programFactory: async () => ({ encodeSequence: async () => ({ alphabet: 'amino_acid', pooledEmbedding: new Float32Array([1, 2]), phase: { elapsed: 3 } }), close() {} }),
});
const module = { DOPPLER_VERSION: runtimeApi.DOPPLER_VERSION, dr: runtime };
const service = createReploidDopplerRuntimeService({ loadModule: async () => module });
const session = await service.openPack({ source: migrated.pack, options: { releaseEvents: [event], releaseTrustedSigners: trustedSigners, releasePolicy: { now: '2026-09-04T00:00:00.000Z', minimumSequence: 1, checkpoint: { sequence: 0, digest: null } }, persistReleaseCheckpoint: (value) => { checkpoint = value; } } });
try {
  const binding = { ...identity, requiredOperation: 'encodeSequence', acceptedTargetPlanDigests: [session.selectedTargetPlanDigest], artifacts: migrated.pack.artifacts };
  await assertPackSession(binding, session);
  assert.equal(checkpoint.digest, event.digest);
  const assignment = { assignmentId: 'handoff-a', model: { executablePack: binding } };
  const options = { assignment, includeTokenEmbeddings: false, includeLogits: false };
  const result = await session.encodeSequence('MKT', options);
  await assertPackReceipt(binding, result.receipt, { assignment, sequence: 'MKT', options, result });
  await assert.rejects(assertPackReceipt(binding, result.receipt, { assignment: { ...assignment, assignmentId: 'handoff-b' } }), /assignment/);
} finally { await service.closeAll(); }
assert.equal(session.closed, true);

console.log('Doppler public signed-Pack handoff passed');
