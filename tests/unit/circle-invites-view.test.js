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
