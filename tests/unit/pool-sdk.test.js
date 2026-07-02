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
});
