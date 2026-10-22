import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { AUTO_DOWNLOAD_STORAGE_KEY } from '../../self/ui/pool-home/auto-download.js';
const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers(); localStorage.removeItem(AUTO_DOWNLOAD_STORAGE_KEY); });
// The manual size-and-consent path applies when automatic download is off.
function fixture({ automatic = false } = {}) {
  localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, automatic ? 'on' : 'off');
  const session = createChatSession({ storage: null, service: createChatTestService(), models: [CANONICAL_CHAT_MODELS[0]] });
  cleanups.push(() => session.close());
  let state = { ...session.getState(), localDownloadIssue: null, peerDiscoveryTimedOut: false,
    network: { connecting: true, consumer: { connectionState: 'retrying', peers: [] } } };
  const listeners = new Set();
  const api = { ...session, getState: () => state, subscribe: callback => { listeners.add(callback); callback(state); return () => listeners.delete(callback); },
    getModelDownload: vi.fn(async id => ({ id, sizeBytes: 123000000 })), downloadLocalModel: vi.fn(async () => {}),
    cancelModelDownload: vi.fn(), connect: vi.fn(async () => {}) };
  const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace(); document.body.append(root);
  const dispose = bindConversationWorkspace(root, api); cleanups.push(() => { dispose(); root.remove(); });
  return { root, api, find: selector => root.querySelector(selector),
    publish(update) { state = { ...state, ...update }; listeners.forEach(callback => callback(state)); }, state: () => state };
}
it('bounds the host discovery window even when signaling never connects, without acquiring anything', async () => {
  vi.useFakeTimers();
  const session = createChatSession({ storage: null, service: createChatTestService(), swarm: { getState: () => ({ connecting: true }) } });
  expect(session.getState().peerDiscoveryTimedOut).toBe(false);
  await vi.advanceTimersByTimeAsync(8000);
  expect(session.getState().peerDiscoveryTimedOut).toBe(true); expect(session.getState().acquisition.phase).toBe('idle');
  await session.close();
});
it('downloads the smallest whole model automatically when no computer can answer, and Cancel stops further automatic downloads', async () => {
  const f = fixture({ automatic: true }), model = CANONICAL_CHAT_MODELS[0];
  expect(f.find('[data-auto-download-toggle]').getAttribute('aria-checked')).toBe('true');
  await Promise.resolve();
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled();
  f.publish({ peerDiscoveryTimedOut: true });
  await vi.waitFor(() => expect(f.api.downloadLocalModel).toHaveBeenCalledWith(model.id, true));
  f.publish({ acquisition: { phase: 'downloading', modelId: model.id, progress: { message: 'Downloading model files.', receivedBytes: 1, totalBytes: 2 } } });
  expect(f.find('[data-acquisition-status]').textContent)
    .toBe(`${model.name} is downloading to this device because no computer can answer. Downloading model files.`);
  expect(f.find('[data-acquisition-progress]').hidden).toBe(false);
  f.find('[data-cancel-download]').click(); expect(f.api.cancelModelDownload).toHaveBeenCalledOnce();
  f.publish({ acquisition: { phase: 'cancelled', modelId: model.id, error: 'Download cancelled.', progress: null } });
  f.publish({ peerDiscoveryTimedOut: true });
  await Promise.resolve();
  expect(f.api.downloadLocalModel).toHaveBeenCalledOnce();
  expect(f.find('[data-download-local]').textContent).toBe('Retry download');
});
it('offers explicit local download after no usable peers and reuses the existing size-and-consent dialog', async () => {
  const f = fixture(); expect(f.find('[data-download-local]').hidden).toBe(true);
  f.publish({ peerDiscoveryTimedOut: true });
  expect(f.find('[data-download-local]').hidden).toBe(false); expect(f.find('[data-retry-connection]').hidden).toBe(false);
  f.find('[data-download-local]').click();
  await vi.waitFor(() => expect(f.find('[data-download-confirm]').disabled).toBe(false));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled();
  expect(f.find('[data-download-title]').textContent).toBe('Download model');
  expect(f.find('[data-download-size]').textContent).toBe('123 MB download');
  f.find('[data-download-confirm]').click(); f.find('[data-download-confirm]').click();
  await vi.waitFor(() => expect(f.api.downloadLocalModel).toHaveBeenCalledOnce());
  expect(f.api.downloadLocalModel).toHaveBeenCalledWith(CANONICAL_CHAT_MODELS[0].id, true);
});
it('does not let a perpetually preparing unusable peer hide the local fallback', () => {
  const f = fixture(); f.publish({ peerDiscoveryTimedOut: true, models: [{ ...f.state().models[0], availability: 'loading' }] });
  expect(f.find('[data-download-local]').hidden).toBe(false);
  expect(f.find('[data-acquisition-status]').textContent).toContain('No usable network capacity');
});
it('keeps downloads cancellable when a usable peer arrives and never fabricates unknown totals', () => {
  const f = fixture();
  f.publish({ acquisition: { phase: 'downloading', progress: { message: 'Downloading model files.', receivedBytes: 20, totalBytes: null } } });
  expect(f.find('[data-acquisition-progress]').hasAttribute('value')).toBe(false);
  const ready = { ...f.state().models[0], availability: 'ready', networkAvailability: 'ready' };
  f.publish({ models: [ready], defaultModels: { auto: ready }, defaultModel: ready });
  expect(f.find('[data-composer-send]').disabled).toBe(false); expect(f.find('[data-cancel-download]').hidden).toBe(false);
  expect(f.find('[data-acquisition-status]').textContent).toContain('Network capacity is available');
  f.find('[data-cancel-download]').click(); expect(f.api.cancelModelDownload).toHaveBeenCalledOnce();
});
it('keeps capability failures actionable and checks failed metadata again without starting a download', async () => {
  const f = fixture(); f.publish({ peerDiscoveryTimedOut: true, localDownloadIssue: 'This browser needs WebGPU.' });
  expect(f.find('[data-download-local]').hidden).toBe(true);
  expect(f.find('[data-acquisition-status]').textContent).toContain('WebGPU');
  f.publish({ localDownloadIssue: null }); f.api.getModelDownload.mockRejectedValueOnce(Error('Network unavailable'));
  f.find('[data-download-local]').click();
  await vi.waitFor(() => expect(f.find('[data-retry-download-check]').hidden).toBe(false));
  expect(f.find('[data-download-confirm]').disabled).toBe(true); f.find('[data-retry-download-check]').click();
  await vi.waitFor(() => expect(f.find('[data-download-confirm]').disabled).toBe(false));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled();
});

it('returns a failed local cache to acquisition recovery while preserving the conversation', async () => {
  const model = CANONICAL_CHAT_MODELS[0];
  const service = createChatTestService(); service.open = async () => { throw Error('Cached bytes were evicted'); };
  const session = createChatSession({ storage: null, service, models: [model] });
  session.setCachedModels([model]); const id = session.createThread();
  expect((await session.send(id, 'Keep this question')).status).toBe('failed');
  expect(session.getState().models[0].availability).toBe('unavailable');
  expect(session.getState().activeThread.messages[0].content).toBe('Keep this question');
  await session.close();
});
