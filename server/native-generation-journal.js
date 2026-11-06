/** Durable admission fences and bounded result replay. No prompt text is stored. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';

export async function openNativeGenerationJournal({ file, maxResults, maxResultBytes }) {
  if (!path.isAbsolute(file) || !Number.isSafeInteger(maxResults) || maxResults < 1
    || !Number.isSafeInteger(maxResultBytes) || maxResultBytes < 1) throw Error('Explicit generation journal limits required');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try { if (!(await handle.stat()).isFile()) throw Error('Generation journal must be a regular file'); }
  finally { await handle.close(); }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS generation (id TEXT PRIMARY KEY, binding TEXT NOT NULL, outcome TEXT, finished INTEGER NOT NULL DEFAULT 0)');
  let closed = false;
  const key = binding => JSON.stringify([binding.provider, binding.consumer, binding.requestId]);
  return Object.freeze({
    async get(binding) {
      const row = db.prepare('SELECT binding, outcome FROM generation WHERE id = ?').get(key(binding));
      return row ? { binding: JSON.parse(row.binding), outcome: row.outcome ? JSON.parse(row.outcome) : null } : null;
    },
    async claim(binding) {
      return db.prepare('INSERT OR IGNORE INTO generation (id, binding) VALUES (?, ?)')
        .run(key(binding), JSON.stringify(binding)).changes === 1;
    },
    async finish(binding, outcome) {
      const serialized = JSON.stringify(outcome);
      if (Buffer.byteLength(serialized) > maxResultBytes) throw Error('Generation recovery result exceeds retained byte limit');
      db.exec('BEGIN IMMEDIATE');
      try {
        const changed = db.prepare('UPDATE generation SET outcome = ?, finished = 1 WHERE id = ? AND finished = 0').run(serialized, key(binding));
        if (changed.changes !== 1) throw Error('Generation missing or already finished');
        // Keep admission fences when pruning result bodies. A replay cannot execute again.
        db.prepare('UPDATE generation SET outcome = NULL WHERE outcome IS NOT NULL AND rowid NOT IN '
          + '(SELECT rowid FROM generation WHERE outcome IS NOT NULL ORDER BY rowid DESC LIMIT ?)').run(maxResults);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { if (!closed) { closed = true; db.close(); } }
  });
}
