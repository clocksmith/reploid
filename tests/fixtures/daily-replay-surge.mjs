// Exercise the real Daily replay routes on a private loopback listener.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDailyApp } from '../../server/daily/http.js';
import { createDailyStore } from '../../server/daily/store.js';

const visits = 50_000;
const concurrency = 32;
const day = '2026-11-21';
const clock = () => Date.parse(`${day}T13:00:00Z`);
const prompt = 'Describe the color of the sky';
const answer = 'Blue.';
const directory = await mkdtemp(join(tmpdir(), 'reploid-daily-replay-surge-'));
const store = createDailyStore({ path: join(directory, 'daily.sqlite'), hostId: 'replay-surge-fixture', hostDailyCap: 1, now: clock });
const invite = store.circleInvite({ expiresAt: clock() + 3600_000 });
let admissions = 0;
let executions = 0;
const app = createDailyApp({
  store: { ...store, reserve(request) { admissions++; return store.reserve(request); } },
  staticRoot: fileURLToPath(new URL('../../server/daily/site/', import.meta.url)),
  clock, circleName: 'Replay surge fixture',
  gameForDay: date => ({ day: date, digest: 'replay-surge', qualified: true, target: answer,
    banned: ['blue'], ruleVersion: 'fixture', modelId: 'fixture' }),
  identity: { async verify() { return 'replay-fixture-account'; } },
  async run({ onDispatch }) {
    onDispatch(); executions++;
    return { output: answer, receipt: { fixture: true } };
  }
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;

async function post(path, value, expected, cookie) {
  const response = await fetch(origin + path, { method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Circle-Invite': invite.token,
      ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(value) });
  const body = await response.json();
  assert.equal(response.status, expected, `${path}: ${body.error ?? response.status}`);
  return { body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

try {
  // Use the normal API once to publish a recorded score and fill the host. The
  // positive control also verifies both admission and execution counters work.
  const { cookie } = await post('/api/auth/verify', { email: 'replay@example.test', code: '123456' }, 200);
  assert.ok(cookie);
  const { body: { attempt } } = await post('/api/attempt', { day, digest: 'replay-surge',
    key: 'positive-control', prompt }, 201, cookie);
  const { body: { share } } = await post('/api/share', { attemptId: attempt.id, allowReveal: false }, 200, cookie);
  assert.equal(share.output, answer);
  assert.equal(admissions, 1);
  assert.equal(executions, 1);
  const before = store.capacity(day);
  assert.deepEqual(before, { used: 1, cap: 1 });

  const replayQuery = new URLSearchParams({ share: share.id });
  const landing = `${origin}/?${replayQuery}`;
  const replayApi = `${origin}/api/today?${replayQuery}`;
  const timings = new Float64Array(visits);
  let next = 0;
  const started = performance.now();
  const worker = async () => {
    for (let index = next++; index < visits; index = next++) {
      const visitStarted = performance.now();
      const options = { signal: AbortSignal.timeout(10_000), redirect: 'error' };
      const page = await fetch(landing, options);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /View recorded answer/);
      const response = await fetch(replayApi, options);
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.equal(json.share?.output, answer);
      assert.equal(json.authenticated, false);
      assert.equal(json.inviteValid, false);
      assert.equal(json.history.length, 0);
      assert.equal(json.share?.prompt, undefined);
      timings[index] = performance.now() - visitStarted;
    }
  };
  const results = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const elapsedMs = performance.now() - started;
  assert.ok(timings.every(value => value > 0));
  assert.deepEqual(store.capacity(day), before);
  assert.equal(admissions, 1);
  assert.equal(executions, 1);
  assert.equal(store.ownerStats().openedDares, 1);
  timings.sort();
  const percentile = p => Number(timings[Math.ceil(p * visits) - 1].toFixed(2));
  console.log(JSON.stringify({ visits, httpRequests: visits * 2, concurrency,
    elapsedMs: Number(elapsedMs.toFixed(2)), visitP50Ms: percentile(0.5), visitP95Ms: percentile(0.95),
    replayAdmissions: admissions - 1, replayInferenceCalls: executions - 1,
    fixture: 'Real loopback Daily routes, disk SQLite, one preseeded winning fixture answer' }, null, 2));
} finally {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
  store.close();
  await rm(directory, { recursive: true, force: true });
}
