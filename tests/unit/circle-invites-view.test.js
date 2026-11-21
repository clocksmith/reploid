import { expect, it, vi } from 'vitest';
import { createCircleInviteOwner, parseCircleInviteUrl } from '../../apps/poolday/host/circle-invites.js';
import { bindCircleInviteControls, renderCircleInviteControls } from '../../apps/poolday/ui/pool-home/circle-invites-view.js';

it('creates a shareable link and revokes it from the paired owner control', async () => {
  document.body.innerHTML = renderCircleInviteControls();
  const query = selector => document.querySelector(selector);
  const token = 'a'.repeat(43), hostPeerId = 'peer:desktop';
  const record = { inviteId: 'invite1', expiresAt: Date.now() + 5000, usedRequests: 0, maxRequests: 10, status: 'active', queuedRequests: 2 };
  const request = vi.fn(async command => {
    if (command.op === 'circle-invites.issue') return { ...record, token, hostPeerId };
    if (command.op === 'circle-invites.revoke') record.status = 'revoked';
    return [record];
  });
  let port;
  const control = bindCircleInviteControls(document, () => port);
  expect(query('[data-circle-invites]').hidden).toBe(true);
  port = createCircleInviteOwner({ request, baseUrl: 'https://replo.id/settings?source=owner' });
  control.update();
  expect(query('[data-circle-invites]').hidden).toBe(false);
  query('[data-circle-invite-create]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const field = query('[data-circle-invite-link]');
  await vi.waitFor(() => expect(query('[data-circle-invite-revoke]')).not.toBeNull());
  expect(parseCircleInviteUrl(field.value)).toEqual({ token, hostPeerId });
  expect(new URL(field.value).search).toBe('');
  expect(query('[data-circle-invite-list]').textContent).toContain('2 queued');
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ op: 'circle-invites.issue', maxRequests: 10, maxOutputTokens: 256 }));
  query('[data-circle-invite-revoke]').click();
  await vi.waitFor(() => expect(query('[data-circle-invite-list]').textContent).toContain('revoked'));
  expect(field.value).toBe('');
  port = null;
  control.update();
  expect(query('[data-circle-invites]').hidden).toBe(true);
  control.dispose();
});

it('displays active, expired, and revoked invites with named host scope and revocation policy', async () => {
  document.body.innerHTML = renderCircleInviteControls();
  const query = selector => document.querySelector(selector);
  const token = 'b'.repeat(43), hostPeerId = 'peer:alex-pc', hostLabel = "Alex's PC";
  const rows = [
    { inviteId: 'i-active', guestPeerId: 'peer:guest-a', hostPeerId, hostLabel, expiresAt: Date.now() + 60000, usedRequests: 1, maxRequests: 5, status: 'active', queuedRequests: 1, activeRequests: 1 },
    { inviteId: 'i-expired', guestPeerId: 'peer:guest-b', hostPeerId, hostLabel, expiresAt: Date.now() - 1000, usedRequests: 3, maxRequests: 5, status: 'expired', queuedRequests: 0 },
    { inviteId: 'i-revoked', guestPeerId: 'peer:guest-c', hostPeerId, hostLabel, expiresAt: Date.now() + 60000, usedRequests: 2, maxRequests: 5, status: 'revoked', queuedRequests: 0 }
  ];
  const request = vi.fn(async command => {
    if (command.op === 'circle-invites.issue') return { ...rows[0], token, hostPeerId, hostLabel };
    if (command.op === 'circle-invites.revoke') {
      rows[0].status = 'revoked';
      return { ...rows[0], revocationPolicy: 'stop' };
    }
    return rows;
  });
  const port = createCircleInviteOwner({ request, baseUrl: 'https://replo.id/' });
  const control = bindCircleInviteControls(document, () => port);
  expect(query('[data-circle-invite-policy]').textContent).toContain('no duplicate settlement');

  query('[data-circle-invite-create]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(query('[data-circle-invite-row="i-active"]')).not.toBeNull());
  const parsed = parseCircleInviteUrl(query('[data-circle-invite-link]').value);
  expect(parsed).toEqual({ token, hostPeerId, hostLabel });
  expect(query('[data-circle-invite-row="i-active"]').textContent).toContain("Alex's PC");
  expect(query('[data-circle-invite-row="i-active"]').textContent).toContain('1 running');
  expect(query('[data-circle-invite-row="i-expired"]').dataset.circleInviteState).toBe('expired');
  expect(query('[data-circle-invite-row="i-revoked"]').dataset.circleInviteState).toBe('revoked');

  query('[data-circle-invite-revoke="i-active"]').click();
  await vi.waitFor(() => expect(query('[data-circle-invite-status]').textContent).toContain('no duplicate settlement'));
  control.dispose();
});
