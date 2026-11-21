// @vitest-environment node
import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPairingNetwork } from '../fixtures/owner-pairing-webrtc.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt, verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { hashJson, sha256Hex } from '../../packages/reploid/src/artifacts/signatures.js';
import { requestOwnerPairing } from '../../packages/reploid/src/transport/owner-pairing.js';
import { openOwnerPairing } from '../../server/circles/owner-pairing.js';
import { openCircleInvites } from '../../server/circles/invites.js';
import { createCircleAdmission } from '../../server/circles/admission.js';
import { createCirclePublicGateway } from '../../server/circles/http-gate.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { sendCircleChat } from '../../apps/poolday/host/circle-invites.js';

const modelIdentity = 'sha256:' + 'a'.repeat(64);
const policy = { schema:'reploid.service-credit-policy/v1', version:'circle-integration/1', unit:'noncash-service-credit',
  creditsPerOutputToken:1, maxDebt:32, maxOutputTokens:16, maxPendingPerComputer:2,
  maxClockSkewMs:1000, maxRequestMs:60000, allowSameOwner:true, wholeModelTerminalCharge:0 };

// HTTP authentication is an injected gateway port. These test capabilities bind to an
// actively verified RTC endpoint and expire if its connection or its signing identity changes.
function rtcAuthenticatedHttp(desktop) {
  const sessions = new Map();
  return {
    async enroll(remote, wireId, expectedIdentity, desktopIdentity) {
      expect(await remote.verifyPeer('desktop')).toBe(desktopIdentity);
      expect(await desktop.verifyPeer(wireId)).toBe(expectedIdentity);
      const binding = desktop.transport.getPeerBinding(wireId);
      expect(binding).toBeTruthy();
      const bearer = 'Bearer ' + randomBytes(32).toString('base64url');
      sessions.set(bearer,{ wireId, identity:expectedIdentity, binding });
      return { Authorization:bearer };
    },
    authenticate(req) {
      const who = sessions.get(req.headers.authorization);
      if (!who) return null;
      const current = desktop.transport.getPeerBinding(who.wireId);
      if (!current || current.local !== who.binding.local || current.remote !== who.binding.remote) return null;
      return desktop.currentPeer(who.wireId) === who.identity ? who.identity : null;
    }
  };
}

it('revoking a queued guest behind a paid paired-owner turn sends zero guest prompt bytes and creates no guest credit entry', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'reploid-owner-guest-credit-'));
  const network = createPairingNetwork();
  const [desktop,owner,guest] = await Promise.all(['Ed25519','ECDSA','Ed25519'].map(algorithm => createSigningIdentity({algorithm})));
  const enrolled = [desktop,owner,guest].map((identity,index) => ({
    id:['desktop','owner','guest'][index], name:['Desktop','Owner phone','Guest'][index], ownerId:'integration-owner',
    providers:[{participantId:identity.peerId,publicJwk:identity.publicJwk}]
  }));
  const releaseOwner = Promise.withResolvers();
  const pending = [];
  let pairing, invites, admission, credits, server;
  try {
    const observedPairing = Promise.withResolvers();
    pairing = await openOwnerPairing({file:path.join(directory,'pairing.sqlite'),hostParticipantId:desktop.peerId,onRequest:observedPairing.resolve});
    const hostEndpoint = await network.start('desktop',desktop);
    pairing.attach(hostEndpoint);
    const ownerEndpoint = await network.start('owner-wire',owner);
    await expect.poll(() => ownerEndpoint.transport.getPeerBinding('desktop')).toBeTruthy();
    const pair = requestOwnerPairing({...ownerEndpoint,...pairing.issue(),hostPeer:'desktop',signal:AbortSignal.timeout(5000)});
    const offer = await observedPairing.promise;
    expect(offer.participantId).toBe(owner.peerId);
    expect(pairing.isOwner(owner.peerId)).toBe(false);
    expect(pairing.decide(offer.requestId,true)).toBe(true);
    await expect(pair).resolves.toEqual({hostParticipantId:desktop.peerId});
    const guestEndpoint = await network.start('guest-wire',guest);
    await expect.poll(() => guestEndpoint.transport.getPeerBinding('desktop')).toBeTruthy();
    const httpAuth = rtcAuthenticatedHttp(hostEndpoint);
    const ownerHeaders = await httpAuth.enroll(ownerEndpoint,'owner-wire',owner.peerId,desktop.peerId);
    const guestHeaders = await httpAuth.enroll(guestEndpoint,'guest-wire',guest.peerId,desktop.peerId);
    expect(pairing.isOwner(guest.peerId)).toBe(false);

    invites = await openCircleInvites({file:path.join(directory,'invites.sqlite'),hostPeerId:desktop.peerId,hostLabel:'Paired desktop'});
    admission = createCircleAdmission({hostPeerId:desktop.peerId,hostLabel:'Paired desktop',modelIdentity,invites,
      isReady:() => true,isOwner:pairing.isOwner,maxQueuedRequests:2,maxQueuedPerGuest:1,maxWaitMs:15000});
    credits = await openFleetCredits({file:path.join(directory,'credits.sqlite'),computers:enrolled,policy});
    const known = new Map([owner,guest].map(identity => [identity.peerId,identity]));
    const prompts = [];
    const ownerPrompt = 'Return the two test tokens.';
    const guestPrompt = 'GUEST-PROMPT-MUST-NEVER-LEAVE-THE-CLIENT';
    const ownerRequestId = 'paired-owner-control', guestRequestId = 'queued-guest';
    const receiptByRequest = new Map();
    const gateway = createCirclePublicGateway({invites,admission,ownerPairing:pairing,authenticatePeer:httpAuth.authenticate,
      recordedDemo:{title:'Recorded example',output:'Recorded output',modelIdentity},
      executeInference:async ({prompt,maxOutputTokens,requestId,authenticatedPeerId,lease}) => {
        prompts.push(prompt);
        const consumer = known.get(authenticatedPeerId);
        const inputDigest = await hashJson([{role:'user',content:prompt}]);
        const model = {id:'fixture-model',identity:modelIdentity,adapterIdentities:[]};
        const request = {id:requestId,executionId:requestId,mode:'whole-model',consumer:consumer.peerId,
          providers:[{participantId:desktop.peerId,weight:1}],model,inputDigest,maxOutputTokens};
        credits.reserve(request);
        credits.dispatch(requestId,consumer.peerId);
        credits.admit(requestId,0);
        if (lease.role === 'owner') await releaseOwner.promise;
        const output = 'two tokens',outputTokens = 2;
        const draft = await createReceiptDraft({version:2,provider:desktop.peerId,consumer:consumer.peerId,jobHash:'request:'+requestId,
          model:model.id,modelIdentity,adapterIdentities:[],inputDigest,outputDigest:await sha256Hex(output),inputTokens:6,outputTokens,
          usage:'raw-model-tokens/v1',status:'completed',cleanup:'settled',stopReason:'eos',ownerPolicyDigest:null,timestamp:Date.now()});
        const receipt = await countersignReceipt(await signReceiptDraft(draft,desktop),consumer);
        await credits.settle(requestId,receipt);
        receiptByRequest.set(requestId,receipt);
        return {output,outputTokens,modelWeightBytes:0};
      }});
    server = await gateway.listen();
    const post = (route,headers,body) => fetch(server.origin+route,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
    const ownerCommand = body => post('/circle/owner',ownerHeaders,body);
    const waveTwo = await post('/circle/challenge',{}, {kind:'daily-challenge'});
    expect(waveTwo.status).toBe(503);
    expect(await waveTwo.json()).toMatchObject({mode:'replay-only'});
    const issue = await ownerCommand({op:'circle-invites.issue',expiresAt:Date.now()+60000,maxRequests:1,maxOutputTokens:16});
    expect(issue.status).toBe(200);
    const {result:{inviteId,token}} = await issue.json();
    const redeem = await post('/circle/redeem',guestHeaders,{token,hostPeerId:desktop.peerId});
    expect(redeem.status).toBe(200);
    const metadata = {hostPeerId:desktop.peerId,modelIdentity,maxOutputTokens:8};
    const ownerRun = sendCircleChat({origin:server.origin,requesterPeerId:owner.peerId,metadata:{...metadata,requestId:ownerRequestId},
      prompt:ownerPrompt,headers:ownerHeaders});
    pending.push(ownerRun);
    const account = id => credits.snapshot().accounts.find(row => row.id === id);
    await expect.poll(() => account('owner').held).toBe(8);
    expect(prompts).toEqual([ownerPrompt]);
    const heldSnapshot = credits.snapshot();

    const guestWire = [];
    const guestRun = sendCircleChat({origin:server.origin,requesterPeerId:guest.peerId,metadata:{...metadata,requestId:guestRequestId,inviteId},
      prompt:guestPrompt,headers:guestHeaders,fetchImpl:async (url,init) => {
        const request = new Request(url,init);
        const raw = Buffer.from(await request.clone().arrayBuffer());
        const observed = new URL(request.url);
        const body = JSON.parse(raw.toString('utf8'));
        guestWire.push({origin:observed.origin,path:observed.pathname,host:body.hostPeerId??request.headers.get('x-circle-host'),
          hasPromptField:Object.hasOwn(body,'prompt'),promptBytes:raw.includes(Buffer.from(guestPrompt)) || request.url.includes(guestPrompt)
            || [...request.headers.values()].some(value => value.includes(guestPrompt))});
        const response = await fetch(request);
        expect(response.redirected).toBe(false);
        return response;
      }});
    pending.push(guestRun);
    await expect.poll(() => admission.getQueuedCount(inviteId)).toBe(1);
    expect(credits.snapshot()).toEqual(heldSnapshot);
    const revoke = await ownerCommand({op:'circle-invites.revoke',inviteId});
    expect(revoke.status).toBe(200);
    expect((await revoke.json()).result.status).toBe('revoked');
    const denied = await guestRun;
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({code:'CIRCLE_REVOKED'});
    expect(admission.getQueuedCount(inviteId)).toBe(0);
    expect(credits.snapshot()).toEqual(heldSnapshot);
    const expectedWire = [{origin:server.origin,path:'/circle/admit',host:desktop.peerId,hasPromptField:false,promptBytes:false}];
    expect(guestWire).toEqual(expectedWire);

    releaseOwner.resolve();
    const response = await ownerRun;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({output:'two tokens',receipt:{requestId:ownerRequestId,hostPeerId:desktop.peerId,
      modelIdentity,role:'owner',outcome:'completed',modelWeightBytes:0}});
    const proof = receiptByRequest.get(ownerRequestId);
    expect(await verifyReceipt(proof)).toMatchObject({providerValid:true,consumerValid:true});
    expect(credits.request(ownerRequestId)).toMatchObject({state:'settled',outcome:{charge:2,outputTokens:2},evidence:proof});
    expect(account('owner')).toMatchObject({balance:-2,held:0});
    expect(account('desktop')).toMatchObject({balance:2,held:0});
    expect(account('guest')).toMatchObject({balance:0,held:0});
    expect(credits.request(guestRequestId)).toBeFalsy();
    const settledSnapshot = credits.snapshot();
    expect(settledSnapshot.journal).toHaveLength(2);
    expect(prompts).toEqual([ownerPrompt]);
    expect(server.stats()).toMatchObject({inferenceCalls:1,challengeCalls:0});
    expect(guestWire).toEqual(expectedWire);
    expect(await credits.settle(ownerRequestId,proof)).toEqual(credits.request(ownerRequestId).outcome);
    expect(credits.snapshot()).toEqual(settledSnapshot);
  } finally {
    releaseOwner.resolve();
    await server?.close();
    admission?.close();
    await Promise.allSettled(pending);
    invites?.close();credits?.close();pairing?.close();network.close();
    await rm(directory,{recursive:true,force:true});
  }
},25000);
