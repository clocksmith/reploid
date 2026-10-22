// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createExternalBrainProvider } from '../../self/providers/external-brain.js';
import ProviderRegistry from '../../self/core/provider-registry.js';
import LLMClient from '../../self/core/llm-client.js';
import manifest from '../../self/config/vfs-manifest.json' with { type: 'json' };
import { pickBootSeedFiles } from '../../self/config/boot-seed.js';

const model = { id: 'external-brain', provider: 'external', hostType: 'direct' };
const messages = [{ role: 'user', content: 'Write a local artifact' }];
const tools = [{ type: 'function', function: { name: 'WriteFile', parameters: { type: 'object' } } }];
const location = { hostname: '127.0.0.1', protocol: 'http:' };
const reply = (overrides = {}) => ({
  ok: true, json: async () => ({ requestId: 'req_test', sessionId: 'x:test',
    provider: 'external', model: model.id, content: 'Ready', raw: 'Ready', toolCalls: null, ...overrides })
});
const providerWith = (fetch) => createExternalBrainProvider({ fetch, getLocation: () => location, getSessionId: () => 'x:test' });
const utils = () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Errors: { ConfigError: Error, ValidationError: Error }, generateId: () => 'req_test'
});

describe('external reasoning provider', () => {
  it('delivers the registry-relative provider import into the actual X VFS profile', () => {
    const files = pickBootSeedFiles(manifest.files, 'x_home');
    const registryPath = files.find(path => path.endsWith('/provider-registry.js'));
    expect(registryPath).toBeDefined();
    const targetPath = new URL('../providers/external-brain.js', `https://local.invalid/${registryPath}`).pathname;
    expect(files).toContain(targetPath.slice(1));
  });

  it('preserves HTTP failure status when the disabled server returns HTML', async () => {
    const provider = providerWith(async () => ({ ok: false, status: 404, json: async () => { throw new SyntaxError('HTML'); } }));
    await expect(provider.chat(messages, model, 'req_test')).rejects.toMatchObject({ status: 404, message: 'External reasoning mailbox unavailable (404)' });
  });

  it('is a registered provider and carries context/tools but never provider credentials', async () => {
    const Utils = utils();
    const registry = ProviderRegistry.factory({ Utils });
    expect(typeof (await registry.getProvider('external')).chat).toBe('function');
    const fetch = vi.fn(async () => reply({ toolCalls: [{ id: 'call_1', name: 'WriteFile', args: { path: '/artifacts/probe', content: 'ok' } }] }));
    registry.registerProvider('external', providerWith(fetch), { override: true });
    const client = LLMClient.factory({ Utils, ProviderRegistry: registry });
    const result = await client.chat(messages, { ...model, apiKey: 'must-not-leave-client', endpoint: 'https://example.invalid' }, null, { tools });
    expect(result.toolCalls[0].name).toBe('WriteFile');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/external-brain/generate');
    expect(JSON.parse(options.body)).toEqual({ schema: 'reploid.external-brain.request/v1', requestId: 'req_test', sessionId: 'x:test', modelId: model.id, messages, tools });
    expect(options.headers['X-Reploid-External-Brain']).toBe('1');
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
  });

  it('rejects a non-loopback browser and an already cancelled attempt without sending context', async () => {
    const fetch = vi.fn();
    const remote = createExternalBrainProvider({ fetch, getLocation: () => ({ ...location, hostname: 'example.com' }) });
    await expect(remote.chat(messages, model, 'req_test')).rejects.toThrow('loopback');
    await expect(providerWith(fetch).chat(messages, model, 'req_test', { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates AgentLoop cancellation through LLMClient and rejects even a late successful transport', async () => {
    let resolveGeneration;
    const fetch = vi.fn((url) => url.endsWith('/generate')
      ? new Promise(resolve => { resolveGeneration = resolve; }) : Promise.resolve(reply()));
    const Utils = utils();
    const registry = ProviderRegistry.factory({ Utils });
    registry.registerProvider('external', providerWith(fetch));
    const client = LLMClient.factory({ Utils, ProviderRegistry: registry });
    const controller = new AbortController();
    const pending = client.chat(messages, model, null, { signal: controller.signal, tools });
    await vi.waitFor(() => expect(resolveGeneration).toBeTypeOf('function'));
    controller.abort();
    resolveGeneration(reply());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls[1][0]).toBe('/api/external-brain/requests/req_test');
    expect(fetch.mock.calls[1][1].method).toBe('DELETE');
    expect(client.abortRequest('req_test')).toBe(false);
  });

  it('supports explicit request cancellation and does not deliver a later response', async () => {
    let resolveGeneration;
    const fetch = vi.fn((url) => url.endsWith('/generate')
      ? new Promise(resolve => { resolveGeneration = resolve; }) : Promise.resolve(reply()));
    const provider = providerWith(fetch);
    const pending = provider.chat(messages, model, 'req_test');
    expect(provider.abort('req_test')).toBe(true);
    resolveGeneration(reply());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(provider.abort('req_test')).toBe(false);
  });

  it('preserves server failures and refuses cross-request delivery', async () => {
    await expect(providerWith(async () => ({ ok: false, status: 504, json: async () => ({ error: 'Expired', code: 'timeout' }) }))
      .chat(messages, model, 'req_test')).rejects.toMatchObject({ message: 'Expired', status: 504, code: 'timeout' });
    for (const invalid of [{ requestId: 'another' }, { sessionId: 'another' }, { provider: 'openai' }, { model: 'another' }, { content: null }]) {
      await expect(providerWith(async () => reply(invalid)).chat(messages, model, 'req_test')).rejects.toThrow('Invalid external');
    }
  });
});
