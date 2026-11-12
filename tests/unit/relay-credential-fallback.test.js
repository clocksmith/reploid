import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.resetModules(); vi.doUnmock('../../shared/pool/rtc-config.js'); delete globalThis.REPLOID_POOL_RTC_CONFIG; });

it('continues with direct candidates, and says so, when relay credentials cannot be issued; recovers when they can', async () => {
  const issue = vi.fn();
  vi.doMock('../../shared/pool/rtc-config.js', () => ({ getPoolRtcConfig: issue }));
  const { createLegacyNetworkOptions, relayUnavailableReason } = await import('../../shared/capabilities/communication/library-adapter.js');
  const events = []; const listen = event => events.push(event.detail);
  globalThis.addEventListener('reploid:relay-state', listen);
  try {
    const options = createLegacyNetworkOptions({ config: { mesh: {}, webrtc: {} } });
    issue.mockRejectedValueOnce(new Error('issuer unavailable'));
    const direct = await options.getRtcConfig();
    expect(direct.iceServers.every(server => [].concat(server.urls).every(url => url.startsWith('stun:')))).toBe(true);
    expect(direct.iceTransportPolicy).not.toBe('relay');
    expect(relayUnavailableReason()).toBe('issuer unavailable');
    expect(events.at(-1)).toEqual({ directOnly: true, reason: 'issuer unavailable' });
    const relayed = { iceServers: [{ urls: 'turn:fixture.invalid', username: 'u', credential: 'c' }] };
    issue.mockResolvedValueOnce(relayed);
    expect(await options.getRtcConfig()).toBe(relayed);
    expect(relayUnavailableReason()).toBe(null);
    expect(events.at(-1)).toEqual({ directOnly: false, reason: null });
  } finally { globalThis.removeEventListener('reploid:relay-state', listen); }
});
