// @vitest-environment node
// The coordinator key is configured, never made by the ledger: a key file is created once on purpose, a missing or
// malformed one stops the service, and the published part carries no private key.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COORDINATOR_KEY_SCHEMA, coordinatorFor, createCoordinatorKey, openCoordinatorKey, publicCoordinatorKey } from '../../server/fleet/coordinator-key.js';
import { checkPublication, coordinatorFingerprint, readCoordinatorKey } from '../../scripts/settlement/verify-records.js';
import { coordinatorPublication, coordinatorTxtRecord } from '../../scripts/settlement/trade.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

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

// The ledger operator publishes the key outside the ledger (trade.js coordinator-fingerprint): the public key, its
// fingerprint and a dated statement signed by that key, which the outsider checks with the two verifier files alone.
it('prints a signed, dated publication of the key that the outsider\'s verifier accepts, and refuses an edited one', async () => {
  const file = path.join(root, 'coordinator-key.json');
  const published = await createCoordinatorKey(file);
  const fingerprint = coordinatorFingerprint(published.publicJwk);
  const publication = coordinatorPublication({ identity: await openCoordinatorKey(file), ledger: 'https://ledger.example/v1/fleet', now: () => Date.parse('2026-11-26T20:00:00.000Z') });
  expect(publication).toMatchObject({ schema: 'reploid.coordinator-publication/v1', coordinatorId: published.coordinatorId, fingerprint, publishedAt: '2026-11-26T20:00:00.000Z' });
  expect(publication.publicJwk).toEqual({ kty: 'OKP', crv: 'Ed25519', x: published.publicJwk.x });
  expect(JSON.stringify(publication)).not.toContain(JSON.parse(await readFile(file, 'utf8')).privateJwk.d);
  expect(checkPublication(publication)).toEqual({ body: expect.objectContaining({ fingerprint }) });
  expect(coordinatorTxtRecord(publication)).toBe(`reploid-coordinator=v1 id=${published.coordinatorId} fp=${fingerprint} date=2026-11-26`);
  expect(coordinatorTxtRecord(publication).length).toBeLessThan(255);
  const other = await createCoordinatorKey(path.join(root, 'other.json'));
  for (const edited of [{ ledger: 'https://elsewhere.example' }, { publishedAt: '2026-11-25T20:00:00.000Z' }, { fingerprint: coordinatorFingerprint(other.publicJwk) },
    { publicJwk: { kty: 'OKP', crv: 'Ed25519', x: other.publicJwk.x }, coordinatorId: other.coordinatorId, fingerprint: coordinatorFingerprint(other.publicJwk) }]) {
    expect(checkPublication({ ...publication, ...edited }).problem, JSON.stringify(edited)).toBeTruthy();
  }

  // The command, as the operator runs it, and the outsider's check of what it printed.
  const run = args => execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const printed = run(['scripts/settlement/trade.js', 'coordinator-fingerprint', '--key', file, '--ledger', 'https://ledger.example/v1/fleet']);
  await writeFile(path.join(root, 'publication.json'), printed);
  expect(JSON.parse(printed)).toMatchObject({ coordinatorId: published.coordinatorId, fingerprint });
  const checked = run(['scripts/settlement/verify-records.js', '--publication', path.join(root, 'publication.json')]);
  expect(checked).toContain('The publication is signed by the coordinator key it names.');
  expect(checked).toContain(`--coordinator-fingerprint ${fingerprint}`);
  // On the public part alone it prints the fingerprint and signs nothing.
  await writeFile(path.join(root, 'public.json'), JSON.stringify(published));
  expect(JSON.parse(run(['scripts/settlement/trade.js', 'coordinator-fingerprint', '--key', path.join(root, 'public.json')]))).toEqual({ ...published, fingerprint });
});
