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
