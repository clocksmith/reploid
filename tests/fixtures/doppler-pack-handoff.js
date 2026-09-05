/** Explicit source-checkout handoff. Injected program, not physical GPU evidence. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';
import { assertPackSession, assertPackReceipt, hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { createPeerPackArtifactStore } from '../../self/pool/peer-pack-custody.js';
import { createCustodyFixture } from './peer-pack-custody.js';

const checkout = process.env.DOPPLER_TEST_CHECKOUT;
if (!checkout) throw new Error('DOPPLER_TEST_CHECKOUT is required');
const fromCheckout = (file) => import(pathToFileURL(path.resolve(checkout, file)).href);
const api = await fromCheckout('src/pack.js');
const runtimeApi = await fromCheckout('src/pack-runtime.js');
// Fixture construction is test-only. Production imports use public Doppler APIs.
const fixtureApi = await fromCheckout('tests/helpers/pack-v2-fixture.js');
const { hashTargetPlan } = await fromCheckout('src/config/target-plan.js');
const fixture = await fixtureApi.createSignedPackFixture();
const keys = generateKeyPairSync('ed25519');
const signer = { authority: 'handoff-fixture', privateKeyJwk: keys.privateKey.export({ format: 'jwk' }), publicKeyJwk: keys.publicKey.export({ format: 'jwk' }) };
const trustedSigners = { [signer.authority]: signer.publicKeyJwk };
const migrated = await api.migratePackV2(fixture.pack, { trustedSigners: { [fixtureApi.TEST_PACK_AUTHORITY]: fixtureApi.TEST_PACK_PUBLIC_KEY }, signer });
const identity = api.getPackIdentity(migrated.pack);
const { schema, semanticRoot, envelopeDigest } = identity;
const event = await api.signPackReleaseEvent({ pack: { schema, semanticRoot, envelopeDigest }, sequence: 1, previousEventDigest: null, issuedAtUtc: '2026-09-01T00:00:00.000Z', expiresAtUtc: '2026-10-01T00:00:00.000Z', action: 'eligible', release: migrated.release, migratedFrom: migrated.migratedFrom, nextSigner: null }, signer);
const binding = { ...identity, requiredOperation: 'encodeSequence',
  acceptedTargetPlanDigests: migrated.pack.targetPlans.map(hashTargetPlan), artifacts: migrated.pack.artifacts };
const custody = await createCustodyFixture(binding, fixture.artifactBytes, 16);
const artifactStore = await createPeerPackArtifactStore(custody.options);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Origin and alternate mirrors disabled for custody handoff'); };
let checkpoint;
const runtime = runtimeApi.createDopplerRuntime({
  device: { getDevice: () => ({ createBuffer() {}, createCommandEncoder() {} }), getProfile: () => ({ surface: 'test-webgpu', hasF16: false, hasSubgroups: false, maxBufferSize: 1024 }) },
  artifactStore, trustedSigners,
  programFactory: async () => ({ encodeSequence: async () => ({ alphabet: 'amino_acid', pooledEmbedding: new Float32Array([1, 2]), phase: { elapsed: 3 } }), close() {} }),
});
const module = { DOPPLER_VERSION: runtimeApi.DOPPLER_VERSION, dr: runtime };
const service = createReploidDopplerRuntimeService({ loadModule: async () => module });
const openOptions = { acceptedTargetPlanDigests: binding.acceptedTargetPlanDigests, releaseEvents: [event], releaseTrustedSigners: trustedSigners, releasePolicy: { now: '2026-09-04T00:00:00.000Z', minimumSequence: 1, checkpoint: { sequence: 0, digest: null } }, persistReleaseCheckpoint: (value) => { checkpoint = value; } };
let session;
try {
  const changedPack = structuredClone(migrated.pack);
  changedPack.artifacts[0].hash = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(service.openPack({ source: changedPack, options: openOptions }));
  assert.equal(artifactStore.getReceipt().attempts.length, 0, 'changed Pack rejected before peer reads');
  session = await service.openPack({ source: migrated.pack, options: openOptions });
  await assertPackSession(binding, session);
  assert.equal(checkpoint.digest, event.digest);
  const transferReceipt = artifactStore.getReceipt();
  assert.equal(transferReceipt.completed.length, migrated.pack.artifacts.length);
  assert.deepEqual(new Set(transferReceipt.attempts.filter((item) => item.status === 'accepted').map((item) => item.peerId)), new Set(['even', 'odd']));
  assert(transferReceipt.attempts.some((item) => item.error?.includes('integrity')));
  assert(transferReceipt.attempts.some((item) => item.error?.includes('interruption')));
  const assignment = { assignmentId: 'handoff-a', attempt: 1, custodyReceiptDigest: await hashDopplerEvidence(transferReceipt), model: { executablePack: binding } };
  const options = { assignment, includeTokenEmbeddings: false, includeLogits: false };
  const result = await session.encodeSequence('MKT', options);
  await assertPackReceipt(binding, result.receipt, { assignment, sequence: 'MKT', options, result });
  await assert.rejects(assertPackReceipt(binding, result.receipt, { assignment: { ...assignment, assignmentId: 'handoff-b' } }), /assignment/);
  await assert.rejects(assertPackReceipt(binding, result.receipt, { assignment: { ...assignment, attempt: 2 } }), /assignment/);
} finally { await service.closeAll(); artifactStore.close(); globalThis.fetch = originalFetch; }
assert.equal(session.closed, true);

console.log('Doppler public signed-Pack handoff passed');
