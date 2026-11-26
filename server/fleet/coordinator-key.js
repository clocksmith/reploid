#!/usr/bin/env node
/**
 * The coordinator key: the one signing key a ledger operator speaks with when it signs settlement statements
 * (settlement-statement.js; docs/settlement-replay.md, "The coordinator's statement").
 *
 *   node server/fleet/coordinator-key.js create /absolute/coordinator-key.json    make the key once; refuses to overwrite
 *   node server/fleet/coordinator-key.js public /absolute/coordinator-key.json    print the public part to publish
 *
 * The ledger never makes this key by itself. A service whose configuration names no key file signs no statements; one
 * whose file is missing, readable by others or malformed does not start. The private half stays in that file; the
 * public part (`reploid.coordinator-key/v1`: the coordinator ID and its public key) is what the operator publishes
 * somewhere a verifier can fetch without asking whoever hands them a trade.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity, createPeerIdFromPublicJwk } from '../../shared/vendor/reploid/artifacts/identity.js';
import { createAttemptEvidenceSigner } from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { readOwnFile } from './computer-identity.js';
import { assert } from './contract.js';

export const COORDINATOR_KEY_SCHEMA = 'reploid.coordinator-key/v1';

/** The public part of a coordinator identity, as it is published and as a verifier is given it. */
export const publicCoordinatorKey = identity => ({ schema: COORDINATOR_KEY_SCHEMA, coordinatorId: identity.peerId, publicJwk: structuredClone(identity.publicJwk) });

async function checked(identity) {
  assert(identity?.privateJwk && identity.publicJwk && await createPeerIdFromPublicJwk(identity.publicJwk) === identity.peerId,
    'Invalid coordinator key: its ID does not derive from its public key');
  return identity;
}

/** Reads an existing owner-only coordinator key file. It is never created here. */
export async function openCoordinatorKey(file) {
  assert(typeof file === 'string' && path.isAbsolute(file), 'Absolute coordinator key path required');
  let text;
  try { text = await readOwnFile(file); }
  catch (error) {
    if (error.code === 'ENOENT') throw Error(`No coordinator key at ${file}. Make it once with: node server/fleet/coordinator-key.js create ${file}`);
    throw error;
  }
  return checked(JSON.parse(text));
}

/** The coordinator's key from a secret value (a hosted service that mounts no key file). */
export const coordinatorKeyFromSecret = async text => checked(JSON.parse(text));

/** `{ signer, publicKey }` for the fleet service, or `null` when no key is configured. */
export async function coordinatorFor(identity, now = Date.now) {
  if (!identity) return null;
  return { signer: createAttemptEvidenceSigner({ identity: await checked(identity), now }), publicKey: publicCoordinatorKey(identity) };
}

/** Makes the key file once, owner-only. An existing file is never replaced: a new key is a new coordinator. */
export async function createCoordinatorKey(file) {
  assert(typeof file === 'string' && path.isAbsolute(file), 'Absolute coordinator key path required');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  try { await fs.writeFile(file, JSON.stringify(identity), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error(`${file} already holds a key. It was not replaced: statements signed with it stay checkable only against that key.`);
    throw error;
  }
  return publicCoordinatorKey(identity);
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  const [command, file] = process.argv.slice(2);
  try {
    assert(['create', 'public'].includes(command) && file, 'Usage: node server/fleet/coordinator-key.js create|public /absolute/coordinator-key.json');
    const target = path.resolve(file);
    console.log(JSON.stringify(command === 'create' ? await createCoordinatorKey(target) : publicCoordinatorKey(await openCoordinatorKey(target)), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
