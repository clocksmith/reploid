import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const MAX_INVITE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETAINED_INVITES = 256;
const SETTLEMENT_OUTCOMES = new Set(['completed', 'stopped', 'failed']);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validLabel = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 128;
const bounded = (value, limit) => Number.isSafeInteger(value) && value > 0 && value <= limit;
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const tokenDigest = token => createHash('sha256').update(token).digest('hex');

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(entry => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** The caller supplies peer IDs from authenticated transport, never from a request body. */
export async function openCircleInvites({ file, hostPeerId, hostLabel = hostPeerId, now = Date.now }) {
  if (!path.isAbsolute(file) || !validId(hostPeerId) || !validLabel(hostLabel)) {
    throw Error('Private invite database, host identity, and display name required');
  }
  const normalizedLabel = hostLabel.trim();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) {
      throw Error('Invite database must be a private regular file');
    }
  } finally { await handle.close(); }

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  const listeners = new Set();
  let closed = false;
  function transaction(change) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = change();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  try {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS circle_scope (id INTEGER PRIMARY KEY CHECK(id = 1), host TEXT NOT NULL, host_label TEXT);
      CREATE TABLE IF NOT EXISTS circle_invite (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, guest TEXT, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, revoked_at INTEGER, max_requests INTEGER NOT NULL,
        max_output_tokens INTEGER NOT NULL, used_requests INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS circle_request (
        guest TEXT NOT NULL, id TEXT NOT NULL, invite_id TEXT NOT NULL REFERENCES circle_invite(id) ON DELETE CASCADE,
        max_output_tokens INTEGER NOT NULL, settled_at INTEGER, outcome TEXT, output_tokens INTEGER,
        model_weight_bytes INTEGER, PRIMARY KEY(guest, id)
      );`);
    ensureColumn(db, 'circle_scope', 'host_label', 'TEXT');
    ensureColumn(db, 'circle_request', 'settled_at', 'INTEGER');
    ensureColumn(db, 'circle_request', 'outcome', 'TEXT');
    ensureColumn(db, 'circle_request', 'output_tokens', 'INTEGER');
    ensureColumn(db, 'circle_request', 'model_weight_bytes', 'INTEGER');
    transaction(() => {
      db.prepare('INSERT OR IGNORE INTO circle_scope (id, host, host_label) VALUES(1, ?, ?)').run(hostPeerId, normalizedLabel);
      const scope = db.prepare('SELECT host, host_label FROM circle_scope WHERE id=1').get();
      if (scope.host !== hostPeerId) {
        throw Error('Invite database belongs to another host identity');
      }
      if (scope.host_label !== normalizedLabel && hostLabel !== hostPeerId) {
        db.prepare('UPDATE circle_scope SET host_label=? WHERE id=1').run(normalizedLabel);
      } else if (!scope.host_label) {
        db.prepare('UPDATE circle_scope SET host_label=? WHERE id=1').run(normalizedLabel);
      }
    });
  } catch (error) {
    db.close();
    throw error;
  }

  const selectScope = db.prepare('SELECT host_label FROM circle_scope WHERE id=1');
  const selectInvite = db.prepare('SELECT * FROM circle_invite WHERE id=?');
  const selectToken = db.prepare('SELECT * FROM circle_invite WHERE token_hash=?');
  const selectRequest = db.prepare('SELECT guest, id, invite_id, max_output_tokens, settled_at, outcome, output_tokens, model_weight_bytes FROM circle_request WHERE guest=? AND id=?');
  const currentHostLabel = () => selectScope.get()?.host_label || normalizedLabel;

  function view(row, at) {
    let status = 'active';
    if (row.revoked_at !== null) status = 'revoked';
    else if (row.expires_at <= at) status = 'expired';
    return {
      inviteId: row.id, hostPeerId, hostLabel: currentHostLabel(), guestPeerId: row.guest,
      createdAt: row.created_at, expiresAt: row.expires_at,
      maxRequests: row.max_requests, maxOutputTokens: row.max_output_tokens, usedRequests: row.used_requests,
      status
    };
  }
  function settlementView(row) {
    return {
      guestPeerId: row.guest,
      requestId: row.id,
      inviteId: row.invite_id,
      hostPeerId,
      hostLabel: currentHostLabel(),
      maxOutputTokens: row.max_output_tokens,
      settledAt: row.settled_at,
      outcome: row.outcome,
      outputTokens: row.output_tokens,
      modelWeightBytes: row.model_weight_bytes
    };
  }
  function findLive({ inviteId, guestPeerId, hostPeerId: target }, at) {
    if (target !== hostPeerId || !validId(inviteId) || !validId(guestPeerId)) return null;
    const row = selectInvite.get(inviteId);
    if (!row || row.guest !== guestPeerId || row.revoked_at !== null || row.expires_at <= at) return null;
    return row;
  }

  return Object.freeze({
    get hostPeerId() { return hostPeerId; },
    get hostLabel() { return currentHostLabel(); },
    issue({ expiresAt, maxRequests, maxOutputTokens }) {
      const at = now();
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= at || expiresAt - at > MAX_INVITE_LIFETIME_MS
        || !bounded(maxRequests, 1000) || !bounded(maxOutputTokens, 32768)) {
        throw Error('Invite requires an expiry within 30 days and bounded request and output limits');
      }
      const inviteId = randomUUID(), token = randomBytes(32).toString('base64url');
      return transaction(() => {
        if (db.prepare('SELECT count(*) AS n FROM circle_invite').get().n >= MAX_RETAINED_INVITES) {
          const oldest = db.prepare('SELECT id FROM circle_invite WHERE expires_at<=? OR revoked_at IS NOT NULL ORDER BY created_at LIMIT 1').get(at);
          if (!oldest) throw Error('Too many active invites');
          db.prepare('DELETE FROM circle_invite WHERE id=?').run(oldest.id);
        }
        db.prepare('INSERT INTO circle_invite (id, token_hash, created_at, expires_at, max_requests, max_output_tokens) VALUES (?, ?, ?, ?, ?, ?)')
          .run(inviteId, tokenDigest(token), at, expiresAt, maxRequests, maxOutputTokens);
        return { ...view(selectInvite.get(inviteId), at), token };
      });
    },
    redeem({ token, guestPeerId }) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !validId(guestPeerId)) return null;
      return transaction(() => {
        const at = now(), row = selectToken.get(tokenDigest(token));
        if (!row || row.revoked_at !== null || row.expires_at <= at || (row.guest !== null && row.guest !== guestPeerId)) return null;
        if (row.guest === null) db.prepare('UPDATE circle_invite SET guest=? WHERE id=?').run(guestPeerId, row.id);
        return view(selectInvite.get(row.id), at);
      });
    },
    lookup(scope) {
      const at = now(), row = findLive(scope, at);
      return row ? view(row, at) : null;
    },
    /** The newest live invite this verified guest has claimed on this host, or null. */
    liveForGuest(guestPeerId) {
      if (!validId(guestPeerId)) return null;
      const at = now();
      const row = db.prepare('SELECT * FROM circle_invite WHERE guest=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC, rowid DESC LIMIT 1')
        .get(guestPeerId, at);
      return row ? view(row, at) : null;
    },
    hasRequest({ guestPeerId, requestId }) {
      return validId(guestPeerId) && validId(requestId) && !!selectRequest.get(guestPeerId, requestId);
    },
    admit({ inviteId, guestPeerId, hostPeerId: target, requestId, maxOutputTokens }) {
      if (!validId(requestId) || !bounded(maxOutputTokens, 32768)) return null;
      return transaction(() => {
        const at = now(), row = findLive({ inviteId, guestPeerId, hostPeerId: target }, at);
        if (!row || maxOutputTokens > row.max_output_tokens) return null;
        const previous = selectRequest.get(guestPeerId, requestId);
        if (previous) {
          return previous.invite_id === inviteId && previous.max_output_tokens === maxOutputTokens
            ? { status: 'duplicate', grant: view(row, at) } : null;
        }
        if (row.used_requests >= row.max_requests) return null;
        db.prepare('INSERT INTO circle_request (guest, id, invite_id, max_output_tokens) VALUES (?, ?, ?, ?)')
          .run(guestPeerId, requestId, inviteId, maxOutputTokens);
        db.prepare('UPDATE circle_invite SET used_requests=used_requests+1 WHERE id=?').run(inviteId);
        return { status: 'admitted', grant: view(selectInvite.get(inviteId), at) };
      });
    },
    settle({ inviteId, guestPeerId, hostPeerId: target, requestId, outcome, outputTokens = 0, modelWeightBytes = 0 }) {
      if (target !== hostPeerId || !validId(inviteId) || !validId(guestPeerId) || !validId(requestId)
        || !SETTLEMENT_OUTCOMES.has(outcome) || !nonNegative(outputTokens) || !nonNegative(modelWeightBytes)) {
        return null;
      }
      return transaction(() => {
        const existing = selectRequest.get(guestPeerId, requestId);
        if (!existing || existing.invite_id !== inviteId) return null;
        if (existing.settled_at !== null) {
          return { settled: false, alreadySettled: true, record: settlementView(existing) };
        }
        const at = now();
        db.prepare('UPDATE circle_request SET settled_at=?, outcome=?, output_tokens=?, model_weight_bytes=? WHERE guest=? AND id=?')
          .run(at, outcome, outputTokens, modelWeightBytes, guestPeerId, requestId);
        return { settled: true, alreadySettled: false, record: settlementView(selectRequest.get(guestPeerId, requestId)) };
      });
    },
    getSettlement({ guestPeerId, requestId }) {
      if (!validId(guestPeerId) || !validId(requestId)) return null;
      const existing = selectRequest.get(guestPeerId, requestId);
      return existing && existing.settled_at !== null ? settlementView(existing) : null;
    },
    list() {
      const at = now();
      return db.prepare('SELECT * FROM circle_invite ORDER BY created_at DESC, rowid DESC').all().map(row => view(row, at));
    },
    revoke(inviteId) {
      if (!validId(inviteId)) return null;
      const at = now();
      const changed = db.prepare('UPDATE circle_invite SET revoked_at=? WHERE id=? AND revoked_at IS NULL AND expires_at>?')
        .run(at, inviteId, at).changes === 1;
      const row = selectInvite.get(inviteId);
      if (changed) for (const listener of listeners) {
        try { listener({ inviteId, hostPeerId, status: 'revoked' }); }
        catch { /* Receivers also recheck expiry and revocation at admission. */ }
      }
      return row ? view(row, at) : null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      db.close();
    }
  });
}
