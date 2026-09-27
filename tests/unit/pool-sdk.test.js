import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPoolSdk,
  getDefaultPoolClientId
} from '../../self/pool/sdk.js';

describe('Pool SDK client identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a normalized relay client id on pool requests', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true })
    }));
    vi.stubGlobal('fetch', fetchMock);

    const sdk = createPoolSdk({
      baseUrl: 'https://pool.test',
      authTokenProvider: null,
      clientId: 'provider/id with space'
    });

    await sdk.publishPeerRoomMessage('room-a', { type: 'provider-advert' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pool.test/peer/rooms/room-a/messages');
    expect(init.headers['X-Reploid-Client-Id']).toBe('provider_id_with_space');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('keeps the generated browser-tab client id stable in session storage', () => {
    const values = new Map();
    vi.stubGlobal('sessionStorage', {
      getItem(key) {
        return values.get(key) || null;
      },
      setItem(key, value) {
        values.set(key, value);
      }
    });

    const first = getDefaultPoolClientId();
    const second = getDefaultPoolClientId();

    expect(first).toMatch(/^pool_client_/);
    expect(second).toBe(first);
  });

  it('routes only authenticated RTC issuance to the configured host without redirecting', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const sdk = createPoolSdk({ rtcConfigUrl: 'https://worker.test/rtc-config',
      authTokenProvider: async () => 'test-token', clientId: 'test-client' });
    await sdk.rtcConfig(); await sdk.status();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['https://worker.test/rtc-config', '/pool/status']);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: 'error', headers: { Authorization: 'Bearer test-token' }
    });
  });

  it('does not silently fall back after RTC issuer failure', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const sdk = createPoolSdk({ rtcConfigUrl: 'https://worker.test/rtc-config', authTokenProvider: null });
    await expect(sdk.rtcConfig()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://worker.test/rtc-config');
  });

  it('preserves an explicitly supplied Pool API base', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    await createPoolSdk({ baseUrl: 'https://custom.test', authTokenProvider: null }).rtcConfig();
    expect(fetchMock.mock.calls[0][0]).toBe('https://custom.test/rtc-config');
  });

  it('uses the isolated adapter-canary publication routes', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ publications: [] })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const sdk = createPoolSdk({
      baseUrl: 'https://pool.test',
      authTokenProvider: null,
      clientId: 'canary-client'
    });

    await sdk.publishAdapterCanary({ publicationHash: 'sha256:test' });
    await sdk.listAdapterCanaries({ canaryId: 'ner-canary' });
    await sdk.getAdapterCanary('sha256:test');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://pool.test/adapter-canaries',
      'https://pool.test/adapter-canaries?canaryId=ner-canary',
      'https://pool.test/adapter-canaries/sha256%3Atest'
    ]);
  });

  it('requests exact-sequence evidence and the bounded campaign queue', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ schema: 'poolday.cross_room_sequence_evidence/v1' })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const sdk = createPoolSdk({
      baseUrl: 'https://pool.test',
      authTokenProvider: null,
      clientId: 'sequence-client'
    });

    await sdk.listSequenceResearchEvidence('sha256:sequence/id', {
      currentRoomId: 'room with space',
      limit: 125
    });
    await sdk.listProteinUncertaintyCampaignQueue({ limit: 125 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://pool.test/research/sequences/sha256%3Asequence%2Fid/evidence?currentRoomId=room+with+space&limit=125',
      'https://pool.test/research/campaign-queue?limit=125'
    ]);
  });

  it('preserves a trusted relay retry deadline on rate-limit errors', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => name === 'Retry-After' ? '7' : null },
      json: async () => ({ error: 'pool rate limit exceeded', retryable: true, retryAfter: 7 })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const sdk = createPoolSdk({
      baseUrl: 'https://pool.test',
      authTokenProvider: null,
      clientId: 'rate-limited-client'
    });

    await expect(sdk.listPeerRoomMessages('room-a')).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7000,
      payload: { retryAfter: 7 }
    });
  });
});
