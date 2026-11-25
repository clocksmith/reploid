import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { assert, creditPolicy, creditRefusal, digest, enrollComputer, enrollComputers, enrollmentKey, fleetCreditQuote, integer, same, text,
  withCreditPolicyDefaults } from './contract.js';
import { createCreditRecovery } from './credit-recovery.js';
import { verifyCreditEvidence } from './credit-evidence.js';
import { accountSettlement, settledCreditUnits, UNFINISHED_ANSWER_TERMS } from './credit-shares.js';

/** Balances are kept per owner account: every computer and key an owner enrolled spends and earns one balance. */
export const FLEET_ACCOUNT_UNIT = 'owner/v1';
export const FLEET_CREDIT_STATEMENT_V2_SCHEMA = 'reploid.fleet-credit-statement/v2';

/** The owner accounts of an enrollment, each with its computers in enrollment order. */
export function ownerAccounts(enrollment) {
  const accounts = new Map();
  for (const computer of enrollment.byId.values()) {
    if (!accounts.has(computer.ownerId)) accounts.set(computer.ownerId, []);
    accounts.get(computer.ownerId).push(computer);
  }
  return accounts;
}

/** Adds the journal's per-computer attribution column to a database written before owner accounts. */
export function ensureJournalAttribution(db) {
  if (!db.prepare('PRAGMA table_info(fleet_journal)').all().some(column => column.name === 'computer_id')) {
    db.exec('ALTER TABLE fleet_journal ADD COLUMN computer_id TEXT');
  }
}

/** Non-redeemable mutual service credit. No purchased lots, issuance, or payout path.
 * `openEnrollment` lets the ledger start from an empty operator enrollment and append accounts and keys
 * through its own journal (self-serve.js); every appended record is checked as an enrollment file is. */
export async function openFleetCredits({ file, computers, policy: supplied, now = Date.now, openEnrollment = false }) {
  const policy = creditPolicy(withCreditPolicyDefaults(supplied)), enrollment = await enrollComputers(computers, { allowEmpty: openEnrollment === true });
  // Owner accounts and their computers, read live: an open ledger appends accounts and keys as it runs.
  const accounts = () => ownerAccounts(enrollment);
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
    CREATE TABLE IF NOT EXISTS fleet_journal (sequence INTEGER PRIMARY KEY, request_id TEXT NOT NULL, account_id TEXT NOT NULL, delta INTEGER NOT NULL, at INTEGER NOT NULL, computer_id TEXT);
    CREATE TABLE IF NOT EXISTS fleet_metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fleet_enrollment_log (sequence INTEGER PRIMARY KEY, computer_id TEXT NOT NULL, kind TEXT NOT NULL, entry TEXT NOT NULL, at INTEGER NOT NULL);`);
  ensureJournalAttribution(db);
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    transaction(() => {
      // Existing balances cannot be reinterpreted using another unit, rate or enrolled owner.
      const existing = db.prepare("SELECT value FROM fleet_metadata WHERE id='policy'").get();
      const priorMode = db.prepare("SELECT value FROM fleet_metadata WHERE id='enrollmentMode'").get();
      assert(!existing || !priorMode === (openEnrollment !== true), 'Credit enrollment mode changed; explicit migration required');
      const unit = db.prepare("SELECT value FROM fleet_metadata WHERE id='account-unit'").get()?.value;
      assert(!existing || unit === FLEET_ACCOUNT_UNIT, 'This ledger keeps balances per computer; migrate it to owner accounts first'
        + ' (node server/fleet/credit-migration.js /absolute/service.json)');
      for (const [id, value] of [['policy', policy], ['enrollment', computers], ...(openEnrollment === true ? [['enrollmentMode', 'open']] : [])]) {
        const encoded = canonicalize(value), prior = db.prepare('SELECT value FROM fleet_metadata WHERE id=?').get(id);
        assert(!prior || prior.value === encoded, 'Credit policy or enrollment changed; explicit migration required'
          + ' (node server/fleet/credit-migration.js /absolute/service.json)');
        db.prepare('INSERT OR IGNORE INTO fleet_metadata VALUES (?,?)').run(id, encoded);
      }
      db.prepare("INSERT OR IGNORE INTO fleet_metadata VALUES ('account-unit',?)").run(FLEET_ACCOUNT_UNIT);
      for (const id of accounts().keys()) db.prepare('INSERT OR IGNORE INTO fleet_accounts (id) VALUES (?)').run(id);
    });
    // Appended enrollment replays in journal order, checked exactly as when it was first written.
    for (const row of db.prepare('SELECT * FROM fleet_enrollment_log ORDER BY sequence').all()) await applyEnrollment(enrollment, row.kind, row.computer_id, JSON.parse(row.entry));
  } catch (error) { db.close(); throw error; }
  const accountFor = peer => { const account = enrollment.byPeer.get(peer); assert(account, 'Unenrolled participant'); return account; };
  const activeAccountFor = peer => { const account = accountFor(peer); assert(account.revokedAt === undefined, 'This computer key was removed from its account'); return account; };
  /** Record one enrollment change, then apply it. A record that fails its checks changes nothing. */
  // One enrollment change at a time, so each is checked against every change committed before it.
  let enrollmentWrites = Promise.resolve();
  const appendEnrollment = (kind, computerId, entry) => {
    const run = enrollmentWrites.then(() => writeEnrollment(kind, computerId, entry));
    enrollmentWrites = run.catch(() => {});
    return run;
  };
  const writeEnrollment = async (kind, computerId, entry) => {
    assert(openEnrollment === true, 'This ledger uses a fixed operator enrollment; explicit migration required');
    const trial = { byId: new Map([...enrollment.byId].map(([id, row]) => [id, structuredClone(row)])), byPeer: new Map(enrollment.byPeer) };
    await applyEnrollment(trial, kind, computerId, entry);
    const at = now();
    transaction(() => {
      db.prepare('INSERT INTO fleet_enrollment_log (computer_id, kind, entry, at) VALUES (?,?,?,?)').run(computerId, kind, JSON.stringify(entry), at);
      // A new account's balance is its owner's: one row per owner, however many computers it pairs.
      if (kind === 'computer') db.prepare('INSERT OR IGNORE INTO fleet_accounts (id) VALUES (?)').run(entry.ownerId);
    });
    await applyEnrollment(enrollment, kind, computerId, entry);
    return structuredClone(enrollment.byId.get(computerId));
  };
  const placeOf = peer => { const { computerId, ownerId } = accountFor(peer); return { computerId, accountId: ownerId }; };
  // The account a reservation's hold sits on: named since owner accounts, otherwise its computer's owner.
  const holdAccount = binding => binding.accountId ?? enrollment.byId.get(binding.computerId).ownerId;
  const read = id => {
    const row = db.prepare('SELECT * FROM fleet_requests WHERE id=?').get(id);
    const evidence = row && db.prepare('SELECT payload FROM fleet_evidence WHERE request_id=?').get(id);
    return row ? { ...row, binding: JSON.parse(row.binding), outcome: row.outcome && JSON.parse(row.outcome),
      evidence: evidence ? JSON.parse(evidence.payload) : null } : null;
  };
  let ledger;
  const recovery = createCreditRecovery({ db, transaction, read, settle: (id, evidence) => ledger.settle(id, evidence), enrollment, policy, now, holdAccount });
  // An account's debt limit (its starter allowance): the policy's, lowered by any limit set on one of its computers.
  const debtLimitFor = accountId => Math.min(policy.maxDebt, ...(accounts().get(accountId) ?? [])
    .map(computer => computer.debtLimit ?? policy.maxDebt));
  ledger = Object.freeze({
    enrollment, policy, ...recovery, openEnrollment: openEnrollment === true, debtLimitFor,
    /** Open enrollment only: a new account with its first key. */
    enrollAccount: computer => appendEnrollment('computer', computer?.id, computer),
    /** Open enrollment only: another key for an existing account (a further paired computer). */
    enrollKey: (computerId, provider) => appendEnrollment('key', computerId, provider),
    /** Open enrollment only: refuse a key's later requests. Its earlier signatures still verify. */
    revokeKey: (computerId, participantId) => appendEnrollment('revoke', computerId, { participantId, revokedAt: now() }),
    /** Open enrollment only: change one account's debt limit, never above the policy's. */
    setDebtLimit: (computerId, debtLimit) => appendEnrollment('debt-limit', computerId, { debtLimit }),
    enrollmentLog(computerId) {
      return db.prepare('SELECT * FROM fleet_enrollment_log WHERE computer_id=? ORDER BY sequence').all(computerId)
        .map(row => ({ sequence: row.sequence, kind: row.kind, at: row.at, entry: JSON.parse(row.entry) }));
    },
    reserve(input) {
      recovery.expire();
      const value = structuredClone(input), consumer = activeAccountFor(value.consumer);
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
        const owner = activeAccountFor(provider.participantId);
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
        const quote = fleetCreditQuote(policy, value.maxOutputTokens, value.mode);
        if (value.acceptedQuote !== undefined) assert(same(value.acceptedQuote, quote),
          'Accepted service-credit quote changed; review terms before retrying');
        const accountId = consumer.ownerId;
        const account = db.prepare('SELECT * FROM fleet_accounts WHERE id=?').get(accountId);
        const pending = db.prepare("SELECT COUNT(*) AS count FROM fleet_requests WHERE state IN ('reserved','dispatched','closing') AND json_extract(binding,'$.computerId')=?").get(consumer.computerId).count;
        const maximum = value.maxOutputTokens * policy.creditsPerOutputToken;
        // Refused before any hold or disclosure: the requester sends the prompt only after this reservation exists.
        if (pending >= policy.maxPendingPerComputer) throw creditRefusal('SERVICE_CREDIT_PENDING_LIMIT',
          `Service-credit admission limit reached: ${pending} unfinished answers on this account. Nothing was sent.`,
          { quote, pending, maxPending: policy.maxPendingPerComputer });
        const spendable = account.balance - account.held + debtLimitFor(accountId);
        if (spendable < maximum) throw creditRefusal('SERVICE_CREDIT_INSUFFICIENT',
          `Service-credit admission limit reached: not enough service credits. This answer can cost up to ${maximum} and ${Math.max(0, spendable)} can be spent now. Nothing was sent.`,
          { quote, spendable: Math.max(0, spendable), accountId });
        if (policy.maxTotalDebt !== undefined) {
          // Owed now across every account, counting holds as spent, plus what this hold could add.
          const owed = db.prepare('SELECT COALESCE(SUM(MAX(0, held - balance)), 0) AS owed FROM fleet_accounts').get().owed;
          const added = Math.max(0, account.held + maximum - account.balance) - Math.max(0, account.held - account.balance);
          if (owed + added > policy.maxTotalDebt) throw creditRefusal('SERVICE_CREDIT_INSUFFICIENT',
            'Service-credit admission limit reached: the network has lent all the starter credit it allows right now. Serving answers earns credits you can spend. Nothing was sent.',
            { quote, spendable: Math.max(0, spendable), accountId, reason: 'network-debt-cap' });
        }
        const createdAt = now();
        const binding = { ...value, requestHash, computerId: consumer.computerId, accountId, maximum,
          policyVersion: policy.version, terminalCharge: value.mode === 'whole-model' ? policy.wholeModelTerminalCharge ?? null : null,
          // admissionVersion says the ledger journals every admission of this request, which is what lets a
          // fenced request that nobody admitted settle at zero. A pre-disclosure commitment is versioned by its
          // own schema in `admission` and does not change that.
          admissionVersion: 1, createdAt, deadline: createdAt + policy.maxRequestMs };
        db.prepare("INSERT INTO fleet_requests VALUES (?,?,'reserved',NULL)").run(value.id, JSON.stringify(binding));
        db.prepare('UPDATE fleet_accounts SET held=held+? WHERE id=?').run(maximum, accountId);
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
        const { credits, ownComputeUnits, charge, entries, deltas } = accountSettlement(request, totalUnits, placeOf);
        for (const work of observed.workIds) db.prepare('INSERT INTO fleet_work VALUES (?,?)').run(work, id);
        for (const [accountId, delta] of deltas) {
          const account = db.prepare('SELECT balance FROM fleet_accounts WHERE id=?').get(accountId);
          assert(Number.isSafeInteger(account.balance + delta), 'Credit balance exceeds integer precision');
          db.prepare('UPDATE fleet_accounts SET balance=balance+? WHERE id=?').run(delta, accountId);
        }
        // One journal row per account and computer: the balance moves per account, the attribution stays per computer.
        for (const entry of entries) {
          db.prepare('INSERT INTO fleet_journal (request_id,account_id,delta,at,computer_id) VALUES (?,?,?,?,?)')
            .run(id, entry.accountId, entry.delta, now(), entry.computerId);
        }
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.maximum, holdAccount(request));
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
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(row.binding.maximum, holdAccount(row.binding));
        db.prepare("UPDATE fleet_requests SET state='abandoned' WHERE id=?").run(id);
      });
    },
    request: read,
    /**
     * Everything one owner account needs to check its own balance without this ledger: each settled request it took
     * part in, with the request's accepted terms, its outcome, the signed evidence it was settled on, and the
     * computers the account's share is attributed to (credit-statement.js).
     */
    statement(accountId) {
      recovery.expire();
      const account = db.prepare('SELECT * FROM fleet_accounts WHERE id=?').get(accountId);
      assert(account && accounts().has(accountId), 'Unknown service-credit account');
      const entries = [], byRequest = new Map();
      for (const row of db.prepare('SELECT * FROM fleet_journal WHERE account_id=? ORDER BY sequence').all(accountId)) {
        let entry = byRequest.get(row.request_id);
        if (!entry) {
          const request = read(row.request_id);
          entry = { sequence: row.sequence, requestId: row.request_id, delta: 0, at: row.at, attribution: [],
            request: request.binding, outcome: request.outcome, evidence: request.evidence };
          byRequest.set(row.request_id, entry); entries.push(entry);
        }
        entry.delta += row.delta;
        entry.attribution.push({ sequence: row.sequence, computerId: row.computer_id, delta: row.delta });
      }
      const expired = db.prepare("SELECT id FROM fleet_requests WHERE state='settled' ORDER BY rowid").all()
        .map(row => read(row.id))
        .filter(row => row.outcome?.status === 'expired'
          && (holdAccount(row.binding) === accountId
            || row.binding.providers.some(provider => accountFor(provider.participantId).ownerId === accountId)))
        .map(row => ({ requestId: row.id, request: row.binding, outcome: row.outcome }));
      // An open ledger states only the accounts this one dealt with (all of this account's computers among them).
      const owners = accounts(), owned = owners.get(accountId);
      const involved = new Set(owned.map(computer => computer.id));
      for (const row of [...entries, ...expired]) {
        for (const owner of [holdAccount(row.request), ...row.request.providers.map(provider => accountFor(provider.participantId).ownerId)]) {
          for (const computer of owners.get(owner)) involved.add(computer.id);
        }
      }
      const stated = openEnrollment === true ? [...enrollment.byId.values()].filter(computer => involved.has(computer.id)).map(row => structuredClone(row))
        : structuredClone(computers);
      return { schema: FLEET_CREDIT_STATEMENT_V2_SCHEMA, accountId, computerIds: owned.map(computer => computer.id),
        unit: policy.unit, policy: structuredClone(policy), computers: stated, balance: account.balance,
        held: account.held, issuedAt: now(), entries, expired,
        ...(openEnrollment === true ? { debtLimit: debtLimitFor(accountId),
          enrollment: owned.flatMap(computer => ledger.enrollmentLog(computer.id)).sort((a, b) => a.sequence - b.sequence) } : {}) };
    },
    /** One row per owner account, naming its computers; `journal` rows keep the computer each delta is attributed to. */
    snapshot() {
      recovery.expire();
      const owners = accounts();
      const rows = db.prepare('SELECT * FROM fleet_accounts ORDER BY id').all().map(row => {
        const owned = owners.get(row.id) ?? [];
        return { ...row, name: owned.map(computer => computer.name).join(', ') || row.id, computerIds: owned.map(computer => computer.id),
          available: row.balance - row.held, debtLimit: debtLimitFor(row.id) };
      });
      const journal = db.prepare('SELECT * FROM fleet_journal ORDER BY sequence').all();
      assert(rows.reduce((sum, row) => sum + BigInt(row.balance), 0n) === 0n, 'Service credit conservation failed');
      return { unit: policy.unit, policyVersion: policy.version, accountUnit: FLEET_ACCOUNT_UNIT, accounts: rows, journal };
    },
    close() { db.close(); }
  });
  return ledger;
}

/** One enrollment journal record applied to the in-memory enrollment, with the same checks as an enrollment file. */
async function applyEnrollment(enrollment, kind, computerId, entry) {
  if (kind === 'computer') {
    assert(entry?.id === computerId, 'Enrollment record names another account');
    await enrollComputer(enrollment, entry);
    return;
  }
  const computer = enrollment.byId.get(computerId);
  assert(computer, 'Unknown service-credit account');
  if (kind === 'key') {
    const key = await enrollmentKey(entry, enrollment.byPeer);
    assert(key.revokedAt === undefined, 'A new key cannot arrive revoked');
    computer.providers.push(structuredClone(entry));
    enrollment.byPeer.set(key.participantId, { computerId, ownerId: computer.ownerId, publicJwk: key.publicJwk });
  } else if (kind === 'revoke') {
    const provider = computer.providers.find(row => row.participantId === entry?.participantId);
    assert(provider && provider.revokedAt === undefined && integer(entry.revokedAt), 'No active key to remove from this account');
    provider.revokedAt = entry.revokedAt;
    enrollment.byPeer.set(provider.participantId, { ...enrollment.byPeer.get(provider.participantId), revokedAt: entry.revokedAt });
  } else if (kind === 'debt-limit') {
    assert(integer(entry?.debtLimit), 'Invalid account debt limit');
    computer.debtLimit = entry.debtLimit;
  } else throw Error('Unknown enrollment change');
}
