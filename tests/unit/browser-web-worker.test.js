// @vitest-environment node
import { it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBrowserWebWorker, openBrowserWebWorker } from '../../server/browser-web-worker.js';

function fixture({ goto, get, url = 'https://www.google.com/search?q=test' } = {}) {
  const response = { status: () => 302, headers: () => ({ location: 'https://example.org/article' }), dispose: vi.fn() };
  const page = { close: vi.fn(async () => {}), route: vi.fn(), goto: goto || vi.fn(), url: () => url,
    locator: () => ({ first: () => ({ waitFor: vi.fn() }), evaluateAll: async () => [{ url: 'https://www.google.com/goto?url=opaque', title: 'Source', excerpt: 'Source excerpt' }] }) };
  const context = { newPage: vi.fn(async () => page), pages: () => [], request: { get: get || vi.fn(async () => response) } };
  const pageFetch = vi.fn(async () => ({ url: 'https://example.org/article', status: 200, contentType: 'text/html', body: new TextEncoder().encode('<main>The tower opened in 1889.</main>') }));
  return { worker: createBrowserWebWorker({ context, pageFetch }), page, context, pageFetch, response };
}
it('resolves only the Google hop with session cookies and extracts through the guarded public reader', async () => {
  const { worker, page, context, pageFetch, response } = fixture();
  const { results: [source] } = await worker.search({ query: 'tower?', maxResults: 1 }, { requester: 'a' });
  expect(context.request.get).toHaveBeenCalledWith('https://www.google.com/goto?url=opaque', { maxRedirects: 0, timeout: 4000 });
  expect(response.dispose).toHaveBeenCalledOnce(); expect(page.close).toHaveBeenCalledOnce();
  expect(source.url).toBe('https://example.org/article');
  await expect(worker.extract({ source, query: 'tower?', maxCharacters: 100 }, { requester: 'b' })).rejects.toThrow('authorized');
  const result = await worker.extract({ source, query: 'tower?', maxCharacters: 100 }, { requester: 'a' });
  expect(result.text).toBe('The tower opened in 1889.');
  expect(pageFetch).toHaveBeenCalledWith('https://example.org/article', { signal: undefined });
  await worker.close();
  await expect(worker.search({ query: 'tower?', maxResults: 1 }, { requester: 'a' })).rejects.toThrow('closed');
});
it('returns human verification as failure and does not treat it as a search result', async () => {
  const { worker, context, page } = fixture({ url: 'https://www.google.com/sorry/index' });
  await expect(worker.search({ query: 'tower?', maxResults: 1 }, { requester: 'a' })).rejects.toThrow('human verification');
  expect(context.request.get).not.toHaveBeenCalled(); expect(page.close).toHaveBeenCalledOnce(); await worker.close();
});
it('rejects overlap, cancels its owned tab, and settles close before admitting another search', async () => {
  let rejectNavigation;
  const { worker, page } = fixture({ goto: () => new Promise((_, reject) => { rejectNavigation = reject; }) });
  page.close.mockImplementation(async () => rejectNavigation?.(new Error('Tab closed')));
  const controller = new AbortController();
  const result = worker.search({ query: 'one', maxResults: 1 }, { requester: 'a', signal: controller.signal });
  const failure = expect(result).rejects.toThrow();
  await vi.waitFor(() => expect(rejectNavigation).toBeTypeOf('function'));
  await expect(worker.search({ query: 'two', maxResults: 1 }, { requester: 'b' })).rejects.toThrow('busy');
  controller.abort(); await failure; await worker.close(); expect(page.close).toHaveBeenCalled();
});
it('does not release the search slot while a cookie-bound redirect request is pending', async () => {
  let release;
  const { worker, context } = fixture({ get: () => new Promise(resolve => { release = resolve; }) });
  const result = worker.search({ query: 'one', maxResults: 1 }, { requester: 'a' });
  const failure = expect(result).rejects.toThrow();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  let settled = false; const closing = worker.close().then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  release({ status: () => 302, headers: () => ({ location: 'https://example.org/article' }), dispose: vi.fn() });
  await failure; await closing; expect(settled).toBe(true); expect(context.newPage).toHaveBeenCalledOnce();
});

it('refuses an existing unrelated profile before launching Chrome', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-search-profile-'));
  const launch = vi.fn();
  try {
    await fs.writeFile(path.join(directory, 'Local State'), 'personal');
    await expect(openBrowserWebWorker({ profileDirectory: directory, launch })).rejects.toThrow('not created for Reploid');
    expect(launch).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(directory, 'Local State'), 'utf8')).toBe('personal');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
