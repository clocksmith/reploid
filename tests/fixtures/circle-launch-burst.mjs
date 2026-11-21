import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCircleAdmission } from '../../server/circles/admission.js';
import { createCirclePublicGateway } from '../../server/circles/http-gate.js';
import { openCircleInvites } from '../../server/circles/invites.js';
import { createPublicChallengeGate, derivePublicChallengeCaps } from '../../server/circles/public-challenge-gate.js';

const WAVE1_VISITS = Number(process.env.REPLOID_BURST_VISITS || 50_000);
const WAVE2_VISITS = Number(process.env.REPLOID_BURST_WAVE2_VISITS || 50_000);
const KILL_SWITCH_VISITS = Number(process.env.REPLOID_BURST_KILL_VISITS || 2_000);
const CONCURRENCY = Number(process.env.REPLOID_BURST_CONCURRENCY || 48);

const HOST_ID = 'peer:launch-host-1';
const HOST_LABEL = "Alex's PC";
const OWNER_ID = 'peer:launch-owner';
const GUEST_ID = 'peer:invited-guest';
const MODEL_ID = `sha256:${'9'.repeat(64)}`;

async function runPool(total, concurrency, task) {
  const timings = new Float64Array(total);
  let next = 0;
  const started = performance.now();
  const worker = async () => {
    for (let index = next++; index < total; index = next++) {
      const t0 = performance.now();
      await task(index);
      timings[index] = performance.now() - t0;
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failure = settled.find(item => item.status === 'rejected');
  if (failure) throw failure.reason;
  const elapsedMs = performance.now() - started;
  timings.sort();
  const percentile = p => Number(timings[Math.max(0, Math.ceil(p * total) - 1)].toFixed(2));
  return {
    visits: total,
    concurrency,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99)
  };
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-circle-burst-'));
const invites = await openCircleInvites({
  file: path.join(directory, 'invites.sqlite'),
  hostPeerId: HOST_ID,
  hostLabel: HOST_LABEL
});
const admission = createCircleAdmission({
  hostPeerId: HOST_ID,
  hostLabel: HOST_LABEL,
  modelIdentity: MODEL_ID,
  isReady: () => true,
  invites,
  isOwner: id => id === OWNER_ID,
  maxQueuedRequests: 8,
  maxQueuedPerGuest: 2,
  maxWaitMs: 5000
});

// Derive Wave 2 rate caps from measured throughput (e.g., 30 attempts/min on 1 host -> 24/min at 0.8 safety factor).
const wave2Caps = derivePublicChallengeCaps({
  measuredAttemptsPerMinute: 30,
  hostCount: 1,
  safetyFactor: 0.8,
  maxTurnsPerVisitor: 2
});
const challengeGate = createPublicChallengeGate({
  enabled: false,
  host: { hostPeerId: HOST_ID, hostLabel: HOST_LABEL, modelIdentity: MODEL_ID, tier: 'project', maxConcurrent: 1 },
  caps: wave2Caps,
  maxExpectedWaitMs: 20_000
});

const gateway = createCirclePublicGateway({
  invites,
  admission,
  ownerPairing: { isOwner: id => id === OWNER_ID },
  authenticatePeer: async req => req.headers['x-test-peer'] || null,
  publicChallengeGate: challengeGate,
  recordedDemo: { title: 'Reploid Wave 1 Recorded Demo', output: 'Recorded sample answer.', modelIdentity: MODEL_ID },
  executeInference: async ({ maxOutputTokens }) => ({
    output: 'Authorized answer.',
    outputTokens: Math.min(12, maxOutputTokens),
    modelWeightBytes: 0
  })
});

const running = await gateway.listen();
const { origin } = running;

try {
  // Provision 1 legitimate invited guest with a 5-request cap as a positive control.
  const issued = invites.issue({ expiresAt: Date.now() + 3600_000, maxRequests: 5, maxOutputTokens: 32 });
  const redeemed = invites.redeem({ token: issued.token, guestPeerId: GUEST_ID });
  assert.ok(redeemed);

  // --- Phase 1: Wave 1 50,000-visit burst (public demo + invalid invites + 5 authorized guest turns) ---
  const wave1Counts = { demo200: 0, invalidInvite403: 0, guestAdmitted200: 0, guestExhausted403: 0 };
  const wave1Timing = await runPool(WAVE1_VISITS, CONCURRENCY, async index => {
    if (index < 10) {
      // 10 requests from the invited guest against a 5-request quota: exactly 5 must admit, 5 must refuse.
      const res = await fetch(`${origin}/circle/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-peer': GUEST_ID },
        body: JSON.stringify({
          inviteId: redeemed.inviteId,
          hostPeerId: HOST_ID,
          requestId: `guest-turn-${index}`,
          modelIdentity: MODEL_ID,
          maxOutputTokens: 16,
          prompt: `hello ${index}`
        })
      });
      if (res.status === 200) {
        const body = await res.json();
        assert.equal(body.receipt.hostPeerId, HOST_ID);
        assert.equal(body.receipt.modelIdentity, MODEL_ID);
        assert.equal(body.receipt.modelWeightBytes, 0);
        wave1Counts.guestAdmitted200 += 1;
      } else {
        assert.equal(res.status, 403);
        await res.arrayBuffer();
        wave1Counts.guestExhausted403 += 1;
      }
      return;
    }
    if (index % 10 === 0) {
      const res = await fetch(`${origin}/circle/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-peer': `peer:uninvited-${index}` },
        body: JSON.stringify({ token: 'x'.repeat(43), hostPeerId: HOST_ID })
      });
      assert.equal(res.status, 403);
      await res.arrayBuffer();
      wave1Counts.invalidInvite403 += 1;
      return;
    }
    const res = await fetch(`${origin}/circle/demo`);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    wave1Counts.demo200 += 1;
  });

  const afterWave1 = running.stats();
  assert.equal(wave1Counts.guestAdmitted200, 5);
  assert.equal(wave1Counts.guestExhausted403, 5);
  assert.equal(afterWave1.inferenceCalls, 5, 'Public demo and invalid invites must consume 0 inference capacity');
  assert.equal(afterWave1.challengeCalls, 0);
  assert.ok(afterWave1.peakExecutions <= 1, 'Single-host concurrency must never exceed 1');

  // --- Phase 2: Wave 2 50,000-visit burst with hard-capped Public Challenge lane ON ---
  challengeGate.setEnabled(true);
  const wave2Counts = { demo200: 0, openChat403: 0, challenge200: 0, challengeCapped429: 0 };
  const wave2Timing = await runPool(WAVE2_VISITS, CONCURRENCY, async index => {
    if (index % 50 === 0) {
      // Probe open chat refusal.
      const res = await fetch(`${origin}/circle/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'open-chat', visitorId: `v-${index}`, modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'open chat'
        })
      });
      assert.equal(res.status, 403);
      await res.arrayBuffer();
      wave2Counts.openChat403 += 1;
      return;
    }
    if (index % 10 === 0) {
      // Challenge attempt from public surge visitor.
      const res = await fetch(`${origin}/circle/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'daily-challenge',
          visitorId: `visitor-${index % 100}`,
          modelIdentity: MODEL_ID,
          maxOutputTokens: 16,
          challengeDay: '2026-11-21',
          prompt: `attempt ${index}`
        })
      });
      if (res.status === 200) {
        const body = await res.json();
        assert.equal(body.disclosure.readableBy, `Readable by: ${HOST_LABEL}`);
        assert.equal(body.receipt.maxOutputTokens, 16);
        wave2Counts.challenge200 += 1;
      } else {
        assert.equal(res.status, 429);
        const body = await res.json();
        assert.deepEqual(body.fallback, ['replay', 'host-your-own']);
        wave2Counts.challengeCapped429 += 1;
      }
      return;
    }
    const res = await fetch(`${origin}/circle/demo`);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    wave2Counts.demo200 += 1;
  });

  const afterWave2 = running.stats();
  assert.equal(afterWave2.inferenceCalls, 5, 'Wave 2 public traffic must never touch invite-only chat capacity');
  assert.ok(wave2Counts.challenge200 > 0 && wave2Counts.challenge200 <= wave2Caps.perHostAttemptsPerMinute,
    `Challenge admissions (${wave2Counts.challenge200}) must stay within per-minute host cap (${wave2Caps.perHostAttemptsPerMinute})`);
  assert.equal(afterWave2.challengeCalls, wave2Counts.challenge200);
  assert.ok(afterWave2.peakExecutions <= 1, 'Host concurrency must stay within configured capacity (1)');

  // --- Phase 3: Kill switch immediately returns public surface to replay-only ---
  challengeGate.setKillSwitch(true);
  let killSwitchReplayOnly503 = 0;
  const killTiming = await runPool(KILL_SWITCH_VISITS, CONCURRENCY, async index => {
    const res = await fetch(`${origin}/circle/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'daily-challenge',
        visitorId: `post-kill-${index}`,
        modelIdentity: MODEL_ID,
        maxOutputTokens: 16,
        prompt: 'should not run'
      })
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'CHALLENGE_REPLAY_ONLY');
    assert.deepEqual(body.fallback, ['replay', 'host-your-own']);
    killSwitchReplayOnly503 += 1;
  });

  const finalStats = running.stats();
  assert.equal(finalStats.challengeCalls, afterWave2.challengeCalls, 'Kill switch must admit 0 new inference calls');
  assert.equal(finalStats.inferenceCalls, 5);

  const report = {
    schema: 'reploid.wave1-burst-report/v1',
    fixture: 'Loopback HTTP createCirclePublicGateway + disk SQLite invites + fair-lane admission + Wave 2 public challenge gate',
    host: { hostPeerId: HOST_ID, hostLabel: HOST_LABEL, modelIdentity: MODEL_ID, configuredMaxConcurrent: 1 },
    wave2Caps,
    wave1: { ...wave1Timing, counts: wave1Counts, unauthorizedInferenceCalls: 0, peakExecutions: afterWave1.peakExecutions },
    wave2: { ...wave2Timing, counts: wave2Counts, peakExecutions: afterWave2.peakExecutions },
    killSwitch: { ...killTiming, replayOnly503: killSwitchReplayOnly503, postKillChallengeCalls: finalStats.challengeCalls - afterWave2.challengeCalls },
    totals: finalStats
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await running.close();
  admission.close();
  invites.close();
  await fs.rm(directory, { recursive: true, force: true });
}
