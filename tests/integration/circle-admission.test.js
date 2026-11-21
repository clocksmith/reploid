// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCircleAdmission } from '../../server/circles/admission.js';
import { openCircleInvites } from '../../server/circles/invites.js';

const hostPeerId = 'desktop', owner = 'owner-phone', modelIdentity = `sha256:${'a'.repeat(64)}`;
let directory, invites, admission, ready;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-circle-admission-'));
  invites = await openCircleInvites({ file: path.join(directory, 'invites.sqlite'), hostPeerId, now: () => Date.now() });
  ready = true;
  admission = createCircleAdmission({ hostPeerId, modelIdentity, isReady: () => ready, invites,
    isOwner: id => id === owner, maxQueuedRequests: 3, maxQueuedPerGuest: 2, maxWaitMs: 1000, now: () => Date.now() });
});

afterEach(async () => {
  admission?.close();
  invites?.close();
  vi.useRealTimers();
  if (directory) await fs.rm(directory, { force: true, recursive: true });
});

function grant(guestPeerId, expiresAt = Date.now() + 60000) {
  const { token } = invites.issue({ expiresAt, maxRequests: 4, maxOutputTokens: 32 });
  return invites.redeem({ token, guestPeerId });
}

function request(authenticatedPeerId, requestId, inviteId, overrides = {}) {
  return admission.acquire({ requestId, modelIdentity, maxOutputTokens: 16, ...(inviteId ? { inviteId } : {}), ...overrides },
    { authenticatedPeerId });
}

it('limits waiting and fairly rotates guests on one desktop before admitting disclosure', async () => {
  const ownerLease = await request(owner, 'owner-turn');
  const alice = grant('alice'), bob = grant('bob');
  const admitted = [];
  const first = request('alice', 'a1', alice.inviteId).then(lease => { admitted.push('a1'); return lease; });
  const second = request('alice', 'a2', alice.inviteId).then(lease => { admitted.push('a2'); return lease; });
  await expect(request('alice', 'a3', alice.inviteId)).rejects.toThrow('queue is full');
  const third = request('bob', 'b1', bob.inviteId).then(lease => { admitted.push('b1'); return lease; });
  await expect(request('bob', 'b2', bob.inviteId)).rejects.toThrow('queue is full');
  expect(admission.getState()).toEqual({ ready: true, queued: 3 });
  expect(admission.getQueuedCount(alice.inviteId)).toBe(2);
  expect(invites.list().map(invite => invite.usedRequests)).toEqual([0, 0]);

  ownerLease.release();
  const firstLease = await first;
  expect(firstLease.route).toEqual({ hostPeerId, modelIdentity });
  firstLease.release();
  (await third).release();
  (await second).release();
  expect(admitted).toEqual(['a1', 'b1', 'a2']);
  await expect(request('alice', 'a1', alice.inviteId)).rejects.toMatchObject({ code: 'CIRCLE_INVITE' });
  expect(Object.fromEntries(invites.list().map(row => [row.guestPeerId, row.usedRequests]))).toEqual({ alice: 2, bob: 1 });
});

it('removes revoked and expired queued work without a disclosure grant or a spent request', async () => {
  vi.useFakeTimers();
  const ownerLease = await request(owner, 'owner-turn');
  const revoked = grant('alice'), expiring = grant('bob', Date.now() + 30);
  const revokedResult = expect(request('alice', 'a1', revoked.inviteId)).rejects.toMatchObject({ code: 'CIRCLE_REVOKED' });
  const expiredResult = expect(request('bob', 'b1', expiring.inviteId)).rejects.toMatchObject({ code: 'CIRCLE_EXPIRED' });
  expect(admission.getState().queued).toBe(2);

  invites.revoke(revoked.inviteId);
  await revokedResult;
  await vi.advanceTimersByTimeAsync(30);
  await expiredResult;
  expect(admission.getState().queued).toBe(0);
  expect(admission.getQueuedCount(revoked.inviteId)).toBe(0);
  ownerLease.release();
  expect(invites.list().map(invite => invite.usedRequests)).toEqual([0, 0]);
});

it('refuses invalid authentication, other hosts and models, offline routes, and premature prompt payloads', async () => {
  const alice = grant('alice');
  const other = createCircleAdmission({ hostPeerId: 'other-desktop', modelIdentity, isReady: () => true, invites,
    maxQueuedRequests: 3, maxQueuedPerGuest: 2, maxWaitMs: 1000 });
  try {
    await expect(other.acquire({ modelIdentity, requestId: 'a1', inviteId: alice.inviteId, maxOutputTokens: 16 },
      { authenticatedPeerId: 'alice' })).rejects.toMatchObject({ code: 'CIRCLE_INVITE' });
    await expect(request('impostor', 'a1', alice.inviteId)).rejects.toMatchObject({ code: 'CIRCLE_INVITE' });
    await expect(request('alice', 'a1', alice.inviteId, { modelIdentity: `sha256:${'b'.repeat(64)}` }))
      .rejects.toMatchObject({ code: 'CIRCLE_REQUEST' });
    await expect(request('alice', 'a1', alice.inviteId, { messages: ['early prompt'] })).rejects.toMatchObject({ code: 'CIRCLE_REQUEST' });
    await expect(request('alice', 'a1', alice.inviteId, { maxOutputTokens: 33 })).rejects.toMatchObject({ code: 'CIRCLE_INVITE' });
    ready = false;
    await expect(request('alice', 'a1', alice.inviteId)).rejects.toMatchObject({ code: 'CIRCLE_OFFLINE' });
    expect(invites.list()[0].usedRequests).toBe(0);
  } finally { other.close(); }
});

it('withdraws an admission if the computer closes just as a queued slot becomes free', async () => {
  const ownerLease = await request(owner, 'owner-turn');
  const alice = grant('alice');
  const waiting = expect(request('alice', 'a1', alice.inviteId)).rejects.toMatchObject({ code: 'CIRCLE_CLOSED' });
  ownerLease.release();
  admission.close();
  await waiting;
  expect(invites.list()[0].usedRequests).toBe(0);
});

it('keeps a new owner turn protected from a repeated release of an old lease', async () => {
  const previous = await request(owner, 'owner-turn');
  previous.release();
  const current = await request(owner, 'owner-turn');
  previous.release();
  const alice = grant('alice');
  const waiting = request('alice', 'a1', alice.inviteId);
  expect(admission.getState().queued).toBe(1);
  expect(invites.list()[0].usedRequests).toBe(0);
  current.release();
  (await waiting).release();
});
