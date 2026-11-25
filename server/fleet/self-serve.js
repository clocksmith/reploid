/**
 * Self-serve accounts and computer pairing over an open-enrollment fleet credit ledger (credits.js).
 *
 * A signed-in person creates one account. The browser asks for a short pairing code; a native host on
 * the person's computer claims it with a signature from its own key, the browser shows that key's
 * fingerprint and the person confirms it, and only then does the ledger enroll the key under the
 * account. Earning, spending, settlement and statements are the ledger's own; this module adds no
 * balance, price or outcome. Codes, claims and rate-limit counters live in a separate SQLite file;
 * the ledger's enrollment journal stays the authority for which keys belong to which account.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomBytes as cryptoRandomBytes, randomUUID } from 'node:crypto';
import { normalizeParticipantPublicKey, participantIdFor, verifyParticipantSignature } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { assert, integer, text } from './contract.js';

export const SELF_SERVE_SCHEMA = 'reploid.fleet-self-serve/v1';
export const PAIRING_CLAIM_SCHEMA = 'reploid.fleet-pairing-claim/v1';
export const PAIRING_POLL_SCHEMA = 'reploid.fleet-pairing-poll/v1';
/** Crockford base32 without I, L, O and U: 40 bits in eight characters, read aloud without ambiguity. */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export const DEFAULT_SELF_SERVE_LIMITS = Object.freeze({
  pairingTtlMs: 10 * 60 * 1000,
  confirmedPollMs: 24 * 60 * 60 * 1000,
  maxOpenPairings: 3,
  maxKeysPerAccount: 8,
  accountsPerClientPerHour: 5,
  pairingsPerAccountPerHour: 10,
  claimsPerClientPerTenMinutes: 20,
  pollsPerClientPerMinute: 120,
  maxClockSkewMs: 120000
});

export class SelfServeError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'SelfServeError'; this.code = code; this.status = status; }
}
const refuse = (code, message, status) => { throw new SelfServeError(code, message, status); };

/** Normalize what a person types: case, spaces and a missing dash do not matter. */
export function normalizePairingCode(value) {
  const compact = String(value ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const code = compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
  return PAIRING_CODE_PATTERN.test(code) ? code : null;
}

/** What the computer prints and the browser shows before the person confirms: eight characters of the key's ID. */
export function keyFingerprint(participantId) {
  const hex = String(participantId).replace(/^peer:/, '').toUpperCase();
  assert(/^[0-9A-F]{8,}$/.test(hex), 'Participant identity required');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

/** The signed body a native host sends to claim a code; see join.js. */
export const pairingClaimBody = ({ code, participantId, publicJwk, name, bridgePort = null, at, nonce }) => ({
  schema: PAIRING_CLAIM_SCHEMA, code, participantId, publicJwk, name, bridgePort, at, nonce
});
/** The signed body a native host sends while it waits for the person to confirm. */
export const pairingPollBody = ({ pairingId, participantId, at, nonce }) => ({ schema: PAIRING_POLL_SCHEMA, pairingId, participantId, at, nonce });

const sha256 = value => createHash('sha256').update(value).digest('hex');

/**
 * @param {object} input
 * @param {object} input.credits an open-enrollment ledger from openFleetCredits({ openEnrollment: true })
 * @param {string} input.file absolute SQLite path for accounts, pairing codes and rate counters
 * @param {object} input.network what a confirmed computer needs to serve: serviceUrl, signalingUrl, roomId, roomToken
 * @param {object} input.starterDebt the debt limit a new account starts with: { verified, unverified }
 * @param {object[]} [input.models] models this service credits, published to paired computers
 */
export async function openSelfServeFleet({ credits, file, network, starterDebt, models = [], limits: supplied = {},
  now = Date.now, randomBytes = cryptoRandomBytes }) {
  assert(credits?.openEnrollment === true, 'Self-serve accounts need an open-enrollment credit ledger');
  assert(path.isAbsolute(file), 'Absolute self-serve database path required');
  assert(text(network?.serviceUrl) && text(network?.signalingUrl) && text(network?.roomId) && typeof network?.roomToken === 'string'
    && network.roomToken.length >= 32, 'Hosted fleet network settings and a strong room token required');
  assert(integer(starterDebt?.verified) && integer(starterDebt?.unverified)
    && starterDebt.verified <= credits.policy.maxDebt && starterDebt.unverified <= starterDebt.verified,
  'Starter debt must be explicit, at most the policy debt limit, and no larger for unverified sign-ins');
  const limits = Object.freeze({ ...DEFAULT_SELF_SERVE_LIMITS, ...supplied });
  for (const [name, value] of Object.entries(limits)) assert(integer(value) && value > 0, `Invalid self-serve limit ${name}`);

  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try { assert((await handle.stat()).isFile(), 'Self-serve database must be a regular file'); } finally { await handle.close(); }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS self_serve_accounts (id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
      verified INTEGER NOT NULL, label TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS self_serve_pairings (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL, claim TEXT, confirmed_at INTEGER);
    CREATE TABLE IF NOT EXISTS self_serve_rate (key TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, window));`);
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };

  /** Fixed-window counters. A refused call does not count against the next window. */
  const limit = (key, windowMs, max, message) => transaction(() => {
    const window = Math.floor(now() / windowMs);
    db.prepare('DELETE FROM self_serve_rate WHERE window < ? AND key = ?').run(window, key);
    const row = db.prepare('SELECT count FROM self_serve_rate WHERE key=? AND window=?').get(key, window);
    if ((row?.count ?? 0) >= max) refuse('rate_limited', message, 429);
    db.prepare('INSERT INTO self_serve_rate VALUES (?,?,1) ON CONFLICT(key, window) DO UPDATE SET count=count+1').run(key, window);
  });

  // The subject is stored hashed: the account table never holds the sign-in provider's user ID.
  const subjectKey = session => sha256(`${session.issuer}\u0000${session.subject}`);
  const accountRow = session => db.prepare('SELECT * FROM self_serve_accounts WHERE subject=?').get(subjectKey(session));
  const requireAccount = session => accountRow(session) ?? refuse('account_required', 'Create your Reploid account first.', 404);
  const pairingRow = id => db.prepare('SELECT * FROM self_serve_pairings WHERE id=?').get(id);
  const debtFor = verified => verified ? starterDebt.verified : starterDebt.unverified;
  const ledgerAccount = id => credits.enrollment.byId.get(id) ?? null;

  /** Upgrading a sign-in (anonymous to a verified provider) raises the debt limit once; nothing lowers a balance. */
  const upgrade = async (row, session) => {
    if (row.verified || !session.verified) return row;
    db.prepare('UPDATE self_serve_accounts SET verified=1 WHERE id=?').run(row.id);
    if (ledgerAccount(row.id) && credits.debtLimitFor(row.id) < starterDebt.verified) await credits.setDebtLimit(row.id, starterDebt.verified);
    return { ...row, verified: 1 };
  };

  const describePairing = row => {
    const claim = row.claim ? JSON.parse(row.claim) : null;
    const state = row.state === 'open' && now() > row.expires_at ? 'expired' : row.state;
    return { id: row.id, state, createdAt: row.created_at, expiresAt: row.expires_at,
      ...(claim ? { computer: { name: claim.name, participantId: claim.participantId, fingerprint: keyFingerprint(claim.participantId),
        bridgePort: claim.bridgePort ?? null } } : {}),
      ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}) };
  };

  const accountView = row => {
    const ledger = ledgerAccount(row.id);
    const snapshot = ledger ? credits.snapshot().accounts.find(account => account.id === row.id) : null;
    const debtLimit = ledger ? credits.debtLimitFor(row.id) : debtFor(!!row.verified);
    const balance = snapshot?.balance ?? 0, held = snapshot?.held ?? 0;
    return { schema: SELF_SERVE_SCHEMA, account: { id: row.id, label: row.label, createdAt: row.created_at, verified: !!row.verified },
      credits: { unit: credits.policy.unit, balance, held, available: balance - held, debtLimit, spendable: balance - held + debtLimit },
      computers: (ledger?.providers ?? []).map(provider => ({ participantId: provider.participantId, fingerprint: keyFingerprint(provider.participantId),
        name: provider.name ?? null, ...(provider.revokedAt !== undefined ? { revokedAt: provider.revokedAt } : {}) })),
      pairings: db.prepare("SELECT * FROM self_serve_pairings WHERE account_id=? AND state IN ('open','claimed') ORDER BY created_at DESC")
        .all(row.id).map(describePairing).filter(pairing => pairing.state !== 'expired') };
  };

  const verifyHostSignature = async (body, signature, publicJwk) => {
    assert(Math.abs(now() - body.at) <= limits.maxClockSkewMs, 'Pairing request is outside the clock-skew bound; check this computer’s clock');
    const normalized = normalizeParticipantPublicKey(publicJwk);
    assert(normalized && !Object.hasOwn(publicJwk, 'd') && await participantIdFor(normalized) === body.participantId,
      'Pairing key does not match its participant identity');
    assert(await verifyParticipantSignature(normalized, body.schema, body, signature), 'Invalid pairing signature');
    return normalized;
  };

  return Object.freeze({
    limits,
    /** Public settings for the browser: no session needed, nothing account-specific. */
    client() {
      const policy = credits.policy;
      return { schema: SELF_SERVE_SCHEMA, available: true,
        policy: { unit: policy.unit, version: policy.version, creditsPerOutputToken: policy.creditsPerOutputToken,
          maxOutputTokens: policy.maxOutputTokens, maxDebt: policy.maxDebt, maxTotalDebt: policy.maxTotalDebt ?? null },
        starterDebt: { verified: starterDebt.verified, unverified: starterDebt.unverified },
        pairing: { ttlMs: limits.pairingTtlMs, command: 'npx reploid join' },
        models: models.map(model => ({ id: model.id, identity: model.identity })) };
    },

    /** One account per signed-in subject. Repeating the call returns the same account. */
    async createAccount(session, { client = 'unknown' } = {}) {
      const existing = accountRow(session);
      if (existing) return accountView(await upgrade(existing, session));
      limit(`account:${client}`, 3600000, limits.accountsPerClientPerHour, 'Too many new accounts from this network. Try again later.');
      const id = `acct-${randomBytes(12).toString('hex')}`;
      const label = `Reploid account ${id.slice(5, 9).toUpperCase()}`;
      try {
        db.prepare('INSERT INTO self_serve_accounts VALUES (?,?,?,?,?)').run(id, subjectKey(session), now(), session.verified ? 1 : 0, label);
      } catch (error) {
        // A concurrent first call for the same subject created it; return that one.
        if (!accountRow(session)) throw error;
      }
      return accountView(accountRow(session));
    },

    async account(session) { return accountView(await upgrade(requireAccount(session), session)); },

    /** A short single-use code bound to this account. Only its hash is stored. */
    createPairing(session) {
      const row = requireAccount(session);
      const keys = ledgerAccount(row.id)?.providers.filter(provider => provider.revokedAt === undefined).length ?? 0;
      if (keys >= limits.maxKeysPerAccount) refuse('too_many_computers', `This account already has ${keys} computers. Remove one first.`, 409);
      const open = db.prepare("SELECT COUNT(*) AS count FROM self_serve_pairings WHERE account_id=? AND state IN ('open','claimed') AND expires_at>?")
        .get(row.id, now()).count;
      if (open >= limits.maxOpenPairings) refuse('too_many_pairings', 'Finish or cancel an open pairing code first.', 409);
      limit(`pairing:${row.id}`, 3600000, limits.pairingsPerAccountPerHour, 'Too many pairing codes this hour. Try again later.');
      for (let attempt = 0; attempt < 8; attempt++) {
        const bytes = randomBytes(8);
        const raw = [...bytes].map(byte => PAIRING_ALPHABET[byte % 32]).join('');
        const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
        const id = `pair-${randomUUID()}`, createdAt = now();
        try {
          db.prepare("INSERT INTO self_serve_pairings VALUES (?,?,?,?,?,'open',NULL,NULL)").run(id, row.id, sha256(code), createdAt, createdAt + limits.pairingTtlMs);
          return { ...describePairing(pairingRow(id)), code, command: `npx reploid join ${code}` };
        } catch (error) { if (!/UNIQUE/.test(error.message)) throw error; }
      }
      refuse('pairing_unavailable', 'Could not create a pairing code. Try again.', 503);
    },

    pairing(session, id) {
      const row = requireAccount(session), pairing = pairingRow(id);
      if (!pairing || pairing.account_id !== row.id) refuse('pairing_not_found', 'No such pairing code on this account.', 404);
      return describePairing(pairing);
    },

    cancelPairing(session, id) {
      const row = requireAccount(session), pairing = pairingRow(id);
      if (!pairing || pairing.account_id !== row.id) refuse('pairing_not_found', 'No such pairing code on this account.', 404);
      if (['open', 'claimed'].includes(pairing.state)) db.prepare("UPDATE self_serve_pairings SET state='cancelled' WHERE id=?").run(id);
      return describePairing(pairingRow(id));
    },

    /**
     * A native host claims a code with its own signature. The claim enrolls nothing: the person must still
     * confirm the computer's fingerprint in the browser, so a code read over someone's shoulder pairs nothing.
     */
    async claim(envelope, { client = 'unknown' } = {}) {
      limit(`claim:${client}`, 600000, limits.claimsPerClientPerTenMinutes, 'Too many pairing attempts from this network. Wait a few minutes.');
      const { signature, ...body } = envelope ?? {};
      const code = normalizePairingCode(body.code);
      assert(body.schema === PAIRING_CLAIM_SCHEMA && code && text(body.participantId) && text(body.nonce) && Number.isSafeInteger(body.at)
        && typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 64
        && (body.bridgePort === null || Number.isSafeInteger(body.bridgePort) && body.bridgePort >= 1024 && body.bridgePort <= 65535),
      'Invalid pairing claim');
      const publicJwk = await verifyHostSignature({ ...body, code: body.code }, signature, body.publicJwk);
      if (credits.enrollment.byPeer.has(body.participantId)) refuse('key_enrolled', 'This computer is already paired with an account.', 409);
      return transaction(() => {
        const pairing = db.prepare('SELECT * FROM self_serve_pairings WHERE code_hash=?').get(sha256(code));
        if (!pairing || pairing.state !== 'open' || now() > pairing.expires_at) {
          refuse('pairing_code_invalid', 'That code is not valid. Codes work once and expire after ten minutes; make a new one in your browser.', 404);
        }
        const claim = { participantId: body.participantId, publicJwk, name: body.name.trim(), bridgePort: body.bridgePort, claimedAt: now() };
        db.prepare("UPDATE self_serve_pairings SET state='claimed', claim=? WHERE id=?").run(JSON.stringify(claim), pairing.id);
        return { pairingId: pairing.id, state: 'claimed', fingerprint: keyFingerprint(body.participantId), expiresAt: pairing.expires_at };
      });
    },

    /** The person confirms the fingerprint they see on their computer; only now is the key enrolled. */
    async confirm(session, id, { fingerprint } = {}) {
      const row = requireAccount(session), pairing = pairingRow(id);
      if (!pairing || pairing.account_id !== row.id) refuse('pairing_not_found', 'No such pairing code on this account.', 404);
      if (pairing.state === 'confirmed') return describePairing(pairing);
      if (pairing.state !== 'claimed' || now() > pairing.expires_at) refuse('pairing_not_claimed', 'No computer has claimed this code yet, or it expired.', 409);
      const claim = JSON.parse(pairing.claim);
      if (fingerprint !== keyFingerprint(claim.participantId)) refuse('fingerprint_mismatch', 'The fingerprint does not match the computer that claimed this code.', 409);
      const provider = { participantId: claim.participantId, publicJwk: claim.publicJwk, name: claim.name };
      if (ledgerAccount(row.id)) await credits.enrollKey(row.id, provider);
      else await credits.enrollAccount({ id: row.id, name: row.label, ownerId: row.id, debtLimit: debtFor(!!row.verified), providers: [provider] });
      db.prepare("UPDATE self_serve_pairings SET state='confirmed', confirmed_at=? WHERE id=?").run(now(), id);
      return describePairing(pairingRow(id));
    },

    /** The waiting host learns the outcome; once confirmed it receives what it needs to serve and spend. */
    async poll(envelope, { client = 'unknown' } = {}) {
      limit(`poll:${client}`, 60000, limits.pollsPerClientPerMinute, 'Polling too often.');
      const { signature, ...body } = envelope ?? {};
      assert(body.schema === PAIRING_POLL_SCHEMA && text(body.pairingId) && text(body.participantId) && text(body.nonce)
        && Number.isSafeInteger(body.at), 'Invalid pairing poll');
      const pairing = pairingRow(body.pairingId), claim = pairing?.claim ? JSON.parse(pairing.claim) : null;
      if (!claim || claim.participantId !== body.participantId) refuse('pairing_not_found', 'No pairing claimed by this computer.', 404);
      await verifyHostSignature(body, signature, claim.publicJwk);
      const described = describePairing(pairing);
      if (described.state === 'confirmed') {
        if (now() > pairing.confirmed_at + limits.confirmedPollMs) refuse('pairing_closed', 'This pairing finished; the computer already has its settings.', 410);
        const account = ledgerAccount(pairing.account_id);
        return { state: 'confirmed', computerId: account.id, accountLabel: account.name, name: claim.name,
          network: { serviceUrl: network.serviceUrl, signalingUrl: network.signalingUrl, roomId: network.roomId, roomToken: network.roomToken },
          policy: structuredClone(credits.policy), models: structuredClone(models) };
      }
      if (described.state === 'claimed' && now() > pairing.expires_at) return { state: 'expired' };
      return { state: described.state };
    },

    statement(session) {
      const row = requireAccount(session);
      if (!ledgerAccount(row.id)) refuse('no_computers', 'Pair a computer first; the account has no credit activity yet.', 404);
      return credits.statement(row.id);
    },

    async revoke(session, participantId) {
      const row = requireAccount(session), account = ledgerAccount(row.id);
      const provider = account?.providers.find(item => item.participantId === participantId && item.revokedAt === undefined);
      if (!provider) refuse('computer_not_found', 'No such computer on this account.', 404);
      await credits.revokeKey(row.id, participantId);
      return accountView(row);
    },

    close() { db.close(); }
  });
}
