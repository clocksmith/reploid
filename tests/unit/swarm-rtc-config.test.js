import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({ getPoolRtcConfig: vi.fn() }));
vi.mock('../../self/pool/rtc-config.js', () => ports);
import { createLegacyNetworkOptions } from '../../self/capabilities/communication/library-adapter.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { location: new URL('https://replo.id/'),
    localStorage: { getItem: () => null, setItem() {} } });
});
afterEach(() => vi.unstubAllGlobals());

it('acquires authorized RTC configuration lazily for hosted swarm negotiation', async () => {
  const first = { iceServers: [{ urls: 'turn:fixture.invalid', credential: 'first' }] };
  const refreshed = { iceServers: [{ urls: 'turn:fixture.invalid', credential: 'refreshed' }] };
  ports.getPoolRtcConfig.mockResolvedValueOnce(first).mockResolvedValueOnce(refreshed);
  const options = createLegacyNetworkOptions();
  const policyBefore = structuredClone(options.config.value);
  expect(ports.getPoolRtcConfig).not.toHaveBeenCalled();
  expect(await options.getRtcConfig()).toEqual(first);
  expect(await options.getRtcConfig()).toEqual(refreshed);
  expect(options.config.value).toEqual(policyBefore);
});

it('preserves explicit host RTC configuration and development independence', async () => {
  const explicit = { iceServers: [] };
  expect(await createLegacyNetworkOptions({ rtcConfig: explicit }).getRtcConfig()).toBe(explicit);
  vi.stubGlobal('REPLOID_POOL_RTC_CONFIG', explicit);
  expect(await createLegacyNetworkOptions().getRtcConfig()).toEqual(explicit);
  vi.stubGlobal('REPLOID_POOL_RTC_CONFIG', undefined);
  window.location = new URL('http://localhost:8000/?swarm=test-room&swarmToken=' + 'a'.repeat(32));
  expect((await createLegacyNetworkOptions().getRtcConfig()).iceServers[0].urls).toMatch(/^stun:/);
  expect(ports.getPoolRtcConfig).not.toHaveBeenCalled();
});

it('preserves a host credential port and propagates authorization failures', async () => {
  const getRtcConfig = vi.fn().mockRejectedValue(new Error('Authorization unavailable'));
  const options = createLegacyNetworkOptions({ getRtcConfig });
  await expect(options.getRtcConfig()).rejects.toThrow('Authorization unavailable');
  expect(ports.getPoolRtcConfig).not.toHaveBeenCalled();
});


it('uses shared authenticated RTC credentials for public localhost nodes', async () => {
  for (const href of ['http://localhost:5173/', 'http://127.0.0.1:3000/', 'http://[::1]:8080/']) {
    window.location = new URL(href);
    ports.getPoolRtcConfig.mockResolvedValue({ iceServers: [{ urls: 'turn:shared.invalid' }] });
    const options = createLegacyNetworkOptions();
    expect(options.config.value.webrtc.signalingUrl).toContain('reploid-swarm.reploid.workers.dev');
    expect((await options.getRtcConfig()).iceServers[0].urls).toBe('turn:shared.invalid');
  }
});
