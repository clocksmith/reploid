// @vitest-environment node
import fs from 'node:fs/promises';
import http from 'node:http';
import { sendCircleChat } from '../../apps/poolday/host/circle-invites.js';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCircleAdmission } from '../../server/circles/admission.js';
import { createCirclePublicGateway } from '../../server/circles/http-gate.js';
import { openCircleInvites } from '../../server/circles/invites.js';
import { createPublicChallengeGate, derivePublicChallengeCaps } from '../../server/circles/public-challenge-gate.js';

const HOST_ID = 'peer:alex-desktop';
const HOST_LABEL = "Alex's PC";
const OWNER_ID = 'peer:alex-phone';
const GUEST_ID = 'peer:friend-phone';
const MODEL_ID = `sha256:${'f'.repeat(64)}`;

describe('Circle HTTP invite & capacity gate (#185 / #187)', () => {
  let directory, invites, admission, challengeGate, server, origin;
  let ready = true, offset = 0;
  const now = () => Date.now()+offset;
  const disclosedPrompts = [];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-circle-http-'));
    ready = true; offset = 0;
    disclosedPrompts.length = 0;
    invites = await openCircleInvites({
      file: path.join(directory, 'invites.sqlite'), now,
      hostPeerId: HOST_ID,
      hostLabel: HOST_LABEL
    });
    admission = createCircleAdmission({
      now,
      hostPeerId: HOST_ID,
      hostLabel: HOST_LABEL,
      modelIdentity: MODEL_ID,
      isReady: () => ready,
      invites,
      isOwner: id => id === OWNER_ID,
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
      now,
      invites,
      admission,
      ownerPairing: { isOwner: id => id === OWNER_ID },
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
    invites?.close();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  async function post(route, body, peerId, headers = {}) {
    const response = await fetch(`${origin}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(peerId ? { 'x-test-peer': peerId } : {}), ...headers },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  const metadata = (requestId,inviteId) => ({hostPeerId:HOST_ID,requestId,modelIdentity:MODEL_ID,maxOutputTokens:16,
    ...(inviteId ? {inviteId} : {})});
  function grantHeaders(grant) { return {'x-circle-grant':grant,'x-circle-host':HOST_ID}; }
  async function normalChat(body,peerId,fetchImpl = fetch,signal) {
    const {prompt,...metadata} = body;
    const response = await sendCircleChat({origin,metadata,requesterPeerId:peerId,prompt,signal,headers:{'x-test-peer':peerId},fetchImpl});
    return {status:response.status,body:await response.json()};
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
    const uninvitedChat = await post('/circle/chat', {
      inviteId: 'bogus', requestId: 'r0', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'leak me'
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

    const wrongHostChat = await post('/circle/chat', {
      inviteId, hostPeerId: 'peer:other-pc', requestId: 'r-other', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'wrong host'
    }, GUEST_ID);
    expect(wrongHostChat.status).toBe(403);
    expect(disclosedPrompts).toEqual([]);

    // Valid guest turn returns answer + request-matched receipt with 0 model weight bytes downloaded.
    const turn1 = await normalChat({
      inviteId, hostPeerId: HOST_ID, requestId: 'r1', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'hello friend'
    }, GUEST_ID);
    expect(turn1.status).toBe(200);
    expect(turn1.body.receipt).toMatchObject({
      requestId: 'r1',
      hostPeerId: HOST_ID,
      hostLabel: HOST_LABEL,
      modelIdentity: MODEL_ID,
      role: 'guest',
      inviteId,
      modelWeightBytes: 0,
      outcome: 'completed'
    });

    // Owner revokes invite; second turn is blocked before prompt disclosure.
    const revoked = await post('/circle/owner', { op: 'circle-invites.revoke', inviteId }, OWNER_ID);
    expect(revoked.status).toBe(200);
    expect(revoked.body.result.status).toBe('revoked');

    const turn2 = await normalChat({
      inviteId, hostPeerId: HOST_ID, requestId: 'r2', modelIdentity: MODEL_ID, maxOutputTokens: 16, prompt: 'must not disclose'
    }, GUEST_ID);
    expect(turn2.status).toBe(403);
    expect(disclosedPrompts).toEqual(['hello friend']);
  });

  function newGuest(expiresAt = now()+60_000) {
    const issued = invites.issue({expiresAt,maxRequests:12,maxOutputTokens:32});
    expect(invites.redeem({token:issued.token,guestPeerId:GUEST_ID})).toBeTruthy();
    return issued.inviteId;
  }

  it('sends only routing metadata while queued and uses the bound grant once for owner and guest', async () => {
    const inviteId = newGuest();
    const held = await post('/circle/admit',metadata('holder'),OWNER_ID);
    expect(held.body).toMatchObject({admitted:true,hostPeerId:HOST_ID,requesterPeerId:OWNER_ID,requestId:'holder'});
    const headers = grantHeaders(held.body.grant);
    for (const [peer,scope] of [[GUEST_ID,headers],[OWNER_ID,{...headers,'x-circle-host':'another-host'}]]) {
      expect((await post('/circle/chat',{prompt:'unauthorized'},peer,scope)).status).toBe(403);
    }
    const calls = [];
    const guest = normalChat({...metadata('queued',inviteId),prompt:'retained local draft'},GUEST_ID,(url,options) => {
      calls.push([new URL(url).pathname,JSON.parse(options.body)]); return fetch(url,options);
    });
    await expect.poll(()=>admission.getQueuedCount(inviteId)).toBe(1);
    expect(calls).toEqual([['/circle/admit',metadata('queued',inviteId)]]);
    expect(disclosedPrompts).toEqual([]);
    const answer = await post('/circle/chat',{prompt:'owner first'},OWNER_ID,headers);
    expect(answer.body.receipt).toMatchObject({role:'owner',requestId:'holder',modelWeightBytes:0});
    expect((await guest).body.receipt).toMatchObject({role:'guest',requestId:'queued',modelWeightBytes:0});
    expect(calls[1]).toEqual(['/circle/chat',{prompt:'retained local draft'}]);
    expect((await post('/circle/chat',{prompt:'again'},OWNER_ID,headers)).status).toBe(403);
    expect(disclosedPrompts).toEqual(['owner first','retained local draft']);
  });

  it('rejects legacy chat headers before reading a body and rejects prompt-bearing admission metadata', async () => {
    const status = await new Promise((resolve,reject) => {
      const req = http.request(origin+'/circle/chat',{method:'POST',headers:{'x-test-peer':GUEST_ID,'content-length':'400'}},res => {
        resolve(res.statusCode); res.resume(); req.destroy();
      });
      req.once('error',reject); req.setTimeout(1500,()=>req.destroy(Error('Gateway waited for an ungranted body')));
      req.flushHeaders(); // Never supply even one body byte.
    });
    expect(status).toBe(403);
    const denied = await post('/circle/admit',{...metadata('no-text',newGuest()),prompt:'forbidden extra field'},GUEST_ID);
    expect(denied).toMatchObject({status:400,body:{code:'CIRCLE_REQUEST'}});
    expect(server.stats().inferenceCalls).toBe(0);
  });

  it('withdraws an unused grant during body read even under the in-flight finish policy', async () => {
    const inviteId = newGuest(); const offer = await post('/circle/admit',metadata('slow',inviteId),GUEST_ID);
    const headers = {...grantHeaders(offer.body.grant),'x-test-peer':GUEST_ID,'content-type':'application/json'};
    let stream;
    const result = new Promise((resolve,reject) => {
      stream = http.request(origin+'/circle/chat',{method:'POST',headers},res => {
        resolve(res.statusCode); res.resume();
      });
      stream.once('error',reject); stream.flushHeaders(); stream.write('{"prompt":"');
    });
    // The request is still incomplete. Neither accepting its grant nor receiving a
    // prefix permits forwarding the draft after the owner revokes that invitation.
    expect((await post('/circle/owner',{op:'circle-invites.revoke',inviteId},OWNER_ID)).status).toBe(200);
    expect(await result).toBe(403); stream.end('private"}');
    expect(invites.getSettlement({guestPeerId:GUEST_ID,requestId:'slow'})).toMatchObject({outcome:'stopped',outputTokens:0});
    expect(admission.getActiveCount(inviteId)).toBe(0); expect(disclosedPrompts).toEqual([]);
  });

  it('releases explicitly abandoned, disconnected queued, revoked, and expired admissions', async () => {
    const a = newGuest(); const offer = await post('/circle/admit',metadata('hold',a),GUEST_ID);
    const abort = new AbortController(); const queued = normalChat({...metadata('queued',a),prompt:'unsent'},GUEST_ID,fetch,abort.signal);
    await expect.poll(()=>admission.getQueuedCount(a)).toBe(1); abort.abort(); await expect(queued).rejects.toThrow();
    await expect.poll(()=>admission.getQueuedCount(a)).toBe(0);
    expect((await post('/circle/cancel',{},GUEST_ID,grantHeaders(offer.body.grant))).status).toBe(200);
    expect(admission.getActiveCount(a)).toBe(0);
    const stale = await post('/circle/admit',metadata('ttl',a),GUEST_ID); offset += 11_000;
    expect((await post('/circle/chat',{prompt:'expired'},GUEST_ID,grantHeaders(stale.body.grant))).status).toBe(403);
    expect(admission.getActiveCount(a)).toBe(0);
    const button = await post('/circle/admit',metadata('revoke',a),GUEST_ID);
    invites.revoke(a); expect(admission.getActiveCount(a)).toBe(0);
    expect((await post('/circle/chat',{prompt:'revoked'},GUEST_ID,grantHeaders(button.body.grant))).status).toBe(403);
    const temporary = newGuest(now()+200);
    expect((await post('/circle/admit',metadata('abandoned',temporary),GUEST_ID)).status).toBe(200);
    await expect.poll(()=>admission.getActiveCount(temporary)).toBe(0);
    expect(disclosedPrompts).toEqual([]);
  });

  it('retains the draft and cancels an admission whose disclosure does not match the expected host', async () => {
    const inviteId = newGuest(); const observed=[];
    await expect(normalChat({...metadata('bad-disclosure',inviteId),prompt:'keep this local'},GUEST_ID,async (url,options) => {
      observed.push(new URL(url).pathname); const response=await fetch(url,options);
      if (new URL(url).pathname !== '/circle/admit') return response;
      const json=await response.json(); return Response.json({...json,disclosure:{hostPeerId:'somebody-else'}});
    })).rejects.toThrow('admission no longer matches');
    expect(observed).toEqual(['/circle/admit','/circle/cancel']);
    expect(admission.getActiveCount(inviteId)).toBe(0); expect(disclosedPrompts).toEqual([]);
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
