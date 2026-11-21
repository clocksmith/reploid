// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCircleInvites } from '../../server/circles/invites.js';
import { handleCircleInviteOwnerCommand } from '../../server/circles/owner-invites.js';

const HOST = 'peer:owner-desktop';
const GUEST = 'peer:guest-phone';

describe('single-host invites', () => {
  let directory, file, invites, time;
  const open = hostPeerId => openCircleInvites({ file, hostPeerId, now: () => time });
  const issue = (maxRequests = 1) => invites.issue({ expiresAt: time + 1000, maxRequests, maxOutputTokens: 24 });
  const bind = invite => ({ inviteId: invite.inviteId, guestPeerId: GUEST, hostPeerId: HOST });
  const admit = (scope, requestId, maxOutputTokens = 24) => invites.admit({ ...scope, requestId, maxOutputTokens });

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-circles-'));
    file = path.join(directory, 'invites.sqlite');
    time = 1000;
    invites = await open(HOST);
  });
  afterEach(async () => {
    invites.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('keeps link secrets out of the database and binds redemption to one authenticated guest', async () => {
    const created = issue(), scope = bind(created);
    expect(invites.lookup(scope)).toBeNull();
    expect(invites.redeem({ token: created.token, guestPeerId: GUEST })).toMatchObject(scope);
    expect(invites.redeem({ token: created.token, guestPeerId: GUEST })).toMatchObject(scope);
    expect(invites.redeem({ token: created.token, guestPeerId: 'peer:another-phone' })).toBeNull();
    expect(invites.lookup({ ...scope, hostPeerId: 'peer:other-host' })).toBeNull();
    expect(invites.list()[0]).not.toHaveProperty('token');
    expect((await fs.readFile(file)).includes(created.token)).toBe(false);
  });

  it('charges one request against the limit and binds replay to the original invite and output limit', () => {
    const first = issue(), second = issue();
    invites.redeem({ token: first.token, guestPeerId: GUEST });
    invites.redeem({ token: second.token, guestPeerId: GUEST });
    expect(admit(bind(first), 'original', 25)).toBeNull();
    expect(admit(bind(first), 'original', 12)).toMatchObject({ status: 'admitted', grant: { usedRequests: 1 } });
    expect(admit(bind(first), 'original', 12)).toMatchObject({ status: 'duplicate', grant: { usedRequests: 1 } });
    expect(admit(bind(first), 'original')).toBeNull();
    expect(admit(bind(second), 'original', 12)).toBeNull();
    expect(admit(bind(first), 'new')).toBeNull();
  });

  it('survives restart and fences revoked and expired invitations before dispatch', async () => {
    const first = issue(), second = issue();
    invites.redeem({ token: first.token, guestPeerId: GUEST });
    invites.redeem({ token: second.token, guestPeerId: GUEST });
    expect(admit(bind(first), 'first')).toMatchObject({ status: 'admitted' });
    invites.close();
    await expect(open('peer:substitute')).rejects.toThrow('another host identity');
    invites = await open(HOST);
    expect(admit(bind(first), 'first')).toMatchObject({ status: 'duplicate' });
    const notices = [];
    invites.subscribe(event => notices.push(event));
    expect(invites.revoke(first.inviteId)).toMatchObject({ status: 'revoked' });
    invites.revoke(first.inviteId);
    expect(notices).toEqual([{ inviteId: first.inviteId, hostPeerId: HOST, status: 'revoked' }]);
    expect(admit(bind(first), 'first')).toBeNull();
    time = second.expiresAt;
    expect(admit(bind(second), 'waiting')).toBeNull();
    expect(invites.list().map(row => row.status)).toEqual(['expired', 'revoked']);
    invites.close();
    invites = await open(HOST);
    expect(invites.lookup(bind(first))).toBeNull();
  });

  it('authorizes owner controls from the authenticated channel identity only', async () => {
    const authenticatePeer = async peer => ({ 'owner-channel': 'peer:paired-owner', 'guest-channel': GUEST })[peer];
    const ownerPairing = { isOwner: identity => identity === 'peer:paired-owner' };
    const run = (peerId, command) => handleCircleInviteOwnerCommand({ invites, ownerPairing, authenticatePeer, peerId, command });
    const payload = { op: 'circle-invites.issue', expiresAt: time + 500, maxRequests: 2, maxOutputTokens: 24 };
    await expect(run('guest-channel', { ...payload, ownerPeerId: 'peer:paired-owner' })).rejects.toThrow('Only a paired owner');
    const created = await run('owner-channel', payload);
    await expect(run('owner-channel', { op: 'circle-invites.list' })).resolves.toMatchObject([{ inviteId: created.inviteId }]);
    await expect(run('guest-channel', { op: 'circle-invites.revoke', inviteId: created.inviteId })).rejects.toThrow('Only a paired owner');
    await expect(run('owner-channel', { op: 'circle-invites.revoke', inviteId: created.inviteId })).resolves.toMatchObject({ status: 'revoked' });
  });
});
