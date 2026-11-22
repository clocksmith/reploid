import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { TURNS_PER_DAY } from './rules.js';
import { closeSync, constants, fstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const digest = value => createHash('sha256').update(value).digest('hex');
const opaqueToken = () => randomBytes(32).toString('base64url');
const utcDay = time => new Date(time).toISOString().slice(0, 10);

function requireValue(ok, status, code) {
  if (!ok) throw Object.assign(new Error(code), { status, code });
}

// A database belongs to one disclosed host/circle. Only owner-side code can issue
// credentials, finalize a receipt, moderate a reveal, or inspect aggregate metrics.
export function createDailyStore({ path, hostId, hostDailyCap = 100, now = Date.now, mode = 'ranked' }) {
  requireValue(['ranked','playtest'].includes(mode), 500, 'invalid_store_mode');
  requireValue(typeof path === 'string' && path.length > 0, 500, 'missing_store_path');
  requireValue(typeof hostId === 'string' && hostId.length > 0, 500, 'missing_host');
  requireValue(Number.isSafeInteger(hostDailyCap) && hostDailyCap >= 0, 500, 'invalid_host_cap');
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = fstatSync(fd);
      requireValue(stat.isFile() && (process.platform === 'win32' || (stat.mode & 0o077) === 0),
        500, 'private_store_file_required');
    } finally { closeSync(fd); }
  }
  const db = new DatabaseSync(path);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  let circle;
  try {
    db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS daily_circle (
        slot INTEGER PRIMARY KEY CHECK(slot = 1), host TEXT NOT NULL, salt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_store_mode (
        slot INTEGER PRIMARY KEY CHECK(slot=1), mode TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_grants (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        guest TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS daily_circle_invites (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS daily_challenges (
        day TEXT PRIMARY KEY, digest TEXT NOT NULL, public_record TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_attempts (
        id TEXT PRIMARY KEY, guest TEXT NOT NULL, day TEXT NOT NULL, request_key TEXT NOT NULL,
        prompt TEXT NOT NULL, words INTEGER NOT NULL, characters INTEGER NOT NULL,
        request_share TEXT, via TEXT, state TEXT NOT NULL DEFAULT 'pending',
        output TEXT, won INTEGER, receipt TEXT, receipt_digest TEXT, turn INTEGER,
        share_id TEXT UNIQUE, consent INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0,
        UNIQUE(guest, day, request_key)
      );
      CREATE TABLE IF NOT EXISTS daily_scripted_accounts (
        guest TEXT PRIMARY KEY, evidence_attempt TEXT NOT NULL REFERENCES daily_attempts(id),
        evidence_digest TEXT NOT NULL, recorded_at INTEGER NOT NULL
      );
      CREATE VIEW IF NOT EXISTS daily_player_attempts AS
        SELECT a.*, a.rowid AS entry_order FROM daily_attempts a
        WHERE NOT EXISTS (SELECT 1 FROM daily_scripted_accounts q WHERE q.guest=a.guest);
      CREATE TABLE IF NOT EXISTS daily_reveal_cohorts (
        guest TEXT NOT NULL, day TEXT NOT NULL, available INTEGER NOT NULL CHECK(available IN (0,1)),
        PRIMARY KEY(guest, day)
      );
      CREATE TABLE IF NOT EXISTS daily_opened_dares (
        share_id TEXT PRIMARY KEY REFERENCES daily_attempts(share_id)
      );
      CREATE INDEX IF NOT EXISTS daily_by_day ON daily_attempts(day, guest);
    `);
    // Closeness: the provider-signed log-probability of the target after the prompt, in hundredths, with its token count.
    const columns = new Set(db.prepare('PRAGMA table_info(daily_attempts)').all().map(column => column.name));
    for (const [name, type] of [['closeness', 'INTEGER'], ['closeness_tokens', 'INTEGER'], ['score_record', 'TEXT']]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE daily_attempts ADD COLUMN ${name} ${type}`);
    }
    circle = transaction(() => {
      const added = db.prepare('INSERT OR IGNORE INTO daily_circle VALUES (1, ?, ?)').run(hostId, opaqueToken());
      // A ledger created before playtesting was introduced belongs to ranked play.
      db.prepare('INSERT OR IGNORE INTO daily_store_mode VALUES (1,?)').run(added.changes ? mode : 'ranked');
      requireValue(db.prepare('SELECT mode FROM daily_store_mode WHERE slot=1').get().mode === mode, 500, 'store_mode_mismatch');
      const saved = db.prepare('SELECT host, salt FROM daily_circle WHERE slot = 1').get();
      requireValue(saved.host === hostId, 500, 'store_host_mismatch');
      return saved;
    });
  } catch (error) {
    db.close();
    throw error;
  }

  function authorizeGuest({ subject, expiresAt }) {
    const expires = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt;
    requireValue(typeof subject === 'string' && subject.trim().length > 0 && subject.length <= 1024,
      400, 'verified_subject_required');
    requireValue(Number.isSafeInteger(expires) && expires > now(), 400, 'invalid_expiry');
    const guestId = digest(JSON.stringify([circle.salt, subject]));
    const id = randomUUID();
    const token = opaqueToken();
    db.prepare('INSERT INTO daily_grants(id, token_hash, guest, expires) VALUES (?, ?, ?, ?)')
      .run(id, digest(token), guestId, expires);
    return { id, guestId, token, expiresAt: expires };
  }
  function circleInvite({ expiresAt }) {
    const expires = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt;
    requireValue(Number.isSafeInteger(expires) && expires > now(), 400, 'invalid_expiry');
    const id = randomUUID(), token = opaqueToken();
    db.prepare('INSERT INTO daily_circle_invites(id, token_hash, expires) VALUES (?,?,?)')
      .run(id, digest(token), expires);
    return { id, token, expiresAt: expires };
  }
  function resolveCircle(token) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return null;
    return db.prepare(`SELECT id, expires AS expiresAt FROM daily_circle_invites
      WHERE token_hash=? AND expires>? AND revoked=0`).get(digest(token), Number(now())) ?? null;
  }
  function guest(token) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return null;
    return db.prepare(`SELECT guest AS id, id AS grantId, expires AS expiresAt FROM daily_grants
      WHERE token_hash = ? AND expires > ? AND revoked = 0`).get(digest(token), Number(now())) ?? null;
  }
  function principal(token) {
    const grant = guest(token);
    requireValue(grant, 401, 'guest_grant_required');
    return grant.id;
  }
  const byId = id => db.prepare('SELECT * FROM daily_attempts WHERE id = ?').get(id);
  function own(token, id) {
    const guestId = principal(token);
    const row = byId(id);
    requireValue(row && row.guest === guestId, 404, 'unknown_attempt');
    return row;
  }
  /**
   * Geometric-mean probability per target token as a percent; null when the turn was not scored. One percent and
   * above is a whole number. Below that the value stays a positive fraction, never 0: a stored score is a finite
   * log-probability, so its probability is nonzero, and the page must be able to tell that from an exact zero.
   */
  function closenessPercent(row) {
    if (!Number.isSafeInteger(row.closeness) || !Number.isSafeInteger(row.closeness_tokens) || row.closeness_tokens <= 0) return null;
    const percent = 100 * Math.exp(row.closeness / 100 / row.closeness_tokens);
    return Math.round(percent) >= 1 ? Math.round(percent) : Math.max(Number(percent.toPrecision(2)), Number.MIN_VALUE);
  }
  function privateAttempt(row) {
    return {
      id: row.id, day: row.day, status: row.state, prompt: row.prompt, words: row.words,
      characters: row.characters, attemptNumber: row.turn, shareId: row.share_id, allowReveal: row.consent === 1,
      output: row.output, won: row.won === 1, receiptDigest: row.receipt_digest,
      receipt: row.receipt ? JSON.parse(row.receipt) : null,
      closeness: closenessPercent(row),
    };
  }
  function existingAttempt({ token, day, key, prompt, via = null }) {
    const row = db.prepare('SELECT * FROM daily_attempts WHERE guest=? AND day=? AND request_key=?')
      .get(principal(token), day, key);
    if (!row) return null;
    requireValue(row.prompt === prompt && row.request_share === via, 409, 'request_key_conflict');
    return privateAttempt(row);
  }
  function reserve({ invite, token, day, key, prompt, words, characters, via = null }) {
    requireValue(typeof key === 'string' && /^[\w.:-]{1,128}$/.test(key), 400, 'invalid_request_key');
    requireValue(typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 8192,
      400, 'invalid_prompt');
    const length = [...prompt].length;
    requireValue(Number.isSafeInteger(words) && words > 0 && words <= length
      && (characters === undefined || characters === length), 400, 'invalid_prompt_score');
    requireValue(via === null || typeof via === 'string', 400, 'invalid_share');
    return transaction(() => {
      requireValue(resolveCircle(invite), 403, 'circle_invite_required');
      const guestId = principal(token);
      requireValue(day === utcDay(now()), 409, 'challenge_closed');
      const replay = db.prepare('SELECT * FROM daily_attempts WHERE guest = ? AND day = ? AND request_key = ?')
        .get(guestId, day, key);
      if (replay) {
        requireValue(replay.prompt === prompt && replay.words === words && replay.request_share === via,
          409, 'request_key_conflict');
        return { created: false, attempt: privateAttempt(replay) };
      }
      if (via !== null) {
        const share = db.prepare('SELECT day FROM daily_attempts WHERE share_id = ?').get(via);
        requireValue(share && share.day === day, 400, 'invalid_share');
      }
      const prior = db.prepare('SELECT via FROM daily_attempts WHERE guest = ? AND day = ? ORDER BY rowid')
        .all(guestId, day);
      requireValue(prior.length < TURNS_PER_DAY, 429, 'daily_attempt_limit');
      const { used } = db.prepare('SELECT COUNT(*) AS used FROM daily_attempts WHERE day = ?').get(day);
      requireValue(used < hostDailyCap, 429, 'host_daily_limit');
      const id = randomUUID();
      // The first entry source stays fixed through retries and later winning turns.
      const origin = prior.length ? prior[0].via : via;
      db.prepare(`INSERT INTO daily_attempts
        (id,guest,day,request_key,prompt,words,characters,request_share,via)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, guestId, day, key, prompt, words, length, via, origin);
      return { created: true, attempt: privateAttempt(byId(id)) };
    });
  }
  function nextTurn(row) {
    return row.turn ?? db.prepare(`SELECT COALESCE(MAX(turn),0)+1 AS turn FROM daily_attempts
      WHERE guest=? AND day=?`).get(row.guest, row.day).turn;
  }
  // Use the same winning-rank and consent rules as the public reveal. Analytics
  // only reads a boolean, even when several winning prompts tied.
  const revealRanks = `WITH winners AS (
    SELECT id, consent, approved, RANK() OVER(ORDER BY words,characters,closeness DESC) AS rank
    FROM daily_player_attempts WHERE day=? AND won=1
  )`;
  function recordFirstPlay(row) {
    const acceptedAt = Number(now());
    if (row.state !== 'pending' || row.day !== utcDay(acceptedAt)) return;
    const prior = db.prepare(`SELECT 1 FROM daily_attempts WHERE guest=? AND day=?
      AND state IN ('dispatched','completed','unresolved') LIMIT 1`).get(row.guest, row.day);
    // An earlier accepted play may predate this feature. Its cohort stays unknown.
    if (prior) return;
    const { available } = db.prepare(`${revealRanks} SELECT EXISTS(
      SELECT 1 FROM winners WHERE rank=1 AND consent=1 AND approved=1) AS available`).get(utcDay(acceptedAt - 86400000));
    db.prepare('INSERT OR IGNORE INTO daily_reveal_cohorts VALUES (?,?,?)').run(row.guest, row.day, available);
  }
  function markAccepted(id, state, from) {
    return transaction(() => {
      const row = byId(id);
      if (!row || !from.includes(row.state)) return false;
      recordFirstPlay(row);
      db.prepare('UPDATE daily_attempts SET state=?,turn=? WHERE id=?').run(state, nextTurn(row), id);
      return true;
    });
  }
  function complete(id, { output, won, receipt, score = null }) {
    requireValue(typeof output === 'string' && typeof won === 'boolean'
      && receipt && typeof receipt === 'object' && !Array.isArray(receipt), 500, 'invalid_result');
    const closeness = score && Number.isSafeInteger(score.totalLogProbHundredths) && score.totalLogProbHundredths <= 0
      && Number.isSafeInteger(score.tokenCount) && score.tokenCount > 0 ? score : null;
    const serialized = JSON.stringify(receipt);
    return transaction(() => {
      const row = byId(id);
      requireValue(row, 404, 'unknown_attempt');
      if (row.state === 'completed') {
        requireValue(row.output === output && row.won === Number(won) && row.receipt === serialized,
          409, 'result_conflict');
        return privateAttempt(row);
      }
      recordFirstPlay(row);
      db.prepare(`UPDATE daily_attempts SET state='completed', output=?, won=?, receipt=?,
        receipt_digest=?, turn=?, closeness=?, closeness_tokens=?, score_record=? WHERE id=?`).run(output, Number(won), serialized,
        'sha256:' + digest(serialized), nextTurn(row), closeness?.totalLogProbHundredths ?? null, closeness?.tokenCount ?? null,
        closeness ? JSON.stringify(closeness) : null, id);
      return privateAttempt(byId(id));
    });
  }
  function history(token, day) {
    return db.prepare('SELECT * FROM daily_attempts WHERE guest = ? AND day = ? ORDER BY rowid')
      .all(principal(token), day).map(privateAttempt);
  }
  function readShare(id) {
    // No public projection includes the prompt, guest identity or raw provider receipt.
    return db.prepare(`SELECT share_id AS id, day, words, characters, output, turn AS attemptNumber,
      receipt_digest AS receiptDigest FROM daily_attempts WHERE share_id = ?`).get(id) ?? null;
  }
  function publish(token, id, { allowReveal } = {}) {
    requireValue(allowReveal === undefined || typeof allowReveal === 'boolean', 400, 'invalid_reveal_consent');
    return transaction(() => {
      const row = own(token, id);
      requireValue(row.state === 'completed' && row.won === 1, 409, 'winning_attempt_required');
      const shareId = row.share_id ?? opaqueToken();
      const consent = allowReveal === undefined ? row.consent : Number(allowReveal);
      db.prepare('UPDATE daily_attempts SET share_id=?, consent=?, approved=CASE WHEN ?=0 THEN 0 ELSE approved END WHERE id=?')
        .run(shareId, consent, consent, id);
      return readShare(shareId);
    });
  }
  function leaderboard(day) {
    return db.prepare(`WITH scores AS (
      SELECT words,characters,closeness,closeness_tokens,
        ROW_NUMBER() OVER(PARTITION BY guest ORDER BY words,characters,closeness DESC,entry_order) AS entry
      FROM daily_player_attempts WHERE day=? AND won=1
    ) SELECT RANK() OVER(ORDER BY words,characters,closeness DESC) AS rank, words, characters, closeness, closeness_tokens
      FROM scores WHERE entry=1 ORDER BY words,characters,closeness DESC`).all(day)
      .map(({ closeness, closeness_tokens: tokens, ...row }) => ({ ...row, closeness: closenessPercent({ closeness, closeness_tokens: tokens }) }));
  }
  function revealCandidates(day, approvedOnly) {
    // Rank all winners before filtering consent. An unapproved first-place result
    // never silently promotes a lower score to "yesterday's winning prompt".
    return db.prepare(`${revealRanks} SELECT a.id AS attemptId, a.prompt, a.words, a.characters
      FROM winners w JOIN daily_attempts a ON a.id=w.id
      WHERE w.rank=1 AND w.consent=1 AND (?=0 OR w.approved=1) ORDER BY a.id`).all(day, Number(approvedOnly));
  }
  const yesterday = () => utcDay(Number(now()) - 86400000);
  function metrics(day) {
    const params = day === undefined ? [] : [day];
    return db.prepare(`SELECT COUNT(DISTINCT c.guest) AS thirdParticipants FROM daily_player_attempts c
      JOIN daily_player_attempts b ON b.share_id=c.via JOIN daily_player_attempts a ON a.share_id=b.via
      WHERE c.state IN ('dispatched','completed','unresolved') AND c.guest<>b.guest
      AND c.guest<>a.guest AND a.guest<>b.guest ${params.length ? 'AND c.day=?' : ''}`).get(...params);
  }
  function activity() {
    const totals = db.prepare(`SELECT COUNT(*) AS players, COUNT(*) FILTER(WHERE days>1) AS returningPlayers
      FROM (SELECT guest,COUNT(DISTINCT day) AS days FROM daily_player_attempts
      WHERE state IN ('dispatched','completed','unresolved') GROUP BY guest)`).get();
    return { ...totals, ...metrics() };
  }
  function nextDayReturn() {
    // Each guest can enter once per play day. Include a denominator only after
    // the entire following UTC day has elapsed, whether or not they returned.
    const counts = db.prepare(`WITH play_days AS (
      SELECT DISTINCT guest,day FROM daily_player_attempts WHERE state IN ('dispatched','completed','unresolved')
    ), followup AS (
      SELECT guest,day,LEAD(day) OVER(PARTITION BY guest ORDER BY day) AS next_play FROM play_days
    ) SELECT c.available, COUNT(*) AS eligibleGuestDays,
      COUNT(*) FILTER(WHERE f.next_play=date(f.day,'+1 day')) AS nextDayReturns
      FROM followup f LEFT JOIN daily_reveal_cohorts c ON c.guest=f.guest AND c.day=f.day
      WHERE date(f.day,'+2 days')<=? GROUP BY c.available`).all(utcDay(now()));
    const empty = () => ({ eligibleGuestDays: 0, nextDayReturns: 0 });
    const groups = { withReveal: empty(), withoutReveal: empty(), unknown: empty(), total: empty() };
    for (const {available, eligibleGuestDays, nextDayReturns} of counts) {
      let group = 'unknown';
      if (available !== null) group = available ? 'withReveal' : 'withoutReveal';
      groups[group] = {eligibleGuestDays, nextDayReturns};
      groups.total.eligibleGuestDays += eligibleGuestDays;
      groups.total.nextDayReturns += nextDayReturns;
    }
    return groups;
  }
  return Object.freeze({
    mode, authorizeGuest, issueInvite: authorizeGuest, guest, circleInvite, resolveCircle, reserve, existingAttempt,
    complete, history, readShare, publish, leaderboard, metrics,
    pinChallenge({ day, digest, challenge = null }) {
      requireValue(/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof digest === 'string' && digest.length > 0,
        500, 'challenge_pin_required');
      transaction(() => {
        db.prepare('INSERT OR IGNORE INTO daily_challenges VALUES (?,?,?)')
          .run(day, digest, challenge && JSON.stringify(challenge));
        const existing = db.prepare('SELECT digest FROM daily_challenges WHERE day=?').get(day);
        requireValue(existing.digest === digest, 409, 'challenge_configuration_changed');
      });
    },
    storedChallenge(day) {
      const row = db.prepare('SELECT public_record FROM daily_challenges WHERE day=?').get(day);
      return row?.public_record ? JSON.parse(row.public_record) : null;
    },
    revokeCircle(id) {
      return db.prepare('UPDATE daily_circle_invites SET revoked=1 WHERE id=? AND revoked=0').run(id).changes === 1;
    },
    revokeInvite(id) {
      return db.prepare('UPDATE daily_grants SET revoked=1 WHERE id=? AND revoked=0').run(id).changes === 1;
    },
    release(id) {
      // Only a definite pre-dispatch/admission rejection returns the reserved turn.
      return db.prepare("DELETE FROM daily_attempts WHERE id=? AND state='pending'").run(id).changes === 1;
    },
    markDispatched(id) {
      return markAccepted(id, 'dispatched', ['pending']);
    },
    markUnresolved(id) {
      return markAccepted(id, 'unresolved', ['pending','dispatched']);
    },
    setRevealConsent(token, id, allowed) {
      requireValue(typeof allowed === 'boolean', 400, 'invalid_reveal_consent');
      return transaction(() => {
        const row = own(token, id);
        requireValue(row.share_id, 409, 'published_win_required');
        db.prepare('UPDATE daily_attempts SET consent=?, approved=CASE WHEN ?=0 THEN 0 ELSE approved END WHERE id=?')
          .run(Number(allowed), Number(allowed), id);
      });
    },
    classifyScripted({attemptId, receiptDigest, excluded}) {
      // The browser cannot classify itself or anyone else. An operator must match
      // both artifacts from a known automation to the very same completed turn.
      requireValue(typeof attemptId === 'string' && typeof receiptDigest === 'string'
        && /^sha256:[0-9a-f]{64}$/.test(receiptDigest) && typeof excluded === 'boolean', 400, 'exact_qa_evidence_required');
      return transaction(() => {
        const evidence = db.prepare(`SELECT guest FROM daily_attempts WHERE id=?
          AND state='completed' AND receipt_digest=?`).get(attemptId,receiptDigest);
        requireValue(evidence, 404, 'qa_evidence_does_not_match');
        const change = excluded
          ? db.prepare('INSERT OR IGNORE INTO daily_scripted_accounts(guest,evidence_attempt,evidence_digest,recorded_at) VALUES (?,?,?,?)')
              .run(evidence.guest,attemptId,receiptDigest,Number(now()))
          : db.prepare('DELETE FROM daily_scripted_accounts WHERE guest=?').run(evidence.guest);
        return {attemptId,receiptDigest,excluded,changed:change.changes === 1};
      });
    },
    reviewQueue(day = yesterday()) { return revealCandidates(day, false); },
    reviewReveal(id, approved = true) {
      requireValue(typeof approved === 'boolean', 400, 'invalid_review');
      return db.prepare('UPDATE daily_attempts SET approved=? WHERE id=? AND consent=1')
        .run(Number(approved), id).changes === 1;
    },
    yesterdayWinners() {
      return revealCandidates(yesterday(), true).map(({ prompt, words, characters }) => ({ prompt, words, characters }));
    },
    capacity(day) {
      const { used } = db.prepare('SELECT COUNT(*) AS used FROM daily_attempts WHERE day=?').get(day);
      return { used, cap: hostDailyCap };
    },
    activity,
    recordDareOpen(id) {
      return db.prepare(`INSERT OR IGNORE INTO daily_opened_dares(share_id)
        SELECT share_id FROM daily_attempts WHERE share_id=?`).run(id).changes === 1;
    },
    ownerStats() {
      const { publishedDares } = db.prepare('SELECT COUNT(share_id) AS publishedDares FROM daily_player_attempts').get();
      const { openedDares } = db.prepare('SELECT COUNT(*) AS openedDares FROM daily_opened_dares o JOIN daily_player_attempts a ON a.share_id=o.share_id').get();
      const { playedDares, darePlayers } = db.prepare(`SELECT COUNT(DISTINCT parent.share_id) AS playedDares,
        COUNT(DISTINCT player.guest) AS darePlayers
        FROM daily_player_attempts player JOIN daily_player_attempts parent ON parent.share_id=player.request_share
        WHERE parent.guest<>player.guest AND player.state IN ('dispatched','completed','unresolved')`).get();
      const { consecutiveDayPlayers } = db.prepare(`WITH play_days AS (
        SELECT DISTINCT guest,day FROM daily_player_attempts WHERE state IN ('dispatched','completed','unresolved')
      ) SELECT COUNT(DISTINCT a.guest) AS consecutiveDayPlayers FROM play_days a JOIN play_days b
        ON a.guest=b.guest AND b.day=date(a.day,'+1 day')`).get();
      const scriptedQA = db.prepare(`SELECT COUNT(DISTINCT q.guest) AS accounts, COUNT(a.id) AS acceptedTurns
        FROM daily_scripted_accounts q LEFT JOIN daily_attempts a ON a.guest=q.guest
        AND a.state IN ('dispatched','completed','unresolved')`).get();
      return { ...activity(), scriptedQA, publishedDares, openedDares, playedDares, darePlayers, consecutiveDayPlayers, nextDayReturn: nextDayReturn() };
    },
    close() { db.close(); },
  });
}
