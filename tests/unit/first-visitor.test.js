import { createExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../apps/poolday/ui/pool-home/conversation-workspace.js';
import { AUTO_DOWNLOAD_STORAGE_KEY } from '../../apps/poolday/ui/pool-home/auto-download.js';
const cleanups = [];
const observedDiscovery = {
  discoveryPhase: 'observed', peerDiscoveryTimedOut: true,
  network: { consumer: { connectionState: 'connected', peers: [] } }
};
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers(); localStorage.removeItem(AUTO_DOWNLOAD_STORAGE_KEY); });
// Legacy automatic-download preferences cannot bypass the explicit size-and-consent path.
const openPolicy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
function fixture({ automatic = false, viewState, fresh = false } = {}) {
  localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, automatic ? 'on' : 'off');
  const session = createChatSession({ storage: null, service: createChatTestService(), models: [CANONICAL_CHAT_MODELS[0]] });
  cleanups.push(() => session.close());
  let state = { ...session.getState(), localDownloadIssue: null, peerDiscoveryTimedOut: false, discoveryPhase: 'searching',
    network: { connecting: true, consumer: { connectionState: 'connecting', peers: [] } } };
  const listeners = new Set();
  const api = { ...session, getState: () => state, subscribe: callback => { listeners.add(callback); callback(state); return () => listeners.delete(callback); },
    getModelDownload: vi.fn(async id => ({ id, sizeBytes: 123000000 })), downloadLocalModel: vi.fn(async () => {}),
    cancelModelDownload: vi.fn(), connect: vi.fn(async () => {}) };
  const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace(); document.body.append(root);
  const dispose = bindConversationWorkspace(root, api, { viewState: { ...(fresh ? {} : { privacy: openPolicy }), ...viewState } }); cleanups.push(() => { dispose(); root.remove(); });
  return { root, api, find: selector => root.querySelector(selector),
    publish(update) { state = { ...state, ...update }; listeners.forEach(callback => callback(state)); }, state: () => state };
}
it('asks once where to run before a first visitor prompt can reach a network provider', async () => {
  const f = fixture({ fresh: true });
  const model = { ...f.state().models[0], availability: 'ready', networkAvailability: 'ready',
    providerIds: ['peer'], reachableProviderIds: ['peer'] };
  f.publish({ ...observedDiscovery, models: [model] });
  const send = f.find('[data-composer-send]');
  // Send is available, but nothing is sent until the visitor picks a computer in the one sheet.
  expect(send.disabled).toBe(false);
  f.find('[data-composer-input]').value = 'First question';
  f.find('[data-composer-form]').dispatchEvent(new Event('submit', { cancelable: true }));
  expect(f.find('[data-model-picker]').open).toBe(true);
  expect(f.find('[data-picker-title]').textContent).toBe('Where should this run?');
  expect(f.find('[data-execution-choice=local]').getAttribute('aria-pressed')).toBe('true');
  expect(f.api.connect).not.toHaveBeenCalled();
  f.find('[data-execution-choice=network]').click();
  await vi.waitFor(() => expect(f.find('[data-execution-choice=network]').getAttribute('aria-pressed')).toBe('true'));
});

it('bounds the host discovery window even when signaling never connects, without acquiring anything', async () => {
  vi.useFakeTimers();
  const session = createChatSession({ storage: null, service: createChatTestService(), swarm: { getState: () => ({ connecting: true }) } });
  expect(session.getState().peerDiscoveryTimedOut).toBe(false);
  await vi.advanceTimersByTimeAsync(8000);
  expect(session.getState().peerDiscoveryTimedOut).toBe(true); expect(session.getState().acquisition.phase).toBe('idle');
  await session.close();
});
it('distinguishes discovery in progress, a transport interruption and observed absence of providers', async () => {
  const f = fixture();
  const status = f.find('[data-model-status]'), retry = f.find('[data-retry-connection]');
  const alternative = f.find('[data-review-shared-model]');
  expect(status.textContent).toMatch(/looking|finding|searching/i);
  expect(alternative.hidden).toBe(true);
  f.publish({ discoveryPhase: 'interrupted', peerDiscoveryTimedOut: true,
    network: { consumer: { connectionState: 'retrying', peers: [] } } });
  expect(status.textContent).toMatch(/interrupt|connection|connect to/i);
  expect(retry.hidden).toBe(false);
  expect(alternative.hidden).toBe(true);
  retry.click();
  await vi.waitFor(() => expect(f.api.connect).toHaveBeenCalledOnce());
  f.publish(observedDiscovery);
  expect(status.textContent).toMatch(/no .*computer|no .*provider/i);
  expect(status.textContent).not.toMatch(/choose a shared model/i);
  expect(alternative.hidden).toBe(true);
  f.publish({ network: { ...observedDiscovery.network, connectionFailure: { peerId: 'departed-peer' } } });
  expect(status.textContent).toContain('A peer connection failed. No eligible computer found');
  expect(alternative.hidden).toBe(true);
});

it('only offers a switch for a reachable shared provider with capacity', () => {
  const [requested, other] = CANONICAL_CHAT_MODELS;
  const f = fixture({ viewState: { chosenModel: requested } });
  const candidate = { ...other, availability: 'ready', networkAvailability: 'ready',
    providerIds: ['peer'], reachableProviderIds: [] };
  const publish = changes => f.publish({ ...observedDiscovery,
    models: [{ ...requested, availability: 'unavailable' }, { ...candidate, ...changes }] });
  const alternative = f.find('[data-review-shared-model]');
  publish({});
  expect(alternative.hidden).toBe(true);
  publish({ availability: 'busy', networkAvailability: 'busy', reachableProviderIds: ['peer'] });
  expect(alternative.hidden).toBe(true);
  publish({ reachableProviderIds: ['peer'] });
  expect(alternative.hidden).toBe(false);
  expect(alternative.dataset.selectionId).toBe(other.id);
  expect(f.find('[data-active-model-select]').value).toBe(requested.id);
  publish({});
  expect(alternative.hidden).toBe(true);
});

it('names the pre-send destination as the selected model moves between local and public execution', () => {
  const f = fixture(), [model] = f.state().models;
  const source = f.find('[data-composer-model-source]'), note = f.find('[data-prompt-disclosure]');
  const switcher = f.find('[data-open-model]');
  expect(f.find('[data-composer-send]').getAttribute('aria-describedby')).toBe(note.id);
  expect(note.hidden).toBe(false);
  expect(note.textContent).toContain('A network provider could read your prompt');
  // One selector, named for what it does; the disclosure lives in the Answer on sheet beside the choice.
  expect(switcher.getAttribute('aria-label')).toMatch(/^Answer on /);
  expect(switcher.getAttribute('aria-label')).toContain(model.name);
  expect(f.find('[data-model-picker]').contains(note)).toBe(true);
  f.publish({ ...observedDiscovery, models: [{
    ...model, localCached: true, availability: 'cached', networkAvailability: 'unavailable'
  }] });
  expect(source.textContent).toMatch(/this device/i);
  expect(note.textContent).toBe('Nothing leaves this device.');
  f.publish({ models: [{
    ...model, localCached: false, availability: 'ready', networkAvailability: 'ready',
    providerIds: ['public-peer'], reachableProviderIds: ['public-peer']
  }] });
  expect(source.textContent).toBe('Contributors');
  expect(note.hidden).toBe(false);
  expect(note.textContent).toBe('The answering computer can read your prompt.');
});

it.each([
  ['local execution', { executionLocation: 'local' }],
  ['named recipients', { privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: ['private-device'] } }) }]
])('keeps an unrelated public provider out of recovery for %s', (_name, policy) => {
  const [requested, other] = CANONICAL_CHAT_MODELS;
  const f = fixture({ viewState: { chosenModel: requested, ...policy } });
  f.publish({ ...observedDiscovery, models: [
    { ...requested, availability: 'unavailable' },
    { ...other, availability: 'ready', networkAvailability: 'ready', providerIds: ['public'], reachableProviderIds: ['public'] }
  ] });
  expect(f.find('[data-review-shared-model]').hidden).toBe(true);
});

it('never turns Send into download or queues an automatic answer, even with an old automatic preference', async () => {
  const f = fixture({ automatic: true }), model = CANONICAL_CHAT_MODELS[0];
  f.api.send = vi.fn(() => Object.assign(Promise.resolve(), { admitted: Promise.resolve() }));
  f.publish(observedDiscovery);
  expect(f.find('[data-auto-download-toggle]')).toBeNull();
  expect(f.find('[data-composer-send]').disabled).toBe(true);
  f.find('[data-composer-input]').value = 'Hello'; f.find('[data-composer-form]').requestSubmit();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled(); expect(f.api.send).not.toHaveBeenCalled();
  f.publish({ models: f.state().models.map(entry => entry.id === model.id ? { ...entry, availability: 'cached', localCached: true } : entry) });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.api.send).not.toHaveBeenCalled(); expect(f.find('[data-composer-input]').value).toBe('Hello');
});
it('cancels an explicitly confirmed download while preserving the unsent draft', async () => {
  const f = fixture({ automatic: true }), model = CANONICAL_CHAT_MODELS[0]; f.api.send = vi.fn();
  f.publish(observedDiscovery); f.find('[data-composer-input]').value = 'Hello';
  f.find('[data-download-local]').click(); await vi.waitFor(() => expect(f.find('[data-download-confirm]').disabled).toBe(false));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled(); f.find('[data-download-confirm]').click();
  await vi.waitFor(() => expect(f.api.downloadLocalModel).toHaveBeenCalledWith(model.id, true));
  f.publish({ acquisition: { phase: 'downloading', modelId: model.id, progress: { message: 'Downloading model files.', receivedBytes: 1, totalBytes: 2 } } });
  f.find('[data-cancel-download]').click(); expect(f.api.cancelModelDownload).toHaveBeenCalledOnce();
  f.publish({ acquisition: { phase: 'cancelled', modelId: model.id, error: 'Download cancelled.', progress: null } });
  expect(f.find('[data-composer-input]').value).toBe('Hello'); expect(f.find('[data-composer-send]').disabled).toBe(true);
  f.find('[data-composer-form]').requestSubmit(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.api.downloadLocalModel).toHaveBeenCalledOnce(); expect(f.api.send).not.toHaveBeenCalled();
  expect(f.find('[data-download-local]').textContent).toBe('Retry download');
});
it('offers explicit local download after no usable peers and reuses the existing size-and-consent dialog', async () => {
  const f = fixture(); expect(f.find('[data-download-local]').hidden).toBe(true);
  f.publish(observedDiscovery);
  expect(f.find('[data-download-local]').hidden).toBe(false); expect(f.find('[data-retry-connection]').hidden).toBe(false);
  f.find('[data-download-local]').click();
  await vi.waitFor(() => expect(f.find('[data-download-confirm]').disabled).toBe(false));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled();
  expect(f.find('[data-download-title]').textContent).toBe('Download ' + CANONICAL_CHAT_MODELS[0].name);
  expect(f.find('[data-download-size]').textContent).toBe('123 MB download');
  f.find('[data-download-confirm]').click(); f.find('[data-download-confirm]').click();
  await vi.waitFor(() => expect(f.api.downloadLocalModel).toHaveBeenCalledOnce());
  expect(f.api.downloadLocalModel).toHaveBeenCalledWith(CANONICAL_CHAT_MODELS[0].id, true);
});
it('does not let a perpetually preparing unusable peer hide the local fallback', () => {
  const f = fixture(); f.publish({ ...observedDiscovery, models: [{ ...f.state().models[0], availability: 'loading' }] });
  expect(f.find('[data-download-local]').hidden).toBe(false);
  expect(f.find('[data-model-status]').textContent).toBe('Model preparing…');
  expect(f.find('[data-composer-send]').disabled).toBe(true);
  expect(f.find('[data-acquisition-status]').hidden).toBe(true);
});
it('keeps downloads cancellable when a usable peer arrives and never fabricates unknown totals', () => {
  const f = fixture();
  f.publish({ acquisition: { phase: 'downloading', progress: { message: 'Downloading model files.', receivedBytes: 20, totalBytes: null } } });
  expect(f.find('[data-acquisition-progress]').hasAttribute('value')).toBe(false);
  const ready = { ...f.state().models[0], availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] };
  f.publish({ models: [ready], defaultModels: { auto: ready }, defaultModel: ready });
  expect(f.find('[data-composer-send]').disabled).toBe(false); expect(f.find('[data-cancel-download]').hidden).toBe(false);
  const status = f.find('[data-acquisition-status]');
  expect(status.textContent).toContain('Network model ready.');
  f.publish({ models: [{ ...ready, availability: 'busy', networkAvailability: 'busy', reachableProviderIds: [] }] });
  expect(status.textContent).toBe('Downloading model files.');
  f.publish({ models: [{ ...ready, availability: 'cached', localCached: true, networkAvailability: 'unavailable', reachableProviderIds: [] }] });
  expect(status.textContent).toBe('Downloading model files.');
  f.find('[data-cancel-download]').click(); expect(f.api.cancelModelDownload).toHaveBeenCalledOnce();
});
it('keeps capability failures actionable and checks failed metadata again without starting a download', async () => {
  const f = fixture(); f.publish({ ...observedDiscovery, localDownloadIssue: 'This browser needs WebGPU.' });
  expect(f.find('[data-download-local]').hidden).toBe(true);
  expect(f.find('[data-model-status]').textContent).toContain('WebGPU');
  expect(f.find('[data-acquisition-status]').hidden).toBe(true);
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
