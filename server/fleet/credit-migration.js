/**
 * Explicit, operator-run migration of an existing service-credit ledger.
 *
 * Two changes, applied together in one SQLite transaction and recorded in the ledger:
 *
 * - Owner accounts. A ledger written before owner accounts kept one balance per enrolled computer, so credit one of an
 *   owner's computers earned could not pay for another's request. Each owner's computer balances and holds are summed
 *   into one owner account. Every existing journal row keeps its delta and gains the computer it was attributed to; a
 *   request reserved before the migration still settles with the per-computer arithmetic it was accepted under
 *   (credit-shares.js `accountSettlement`). Totals are conserved: nothing is issued, forgiven or converted.
 * - Default credit terms (contract.js `withCreditPolicyDefaults`): the two unclaimed-hold release windows and the
 *   starter debt limit, when the stored policy left them out, and the published acknowledgment bound
 *   `maxUnacknowledgedOutputs` (K), which may be added but never changed. A new policy version is required whenever a term
 *   changes. No other term (unit, rate, output ceiling, request deadline, terminal charge, same-owner rule) can change
 *   here, and the enrollment must be exactly the stored one.
 *
 * After it, a hold still open from before the migration is released at its deadline plus the release window, like
 * every other hold. Repeating the migration with the same inputs returns the retained record and changes nothing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { assert, creditPolicy, enrollComputers, same, withCreditPolicyDefaults } from './contract.js';
import { FLEET_ACCOUNT_UNIT, ensureJournalAttribution, ownerAccounts } from './credits.js';

export const FLEET_CREDIT_MIGRATION_SCHEMA = 'reploid.fleet-credit-migration/v1';
/** The terms this migration may add or change. Anything else differing is refused. */
const MIGRATABLE_TERMS = ['version', 'wholeModelUnclaimedReleaseMs', 'partitionUnclaimedReleaseMs', 'maxDebt', 'maxUnacknowledgedOutputs'];

export async function migrateFleetCredits({ file, computers, policy: supplied, now = Date.now }) {
  const policy = creditPolicy(withCreditPolicyDefaults(supplied)), enrollment = await enrollComputers(computers, { allowEmpty: true });
  assert(path.isAbsolute(file), 'Absolute service-credit database path required');
  const handle = await fs.open(file, constants.O_RDWR | constants.O_NOFOLLOW);
  try { assert((await handle.stat()).isFile(), 'Existing credit database required'); } finally { await handle.close(); }
  const db = new DatabaseSync(file);
  let open = false;
  try {
    db.exec('BEGIN IMMEDIATE'); open = true;
    const meta = id => db.prepare('SELECT value FROM fleet_metadata WHERE id=?').get(id)?.value ?? null;
    const storedEnrollment = meta('enrollment'), storedPolicyText = meta('policy');
    assert(storedEnrollment && storedPolicyText, 'Existing credit database required');
    assert(storedEnrollment === canonicalize(computers), 'Enrollment differs from the ledger; this migration keeps enrollment unchanged');
    const previousPolicy = JSON.parse(storedPolicyText), previousUnit = meta('account-unit');
    const termsChanged = canonicalize(previousPolicy) !== canonicalize(policy);
    if (!termsChanged && previousUnit === FLEET_ACCOUNT_UNIT) {
      const prior = meta(`credit-migration:${policy.version}`);
      db.exec('COMMIT'); open = false;
      return prior ? JSON.parse(prior) : { schema: FLEET_CREDIT_MIGRATION_SCHEMA, unchanged: true, policy };
    }
    const fixed = value => Object.fromEntries(Object.entries(value).filter(([key]) => !MIGRATABLE_TERMS.includes(key)));
    assert(same(fixed(previousPolicy), fixed(policy)), 'This migration can only add release windows or change the debt limit');
    for (const key of ['wholeModelUnclaimedReleaseMs', 'partitionUnclaimedReleaseMs', 'maxUnacknowledgedOutputs']) {
      assert(previousPolicy[key] === undefined || previousPolicy[key] === policy[key], `Migration cannot change an existing ${key}`);
    }
    assert(!termsChanged || policy.version !== previousPolicy.version, 'Changed credit terms need a new policy version');
    assert(!meta(`credit-migration:${policy.version}`), 'A migration to this policy version is already recorded');

    const before = db.prepare('SELECT * FROM fleet_accounts ORDER BY id').all();
    const accounts = ownerAccounts(enrollment);
    let after = before;
    if (previousUnit !== FLEET_ACCOUNT_UNIT) {
      // Per computer to per owner: sum each owner's computers, then attribute every existing journal row.
      const ownerOf = new Map([...enrollment.byId.values()].map(computer => [computer.id, computer.ownerId]));
      // An open (self-serve) ledger appended its accounts to its own enrollment journal.
      const log = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fleet_enrollment_log'").get()
        ? db.prepare("SELECT entry FROM fleet_enrollment_log WHERE kind='computer' ORDER BY sequence").all().map(row => JSON.parse(row.entry)) : [];
      for (const computer of log) ownerOf.set(computer.id, computer.ownerId);
      const sums = new Map([...new Set([...accounts.keys(), ...ownerOf.values()])].map(id => [id, { balance: 0n, held: 0n }]));
      for (const row of before) {
        const owner = ownerOf.get(row.id);
        assert(owner, `Ledger account ${row.id} is not an enrolled computer`);
        sums.get(owner).balance += BigInt(row.balance); sums.get(owner).held += BigInt(row.held);
      }
      ensureJournalAttribution(db);
      db.exec('DELETE FROM fleet_accounts');
      for (const [id, sum] of sums) {
        assert(Number.isSafeInteger(Number(sum.balance)) && Number.isSafeInteger(Number(sum.held)), 'Owner balance exceeds integer precision');
        db.prepare('INSERT INTO fleet_accounts (id,balance,held) VALUES (?,?,?)').run(id, Number(sum.balance), Number(sum.held));
      }
      for (const [computerId, ownerId] of ownerOf) {
        db.prepare('UPDATE fleet_journal SET computer_id=account_id, account_id=? WHERE account_id=? AND computer_id IS NULL').run(ownerId, computerId);
      }
      assert(db.prepare('SELECT COUNT(*) AS count FROM fleet_journal WHERE computer_id IS NULL').get().count === 0,
        'A journal row names an account outside the enrollment');
      after = db.prepare('SELECT * FROM fleet_accounts ORDER BY id').all();
    }
    const total = rows => rows.reduce((sum, row) => sum + BigInt(row.balance), 0n);
    const held = rows => rows.reduce((sum, row) => sum + BigInt(row.held), 0n);
    assert(total(after) === 0n && total(before) === total(after) && held(before) === held(after), 'Service credit conservation failed');
    const record = { schema: FLEET_CREDIT_MIGRATION_SCHEMA, previousPolicy, policy, previousAccountUnit: previousUnit ?? 'computer',
      accountUnit: FLEET_ACCOUNT_UNIT, accountsBefore: before.map(({ id, balance, held: hold }) => ({ id, balance, held: hold })),
      accountsAfter: after.map(({ id, balance, held: hold }) => ({ id, balance, held: hold })), migratedAt: now() };
    db.prepare('INSERT INTO fleet_metadata VALUES (?,?)').run(`credit-migration:${policy.version}`, JSON.stringify(record));
    db.prepare("INSERT OR REPLACE INTO fleet_metadata VALUES ('account-unit',?)").run(FLEET_ACCOUNT_UNIT);
    db.prepare("UPDATE fleet_metadata SET value=? WHERE id='policy'").run(canonicalize(policy));
    db.exec('COMMIT'); open = false;
    return record;
  } catch (error) { if (open) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}

// node server/fleet/credit-migration.js /absolute/service.json: the same service configuration the ledger runs with.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const configFile = process.argv[2];
  assert(configFile && path.isAbsolute(configFile), 'Usage: node server/fleet/credit-migration.js /absolute/service.json');
  const configuration = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert(configuration.schema === 'reploid.fleet-service/v1', 'Explicit fleet service configuration required');
  const computers = JSON.parse(await fs.readFile(configuration.enrollmentFile, 'utf8'));
  console.log(JSON.stringify(await migrateFleetCredits({ file: configuration.databaseFile, computers, policy: configuration.creditPolicy }), null, 2));
}
