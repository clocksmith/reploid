/** Native persistence for the application's existing monotonic release contract. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const requireValue = (ok, message) => { if (!ok) throw new Error(`Native release storage: ${message}`); };
const valid = value => Number.isSafeInteger(value?.sequence) && value.sequence >= 0
  && (value.sequence === 0 ? value.digest === null : /^sha256:[a-f0-9]{64}$/.test(value.digest));
const same = (a, b) => a.sequence === b.sequence && a.digest === b.digest;

export async function openNativeReleaseCheckpoints({ directory }) {
  requireValue(typeof directory === 'string' && directory.length > 0, 'explicit directory required');
  // Lazy native-only dependency: unsupported Node versions fail before signed
  // opening; ordinary manifest participation does not import SQLite.
  const { DatabaseSync } = await import('node:sqlite');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(await fs.realpath(directory), 'release-checkpoints.sqlite');
  const handle = await fs.open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try { requireValue((await handle.stat()).isFile(), 'checkpoint store must be a regular file'); }
  finally { await handle.close(); }
  const db = new DatabaseSync(filename);
  let closed = false;
  try {
    db.prepare('PRAGMA synchronous=FULL').run();
    db.prepare('CREATE TABLE IF NOT EXISTS checkpoints (namespace TEXT PRIMARY KEY, sequence INTEGER NOT NULL, digest TEXT)').run();
    const read = db.prepare('SELECT sequence, digest FROM checkpoints WHERE namespace = ?');
    const save = db.prepare('INSERT INTO checkpoints(namespace, sequence, digest) VALUES (?, ?, ?) ON CONFLICT(namespace) DO UPDATE SET sequence=excluded.sequence, digest=excluded.digest');
    const transact = (namespace, update) => {
      requireValue(!closed, 'store closed');
      requireValue(/^sha256:[a-f0-9]{64}$/.test(namespace), 'bounded namespace digest required');
      db.prepare('BEGIN IMMEDIATE').run();
      try {
        const row = read.get(namespace);
        const current = row ? { sequence: row.sequence, digest: row.digest } : { sequence: 0, digest: null };
        requireValue(valid(current), 'stored checkpoint is invalid');
        const result = update(current);
        save.run(namespace, result.sequence, result.digest);
        db.prepare('COMMIT').run(); return result;
      } catch (error) {
        try { db.prepare('ROLLBACK').run(); }
        catch (rollback) { throw new AggregateError([error, rollback], 'Native checkpoint transaction and rollback failed'); }
        throw error;
      }
    };
    return Object.freeze({
      async read(namespace) { return transact(namespace, current => current); },
      async advance(namespace, expected, next) {
        requireValue(valid(expected) && valid(next) && next.sequence > 0, 'valid checkpoints required');
        const prior = structuredClone(expected), observed = structuredClone(next);
        return transact(namespace, current => {
          if (same(current, observed)) return current;
          requireValue(same(current, prior), 'checkpoint changed during verification');
          requireValue(observed.sequence > current.sequence, 'rollback or fork rejected');
          return observed;
        });
      },
      close() { if (!closed) { db.close(); closed = true; } }
    });
  } catch (error) {
    try { db.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native checkpoint opening and cleanup failed'); }
    throw error;
  }
}
