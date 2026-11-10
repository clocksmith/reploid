/** Process-safe cumulative supply allowance. A successful reservation is never refunded. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { custodyBudgetError, reserveCustodyBudget } from '../packages/reploid/src/artifacts/custody/supply-budget.js';

export async function openNativeSupplyBudget(options) {
  try { return await openStore(options); }
  catch (cause) {
    if (cause.code?.startsWith('CUSTODY_BUDGET_')) throw cause;
    throw custodyBudgetError('STORAGE', 'File contribution ledger unavailable; serving is blocked', cause);
  }
}
async function openStore({ directory, maxBytes }) {
  const { DatabaseSync } = await import('node:sqlite');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await fs.realpath(directory), filename = path.join(root, 'custody-budget.sqlite');
  const entries = await fs.readdir(root);
  const legacy = entries.some(name => !name.startsWith('custody-budget.sqlite'));
  const handle = await fs.open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  let existed;
  try { const stat = await handle.stat(); if (!stat.isFile()) throw custodyBudgetError('STORAGE', 'Budget store must be a regular file'); existed = stat.size > 0; }
  finally { await handle.close(); }
  const db = new DatabaseSync(filename); let closed = false, state;
  const transaction = bytes => {
    if (closed) throw custodyBudgetError('STORAGE', 'File contribution budget closed');
    db.prepare('BEGIN IMMEDIATE').run();
    try {
      const row = db.prepare('SELECT record FROM allowance WHERE id = 1').get();
      let record;
      try { record = row && JSON.parse(row.record); }
      catch (cause) { throw custodyBudgetError('CORRUPT', 'File contribution ledger is corrupt', cause); }
      const next = reserveCustodyBudget(record, bytes, maxBytes);
      db.prepare('UPDATE allowance SET record = ? WHERE id = 1').run(JSON.stringify(next));
      db.prepare('COMMIT').run(); state = next; return { ...state };
    } catch (error) {
      try { db.prepare('ROLLBACK').run(); }
      catch (rollback) { throw new AggregateError([error, rollback], 'Budget transaction and rollback failed'); }
      throw error;
    }
  };
  try {
    db.prepare('PRAGMA busy_timeout=1000').run();
    db.prepare('PRAGMA synchronous=FULL').run();
    db.prepare('BEGIN IMMEDIATE').run();
    try {
      db.prepare('CREATE TABLE IF NOT EXISTS allowance (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)').run();
      if (!db.prepare('SELECT id FROM allowance WHERE id=1').get()) {
        if (existed || legacy) throw custodyBudgetError('MISSING', 'File contribution ledger missing for existing cache; allowance cannot be renewed');
        const initial = { schema: 'reploid.custody-supply-budget/v1', maxBytes, reservedBytes: 0 };
        reserveCustodyBudget(initial, 0, maxBytes);
        db.prepare('INSERT INTO allowance VALUES (1, ?)').run(JSON.stringify(initial));
      }
      db.prepare('COMMIT').run();
    } catch (error) { db.prepare('ROLLBACK').run(); throw error; }
    transaction(0);
    return Object.freeze({ getState: () => ({ ...state }), reserve: async bytes => {
        try { return transaction(bytes); }
        catch (cause) {
          if (cause.code?.startsWith('CUSTODY_BUDGET_')) throw cause;
          throw custodyBudgetError('STORAGE', 'File contribution reservation not confirmed', cause);
        }
      },
      close() { if (!closed) { db.close(); closed = true; } } });
  } catch (error) { db.close(); throw error; }
}
