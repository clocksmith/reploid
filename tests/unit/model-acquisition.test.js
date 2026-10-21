import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquisitionProgress, createModelAcquisition, retainedModelSource } from '../../self/host/model-acquisition.js';

const model = { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64), source: { baseUrl: 'https://models.invalid/fixture' } };
const source = () => ({ manifest: { modelId: model.id }, manifestHash: 'a'.repeat(64), storageContext: { close: vi.fn(async () => {}) } });
const supported = () => ({ gpu: true, storage: true, locks: { request: async (_name, _options, run) => run({}) } });
const owners = [];
function setup(ensure, extra = {}) {
  const acquire = vi.fn(ensure ?? (async () => source()));
  const owner = createModelAcquisition({ capabilities: supported, load: async () => ({ ensureModelCachedSource: acquire }), ...extra });
  owners.push(owner); return { owner, acquire };
}
afterEach(async () => { await Promise.all(owners.splice(0).map(owner => owner.close())); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Local acquisition using the existing Doppler cache API', () => {
  it('requires consent and binds the exact catalog identity without a second downloader', async () => {
    const stored = source(), { owner, acquire } = setup(async () => stored);
    await expect(owner.start(model, false, 100)).rejects.toThrow('Approve'); expect(acquire).not.toHaveBeenCalled();
    expect(await owner.start(model, true, 100)).toEqual({ id: model.id, identity: model.identity });
    expect(acquire).toHaveBeenCalledWith(model.id, model.source.baseUrl, expect.any(Function),
      expect.objectContaining({ expectedManifestHash: model.identity, signal: expect.any(AbortSignal) }));
    expect(stored.storageContext.close).toHaveBeenCalledOnce(); expect(owner.getState().phase).toBe('complete');
  });
  it('keeps repeated clicks single flight and rejects another model while downloading', async () => {
    let release;
    const { owner, acquire } = setup(() => new Promise(resolve => { release = resolve; }));
    const first = owner.start(model, true, 100), second = owner.start(model, true, 100);
    expect(second).toBe(first);
    await expect(owner.start({ ...model, id: 'other' }, true, 100)).rejects.toThrow('Another model');
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce()); release(source()); await first;
  });
  it('cancels through Doppler, ignores late progress, and explicitly retries through its resume API', async () => {
    let report;
    const { owner, acquire } = setup((_id, _url, progress, { signal }) => new Promise((_resolve, reject) => {
      report = progress; signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const first = owner.start(model, true, 100); const rejected = expect(first).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(report).toBeTypeOf('function'));
    report({ stage: 'downloading', downloadedBytes: 10, totalBytes: 100 }); owner.cancel(); await rejected;
    const terminal = owner.getState(); report({ stage: 'downloading', downloadedBytes: 99, totalBytes: 100 });
    expect(owner.getState()).toEqual(terminal); expect(terminal.phase).toBe('cancelled');
    acquire.mockResolvedValueOnce(source()); await owner.start(model, true, 100); expect(acquire).toHaveBeenCalledTimes(2);
  });
  it('bounds a stalled acquisition and permits explicit retry after it settles', async () => {
    vi.useFakeTimers();
    const { owner } = setup((_id, _url, _progress, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), { idleMs: 100, deadlineMs: 1000 });
    const result = owner.start(model, true, 100); const failure = expect(result).rejects.toThrow('stopped making progress');
    await vi.advanceTimersByTimeAsync(101); await failure;
    expect(owner.getState().phase).toBe('failed'); expect(owner.getState().error).toContain('Retry');
  });
  it.each([
    [{ gpu: false, storage: true, locks: supported().locks }, 'WebGPU'],
    [{ gpu: true, storage: false, locks: supported().locks }, 'storage'],
    [{ gpu: true, storage: true }, 'Web Locks']
  ])('reports unsupported capabilities before downloading', async (capabilities, message) => {
    const { owner, acquire } = setup(undefined, { capabilities: () => capabilities });
    await expect(owner.start(model, true, 100)).rejects.toThrow(message); expect(acquire).not.toHaveBeenCalled();
    expect(owner.getState().phase).toBe('failed');
  });
  it('does not overlap another tab or exceed the host storage limit', async () => {
    const { owner, acquire } = setup(undefined, { capabilities: () => ({ gpu: true, storage: true,
      locks: { request: async (_name, _options, run) => run(null) } }) });
    await expect(owner.start(model, true, 100)).rejects.toThrow('Another tab');
    await expect(owner.start(model, true, 4 * 1024 ** 3)).rejects.toThrow('storage limit');
    expect(acquire).not.toHaveBeenCalled();
  });
  it.each(['QuotaExceededError: disk full', 'HTTP 503', 'network offline'])('retains %s as a recoverable failure', async message => {
    const { owner } = setup(async () => { throw Error(message); });
    await expect(owner.start(model, true, 100)).rejects.toThrow(message);
    expect(owner.getState()).toMatchObject({ phase: 'failed', error: message });
  });
  it('rejects wrong downloaded and restored identities and closes their storage handles', async () => {
    const wrong = source(); wrong.manifestHash = 'b'.repeat(64);
    const { owner } = setup(async () => wrong);
    await expect(owner.start(model, true, 100)).rejects.toThrow('identity mismatch');
    expect(await retainedModelSource(model, async () => ({ loadPersistentModelSource: async () => wrong }))).toBeNull();
    expect(wrong.storageContext.close).toHaveBeenCalledTimes(2);
  });
  it('never presents phase percentages as measured download progress', () => {
    expect(acquisitionProgress({ stage: 'downloading', percent: 42, downloadedBytes: 12 }).message).not.toContain('%');
    expect(acquisitionProgress({ stage: 'downloading', downloadedBytes: 25, totalBytes: 100 }).message).toContain('25%');
    expect(acquisitionProgress({ stage: 'download-complete', percent: 100 }).message).not.toContain('100%');
  });
});

it('refuses acquisition when WebGPU exists but no adapter is available', async () => {
  const { owner, acquire } = setup(undefined, { capabilities: () => ({ ...supported(), checkGpu: async () => null }) });
  await expect(owner.start(model, true, 100)).rejects.toThrow('No WebGPU adapter');
  expect(acquire).not.toHaveBeenCalled();
});
it('restores a verified source through Doppler without making a new acquisition', async () => {
  const stored = source(), loadPersistentModelSource = vi.fn(async () => stored), ensureModelCachedSource = vi.fn();
  expect(await retainedModelSource(model, async () => ({ loadPersistentModelSource, ensureModelCachedSource }))).toBe(stored);
  expect(ensureModelCachedSource).not.toHaveBeenCalled(); await stored.storageContext.close();
});

it.each(['adapter', 'import'])('bounds a stalled %s setup before any model download starts', async stage => {
  vi.useFakeTimers();
  const ports = stage === 'adapter' ? { capabilities: () => ({ ...supported(), checkGpu: () => new Promise(() => {}) }) }
    : { load: () => new Promise(() => {}) };
  const { owner, acquire } = setup(undefined, { ...ports, idleMs: 100, deadlineMs: 1000 });
  const pending = owner.start(model, true, 100), rejected = expect(pending).rejects.toThrow('stopped making progress');
  await vi.advanceTimersByTimeAsync(101); await rejected;
  expect(owner.getState().phase).toBe('failed'); expect(acquire).not.toHaveBeenCalled();
});
