import path from 'node:path';
import fs from 'node:fs/promises';
import { requireValue } from './native-host-utils.js';

/** Reads the private room capability once from an operator file. The path must be absolute and
 * name a regular file owned by the current user with mode 0600. The final path component is
 * opened without following a symbolic link and the open descriptor is checked before it is read.
 * One trailing newline (LF or CRLF) is removed; the token is otherwise unchanged. */
export async function readNativeRoomTokenFile(file, { uid = process.getuid?.() } = {}) {
  requireValue(typeof file === 'string' && path.isAbsolute(file), '--room-token-file requires an absolute path');
  requireValue(Number.isSafeInteger(uid), '--room-token-file requires a POSIX host that reports the current user id');
  let handle;
  try { handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) {
    const known = { ENOENT: 'does not exist', ELOOP: 'is a symbolic link, not a regular file' };
    const reason = known[error.code] ?? `cannot be opened (${error.code || error.message})`;
    throw new Error(`--room-token-file ${reason}: ${file}`);
  }
  try {
    const stat = await handle.stat();
    requireValue(stat.isFile(), `--room-token-file must be a regular file: ${file}`);
    requireValue(stat.uid === uid, `--room-token-file must be owned by the current user (uid ${uid}), not uid ${stat.uid}: ${file}`);
    const mode = stat.mode & 0o7777;
    requireValue(mode === 0o600, `--room-token-file must have mode 0600 (owner read/write only), not ${mode.toString(8).padStart(4, '0')}: ${file}`);
    const token = (await handle.readFile('utf8')).replace(/\r?\n$/, '');
    requireValue(token.length > 0, `--room-token-file is empty: ${file}`);
    return token;
  } finally { await handle.close(); }
}

/** One source for the room capability. The value then follows the same path as --room-token
 * (createRoomIntroductionAdmission and the signaling join), so it is validated identically.
 * --room-token remains for compatibility; it exposes the token in process arguments. */
export async function resolveNativeRoomToken(values, { warn = message => console.error(message), uid } = {}) {
  const inline = values['room-token'], file = values['room-token-file'];
  requireValue(inline === undefined || file === undefined, 'Choose either --room-token or --room-token-file, not both');
  if (file !== undefined) return readNativeRoomTokenFile(file, { uid });
  if (inline !== undefined) warn('Warning: --room-token exposes the room token in process arguments; use --room-token-file');
  return inline;
}
