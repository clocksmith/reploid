// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCircleInvites } from '../../server/circles/invites.js';
import { createGuestAccess } from '../../server/circles/guest-access.js';
import { CIRCLE_JOIN_REQUEST, CIRCLE_JOIN_RESULT, requestCircleJoin } from '../../packages/reploid/src/transport/index.js';

const HOST = `peer:${'a'.repeat(24)}`;
const GUEST = `peer:${'b'.repeat(24)}`;
const OTHER = `peer:${'c'.repeat(24)}`;

/** Two endpoints joined by an in-memory channel; each peer id resolves to a verified participant. */
function pair(identities) {
  const handlers = { host: new Map(), guest: new Map() };
  const sent = [];
  const endpoint = (self, other) => ({
    getPeerBinding: peer => (peer === other ? { channel: `${self}->${other}` } : null),
    onMessage: (type, handler) => handlers[self].set(type, handler),
    sendToPeer: (peer, type, payload) => {
      sent.push({ from: self, type, payload: structuredClone(payload) });
      queueMicrotask(() => handlers[peer].get(type)?.(self, structuredClone(payload)));
      return true;
    }
  });
  return {
    sent,
    host: endpoint('host', 'guest'),
    guest: endpoint('guest', 'host'),
    verifyPeer: async peer => identities[peer],
    currentPeer: peer => identities[peer]
  };
}

describe('guest access over the mesh', () => {
  let directory, invites, access, time, busy;
  const issue = (maxRequests = 2) => invites.issue({ expiresAt: time + 60_000, maxRequests, maxOutputTokens: 256 });

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-guest-access-'));
    time = 1000; busy = false;
    invites = await openCircleInvites({ file: path.join(directory, 'invites.sqlite'), hostPeerId: HOST, hostLabel: 'Desk', now: () => time });
    access = createGuestAccess({ invites, hostParticipantId: HOST, isBusy: () => busy });
  });
  afterEach(async () => {
    access.close(); invites.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const join = async (net, token, identity = GUEST) => requestCircleJoin({ transport: net.guest, verifyPeer: net.verifyPeer,
    currentPeer: net.currentPeer, hostPeer: 'host', hostParticipantId: HOST, token, signal: AbortSignal.timeout(2000) })
    .then(result => ({ result, identity }));

  it('binds an invite to the verified guest once, and the token works on no other device', async () => {
    const invite = issue();
    const net = pair({ host: HOST, guest: GUEST });
    access.attach({ transport: net.host, verifyPeer: net.verifyPeer, currentPeer: net.currentPeer });
    const { result } = await join(net, invite.token);
    expect(result).toMatchObject({ hostParticipantId: HOST, hostLabel: 'Desk', remainingRequests: 2, maxOutputTokens: 256 });
    expect(access.inviteFor(GUEST)?.inviteId).toBe(invite.inviteId);
    // The token travels only in the join request to the verified host.
    expect(net.sent.filter(message => JSON.stringify(message.payload).includes(invite.token)).map(message => message.type)).toEqual([CIRCLE_JOIN_REQUEST]);

    const stolen = pair({ host: HOST, guest: OTHER });
    const otherAccess = createGuestAccess({ invites, hostParticipantId: HOST });
    otherAccess.attach({ transport: stolen.host, verifyPeer: stolen.verifyPeer, currentPeer: stolen.currentPeer });
    await expect(join(stolen, invite.token)).rejects.toThrow(/invalid, expired, revoked or already used/);
    expect(access.inviteFor(OTHER)).toBeNull();
    expect(stolen.sent.at(-1)).toMatchObject({ type: CIRCLE_JOIN_RESULT, payload: { joined: false } });
  });

  it('admits before disclosure only within the invite, defers while busy and stops on revocation', async () => {
    const invite = issue(2);
    invites.redeem({ token: invite.token, guestPeerId: GUEST });
    expect(access.admit({ participantId: OTHER, requestId: 'r0' })).toBe(false);

    busy = true;
    expect(access.admit({ participantId: GUEST, requestId: 'r1' })).toBe(false);
    expect(invites.lookup({ inviteId: invite.inviteId, guestPeerId: GUEST, hostPeerId: HOST }).usedRequests).toBe(0);

    busy = false;
    expect(access.admit({ participantId: GUEST, requestId: 'r1' })).toBe(true);
    expect(access.mayExecute({ participantId: GUEST, requestId: 'r1' })).toBe(true);
    expect(access.mayExecute({ participantId: GUEST, requestId: 'unadmitted' })).toBe(false);
    expect(access.settle({ participantId: GUEST, requestId: 'r1', outputTokens: 12 })).toMatchObject({ settled: true });

    invites.revoke(invite.inviteId);
    expect(access.admit({ participantId: GUEST, requestId: 'r2' })).toBe(false);
    expect(access.mayExecute({ participantId: GUEST, requestId: 'r1' })).toBe(false);
  });

  it('stops admitting when the invite has no requests left or has expired', async () => {
    const invite = issue(1);
    invites.redeem({ token: invite.token, guestPeerId: GUEST });
    expect(access.admit({ participantId: GUEST, requestId: 'r1' })).toBe(true);
    expect(access.admit({ participantId: GUEST, requestId: 'r2' })).toBe(false);

    const second = issue(5);
    invites.redeem({ token: second.token, guestPeerId: OTHER });
    time += 120_000;
    expect(access.admit({ participantId: OTHER, requestId: 'r3' })).toBe(false);
  });
});
