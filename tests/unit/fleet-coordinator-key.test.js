// @vitest-environment node
// The coordinator key is configured, never made by the ledger: a key file is created once on purpose, a missing or
// malformed one stops the service, and the published part carries no private key.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COORDINATOR_KEY_SCHEMA, coordinatorFor, createCoordinatorKey, openCoordinatorKey, publicCoordinatorKey } from '../../server/fleet/coordinator-key.js';
import { readCoordinatorKey } from '../../scripts/settlement/verify-records.js';

let root;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'coordinator-key-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('makes the key once, publishes only its public part, and never replaces or invents one', async () => {
  const file = path.join(root, 'coordinator-key.json');
  await expect(openCoordinatorKey(file)).rejects.toThrow(/No coordinator key at/);
  const published = await createCoordinatorKey(file);
  expect(Object.keys(published)).toEqual(['schema', 'coordinatorId', 'publicJwk']);
  expect(published.schema).toBe(COORDINATOR_KEY_SCHEMA);
  expect(JSON.stringify(published)).not.toContain(JSON.parse(await readFile(file, 'utf8')).privateJwk.d);
  // The second verifier reads the published form with its own key-to-ID rule.
  expect(readCoordinatorKey(published).coordinatorId).toBe(published.coordinatorId);
  await expect(createCoordinatorKey(file)).rejects.toThrow(/already holds a key/);
  const opened = await openCoordinatorKey(file);
  expect(publicCoordinatorKey(opened)).toEqual(published);
  const coordinator = await coordinatorFor(opened);
  expect(coordinator.signer.participantId).toBe(published.coordinatorId);
  expect(await coordinatorFor(null)).toBeNull();
});

it('refuses a key whose ID does not derive from it, and a published key with anything else in it', async () => {
  const file = path.join(root, 'coordinator-key.json');
  const published = await createCoordinatorKey(file);
  const forged = { ...JSON.parse(await readFile(file, 'utf8')), peerId: 'peer:' + '0'.repeat(24) };
  const other = path.join(root, 'forged.json');
  await writeFile(other, JSON.stringify(forged), { mode: 0o600 });
  await expect(openCoordinatorKey(other)).rejects.toThrow(/does not derive/);
  expect(() => readCoordinatorKey({ ...published, coordinatorId: 'peer:' + '0'.repeat(24) })).toThrow(/does not derive/);
  expect(() => readCoordinatorKey({ ...published, privateJwk: {} })).toThrow(/not a coordinator key/);
});
