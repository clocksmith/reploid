// Fresh local-only authorization for the user's three-arm comparison; no public release.
// Continued history and signature validation stay unchanged; expiry is not bypassed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const output = process.argv[2];
assert(output === '/var/tmp/reploid-three-arm-20261016/release');
const capsuleDir = '/var/tmp/qwen35-capsule-faster-20261015-3';
const runtime = '/var/tmp/reploid-faster-candidate-20261015-3/vendor/doppler/0.6.28';
const keys = '/var/tmp/doppler-0.6.28-source-20261012/capsule-input';
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const load = name => import(pathToFileURL(`${runtime}/src/config/${name}`).href);
const { signCapsuleReleaseEvent } = await load('capsule-release-events.js');
const { getCapsuleIdentity, verifyCapsule } = await load('capsule.js');

const capsule = await read(`${capsuleDir}/capsule-v3.json`);
const policy = await read(`${capsuleDir}/release-policy.json`);
const history = await read('/var/tmp/qwen35-capsule-faster-20261015-3-renewal-10/release-events.json');
assert.equal(history.length, 10);
const prior = history[9];
assert.equal(prior.sequence, 10);
assert.equal(prior.digest, 'sha256:e7b0cb348e0ff212ff6d1cde0f9b1ceaaa34cd6be5a7f6a38feed4e26f6ecd5e');
const identity = getCapsuleIdentity(capsule);
assert.deepEqual(prior.capsule, { schema: identity.schema, semanticRoot: identity.semanticRoot, envelopeDigest: identity.envelopeDigest });
const signer = { authority: policy.authority, privateKeyJwk: await read(`${keys}/signing-private.jwk.json`),
  publicKeyJwk: await read(`${keys}/signing-public.jwk.json`) };
assert.equal(prior.signature.authority, signer.authority);
const trustedSigners = await read(`${capsuleDir}/trusted-signers.json`);
assert.deepEqual(trustedSigners, { [signer.authority]: signer.publicKeyJwk });

const now = new Date().toISOString();
// New owner-requested bounded comparison authorizes a new test event after expiry.
assert.equal(policy.scope, 'Local signed browser/Node opening qualification only; no public eligibility or application promotion');
const expires = new Date(Date.parse(now) + Math.min(policy.offlineExpirySeconds, 10800) * 1000).toISOString();
const event = await signCapsuleReleaseEvent({ capsule: prior.capsule, sequence: 11, previousEventDigest: prior.digest,
  issuedAtUtc: now, expiresAtUtc: expires, action: 'eligible', release: prior.release, migratedFrom: prior.migratedFrom,
  nextSigner: null }, signer);
const renewed = [...history, event];

// Hosts holding checkpoint 9 (final-10 pass 3), 8, 7, 6, 5 (final-9), or none must all admit the
// renewed history with the candidate runtime the final-10 delivery carries.
const open = checkpoint => verifyCapsule(capsule, { trustedSigners, releaseTrustedSigners: trustedSigners, releaseEvents: renewed,
  releasePolicy: { now, minimumSequence: 11, checkpoint },
  artifactStore: { readArtifact: artifact => fs.readFile(`${capsuleDir}/${artifact.path}`) } });
const checkpoints = [...history.slice(4).reverse().map(row => ({ sequence: row.sequence, digest: row.digest })), { sequence: 0, digest: null }];
const results = [];
for (const checkpoint of checkpoints) {
  const verification = await open(checkpoint);
  assert.deepEqual(verification.lifecycle.checkpoint, { sequence: 11, digest: event.digest });
  results.push({ from: checkpoint, to: verification.lifecycle.checkpoint, artifacts: verification.artifactReceipts.length });
}

await fs.mkdir(output);
const write = (name, value) => fs.writeFile(`${output}/${name}`, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
await write('release-events.json', renewed);
await write('renewal-verification.json', { schema: 'doppler.capsule-release-renewal/v1', capsule: identity,
  runtimeArchive: policy.runtimeArchiveSha256, authority: signer.authority,
  scope: policy.scope, previous: { sequence: 10, digest: prior.digest, expiresAtUtc: prior.expiresAtUtc },
  renewed: { sequence: 11, digest: event.digest, issuedAtUtc: now, expiresAtUtc: expires },
  verifiedFromCheckpoints: results, verifiedAt: now, publicPromotion: false });
console.log(JSON.stringify({ sequence: 11, digest: event.digest, expiresAtUtc: expires, verified: results.length }));
