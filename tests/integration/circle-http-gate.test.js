// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCircleAdmission } from '../../server/circles/admission.js';
import { createCirclePublicGateway } from '../../server/circles/http-gate.js';
import { openCircleInvites } from '../../server/circles/invites.js';
import { createPublicChallengeGate, derivePublicChallengeCaps } from '../../server/circles/public-challenge-gate.js';

import { openOwnerPairing } from '../../server/circles/owner-pairing.js';
import { requestOwnerPairing } from '../../packages/reploid/src/transport/index.js';
import { createCircleInviteGuest } from '../../apps/poolday/host/circle-invites.js';

const HOST_ID = 'peer:' + 'a'.repeat(24);
const HOST_LABEL = "Alex's PC";
const OWNER_ID = 'peer:' + 'b'.repeat(24);
const GUEST_ID = 'peer:' + 'c'.repeat(24);
const MODEL_ID = `sha256:${'f'.repeat(64)}`;

describe('Circle HTTP invite & capacity gate (#185 / #187)', () => {
  let directory, invites, admission, challengeGate, server, origin, pairing;
  let ready = true;
  const disclosedPrompts = [];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-circle-http-'));
    const request = Promise.withResolvers();
    pairing = await openOwnerPairing({ file: path.join(directory, 'pairing.sqlite'), hostParticipantId: HOST_ID, onRequest: request.resolve });
    const listeners = [new Map(), new Map()];
    const endpoint = i => ({ getPeerBinding: () => ({ local: 'fixture:' + i, remote: 'fixture:' + (1-i) }),
      onMessage: (type, fn) => listeners[i].set(type, fn),
      sendToPeer: (_peer, type, body) => { queueMicrotask(() => listeners[1-i].get(type)?.(i === 0 ? 'desktop' : 'phone', body)); return true; } });
    pairing.attach({ transport: endpoint(0), verifyPeer: async () => OWNER_ID, currentPeer: () => OWNER_ID });
    const pending = requestOwnerPairing({ transport: endpoint(1), verifyPeer: async () => HOST_ID,
      currentPeer: () => HOST_ID, hostPeer: 'desktop', ...pairing.issue(), signal: AbortSignal.timeout(1000) });
    const { requestId } = await request.promise;
    expect(pairing.isOwner(OWNER_ID)).toBe(false);
    expect(pairing.decide(requestId, true)).toBe(true);
    expect(await pending).toEqual({ hostParticipantId: HOST_ID });
    ready = true;
    disclosedPrompts.length = 0;
    invites = await openCircleInvites({
      file: path.join(directory, 'invites.sqlite'),
      hostPeerId: HOST_ID,
      hostLabel: HOST_LABEL
    });
    admission = createCircleAdmission({
      hostPeerId: HOST_ID,
      hostLabel: HOST_LABEL,
      modelIdentity: MODEL_ID,
      isReady: () => ready,
      invites,
      isOwner: pairing.isOwner,
      maxQueuedRequests: 4,
      maxQueuedPerGuest: 2,
      maxWaitMs: 5000
    });
    challengeGate = createPublicChallengeGate({
      enabled: false,
      host: { hostPeerId: HOST_ID, hostLabel: HOST_LABEL, modelIdentity: MODEL_ID, tier: 'project', maxConcurrent: 1 },
      caps: derivePublicChallengeCaps({ measuredAttemptsPerMinute: 20, maxTurnsPerVisitor: 2, safetyFactor: 0.5 })
    });
    const gateway = createCirclePublicGateway({
      invites,
      admission,
      ownerPairing: pairing,
      authenticatePeer: async req => req.headers['x-test-peer'] || null,
      publicChallengeGate: challengeGate,
      recordedDemo: { title: 'Recorded Reploid demo', output: 'Hello from a recorded run.', modelIdentity: MODEL_ID },
      executeInference: async ({ prompt, maxOutputTokens }) => {
        disclosedPrompts.push(prompt);
        return { output: `Answer(${prompt})`, outputTokens: Math.min(8, maxOutputTokens), modelWeightBytes: 0 };
      }
    });
    server = await gateway.listen();
    origin = server.origin;
  });

  afterEach(async () => {
    await server?.close();
    admission?.close();
    pairing?.close();
    invites?.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  async function post(route, body, peerId) {
    const response = await fetch(`${origin}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(peerId ? { 'x-test-peer': peerId } : {}) },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  it('keeps public demo and invalid/cross-host invites at zero inference capacity while enforcing owner-issued invite limits and revocation', async () => {
    // Public recorded demo consumes zero inference capacity and shows direct host disclosure.
    const demo = await fetch(`${origin}/circle/demo`);
    expect(demo.status).toBe(200);
    const demoJson = await demo.json();
    expect(demoJson.disclosure.readableBy).toBe("Readable by: Alex's PC");
    expect(demoJson.disclosure.notice).toBe("This runs on Alex's PC. Its operator can read your prompt.");
    expect(demoJson.challenge.mode).toBe('replay-only');
    expect(server.stats().inferenceCalls).toBe(0);

    // Invalid invite & guest trying to manage invites are rejected with 0 inference calls.
    const badRedeem = await post('/circle/redeem', { token: 'z'.repeat(43) }, GUEST_ID);
    expect(badRedeem.status).toBe(403);
    const guestOwnerAttempt = await post('/circle/owner', {
      op: 'circle-invites.issue', expiresAt: Date.now() + 60_000, maxRequests: 5, maxOutputTokens: 32
    }, GUEST_ID);
    expect(guestOwnerAttempt.status).toBe(403);
    const uninvitedChat = await post('/circle/admit', {
      inviteId: 'bogus', hostPeerId: HOST_ID, requestId: 'r0', modelIdentity: MODEL_ID, maxOutputTokens: 16
    }, GUEST_ID);
    expect(uninvitedChat.status).toBe(403);
    expect(server.stats().inferenceCalls).toBe(0);
    expect(disclosedPrompts).toEqual([]);

    // Owner issues a 1-request invite scoped to Alex's PC.
    const issued = await post('/circle/owner', {
      op: 'circle-invites.issue', expiresAt: Date.now() + 60_000, maxRequests: 2, maxOutputTokens: 32
    }, OWNER_ID);
    expect(issued.status).toBe(200);
    const { token, inviteId } = issued.body.result;

    // Cross-host redemption and cross-host chat are rejected.
    const wrongHostRedeem = await post('/circle/redeem', { token, hostPeerId: 'peer:other-pc' }, GUEST_ID);
    expect(wrongHostRedeem.status).toBe(403);
    const redeemed = await post('/circle/redeem', { token, hostPeerId: HOST_ID }, GUEST_ID);
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.disclosure.readableBy).toBe("Readable by: Alex's PC");

    const wrongHostChat = await post('/circle/admit', {
      inviteId, hostPeerId: 'peer:other-pc', requestId: 'r-other', modelIdentity: MODEL_ID, maxOutputTokens: 16
    }, GUEST_ID);
    expect(wrongHostChat.status).toBe(403);
    expect(disclosedPrompts).toEqual([]);

    // Valid guest turn returns answer + request-matched receipt with 0 model weight bytes downloaded.
    const guestWire = [];
    const guest = createCircleInviteGuest({ hostPeerId: HOST_ID, inviteId, currentHost: () => HOST_ID,
      request: async (route, payload) => {
        guestWire.push({ route, payload });
        const result = await post(route, payload, GUEST_ID);
        if (result.status !== 200) throw Error(result.body.code);
        return result.body;
      } });
    const turn1 = await guest.generate({ requestId: 'r1', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'hello friend' });
    expect(guestWire.map(row => row.route)).toEqual(['/circle/admit', '/circle/chat']);
    expect(guestWire[0].payload).not.toHaveProperty('prompt');
    expect(turn1.receipt).toMatchObject({
      requestId: 'r1',
      hostPeerId: HOST_ID,
      hostLabel: HOST_LABEL,
      modelIdentity: MODEL_ID,
      role: 'guest',
      inviteId,
      modelWeightBytes: 0,
      outcome: 'completed'
    });

    // An owner occupies the only slot. A queued guest sends only metadata and is revoked.
    const blocker = await admission.acquire({ requestId: 'owner-block', modelIdentity: MODEL_ID, maxOutputTokens: 16 },
      { authenticatedPeerId: OWNER_ID });
    try {
      const queued = guest.generate({ requestId: 'r2', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'never disclosed' });
      const denied = expect(queued).rejects.toThrow('CIRCLE_REVOKED');
      await vi.waitFor(() => expect(admission.getQueuedCount(inviteId)).toBe(1));
      const revoked = await post('/circle/owner', { op: 'circle-invites.revoke', inviteId }, OWNER_ID);
      expect(revoked.status).toBe(200);
      await denied;
      expect(guestWire.map(row => row.route)).toEqual(['/circle/admit', '/circle/chat', '/circle/admit']);
      expect(guestWire[2].payload).not.toHaveProperty('prompt');
      expect(invites.getSettlement({ guestPeerId: GUEST_ID, requestId: 'r2' })).toBeNull();
      expect(admission.getQueuedCount(inviteId)).toBe(0);
    } finally { blocker.release(); }
    expect(disclosedPrompts).toEqual(['hello friend']);
  });

  it('toggles Wave 2 public challenge lane independently and enforces kill switch back to replay-only', async () => {
    // Off by default -> 503 replay-only.
    const offRes = await post('/circle/challenge', {
      kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'try 1'
    });
    expect(offRes.status).toBe(503);
    expect(offRes.body.mode).toBe('replay-only');
    expect(server.stats().challengeCalls).toBe(0);

    // Enable Wave 2 public challenge lane.
    challengeGate.setEnabled(true);

    // Open public chat is still forbidden (403).
    const openChat = await post('/circle/challenge', {
      kind: 'open-chat', visitorId: 'v1', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'chat'
    });
    expect(openChat.status).toBe(403);

    // > 16 output tokens rejected (400).
    const tooLong = await post('/circle/challenge', {
      kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL_ID, maxOutputTokens: 32, prompt: 'long'
    });
    expect(tooLong.status).toBe(400);

    // Valid <= 16-token challenge turn succeeds with explicit disclosure.
    const ok = await post('/circle/challenge', {
      kind: 'daily-challenge', visitorId: 'v1', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'say hi'
    });
    expect(ok.status).toBe(200);
    expect(ok.body.disclosure.readableBy).toBe("Readable by: Alex's PC");
    expect(ok.body.receipt.maxOutputTokens).toBe(16);
    expect(server.stats().challengeCalls).toBe(1);

    // Flip kill switch -> immediately back to replay-only (0 more challenge executions).
    challengeGate.setKillSwitch(true);
    const afterKill = await post('/circle/challenge', {
      kind: 'daily-challenge', visitorId: 'v2', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'after kill'
    });
    expect(afterKill.status).toBe(503);
    expect(afterKill.body.code).toBe('CHALLENGE_REPLAY_ONLY');
    expect(server.stats().challengeCalls).toBe(1);
  });
});
