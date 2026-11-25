// "Connect a desktop" and guest links in the React Computers pane, over the host's pairing and invite ports
// (host/owner-pairing.js, host/circle-invites.js) and the pane's decisions (host/decisions/computers.js).
import { cleanup, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createOwnerPairingUrl, parseOwnerPairingUrl } from '../../apps/poolday/host/owner-pairing.js';
import { createCircleInviteOwner, parseCircleInviteUrl } from '../../apps/poolday/host/circle-invites.js';
import { ownerPairingStatus } from '../../apps/poolday/host/decisions/computers.js';
import { createComputersServices } from '../../apps/poolday-react/src/features/computers/infrastructure/hostComputers';
import { ComputersPanel } from '../../apps/poolday-react/src/features/computers/presentation/ComputersPanel';

afterEach(cleanup);

function mount(chat: Record<string, unknown>) {
  const session = { getState: () => ({ models: [], network: {} }), subscribe: () => () => undefined, ...chat };
  const services = createComputersServices({ host: { chat: session }, earning: Promise.resolve(null) });
  const view = render(<PooldayRoot><ComputersPanel services={services} filter={null} onClearFilter={() => undefined} /></PooldayRoot>);
  return { ...view, query: (selector: string) => view.container.querySelector(selector) as HTMLElement };
}

it('reads a fragment-only pairing link and states the desktop as it pairs, goes offline and unpairs', () => {
  const hostParticipantId = `peer:${'a'.repeat(24)}`, code = 'B'.repeat(24), roomId = 'reploid-swarm-alex-pc';
  const url = createOwnerPairingUrl({ hostParticipantId, code, hostLabel: "Alex's PC", roomId }, 'https://replo.id/');
  // Nothing the desktop needs leaves in the query string: the link carries it in the fragment.
  expect(new URL(url).search).toBe('');
  expect(parseOwnerPairingUrl(url)).toEqual({ hostParticipantId, code, hostLabel: "Alex's PC", roomId });
  expect(ownerPairingStatus({ status: 'pairing', hostLabel: "Alex's PC" })).toBe("Waiting for desktop confirmation on Alex's PC…");
  expect(ownerPairingStatus({ status: 'online', hostLabel: "Alex's PC", transportPath: 'relayed', readyModel: 'qwen-3-5-0-8b' }))
    .toBe("Paired with Alex's PC · Online · relayed · qwen-3-5-0-8b");
  expect(ownerPairingStatus({ status: 'offline', hostLabel: "Alex's PC" })).toBe("Alex's PC · Offline");
  expect(ownerPairingStatus({ status: 'unpaired' })).toBe('Not paired');
});

it('creates a shareable guest link, lists it and revokes it', async () => {
  const token = 'a'.repeat(43), hostPeerId = 'peer:desktop';
  const record = { inviteId: 'invite1', expiresAt: Date.now() + 5000, usedRequests: 0, maxRequests: 10, status: 'active', queuedRequests: 2 };
  const request = vi.fn(async (command: { op: string }) => {
    if (command.op === 'circle-invites.issue') return { ...record, token, hostPeerId };
    if (command.op === 'circle-invites.revoke') record.status = 'revoked';
    return [record];
  });
  const circleInvites = createCircleInviteOwner({ request, baseUrl: 'https://replo.id/settings?source=owner' });
  const { query } = mount({ circleInvites });
  await userEvent.click(within(query('[data-circle-invites]')).getAllByText(/./)[0] as HTMLElement);
  await userEvent.click(query('[data-circle-invite-submit]'));
  await waitFor(() => expect(query('[data-circle-invite-revoke="invite1"]')).not.toBeNull());
  const field = query('[data-circle-invite-link]') as HTMLInputElement;
  expect(parseCircleInviteUrl(field.value)).toEqual({ token, hostPeerId });
  expect(new URL(field.value).search).toBe('');
  expect(query('[data-circle-invite-list]').textContent).toContain('2 queued');
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ op: 'circle-invites.issue', maxRequests: 10, maxOutputTokens: 256 }));
  await userEvent.click(query('[data-circle-invite-revoke="invite1"]'));
  await waitFor(() => expect(query('[data-circle-invite-row="invite1"]').dataset.circleInviteState).toBe('revoked'));
  expect(query('[data-circle-invite-link]')).toBeNull();
});

it('displays active, expired and revoked guest links with the named host and the revocation policy', async () => {
  const token = 'b'.repeat(43), hostPeerId = 'peer:alex-pc', hostLabel = "Alex's PC";
  const rows = [
    { inviteId: 'i-active', guestPeerId: 'peer:guest-a', hostPeerId, hostLabel, expiresAt: Date.now() + 60000, usedRequests: 1, maxRequests: 5, status: 'active', queuedRequests: 1, activeRequests: 1 },
    { inviteId: 'i-expired', guestPeerId: 'peer:guest-b', hostPeerId, hostLabel, expiresAt: Date.now() - 1000, usedRequests: 3, maxRequests: 5, status: 'expired', queuedRequests: 0 },
    { inviteId: 'i-revoked', guestPeerId: 'peer:guest-c', hostPeerId, hostLabel, expiresAt: Date.now() + 60000, usedRequests: 2, maxRequests: 5, status: 'revoked', queuedRequests: 0 }
  ];
  const request = vi.fn(async (command: { op: string }) => {
    if (command.op === 'circle-invites.issue') return { ...rows[0], token, hostPeerId, hostLabel };
    if (command.op === 'circle-invites.revoke') { rows[0]!.status = 'revoked'; return { ...rows[0], revocationPolicy: 'stop' }; }
    return rows;
  });
  const { query } = mount({ circleInvites: createCircleInviteOwner({ request, baseUrl: 'https://replo.id/' }) });
  expect(query('[data-circle-invites]').textContent).toContain('no duplicate settlement');
  await userEvent.click(within(query('[data-circle-invites]')).getAllByText(/./)[0] as HTMLElement);
  await userEvent.click(query('[data-circle-invite-submit]'));
  await waitFor(() => expect(query('[data-circle-invite-row="i-active"]')).not.toBeNull());
  expect(parseCircleInviteUrl((query('[data-circle-invite-link]') as HTMLInputElement).value)).toEqual({ token, hostPeerId, hostLabel });
  expect(query('[data-circle-invite-row="i-active"]').textContent).toContain("Alex's PC");
  expect(query('[data-circle-invite-row="i-active"]').textContent).toContain('1 running');
  expect(query('[data-circle-invite-row="i-expired"]').dataset.circleInviteState).toBe('expired');
  expect(query('[data-circle-invite-row="i-revoked"]').dataset.circleInviteState).toBe('revoked');
  await userEvent.click(query('[data-circle-invite-revoke="i-active"]'));
  await waitFor(() => expect(query('[data-circle-invite-status]').textContent).toContain('no duplicate settlement'));
});
