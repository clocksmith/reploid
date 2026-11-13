import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { canonicalRouteAttemptBinding } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { assert, creditPolicy, digest, enrollComputers, fleetCreditQuote, integer, same, text } from './contract.js';
import { createCreditRecovery } from './credit-recovery.js';
import { verifyCreditEvidence } from './credit-evidence.js';

/** Non-redeemable mutual service credit. No purchased lots, issuance, or payout path. */
export async function openFleetCredits({ file, computers, policy: supplied, now = Date.now }) {
  const policy = creditPolicy(supplied), enrollment = await enrollComputers(computers);
  assert(path.isAbsolute(file), 'Absolute service-credit database path required');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try { assert((await handle.stat()).isFile(), 'Credit database must be a regular file'); } finally { await handle.close(); }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS fleet_accounts (id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, held INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS fleet_requests (id TEXT PRIMARY KEY, binding TEXT NOT NULL, state TEXT NOT NULL, outcome TEXT);
    CREATE TABLE IF NOT EXISTS fleet_work (id TEXT PRIMARY KEY, request_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fleet_evidence (request_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fleet_journal (sequence INTEGER PRIMARY KEY, request_id TEXT NOT NULL, account_id TEXT NOT NULL, delta INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS fleet_metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    transaction(() => {
      // Existing balances cannot be reinterpreted using another unit, rate or enrolled owner.
      for (const [id, value] of [['policy', policy], ['enrollment', computers]]) {
        const encoded = canonicalize(value), prior = db.prepare('SELECT value FROM fleet_metadata WHERE id=?').get(id);
        assert(!prior || prior.value === encoded, 'Credit policy or enrollment changed; explicit migration required');
        db.prepare('INSERT OR IGNORE INTO fleet_metadata VALUES (?,?)').run(id, encoded);
      }
      for (const id of enrollment.byId.keys()) db.prepare('INSERT OR IGNORE INTO fleet_accounts (id) VALUES (?)').run(id);
    });
  } catch (error) { db.close(); throw error; }
  const accountFor = peer => { const account = enrollment.byPeer.get(peer); assert(account, 'Unenrolled participant'); return account; };
  const read = id => {
    const row = db.prepare('SELECT * FROM fleet_requests WHERE id=?').get(id);
    const evidence = row && db.prepare('SELECT payload FROM fleet_evidence WHERE request_id=?').get(id);
    return row ? { ...row, binding: JSON.parse(row.binding), outcome: row.outcome && JSON.parse(row.outcome),
      evidence: evidence ? JSON.parse(evidence.payload) : null } : null;
  };
  let ledger;
  const recovery = createCreditRecovery({ db, transaction, read, settle: (id, evidence) => ledger.settle(id, evidence), enrollment, policy, now });
  ledger = Object.freeze({
    enrollment, policy, ...recovery,
    reserve(input) {
      recovery.expire();
      const value = structuredClone(input), consumer = accountFor(value.consumer);
      assert(text(value.id) && text(value.executionId) && ['whole-model', 'partition'].includes(value.mode)
        && text(value.model?.id) && digest(value.model.identity) && Array.isArray(value.model.adapterIdentities)
        && value.model.adapterIdentities.every(digest) && digest(value.inputDigest)
        && integer(value.maxOutputTokens) && value.maxOutputTokens > 0 && value.maxOutputTokens <= policy.maxOutputTokens
        && Array.isArray(value.providers) && value.providers.length > 0 && value.providers.length <= 128,
      'Invalid credit reservation');
      let weight = 0;
      for (const provider of value.providers) {
        const owner = accountFor(provider.participantId);
        assert(integer(provider.weight) && provider.weight > 0 && (value.mode === 'partition' || owner.computerId !== consumer.computerId)
          && (policy.allowSameOwner || owner.ownerId !== consumer.ownerId), 'Ineligible credited provider');
        weight += provider.weight;
      }
      assert(Number.isSafeInteger(weight), 'Invalid total stage weight');
      if (value.mode === 'whole-model') assert(value.providers.length === 1 && value.route === undefined, 'Whole-model credit needs one provider');
      else {
        value.route = canonicalRouteAttemptBinding(value.route);
        assert(value.route.attemptId === value.executionId, 'Partition attempt differs');
        // Canonical route validation and exact provider ordering happen before disclosure.
        const recipients = value.route.route.stages.map(stage => stage.participantId);
        assert(Array.isArray(recipients) && same(recipients, value.providers.map(row => row.participantId)), 'Partition credit recipients differ');
        assert(value.route.requesterId === value.consumer && value.route.route.modelId === value.model.id && value.route.route.modelIdentity === value.model.identity,
          'Partition model differs');
      }
      const requestHash = createHash('sha256').update(canonicalize(value)).digest('hex');
      return transaction(() => {
        const prior = read(value.id);
        if (prior) { assert(prior.binding.requestHash === requestHash, 'Reservation identity reused with different terms'); return prior.binding; }
        if (value.acceptedQuote !== undefined) assert(same(value.acceptedQuote, fleetCreditQuote(policy, value.maxOutputTokens, value.mode)),
          'Accepted service-credit quote changed; review terms before retrying');
        const account = db.prepare('SELECT * FROM fleet_accounts WHERE id=?').get(consumer.computerId);
        const pending = db.prepare("SELECT COUNT(*) AS count FROM fleet_requests WHERE state IN ('reserved','dispatched','closing') AND json_extract(binding,'$.computerId')=?").get(consumer.computerId).count;
        const maximum = value.maxOutputTokens * policy.creditsPerOutputToken;
        assert(pending < policy.maxPendingPerComputer && account.balance - account.held - maximum >= -policy.maxDebt,
          'Service-credit admission limit reached');
        const createdAt = now();
        const binding = { ...value, requestHash, computerId: consumer.computerId, maximum,
          policyVersion: policy.version, terminalCharge: value.mode === 'whole-model' ? policy.wholeModelTerminalCharge ?? null : null,
          admissionVersion: 1, createdAt, deadline: createdAt + policy.maxRequestMs };
        db.prepare("INSERT INTO fleet_requests VALUES (?,?,'reserved',NULL)").run(value.id, JSON.stringify(binding));
        db.prepare('UPDATE fleet_accounts SET held=held+? WHERE id=?').run(maximum, consumer.computerId);
        return binding;
      });
    },
    async settle(id, evidence) {
      evidence = structuredClone(evidence);
      const row = read(id); assert(row, 'Unknown credit reservation');
      const observed = await verifyCreditEvidence(row.binding, evidence, enrollment, now(), policy.maxClockSkewMs, { unadmitted: recovery.unadmitted(id) });
      assert(!observed.terminalStatus || integer(observed.fixedCharge), 'Accepted fixed terminal terms required');
      const economicHash = createHash('sha256').update(canonicalize(observed)).digest('hex');
      const previousEconomicHash = row.outcome?.economicHash ?? (row.evidence ? createHash('sha256').update(canonicalize(
        await verifyCreditEvidence(row.binding, row.evidence, enrollment, now(), policy.maxClockSkewMs))).digest('hex') : null);
      const evidenceHash = createHash('sha256').update(canonicalize(evidence)).digest('hex');
      return transaction(() => {
        const current = read(id);
        if (current.state === 'settled') {
          assert(current.outcome.evidenceHash === evidenceHash || current.outcome.economicHash === economicHash || previousEconomicHash === economicHash, 'Conflicting completed evidence');
          db.prepare('INSERT OR IGNORE INTO fleet_evidence VALUES (?,?)').run(id, JSON.stringify(evidence));
          return current.outcome;
        }
        assert(['dispatched', 'closing'].includes(current.state), 'Request no longer admits settlement');
        const request = current.binding, totalUnits = observed.fixedCharge ?? observed.outputTokens * policy.creditsPerOutputToken;
        const totalWeight = request.providers.reduce((sum, row) => sum + row.weight, 0);
        let remaining = totalUnits, ownComputeUnits = 0;
        const credits = request.providers.map((provider, index) => {
          // Integer arithmetic, stable stage-order remainder; every credited unit has a matching debit.
          const amount = index === request.providers.length - 1 ? remaining
            : Number(BigInt(totalUnits) * BigInt(provider.weight) / BigInt(totalWeight));
          remaining -= amount;
          const computerId = accountFor(provider.participantId).computerId;
          if (computerId === request.computerId) ownComputeUnits += amount;
          return { participantId: provider.participantId, computerId, amount };
        }).filter(row => row.computerId !== request.computerId);
        const charge = totalUnits - ownComputeUnits;
        for (const work of observed.workIds) db.prepare('INSERT INTO fleet_work VALUES (?,?)').run(work, id);
        const deltas = new Map([[request.computerId, -charge]]);
        for (const credit of credits) deltas.set(credit.computerId, (deltas.get(credit.computerId) || 0) + credit.amount);
        for (const [computerId, delta] of deltas) {
          const account = db.prepare('SELECT balance FROM fleet_accounts WHERE id=?').get(computerId);
          assert(Number.isSafeInteger(account.balance + delta), 'Credit balance exceeds integer precision');
          db.prepare('UPDATE fleet_accounts SET balance=balance+? WHERE id=?').run(delta, computerId);
          db.prepare('INSERT INTO fleet_journal (request_id,account_id,delta,at) VALUES (?,?,?,?)').run(id, computerId, delta, now());
        }
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.maximum, request.computerId);
        const outcome = { id, unit: policy.unit, charge, ownComputeUnits, outputTokens: observed.outputTokens,
          ...(observed.terminalStatus ? { status: observed.terminalStatus, usage: null } : {}),
          credits, evidenceHash, economicHash, settledAt: now() };
        db.prepare('INSERT INTO fleet_evidence VALUES (?,?)').run(id, JSON.stringify(evidence));
        db.prepare("UPDATE fleet_requests SET state='settled',outcome=? WHERE id=?").run(JSON.stringify(outcome), id);
        return outcome;
      });
    },
    dispatch(id, consumer) {
      return transaction(() => {
        const row = read(id);
        assert(row?.binding.consumer === consumer && ['reserved', 'dispatched'].includes(row.state)
          && (row.state === 'dispatched' || now() < row.binding.deadline),
          'Request cannot dispatch');
        db.prepare("UPDATE fleet_requests SET state='dispatched' WHERE id=?").run(id);
        return row.binding;
      });
    },
    /** Only a request that never left the requester can release without execution evidence. */
    abandonBeforeDispatch(id, consumer) {
      return transaction(() => {
        const row = read(id); assert(row?.binding.consumer === consumer, 'Reservation consumer differs');
        assert(row.state === 'reserved', 'Reservation already closed');
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(row.binding.maximum, row.binding.computerId);
        db.prepare("UPDATE fleet_requests SET state='abandoned' WHERE id=?").run(id);
      });
    },
    request: read,
    snapshot() {
      recovery.expire();
      const accounts = db.prepare('SELECT * FROM fleet_accounts ORDER BY id').all().map(row => ({ ...row,
        name: enrollment.byId.get(row.id).name, available: row.balance - row.held }));
      const journal = db.prepare('SELECT * FROM fleet_journal ORDER BY sequence').all();
      assert(accounts.reduce((sum, row) => sum + BigInt(row.balance), 0n) === 0n, 'Service credit conservation failed');
      return { unit: policy.unit, policyVersion: policy.version, accounts, journal };
    },
    close() { db.close(); }
  });
  return ledger;
}
