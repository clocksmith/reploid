/** The Durable Object SQLite surface (exec + one atomic block) over node:sqlite, for Node tests. */
import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
import { createSqliteFirestore } from '../../server/cloudflare/api/sqlite-firestore.js';

export function createNodeSqlStorage(file = ':memory:') {
  const db = new DatabaseSync(file);
  const sql = {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      const rows = /^\s*(SELECT|WITH)\b/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => rows, one: () => rows[0] };
    }
  };
  const atomically = (fn) => {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return { db, sql, atomically };
}

export function createNodeSqliteFirestore(file) {
  const storage = createNodeSqlStorage(file);
  return { ...storage, firestore: createSqliteFirestore(storage) };
}
