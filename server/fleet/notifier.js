import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGhApi, createGitHubFeed } from './feed-github.js';

export const FEED_EVENT_SCHEMA = 'reploid.fleet-feed-event/v1';
export const FEED_NOTICE = 'Informational only. Does not authorize any action.';
const TERMINAL = new Set(['settled', 'abandoned']);
const label = value => (typeof value === 'string' && /^[\w.:-]{1,200}$/.test(value) ? value : null);
const iso = ms => new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
const hex = value => (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null);

/**
 * Derives informational events from the fleet credit database without writing to it.
 * The credit database is opened read-only; the cursor and outbox live in the notifier's own file.
 * Events carry identifiers, counts and hashes only: never prompts, outputs, keys or evidence bodies.
 */
export async function openFleetNotifier({ creditFile, stateFile, now = Date.now }) {
  if (!path.isAbsolute(creditFile) || !path.isAbsolute(stateFile)) throw new Error('Absolute database paths required');
  if (path.resolve(creditFile) === path.resolve(stateFile)) throw new Error('Notifier state must not share the credit database');
  const { DatabaseSync } = await import('node:sqlite');
  await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  const credit = new DatabaseSync(creditFile, { readOnly: true });
  credit.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2000;');
  const state = new DatabaseSync(stateFile);
  state.exec(`PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS notifier_cursor (id TEXT PRIMARY KEY, value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notifier_tracked (request_id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifier_outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0, delivered_at INTEGER, last_error TEXT);`);
  const transaction = work => {
    state.exec('BEGIN IMMEDIATE');
    try { const result = work(); state.exec('COMMIT'); return result; } catch (error) { state.exec('ROLLBACK'); throw error; }
  };
  const cursor = id => state.prepare('SELECT value FROM notifier_cursor WHERE id=?').get(id)?.value;
  const setCursor = (id, value) => state.prepare('INSERT INTO notifier_cursor VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id, value);
  const computerOf = () => {
    const row = credit.prepare("SELECT value FROM fleet_metadata WHERE id='enrollment'").get(), map = new Map();
    for (const computer of row ? JSON.parse(row.value) : []) for (const provider of computer.providers || []) map.set(provider.participantId, label(computer.id));
    return map;
  };
  const enqueue = event => state.prepare('INSERT OR IGNORE INTO notifier_outbox (event_id,payload,created_at) VALUES (?,?,?)')
    .run(event.event_id, JSON.stringify(event), now()).changes > 0;

  const requestEvent = (id, computers) => {
    const row = credit.prepare('SELECT id,binding,state,outcome FROM fleet_requests WHERE id=?').get(id);
    if (!row || !TERMINAL.has(row.state)) return null;
    const binding = JSON.parse(row.binding), outcome = row.outcome ? JSON.parse(row.outcome) : null;
    const status = row.state === 'abandoned' ? 'abandoned' : outcome?.status === 'cancelled' ? 'cancelled' : outcome?.status ? 'failed' : 'settled';
    const workIds = credit.prepare('SELECT id FROM fleet_work WHERE request_id=? ORDER BY id').all(id).map(work => work.id);
    const journal = credit.prepare('SELECT sequence FROM fleet_journal WHERE request_id=? ORDER BY sequence').all(id).map(entry => entry.sequence);
    const event = {
      schema: FEED_EVENT_SCHEMA,
      event_id: `fleet:${row.id}:${status}`,
      event_type: `request.${status}`,
      timestamp: iso(outcome?.settledAt ?? now()),
      request_id: row.id,
      work_ids: workIds,
      summary: {
        model: label(binding.model?.id),
        mode: label(binding.mode),
        requester: label(binding.computerId),
        hosts: [...new Set((binding.providers || []).map(provider => computers.get(provider.participantId)).filter(Boolean))],
        output_tokens: Number.isSafeInteger(outcome?.outputTokens) ? outcome.outputTokens : null,
        credits_charged: Number.isSafeInteger(outcome?.charge) ? outcome.charge : null
      },
      receipt: { request_id: row.id, evidence_sha256: hex(outcome?.evidenceHash), journal_sequences: journal },
      notice: FEED_NOTICE
    };
    return event;
  };

  const notifier = Object.freeze({
    /** First start begins at the current end of the credit database; in-flight requests are still followed. */
    scan() {
      const computers = computerOf();
      return transaction(() => {
        let emitted = 0;
        if (cursor('request_rowid') === undefined) {
          setCursor('request_rowid', credit.prepare('SELECT COALESCE(MAX(rowid),0) AS value FROM fleet_requests').get().value);
          setCursor('journal_sequence', credit.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM fleet_journal').get().value);
          for (const row of credit.prepare("SELECT id,state FROM fleet_requests WHERE state NOT IN ('settled','abandoned')").all())
            state.prepare('INSERT OR IGNORE INTO notifier_tracked VALUES (?,?)').run(row.id, row.state);
          return 0;
        }
        // Requests already followed are older than newly inserted rows, so they are emitted first.
        for (const tracked of state.prepare('SELECT request_id, state FROM notifier_tracked ORDER BY rowid').all()) {
          const current = credit.prepare('SELECT state FROM fleet_requests WHERE id=?').get(tracked.request_id)?.state;
          if (!current) continue;
          if (TERMINAL.has(current)) {
            const event = requestEvent(tracked.request_id, computers);
            if (event && enqueue(event)) emitted++;
            state.prepare('DELETE FROM notifier_tracked WHERE request_id=?').run(tracked.request_id);
          } else if (current !== tracked.state) state.prepare('UPDATE notifier_tracked SET state=? WHERE request_id=?').run(current, tracked.request_id);
        }
        const rows = credit.prepare('SELECT rowid AS rowid, id, state FROM fleet_requests WHERE rowid>? ORDER BY rowid LIMIT 1000').all(cursor('request_rowid'));
        for (const row of rows) {
          if (TERMINAL.has(row.state)) { const event = requestEvent(row.id, computers); if (event && enqueue(event)) emitted++; }
          else state.prepare('INSERT OR REPLACE INTO notifier_tracked VALUES (?,?)').run(row.id, row.state);
          setCursor('request_rowid', row.rowid);
        }
        setCursor('journal_sequence', credit.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM fleet_journal').get().value);
        return emitted;
      });
    },
    enqueueTest(note = 'Feed connectivity check.') {
      const at = now();
      return transaction(() => enqueue({ schema: FEED_EVENT_SCHEMA, event_id: `feed.test:${iso(at)}`, event_type: 'feed.test',
        timestamp: iso(at), request_id: null, work_ids: [], summary: { note: String(note).slice(0, 200) },
        receipt: null, notice: FEED_NOTICE }));
    },
    pending(limit = 50) {
      return state.prepare('SELECT sequence,payload FROM notifier_outbox WHERE delivered_at IS NULL AND next_attempt_at<=? ORDER BY sequence LIMIT ?')
        .all(now(), limit).map(row => ({ ...JSON.parse(row.payload), sequence: row.sequence }));
    },
    /** Delivers one bounded batch; failures back off without dropping or reordering events. */
    async flush(feed, { maxBatch = 50, baseDelayMs = 5000, maxDelayMs = 900000 } = {}) {
      const events = notifier.pending(maxBatch);
      if (!events.length) return { delivered: 0 };
      const sequences = events.map(event => event.sequence);
      const marks = `(${sequences.map(() => '?').join(',')})`;
      try {
        const result = await feed.publish(events);
        transaction(() => state.prepare(`UPDATE notifier_outbox SET delivered_at=?, last_error=NULL WHERE sequence IN ${marks}`).run(now(), ...sequences));
        return { delivered: events.length, ...result };
      } catch (error) {
        const attempts = state.prepare('SELECT MAX(attempts) AS value FROM notifier_outbox WHERE sequence IN ' + marks).get(...sequences).value + 1;
        const delay = Math.max(error.rateLimited ? 60000 : 0, Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempts - 1, 20)));
        transaction(() => state.prepare(`UPDATE notifier_outbox SET attempts=attempts+1, next_attempt_at=?, last_error=? WHERE sequence IN ${marks}`)
          .run(now() + delay, String(error.message).slice(0, 240), ...sequences));
        return { delivered: 0, error: error.message, retryInMs: delay };
      }
    },
    status() {
      return { requestRowid: cursor('request_rowid') ?? null, journalSequence: cursor('journal_sequence') ?? null,
        tracked: state.prepare('SELECT COUNT(*) AS value FROM notifier_tracked').get().value,
        undelivered: state.prepare('SELECT COUNT(*) AS value FROM notifier_outbox WHERE delivered_at IS NULL').get().value,
        delivered: state.prepare('SELECT COUNT(*) AS value FROM notifier_outbox WHERE delivered_at IS NOT NULL').get().value };
    },
    close() { credit.close(); state.close(); }
  });
  return notifier;
}

/** `node notifier.js config.json [--test-event]`; config: creditFile, stateFile, repository, branch, pidFile, ghCommand, pollMs, maxBatch. */
async function main(configFile, flags) {
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  const notifier = await openFleetNotifier({ creditFile: config.creditFile, stateFile: config.stateFile });
  const feed = createGitHubFeed({ repository: config.repository, branch: config.branch || 'main', api: createGhApi({ command: config.ghCommand || 'gh' }) });
  const log = message => console.log(`${new Date().toISOString()} ${message}`);
  if (flags.includes('--test-event')) {
    notifier.enqueueTest();
    const result = await notifier.flush(feed, { maxBatch: config.maxBatch || 50 });
    log(`test flush ${JSON.stringify(result)}`);
    notifier.close();
    process.exitCode = result.error ? 1 : 0;
    return;
  }
  if (config.pidFile) await fs.writeFile(config.pidFile, `${process.pid}\n`, { mode: 0o600 });
  let stopping = false, wake = () => {};
  const stop = () => { stopping = true; wake(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  log(`notifier started ${JSON.stringify(notifier.status())}`);
  while (!stopping) {
    try {
      const emitted = notifier.scan();
      if (emitted) log(`queued ${emitted} event(s)`);
      const result = await notifier.flush(feed, { maxBatch: config.maxBatch || 50 });
      if (result.delivered || result.error) log(`flush ${JSON.stringify(result)}`);
    } catch (error) { log(`cycle error: ${String(error.message).slice(0, 240)}`); }
    if (!stopping) await new Promise(resolve => { const timer = setTimeout(resolve, config.pollMs || 10000); wake = () => { clearTimeout(timer); resolve(); }; });
  }
  notifier.close();
  if (config.pidFile) await fs.rm(config.pidFile, { force: true });
  log('notifier stopped');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2], process.argv.slice(3)).catch(error => { console.error(String(error.message)); process.exit(1); });
}
