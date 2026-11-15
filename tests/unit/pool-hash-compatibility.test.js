// @vitest-environment node
import { expect, it } from 'vitest';
import { sha256Hex, sha256Digest, hashCanonical } from '../../server/hashing.js';
import { sha256Digest as poolDigest, sha256Hex as legacyPoolDigest, hashJson as poolHash } from '../../server/pool/hash.js';
import { sha256Hex as browserDigest, hashJson as browserHash } from '../../packages/reploid/src/artifacts/signatures.js';

it('keeps browser-produced pool identities compatible with the server wire contract', async () => {
  const hex = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  expect(sha256Hex('abc')).toBe(hex);
  expect(sha256Digest('abc')).toBe(`sha256:${hex}`);
  expect(poolDigest('abc')).toBe(`sha256:${hex}`);
  expect(legacyPoolDigest('abc')).toBe(`sha256:${hex}`);
  expect(await browserDigest('abc')).toBe(`sha256:${hex}`);
});

it('agrees across canonical JSON implementations for signed JSON data', async () => {
  for (const value of [null, 'é', [1, null, false], { z: [3, { b: 2, a: 1 }], a: 'text' }]) {
    expect(poolHash(value)).toBe(hashCanonical(value));
    expect(await browserHash(value)).toBe(hashCanonical(value));
  }
  // General server JSON intentionally normalizes undefined; signed pool records
  // contain JSON values only. Do not migrate stored hashes between these domains.
  expect(hashCanonical({ absent: undefined, present: null })).toBe(hashCanonical({ present: null }));
});
