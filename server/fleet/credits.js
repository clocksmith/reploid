import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { canonicalRouteAttemptBinding } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { assert, creditPolicy, digest, enrollComputers, fleetCreditQuote, integer, same, text } from './contract.js';
import { createCreditRecovery } from './credit-recovery.js';
import { verifyCreditEvidence } from './credit-evidence.js';
import { creditSettlementDeltas, settledCreditUnits, UNFINISHED_ANSWER_TERMS } from './credit-shares.js';

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
        && (value.settingsDigest === undefined || digest(value.settingsDigest) && value.mode === 'whole-model')
        // Optional, whole-model only: the commitment a provider may check before the prompt is disclosed.
        && (value.admission === undefined || value.mode === 'whole-model' && value.admission?.schema === 'reploid.credit-preadmission/v1'
          && digest(value.admission.commitment) && Object.keys(value.admission).length === 2)
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
      assert(value.unfinishedTerms === undefined, 'Unfinished-answer terms are set by the ledger');
      // A retry of a reservation made before these terms existed must still find it.
      const earlierHash = createHash('sha256').update(canonicalize(value)).digest('hex');
      if (value.mode === 'partition') value.unfinishedTerms = UNFINISHED_ANSWER_TERMS;
      const requestHash = createHash('sha256').update(canonicalize(value)).digest('hex');
      return transaction(() => {
        const prior = read(value.id);
        if (prior) { assert([requestHash, earlierHash].includes(prior.binding.requestHash), 'Reservation identity reused with different terms'); return prior.binding; }
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
          // admissionVersion says the ledger journals every admission of this request, which is what lets a
          // fenced request that nobody admitted settle at zero. A pre-disclosure commitment is versioned by its
          // own schema in `admission` and does not change that.
          admissionVersion: 1, createdAt, deadline: createdAt + policy.maxRequestMs };
        db.prepare("INSERT INTO fleet_requests VALUES (?,?,'reserved',NULL)").run(value.id, JSON.stringify(binding));
        db.prepare('UPDATE fleet_accounts SET held=held+? WHERE id=?').run(maximum, consumer.computerId);
        return binding;
      });
    },
    async settle(id, evidence) {
      recovery.expire();
      evidence = structuredClone(evidence);
      const row = read(id); assert(row, 'Unknown credit reservation');
      assert(row.state !== 'settled' || row.outcome?.status !== 'expired', 'Claim window closed; this hold was released unclaimed');
      const observed = await verifyCreditEvidence(row.binding, evidence, enrollment, now(), policy.maxClockSkewMs, { unadmitted: recovery.unadmitted(id), interrupted: recovery.interrupted(id) });
      assert(!observed.terminalStatus || integer(observed.fixedCharge), 'Accepted fixed terminal terms required');
      const { interruptedStages, ...economics } = observed;
      const economicHash = createHash('sha256').update(canonicalize(economics)).digest('hex');
      const previousEconomicHash = row.outcome?.economicHash ?? (row.evidence ? createHash('sha256').update(canonicalize(
        await verifyCreditEvidence(row.binding, row.evidence, enrollment, now(), policy.maxClockSkewMs))).digest('hex') : null);
      const evidenceHash = createHash('sha256').update(canonicalize(evidence)).digest('hex');
      return transaction(() => {
        const current = read(id);
        if (current.state === 'settled') {
          assert(current.outcome.status !== 'expired', 'Claim window closed; this hold was released unclaimed');
          assert(current.outcome.evidenceHash === evidenceHash || current.outcome.economicHash === economicHash || previousEconomicHash === economicHash, 'Conflicting completed evidence');
          db.prepare('INSERT OR IGNORE INTO fleet_evidence VALUES (?,?)').run(id, JSON.stringify(evidence));
          return current.outcome;
        }
        assert(['dispatched', 'closing'].includes(current.state), 'Request no longer admits settlement');
        const request = current.binding, totalUnits = settledCreditUnits(request, observed, policy.creditsPerOutputToken);
        const { credits, ownComputeUnits, charge, deltas } = creditSettlementDeltas(request, totalUnits, peer => accountFor(peer).computerId);
        for (const work of observed.workIds) db.prepare('INSERT INTO fleet_work VALUES (?,?)').run(work, id);
        for (const [computerId, delta] of deltas) {
          const account = db.prepare('SELECT balance FROM fleet_accounts WHERE id=?').get(computerId);
          assert(Number.isSafeInteger(account.balance + delta), 'Credit balance exceeds integer precision');
          db.prepare('UPDATE fleet_accounts SET balance=balance+? WHERE id=?').run(delta, computerId);
          db.prepare('INSERT INTO fleet_journal (request_id,account_id,delta,at) VALUES (?,?,?,?)').run(id, computerId, delta, now());
        }
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.maximum, request.computerId);
        const outcome = { id, unit: policy.unit, charge, ownComputeUnits, outputTokens: observed.outputTokens,
          ...(observed.terminalStatus ? { status: observed.terminalStatus, usage: null } : {}),
          ...(interruptedStages ? { status: 'failed', reason: 'interrupted-stage-owner', interruptedStages } : {}),
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
    /** Only a request that never left the requester can release without execution evidence. Repeating the
     * call after it succeeded (for example when the first reply was lost) releases nothing further. */
    abandonBeforeDispatch(id, consumer) {
      return transaction(() => {
        const row = read(id); assert(row?.binding.consumer === consumer, 'Reservation consumer differs');
        if (row.state === 'abandoned') return;
        assert(row.state === 'reserved', 'Reservation already closed');
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(row.binding.maximum, row.binding.computerId);
        db.prepare("UPDATE fleet_requests SET state='abandoned' WHERE id=?").run(id);
      });
    },
    request: read,
    /** Everything one computer needs to check its own balance without this ledger: each journal entry with the
     * request's accepted terms, its outcome and the signed evidence it was settled on (credit-statement.js). */
    statement(computerId) {
      recovery.expire();
      const account = db.prepare('SELECT * FROM fleet_accounts WHERE id=?').get(computerId);
      assert(account, 'Unknown service-credit account');
      const entries = db.prepare('SELECT * FROM fleet_journal WHERE account_id=? ORDER BY sequence').all(computerId).map(row => {
        const request = read(row.request_id);
        return { sequence: row.sequence, requestId: row.request_id, delta: row.delta, at: row.at,
          request: request.binding, outcome: request.outcome, evidence: request.evidence };
      });
      const expired = db.prepare("SELECT id FROM fleet_requests WHERE state='settled' ORDER BY rowid").all()
        .map(row => read(row.id))
        .filter(row => row.outcome?.status === 'expired'
          && (row.binding.computerId === computerId
            || row.binding.providers.some(provider => accountFor(provider.participantId).computerId === computerId)))
        .map(row => ({ requestId: row.id, request: row.binding, outcome: row.outcome }));
      return { schema: 'reploid.fleet-credit-statement/v1', computerId, unit: policy.unit, policy: structuredClone(policy),
        computers: structuredClone(computers), balance: account.balance, held: account.held, issuedAt: now(), entries, expired };
    },
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
