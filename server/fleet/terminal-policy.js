/** Explicit operator acceptance of fixed whole-model terminal terms.
 * Existing completed balances and metered rates are never reinterpreted. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { assert, creditPolicy, same, text } from './contract.js';

export async function acceptFleetTerminalPolicy({ file, previousVersion, policy: supplied, requestIds, now = Date.now }) {
  const policy = creditPolicy(supplied);
  assert(path.isAbsolute(file) && text(previousVersion) && policy.version !== previousVersion
    && policy.wholeModelTerminalCharge === 0 && Array.isArray(requestIds)
    && requestIds.length <= 2048 && requestIds.every(text) && new Set(requestIds).size === requestIds.length,
  'Explicit zero-charge terminal policy and reservation scope required');
  const handle = await fs.open(file, constants.O_RDWR | constants.O_NOFOLLOW);
  try { assert((await handle.stat()).isFile(), 'Existing credit database required'); } finally { await handle.close(); }
  const db = new DatabaseSync(file);
  let transactionOpen = false;
  try {
    db.exec('BEGIN IMMEDIATE'); transactionOpen = true;
    const key = `terminal-policy:${policy.version}`;
    const priorAcceptance = db.prepare('SELECT value FROM fleet_metadata WHERE id=?').get(key);
    const acceptance = { schema: 'reploid.fleet-terminal-policy/v1', previousVersion, policy, requestIds };
    if (priorAcceptance) {
      const retained = JSON.parse(priorAcceptance.value);
      assert(same(retained.acceptance, acceptance), 'Terminal policy acceptance scope changed');
      db.exec('COMMIT'); transactionOpen = false; return retained;
    }
    const current = JSON.parse(db.prepare("SELECT value FROM fleet_metadata WHERE id='policy'").get().value);
    const { version: _oldVersion, wholeModelTerminalCharge: _oldCharge, ...oldTerms } = current;
    const { version: _newVersion, wholeModelTerminalCharge: _newCharge, ...newTerms } = policy;
    assert(current.version === previousVersion && same(oldTerms, newTerms), 'Terminal migration cannot change metered terms');
    for (const id of requestIds) {
      const row = db.prepare('SELECT binding,state FROM fleet_requests WHERE id=?').get(id);
      const binding = row && JSON.parse(row.binding);
      assert(binding?.mode === 'whole-model' && ['reserved', 'dispatched', 'closing'].includes(row.state)
        && binding.terminalCharge == null, 'Only explicitly listed unresolved whole-model terms may change');
      binding.terminalCharge = 0;
      binding.terminalPolicyVersion = policy.version;
      db.prepare('UPDATE fleet_requests SET binding=? WHERE id=?').run(JSON.stringify(binding), id);
    }
    const record = { acceptance, previousPolicy: current, acceptedAt: now() };
    db.prepare('INSERT INTO fleet_metadata VALUES (?,?)').run(key, JSON.stringify(record));
    db.prepare("UPDATE fleet_metadata SET value=? WHERE id='policy'").run(canonicalize(policy));
    db.exec('COMMIT'); transactionOpen = false; return record;
  } catch (error) { if (transactionOpen) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
