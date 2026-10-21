// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
const ports = vi.hoisted(() => ({ retained: vi.fn(async () => null) }));
vi.mock('../../self/host/model-acquisition.js', () => ({ retainedModelSource: ports.retained }));
vi.mock('../../self/infrastructure/custody-supply-budget.js', () => ({
  openBrowserSupplyBudget: async () => ({ getState: () => ({}), close() {} }),
  openBrowserAcquisitionBudget: async () => { throw Object.assign(Error('No allowance'), { code: 'CUSTODY_BUDGET_MISSING' }); }
}));
import { createWorkModelFiles } from '../../self/host/work-model-files.js';
import { LOCAL_DOPPLER_MODELS } from '../../self/config/doppler-local-models.js';
afterEach(() => { vi.unstubAllGlobals(); ports.retained.mockReset(); ports.retained.mockResolvedValue(null); });

it('reuses an acquired Doppler source for ordinary mesh compute preparation without another loader', async () => {
  const source = { manifest: { modelId: LOCAL_DOPPLER_MODELS[0].id }, storageContext: { close: vi.fn() } };
  ports.retained.mockResolvedValue(source);
  const files = createWorkModelFiles({ getTransport: () => null, fetchImpl: vi.fn(() => { throw Error('Unexpected download'); }) });
  expect(await files.prepareSource(LOCAL_DOPPLER_MODELS[0], { cacheOnly: true })).toBe(source);
  await files.close();
});

it('reads the pinned manifest from Doppler for mesh custody without copying or downloading bytes', async () => {
  const model = LOCAL_DOPPLER_MODELS[0], descriptor = model.source.files.find(file => file.role === 'model-manifest');
  const text = await readFile(new URL('../../self' + descriptor.url, import.meta.url), 'utf8');
  const missing = () => { throw new DOMException('Not found', 'NotFoundError'); };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => ({
    async *entries() {}, getFileHandle: missing
  }) }) } });
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('REPLOID_DOPPLER_MODULE_URL', new URL('../../self/vendor/doppler/0.6.32/src/index.js', import.meta.url).href);
  const close = vi.fn(async () => {}), read = vi.fn(async path => {
    expect(path).toBe('manifest.json'); return new TextEncoder().encode(text).buffer;
  });
  vi.stubGlobal('__acquisitionMeshTools', {
    listModels: async () => [model.id], openModelReadSession: async id => {
      expect(id).toBe(model.id); return { readManifest: async () => text, readFile: read, close };
    }, computeHash: async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
  });
  vi.stubGlobal('REPLOID_DOPPLER_STORAGE_MODULE_URL', 'data:text/javascript,export const listModels = (...a) => globalThis.__acquisitionMeshTools.listModels(...a);export const openModelReadSession = (...a) => globalThis.__acquisitionMeshTools.openModelReadSession(...a);export const computeHash = (...a) => globalThis.__acquisitionMeshTools.computeHash(...a);');
  const fetch = vi.fn(() => { throw Error('Unexpected second download'); });
  const files = createWorkModelFiles({ getTransport: () => null, fetchImpl: fetch });
  const source = await files.prepareSource(model, { cacheOnly: true });
  expect(source.manifest.modelId).toBe(model.id); expect(fetch).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  await source.storageContext.close?.(); await files.close();
});
