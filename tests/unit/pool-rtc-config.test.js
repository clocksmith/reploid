import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPoolRtcConfigCache,
  getPoolRtcConfig
} from '../../self/pool/rtc-config.js';

describe('Pool browser RTC configuration', () => {
  beforeEach(() => {
    clearPoolRtcConfigCache();
  });

  it('caches unexpired authenticated configuration and can force relay policy', async () => {
    const rtcConfig = {
      iceTransportPolicy: 'all',
      iceServers: [{
        urls: ['turn:203.0.113.10:3478?transport=udp'],
        username: 'expires:user',
        credential: 'temporary'
      }]
    };
    const sdk = {
      rtcConfig: vi.fn().mockResolvedValue({
        expiresAt: '2026-07-28T12:10:00.000Z',
        rtcConfig
      })
    };
    const now = () => Date.parse('2026-07-28T12:00:00.000Z');

    expect(await getPoolRtcConfig({ sdk, now })).toEqual(rtcConfig);
    expect(await getPoolRtcConfig({ sdk, now, forceRelay: true })).toMatchObject({
      iceTransportPolicy: 'relay'
    });
    expect(sdk.rtcConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects expired server credentials', async () => {
    const sdk = {
      rtcConfig: vi.fn().mockResolvedValue({
        expiresAt: '2026-07-28T11:59:00.000Z',
        rtcConfig: { iceServers: [] }
      })
    };
    await expect(getPoolRtcConfig({
      sdk,
      now: () => Date.parse('2026-07-28T12:00:00.000Z')
    })).rejects.toThrow('valid future expiry');
  });
});

it('coalesces renewal near expiry and retries a failed issuer without caching failure', async () => {
  let clock = 100000;
  const now = () => clock;
  const config = credential => ({ expiresAt: new Date(clock + 60000).toISOString(),
    rtcConfig: { iceServers: [{ urls: 'turn:fixture.invalid', username: 'fixture', credential }] } });
  const sdk = { rtcConfig: vi.fn().mockImplementation(async () => config('first')) };
  await Promise.all(Array.from({ length: 8 }, () => getPoolRtcConfig({ sdk, now })));
  expect(sdk.rtcConfig).toHaveBeenCalledTimes(1);
  clock += 31000;
  sdk.rtcConfig.mockRejectedValueOnce(Error('issuer unavailable'));
  await expect(getPoolRtcConfig({ sdk, now })).rejects.toThrow('issuer unavailable');
  sdk.rtcConfig.mockImplementation(async () => config('renewed'));
  const renewed = await Promise.all(Array.from({ length: 8 }, () => getPoolRtcConfig({ sdk, now })));
  expect(sdk.rtcConfig).toHaveBeenCalledTimes(3);
  expect(renewed.every(result => result.iceServers[0].credential === 'renewed')).toBe(true);
});
