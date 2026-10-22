import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_DOWNLOAD_STORAGE_KEY, readAutoDownload, autoDownloadCandidates, smallestDownload,
  autoDownloadBlocker, createAutoDownload
} from '../../self/ui/pool-home/auto-download.js';

const memory = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};
const base = (id, name = id) => ({ id, name, source: { baseUrl: 'https://models.example/' + id } });
const small = base('small', 'Small'), large = base('large', 'Large');
const partition = { ...base('split'), partition: { planId: 'plan' } };
const adapter = { ...base('small'), selectionId: 'small/lora', adapters: [{ id: 'lora' }] };
const sizes = { small: 500e6, large: 1500e6 };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function session() {
  return {
    getModelDownload: vi.fn(async id => ({ id, sizeBytes: sizes[id] })),
    downloadLocalModel: vi.fn(async () => {})
  };
}

describe('automatic model download', () => {
  it('defaults on and honors an explicit opt-out', () => {
    expect(readAutoDownload(memory())).toBe(true);
    expect(readAutoDownload(memory({ [AUTO_DOWNLOAD_STORAGE_KEY]: 'off' }))).toBe(false);
    expect(readAutoDownload({ getItem: () => { throw Error('blocked'); } })).toBe(true);
  });

  it('never substitutes an explicit choice and otherwise considers whole base models only', () => {
    expect(autoDownloadCandidates([small, large, partition, adapter], null)).toEqual([small, large]);
    expect(autoDownloadCandidates([small, large], large)).toEqual([large]);
    expect(autoDownloadCandidates([small, large], partition)).toEqual([]);
    expect(autoDownloadCandidates([small, large], adapter)).toEqual([]);
  });

  it('picks the smallest model inside the storage limit', () => {
    const sized = [{ model: large, sizeBytes: sizes.large }, { model: small, sizeBytes: sizes.small }];
    expect(smallestDownload(sized, 2e9).model).toBe(small);
    expect(smallestDownload([{ model: large, sizeBytes: sizes.large }], 1e9)).toBeNull();
  });

  it('explains data saver and insufficient storage', () => {
    expect(autoDownloadBlocker({ saveData: true })).toMatch(/Data saver is on/);
    expect(autoDownloadBlocker({ model: small, sizeBytes: sizes.small, estimate: { quota: 600e6, usage: 200e6 } }))
      .toMatch(/Not enough browser storage for Small \(500 MB needed\)/);
    expect(autoDownloadBlocker({ model: small, sizeBytes: sizes.small, estimate: { quota: 2e9, usage: 0 } })).toBeNull();
    expect(autoDownloadBlocker({ model: small, sizeBytes: sizes.small, estimate: null })).toBeNull();
  });

  it('downloads the smallest whole model once when eligible', async () => {
    const host = session();
    const auto = createAutoDownload(host, { storage: memory(), connection: () => null, estimate: async () => ({ quota: 5e9, usage: 0 }) });
    auto.consider({ eligible: true, models: [large, small, partition] });
    auto.consider({ eligible: true, models: [large, small, partition] });
    await settle(); await settle();
    expect(host.getModelDownload.mock.calls.map(([id]) => id)).toEqual(['large', 'small']);
    expect(host.downloadLocalModel).toHaveBeenCalledTimes(1);
    expect(host.downloadLocalModel).toHaveBeenCalledWith('small', true);
    expect(auto.started()).toEqual({ id: 'small', name: 'Small' });
  });

  it('does nothing while ineligible or opted out', async () => {
    const host = session();
    const auto = createAutoDownload(host, { storage: memory({ [AUTO_DOWNLOAD_STORAGE_KEY]: 'off' }), connection: () => null });
    auto.consider({ eligible: false, models: [small] });
    auto.consider({ eligible: true, models: [small] });
    await settle();
    expect(host.getModelDownload).not.toHaveBeenCalled();
    expect(host.downloadLocalModel).not.toHaveBeenCalled();
  });

  it('skips with an inline reason under data saver or low storage', async () => {
    const saver = session();
    const autoSaver = createAutoDownload(saver, { storage: memory(), connection: () => ({ saveData: true }) });
    autoSaver.consider({ eligible: true, models: [small] });
    await settle();
    expect(saver.downloadLocalModel).not.toHaveBeenCalled();
    expect(autoSaver.notice()).toMatch(/Data saver is on/);

    const full = session();
    const autoFull = createAutoDownload(full, { storage: memory(), connection: () => null, estimate: async () => ({ quota: 100e6, usage: 0 }) });
    autoFull.consider({ eligible: true, models: [small] });
    await settle(); await settle();
    expect(full.downloadLocalModel).not.toHaveBeenCalled();
    expect(autoFull.notice()).toMatch(/Not enough browser storage/);
  });

  it('stays stopped after Cancel until the setting is turned on again', async () => {
    const host = session();
    const storage = memory();
    const auto = createAutoDownload(host, { storage, connection: () => null, estimate: async () => null });
    auto.cancelled();
    auto.consider({ eligible: true, models: [small] });
    await settle();
    expect(host.downloadLocalModel).not.toHaveBeenCalled();
    auto.setEnabled(false);
    expect(storage.getItem(AUTO_DOWNLOAD_STORAGE_KEY)).toBe('off');
    auto.setEnabled(true);
    auto.consider({ eligible: true, models: [small] });
    await settle(); await settle();
    expect(host.downloadLocalModel).toHaveBeenCalledWith('small', true);
  });
});
