// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FEED_NOTICE, openFleetNotifier } from '../../server/fleet/notifier.js';
import { createGitHubFeed } from '../../server/fleet/feed-github.js';

const SECRET = 'PROMPT-SECRET-do-not-publish';
const evidenceHash = 'c'.repeat(64);

/** In-memory Git data API with the endpoints the feed uses. */
function fakeGitHub() {
  const blobs = new Map(), trees = new Map(), commits = new Map();
  let head = 'commit-0', counter = 0, failures = 0;
  commits.set(head, { tree: 'tree-0' }); trees.set('tree-0', new Map());
  const api = async (method, route, body) => {
    if (failures > 0) { failures--; const error = new Error('HTTP 502'); error.status = 502; throw error; }
    if (method === 'GET' && route.endsWith('/git/ref/heads/main')) return { object: { sha: head } };
    if (method === 'GET' && route.includes('/git/commits/')) return { tree: { sha: commits.get(route.split('/').pop()).tree } };
    if (method === 'GET' && route.includes('/contents/')) {
      const file = decodeURIComponent(route.split('/contents/')[1].split('?')[0]);
      const sha = trees.get(commits.get(head).tree).get(file);
      if (!sha) { const error = new Error('HTTP 404'); error.status = 404; throw error; }
      return { sha, encoding: 'base64', content: Buffer.from(blobs.get(sha)).toString('base64') };
    }
    if (method === 'POST' && route.endsWith('/git/trees')) {
      const tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) { const sha = `blob-${++counter}`; blobs.set(sha, entry.content); tree.set(entry.path, sha); }
      const sha = `tree-${++counter}`; trees.set(sha, tree); return { sha };
    }
    if (method === 'POST' && route.endsWith('/git/commits')) { const sha = `commit-${++counter}`; commits.set(sha, { tree: body.tree, message: body.message }); return { sha }; }
    if (method === 'PATCH' && route.endsWith('/git/refs/heads/main')) { expect(body.force).toBe(false); head = body.sha; return {}; }
    throw new Error(`unexpected ${method} ${route}`);
  };
  const read = file => { const sha = trees.get(commits.get(head).tree).get(file); return sha ? blobs.get(sha) : null; };
  return { api, read, fail: count => { failures = count; }, commitCount: () => [...commits.keys()].length - 1 };
}

describe('fleet feed notifier', () => {
  let directory, credit, creditFile, stateFile, clock, github, feed;
  const open = () => openFleetNotifier({ creditFile, stateFile, now: () => clock });
  const addRequest = (id, state = 'reserved') => credit.prepare('INSERT INTO fleet_requests VALUES (?,?,?,NULL)').run(id, JSON.stringify({
    computerId: 'mac', mode: 'whole-model', model: { id: 'qwen-test' }, providers: [{ participantId: 'peer:bee', weight: 1 }],
    inputDigest: 'sha256:' + 'd'.repeat(64), prompt: SECRET }), state);
  const settle = (id, status) => {
    credit.prepare("UPDATE fleet_requests SET state='settled', outcome=? WHERE id=?").run(JSON.stringify({ id, charge: 6, outputTokens: 6,
      ...(status ? { status } : {}), evidenceHash, settledAt: Date.UTC(2026, 10, 12, 4, 0, 0), output: SECRET }), id);
    credit.prepare('INSERT INTO fleet_work VALUES (?,?)').run(`work:${id}`, id);
    credit.prepare('INSERT INTO fleet_evidence VALUES (?,?)').run(id, JSON.stringify({ text: SECRET }));
    credit.prepare('INSERT INTO fleet_journal (request_id,account_id,delta,at) VALUES (?,?,?,?)').run(id, 'mac', -6, 1);
    credit.prepare('INSERT INTO fleet_journal (request_id,account_id,delta,at) VALUES (?,?,?,?)').run(id, 'bee', 6, 1);
  };

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'reploid-fleet-notifier-'));
    creditFile = path.join(directory, 'credits.sqlite'); stateFile = path.join(directory, 'notifier.sqlite');
    credit = new DatabaseSync(creditFile);
    credit.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE fleet_requests (id TEXT PRIMARY KEY, binding TEXT NOT NULL, state TEXT NOT NULL, outcome TEXT);
      CREATE TABLE fleet_work (id TEXT PRIMARY KEY, request_id TEXT NOT NULL);
      CREATE TABLE fleet_evidence (request_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE fleet_journal (sequence INTEGER PRIMARY KEY, request_id TEXT NOT NULL, account_id TEXT NOT NULL, delta INTEGER NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE fleet_metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    credit.prepare("INSERT INTO fleet_metadata VALUES ('enrollment',?)").run(JSON.stringify([
      { id: 'mac', name: 'network-name-a', providers: [{ participantId: 'peer:mac', publicJwk: { x: 'key-a' } }] },
      { id: 'bee', name: 'network-name-b', providers: [{ participantId: 'peer:bee', publicJwk: { x: 'key-b' } }] }]));
    clock = Date.UTC(2026, 10, 12, 5, 0, 0);
    github = fakeGitHub(); feed = createGitHubFeed({ repository: 'owner/feed', api: github.api });
  });
  afterEach(async () => { credit.close(); await rm(directory, { recursive: true, force: true }); });

  it('starts at the current end, follows in-flight requests and publishes allowlisted fields only', async () => {
    addRequest('old'); settle('old'); addRequest('inflight', 'dispatched');
    const notifier = await open();
    expect(notifier.scan()).toBe(0);
    settle('inflight'); addRequest('abandoned', 'abandoned');
    expect(notifier.scan()).toBe(2);
    expect((await notifier.flush(feed)).delivered).toBe(2);
    const lines = github.read('events/2026-11-12.jsonl').trim().split('\n').map(line => JSON.parse(line));
    expect(lines.map(event => event.event_id)).toEqual(['fleet:inflight:settled', 'fleet:abandoned:abandoned']);
    const [settled] = lines;
    expect(Object.keys(settled).sort()).toEqual(['event_id', 'event_type', 'notice', 'receipt', 'request_id', 'schema', 'sequence', 'summary', 'timestamp', 'work_ids']);
    expect(settled).toMatchObject({ event_type: 'request.settled', timestamp: '2026-11-12T04:00:00.000Z', work_ids: ['work:inflight'], notice: FEED_NOTICE,
      summary: { model: 'qwen-test', requester: 'mac', hosts: ['bee'], output_tokens: 6, credits_charged: 6 },
      receipt: { request_id: 'inflight', evidence_sha256: evidenceHash, journal_sequences: [3, 4] } });
    const published = github.read('events/2026-11-12.jsonl') + github.read('latest.json');
    for (const forbidden of [SECRET, 'key-a', 'network-name', 'inputDigest', 'sha256:ddd']) expect(published).not.toContain(forbidden);
    expect(JSON.parse(github.read('latest.json'))).toMatchObject({ event_id: 'fleet:abandoned:abandoned', sequence: 2, file: 'events/2026-11-12.jsonl' });
    notifier.close();
  });

  it('classifies terminal statuses, deduplicates and resumes from its cursor after restart', async () => {
    let notifier = await open(); notifier.scan();
    addRequest('a', 'dispatched'); addRequest('b', 'dispatched');
    expect(notifier.scan()).toBe(0);
    settle('a', 'cancelled');
    expect(notifier.scan()).toBe(1);
    expect(notifier.scan()).toBe(0);
    notifier.close();
    settle('b', 'failed'); addRequest('c'); settle('c');
    notifier = await open();
    expect(notifier.scan()).toBe(2);
    expect(notifier.pending().map(event => event.event_type)).toEqual(['request.cancelled', 'request.failed', 'request.settled']);
    await notifier.flush(feed);
    expect(notifier.status()).toMatchObject({ undelivered: 0, delivered: 3, tracked: 0 });
    notifier.close();
  });

  it('retries after a failed publish with backoff and never duplicates a landed line', async () => {
    const notifier = await open(); notifier.scan();
    addRequest('x', 'dispatched'); notifier.scan(); settle('x'); notifier.scan();
    github.fail(1);
    const failed = await notifier.flush(feed, { baseDelayMs: 1000 });
    expect(failed).toMatchObject({ delivered: 0, retryInMs: 1000 });
    expect(notifier.pending()).toHaveLength(0);
    clock += 1000;
    expect((await notifier.flush(feed)).delivered).toBe(1);
    // A lost delivery mark republishes; the feed skips the already-present line and makes no commit.
    const again = await feed.publish([{ ...JSON.parse(github.read('events/2026-11-12.jsonl')) }]);
    expect(again).toEqual({ committed: null, appended: 0 });
    expect(github.read('events/2026-11-12.jsonl').trim().split('\n')).toHaveLength(1);
    expect(github.commitCount()).toBe(1);
    notifier.close();
  });

  it('publishes a feed.test event and never opens the credit database for writing', async () => {
    const notifier = await open(); notifier.scan();
    expect(notifier.enqueueTest()).toBe(true);
    await notifier.flush(feed);
    const latest = JSON.parse(github.read('latest.json'));
    expect(latest).toMatchObject({ event_type: 'feed.test', notice: FEED_NOTICE });
    const before = credit.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get().n;
    expect(credit.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get().n).toBe(before);
    expect(credit.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'notifier_%'").get().n).toBe(0);
    notifier.close();
    await expect(openFleetNotifier({ creditFile, stateFile: creditFile })).rejects.toThrow(/must not share/);
  });
});
