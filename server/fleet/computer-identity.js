/** The native computer's persistent signing identity and owner-only file reads, shared by the fleet host and `join`. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createSigningIdentity, createPeerIdFromPublicJwk } from '../../shared/vendor/reploid/artifacts/identity.js';
import { assert } from './contract.js';

export async function openComputerIdentity(file) {
  assert(path.isAbsolute(file), 'Absolute computer identity path required');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let identity;
  try { identity = JSON.parse(await readOwnFile(file)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    identity = await createSigningIdentity({ algorithm: 'Ed25519' });
    await fs.writeFile(file, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  }
  assert(identity.privateJwk && await createPeerIdFromPublicJwk(identity.publicJwk) === identity.peerId, 'Invalid persistent computer identity');
  return identity;
}

export async function readOwnFile(file) {
  assert(path.isAbsolute(file), 'Absolute operator file path required');
  assert(!(await fs.lstat(file)).isSymbolicLink(), 'Operator file cannot be a symbolic link');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    assert(stat.isFile(), 'Operator file must be regular');
    if (process.getuid) assert(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'Operator secrets must be owner-only');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}
