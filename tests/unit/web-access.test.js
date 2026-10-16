import { describe, expect, it, vi } from 'vitest';
import { createProviderWebAccess, createBrowserWebAccess } from '../../self/host/web-access.js';
import { createDeviceSearch } from '../../self/host/device-search.js';
import { createRetrieval, sha256Text } from '../../packages/reploid/src/retrieval/index.js';

// Injected providers and attached-browser ports; these tests establish the interface, not live search access.
const url = 'https://example.org/tower';
const page = '<html><head><title>Tower</title></head><body><main>The tower opened in 1889.</main></body></html>';
const query = 'When did the tower open?';
const pending = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function ports() {
  return {
    id: 'configured-search',
    search: vi.fn(async function () {
      expect(this.id).toBe('configured-search');
      return [{ sourceId: 'tower', url, title: 'Search snippet', excerpt: 'A tower.', retrievedAt: 123,
        contentHash: await sha256Text('A tower.') }];
    }),
    fetch: vi.fn(async () => new Response(page, { headers: { 'content-type': 'text/html' } }))
  };
}

describe('interchangeable web access', () => {
  it.each(['provider', 'browser'])('%s supports search and direct URL reads through the same retrieval pipeline', async kind => {
    const bridge = ports(), authorized = vi.fn(() => true);
    const access = kind === 'browser' ? createBrowserWebAccess({ bridge, authorized })
      : createProviderWebAccess({ provider: bridge, fetch: bridge.fetch });
    const device = createDeviceSearch({ access, accessServer: 'search.example.org', enabled: () => true,
      server: () => 'search.example.org', now: () => 123 });
    const retrieval = createRetrieval({ provider: device.provider, extractor: device.extractor });
    const record = await retrieval.retrieve(retrieval.pending(retrieval.request({}, query), 123));
    expect(record.outcome).toBe('retrieved');
    expect(record.sources[0]).toMatchObject({ url, title: 'Tower', passage: 'The tower opened in 1889.', passageOrigin: 'extract' });
    expect(bridge.search).toHaveBeenCalledTimes(1);
    expect(bridge.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) }));
    const response = await access.fetch(url, { credentials: 'omit' });
    expect(await response.text()).toBe(page);
    expect(bridge.search).toHaveBeenCalledTimes(1); // Known URLs do not need a search.
    if (kind === 'browser') expect(authorized).toHaveBeenCalledWith({ id: bridge.id, operation: 'fetch', target: url });
  });

  it('refuses an ambiguous implementation instead of mixing browser and provider routes', () => {
    const source = ports(), access = createProviderWebAccess({ provider: source });
    expect(() => createDeviceSearch({ access, source, server: () => 'search.example.org' })).toThrow('one web access');
  });

  it('does not dispatch without browser authorization or after cancellation', async () => {
    const bridge = ports(), authorized = vi.fn(() => false);
    const access = createBrowserWebAccess({ bridge, authorized });
    await expect(access.search(query, {})).rejects.toThrow('not authorized');
    await expect(access.fetch(url)).rejects.toThrow('not authorized');
    authorized.mockReturnValue(true);
    const controller = new AbortController(); controller.abort(new Error('Stopped'));
    await expect(access.fetch(url, { signal: controller.signal })).rejects.toThrow('Stopped');
    expect(bridge.search).not.toHaveBeenCalled(); expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it('disables a bound adapter when the configured service changes, including during search', async () => {
    const bridge = ports(), work = pending();
    bridge.search.mockReturnValue(work.promise);
    const access = createBrowserWebAccess({ bridge, authorized: () => true });
    let server = 'search.example.org';
    const device = createDeviceSearch({ access, accessServer: server, server: () => server });
    const result = device.provider.search(query, {});
    server = 'other.example.org';
    work.resolve([]);
    await expect(result).rejects.toThrow('binding changed');
    expect(device.available()).toBe(false);
    await expect(device.provider.search(query, {})).rejects.toThrow('binding changed');
    await expect(device.extractor.extract({ source: { url }, query, limits: {} })).rejects.toThrow('binding changed');
    expect(bridge.search).toHaveBeenCalledTimes(1);
    expect(bridge.fetch).not.toHaveBeenCalled();
  });

  it('rejects browser replacement and does not fall back on failure', async () => {
    const bridge = ports(), access = createBrowserWebAccess({ bridge, authorized: () => true });
    bridge.id = 'another-browser';
    await expect(access.search(query, {})).rejects.toThrow('browser changed');
    expect(bridge.search).not.toHaveBeenCalled();
    bridge.id = 'configured-search';
    bridge.fetch.mockRejectedValue(new Error('Browser disconnected'));
    await expect(access.fetch(url)).rejects.toThrow('Browser disconnected');
    expect(bridge.fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels a stalled page stream even if the bridge does not cancel it itself', async () => {
    const cancel = vi.fn(), body = new ReadableStream({ cancel });
    const bridge = ports();
    bridge.fetch.mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/html' } }));
    const access = createBrowserWebAccess({ bridge, authorized: () => true });
    const device = createDeviceSearch({ access, accessServer: 'search.example.org', server: () => 'search.example.org' });
    const controller = new AbortController();
    const extraction = device.extractor.extract({ source: { url }, query, limits: {}, signal: controller.signal });
    const failed = expect(extraction).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await failed;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each(['revoked', 'cancelled', 'replaced'])('discards page results when access is %s during a read', async reason => {
    const bridge = ports(), read = pending(), controller = new AbortController();
    bridge.fetch.mockReturnValue(read.promise);
    let allowed = true;
    const access = createBrowserWebAccess({ bridge, authorized: () => allowed });
    const result = access.fetch(url, { signal: controller.signal });
    if (reason === 'revoked') allowed = false;
    if (reason === 'cancelled') controller.abort(new Error('Stopped'));
    if (reason === 'replaced') bridge.id = 'another-browser';
    const response = new Response(page);
    read.resolve(response);
    await expect(result).rejects.toThrow();
    expect(await response.body.getReader().read()).toMatchObject({ done: true });
  });
});
