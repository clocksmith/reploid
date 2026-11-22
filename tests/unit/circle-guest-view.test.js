import { expect, it, vi } from 'vitest';
import { createCircleInviteUrl, parseCircleInviteUrl } from '../../apps/poolday/host/circle-invites.js';
import { bindCircleGuestBanner, renderCircleGuestBanner } from '../../apps/poolday/ui/pool-home/circle-guest-view.js';

it('shows direct host disclosure before sending and handles ready, queued, full, offline, and receipt states', () => {
  document.body.innerHTML = renderCircleGuestBanner();
  const query = selector => document.querySelector(selector);
  const onReplay = vi.fn();
  const onHostOwn = vi.fn();
  const banner = bindCircleGuestBanner(document, { onReplay, onHostOwn });

  const url = createCircleInviteUrl({ token: 'c'.repeat(43), hostPeerId: 'peer:alex', hostLabel: "Alex's PC" }, 'https://replo.id/');
  const invite = parseCircleInviteUrl(url);
  expect(invite).toEqual({ token: 'c'.repeat(43), hostPeerId: 'peer:alex', hostLabel: "Alex's PC" });

  // Ready state discloses who can read the prompt before sending.
  const ready = banner.update({ hostLabel: invite.hostLabel, hostPeerId: invite.hostPeerId, hostState: 'ready', inviteStatus: 'active' });
  expect(ready.canSend).toBe(true);
  expect(query('[data-circle-guest-readable]').textContent).toBe("Readable by: Alex's PC");
  expect(query('[data-circle-guest-notice]').textContent).toBe("This runs on Alex's PC. Its operator can read your prompt.");
  expect(query('[data-circle-guest-fallback]').hidden).toBe(true);

  // Queued state shows position and wait while keeping prompt local until admitted.
  const queued = banner.update({
    hostLabel: invite.hostLabel, hostPeerId: invite.hostPeerId,
    hostState: 'queued', inviteStatus: 'active', queuePosition: 2, expectedWaitMs: 6000
  });
  expect(queued.canSend).toBe(true);
  expect(query('[data-circle-guest-state]').textContent).toContain('position 2');
  expect(query('[data-circle-guest-state]').textContent).toContain('6s');

  // >20s expected wait transitions to Full with replay + host-your-own fallback and blocks sending.
  const longWait = banner.update({
    hostLabel: invite.hostLabel, hostPeerId: invite.hostPeerId,
    hostState: 'queued', inviteStatus: 'active', queuePosition: 5, expectedWaitMs: 25_000
  });
  expect(longWait.canSend).toBe(false);
  expect(longWait.stateLabel).toBe('Full');
  expect(query('[data-circle-guest-fallback]').hidden).toBe(false);

  // Offline state blocks sending off-route and exposes replay + host-your-own buttons.
  const offline = banner.update({ hostLabel: invite.hostLabel, hostPeerId: invite.hostPeerId, hostState: 'offline', inviteStatus: 'active' });
  expect(offline.canSend).toBe(false);
  expect(query('[data-circle-guest-state]').textContent).toContain('offline');
  query('[data-circle-guest-replay]').click();
  query('[data-circle-guest-host-own]').click();
  expect(onReplay).toHaveBeenCalledTimes(1);
  expect(onHostOwn).toHaveBeenCalledTimes(1);

  // Request-matched receipt shows authorized host, exact model, and 0 B downloaded.
  banner.update({
    hostLabel: invite.hostLabel, hostPeerId: invite.hostPeerId, hostState: 'ready', inviteStatus: 'active',
    receipt: { hostLabel: "Alex's PC", modelIdentity: `sha256:${'d'.repeat(64)}`, modelWeightBytes: 0 }
  });
  expect(query('[data-circle-guest-receipt]').hidden).toBe(false);
  expect(query('[data-circle-guest-receipt]').textContent).toContain("Alex's PC");
  expect(query('[data-circle-guest-receipt]').textContent).toContain('0 B model weights downloaded');

  banner.dispose();
});
