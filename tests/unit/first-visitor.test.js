import { createExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { openConversation } from '../fixtures/conversation-view.js';
import { AUTO_DOWNLOAD_STORAGE_KEY } from '../../apps/poolday/ui/pool-home/auto-download.js';
const cleanups = [];
const observedDiscovery = {
  discoveryPhase: 'observed', peerDiscoveryTimedOut: true,
  network: { consumer: { connectionState: 'connected', peers: [] } }
};
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers(); localStorage.removeItem(AUTO_DOWNLOAD_STORAGE_KEY); });
// Legacy automatic-download preferences cannot bypass the explicit size-and-consent path.
const openPolicy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
// The first-visit decisions of the conversation controller (host/decisions/conversation-controller.js), which the
// React composer and "Answer on" sheet render.
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
  const view = openConversation(api, { viewState: { ...(fresh ? {} : { privacy: openPolicy }), ...viewState } });
  cleanups.push(() => view.dispose());
  return { api, view, c: view.controller,
    publish(update) { state = { ...state, ...update }; listeners.forEach(callback => callback(state)); }, state: () => state };
}
it('names the public computer and model a first visitor would send to, and asks nothing on Send', async () => {
  const f = fixture({ fresh: true });
  const model = { ...f.state().models[0], availability: 'ready', networkAvailability: 'ready',
    providerIds: ['peer'], reachableProviderIds: ['peer'] };
  f.publish({ ...observedDiscovery, models: [model] });
  // Before Send the composer says where the question goes and who can read it.
  expect(f.view.composer().send.disabled).toBe(false);
  expect(f.view.composer().chip.source).toBe('Contributors');
  expect(f.view.composer().chip.selectionId).toBe(model.id);
  expect(f.view.composer().disclosure).toBe('The answering computer can read your prompt.');
  expect(f.view.composer().nextAction).toBeNull();
  // The sheet is the optional change of computer or model: opened from its control, it starts where the composer is.
  f.c.openSheet();
  expect(f.view.sheet().title).toBe('Answer on');
  expect(f.view.checkedComputer()).toBe('network');
  expect(f.view.sheet().outcome.label).toBe('Answer with contributors');
  // This device stays one tap away, as a download the visitor reviews.
  f.c.pickComputer('local');
  await vi.waitFor(() => expect(f.view.checkedComputer()).toBe('local'));
  expect(f.view.sheet().outcome.label).toBe(`Download ${model.name}`);
  f.c.closeSheet();
  f.view.send('First question');
  expect(f.view.sheet().open).toBe(false);
});
it('waits calmly when a first visitor opens the sheet before discovery settles, then offers the model contributors serve', async () => {
  const f = fixture({ fresh: true });
  const [first, second] = CANONICAL_CHAT_MODELS;
  f.publish({ models: [first, second] });
  const chosen = f.view.composer().chip.selectionId;
  const served = [first, second].find(model => (model.selectionId || model.id) !== chosen);
  f.c.openSheet();
  f.c.pickComputer('network');
  await vi.waitFor(() => expect(f.view.checkedComputer()).toBe('network'));
  // No contributor is known yet, and none is known absent: no download offer and no "No contributor serves" verdict.
  expect(f.view.sheet().outcome.issue).toMatch(/^Finding computers/);
  expect(f.view.sheet().outcome.label).toBe('Answer with contributors');
  expect(f.view.sheet().outcome.disabled).toBe(true);
  // A contributor appears serving a different model: the sheet follows the tapped computer to it.
  f.publish({ models: [first, second].map(model => model === served ? { ...model, availability: 'ready', networkAvailability: 'ready',
    providerIds: ['peer'], reachableProviderIds: ['peer'] } : model) });
  expect(f.view.sheet().selectedKey).toBe(served.selectionId || served.id);
  expect(f.view.sheet().outcome.label).toBe('Answer with contributors');
  expect(f.view.sheet().outcome.disabled).toBe(false);
  expect(f.view.sheet().outcome.issue).toBe('');
});
it('offers Send, not a download, when the first advertisement is also what settles discovery', async () => {
  const f = fixture({ fresh: true });
  const [first, second] = CANONICAL_CHAT_MODELS;
  f.publish({ models: [first, second] });
  const chosen = f.view.composer().chip.selectionId;
  const served = [first, second].find(model => (model.selectionId || model.id) !== chosen);
  f.c.openSheet();
  f.c.pickComputer('network');
  await vi.waitFor(() => expect(f.view.checkedComputer()).toBe('network'));
  expect(f.view.sheet().outcome.issue).toMatch(/^Finding computers/);
  // The session settles discovery on the same update that brings the first served model (chat-session.js).
  f.publish({ ...observedDiscovery, models: [first, second].map(model => model === served ? { ...model, availability: 'ready',
    networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] } : model) });
  expect(f.view.sheet().selectedKey).toBe(served.selectionId || served.id);
  expect(f.view.sheet().outcome.label).toBe('Answer with contributors');
  expect(f.view.sheet().outcome.disabled).toBe(false);
});
it('offers the download only once discovery has settled with no contributor for the model', async () => {
  const f = fixture({ fresh: true });
  f.c.openSheet();
  f.c.pickComputer('network');
  await vi.waitFor(() => expect(f.view.checkedComputer()).toBe('network'));
  expect(f.view.sheet().outcome.disabled).toBe(true);
  f.publish(observedDiscovery);
  expect(f.view.sheet().outcome.issue).toMatch(/^No contributor serves this model now/);
  expect(f.view.sheet().outcome.label).toMatch(/^Download /);
  expect(f.view.sheet().outcome.disabled).toBe(false);
});
it('moves a first visitor to a public computer when one appears instead of reporting a dead end', () => {
  const f = fixture({ fresh: true }), status = () => f.view.composer().status.text;
  f.publish(observedDiscovery);
  // Nobody answers yet: the composer says so on the contributor route, and does not offer this device as ready.
  expect(status()).toBe('No eligible computer found for this model.');
  expect(f.view.composer().chip.source).toBe('Contributors');
  expect(f.view.composer().nextAction).toBe('retry');
  f.publish({ models: [{ ...f.state().models[0], availability: 'ready', networkAvailability: 'ready',
    providerIds: ['peer'], reachableProviderIds: ['peer'] }] });
  expect(status()).toBe('');
  expect(f.view.composer().chip.source).toBe('Contributors');
  expect(f.view.composer().disclosure).toBe('The answering computer can read your prompt.');
  // The Answer on sheet opened from its own control does not say Send: nothing is waiting to be sent.
  f.c.openSheet();
  expect(f.view.sheet().outcome.label).not.toMatch(/^Send/);
});

it('names no model before discovery settles, then the smallest one a contributor serves', () => {
  const f = fixture({ fresh: true });
  const [small, medium] = CANONICAL_CHAT_MODELS;
  const chip = () => [f.view.composer().chip.source, f.view.composer().chip.name];
  // Nothing can answer yet: no "This device · 2B" that may not run anywhere.
  expect(chip()).toEqual(['', 'Finding computers…']);
  expect(f.view.composer().chip.label).toBe('Answer on, Finding computers');
  const served = model => ({ ...model, availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] });
  f.publish({ ...observedDiscovery, models: [served(small), served(medium)] });
  expect(f.view.composer().chip.selectionId).toBe(small.id);
  expect(chip()).toEqual(['Contributors', small.name]);
});
it('starts a first visitor on a model contributors serve, on their computers', () => {
  const f = fixture({ fresh: true }), status = () => f.view.composer().status.text;
  const [first, second] = CANONICAL_CHAT_MODELS;
  f.publish({ ...observedDiscovery, models: [first, second] });
  const starting = f.view.composer().chip.selectionId;
  // Discovery settled on the first advertisement, for the model this device would not start with.
  f.publish({ models: [first, second].map(model => (model.selectionId || model.id) === starting ? model
    : { ...model, availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] }) });
  // A model contributors serve and this device could download is where a first visitor starts.
  const served = [first, second].find(model => (model.selectionId || model.id) !== starting);
  expect(f.view.composer().chip.selectionId).toBe(served.selectionId || served.id);
  expect(f.view.composer().chip.source).toBe('Contributors');
  expect(status()).toBe('');
  expect(f.view.composer().nextAction).toBeNull();
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
  const status = () => f.view.composer().status.text, next = () => f.view.composer().nextAction;
  expect(status()).toMatch(/looking|finding|searching/i);
  expect(next()).not.toBe('review-shared');
  f.publish({ discoveryPhase: 'interrupted', peerDiscoveryTimedOut: true,
    network: { consumer: { connectionState: 'retrying', peers: [] } } });
  expect(status()).toMatch(/interrupt|connection|connect to/i);
  expect(next()).toBe('retry');
  f.c.retryConnection();
  await vi.waitFor(() => expect(f.api.connect).toHaveBeenCalledOnce());
  f.publish(observedDiscovery);
  expect(status()).toMatch(/no .*computer|no .*provider/i);
  expect(status()).not.toMatch(/choose a shared model/i);
  expect(next()).not.toBe('review-shared');
  f.publish({ network: { ...observedDiscovery.network, connectionFailure: { peerId: 'departed-peer' } } });
  expect(status()).toContain('A peer connection failed. No eligible computer found');
  expect(next()).not.toBe('review-shared');
});

it('only offers a switch for a reachable shared provider with capacity', () => {
  const [requested, other] = CANONICAL_CHAT_MODELS;
  const f = fixture({ viewState: { chosenModel: requested } });
  const candidate = { ...other, availability: 'ready', networkAvailability: 'ready',
    providerIds: ['peer'], reachableProviderIds: [] };
  const publish = changes => f.publish({ ...observedDiscovery,
    models: [{ ...requested, availability: 'unavailable' }, { ...candidate, ...changes }] });
  const offered = () => f.view.composer().nextAction === 'review-shared';
  publish({});
  expect(offered()).toBe(false);
  publish({ availability: 'busy', networkAvailability: 'busy', reachableProviderIds: ['peer'] });
  expect(offered()).toBe(false);
  publish({ reachableProviderIds: ['peer'] });
  expect(offered()).toBe(true);
  expect(f.view.composer().nextLabels.reviewShared).toBe(`Review ${other.name}`);
  expect(f.view.composer().chip.selectionId).toBe(requested.id);
  // Reviewing opens Answer on with that model staged on contributors.
  f.c.reviewSharedModel();
  expect(f.view.sheet().selectedKey).toBe(other.id);
  expect(f.view.checkedComputer()).toBe('network');
  f.c.closeSheet();
  publish({});
  expect(offered()).toBe(false);
});

it('names the pre-send destination as the selected model moves between local and public execution', () => {
  const f = fixture(), [model] = f.state().models;
  const source = () => f.view.composer().chip.source, note = () => f.view.composer().disclosure;
  expect(note()).toContain('A network provider could read your prompt');
  // One selector, named for what it does.
  expect(f.view.composer().chip.label).toMatch(/^Answer on /);
  expect(f.view.composer().chip.label).toContain(model.name);
  f.publish({ ...observedDiscovery, models: [{
    ...model, localCached: true, availability: 'cached', networkAvailability: 'unavailable'
  }] });
  expect(source()).toMatch(/this device/i);
  expect(note()).toBe('Nothing leaves this device.');
  f.publish({ models: [{
    ...model, localCached: false, availability: 'ready', networkAvailability: 'ready',
    providerIds: ['public-peer'], reachableProviderIds: ['public-peer']
  }] });
  expect(source()).toBe('Contributors');
  expect(note()).toBe('The answering computer can read your prompt.');
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
  expect(f.view.composer().nextAction).not.toBe('review-shared');
});

it('never turns Send into download or queues an automatic answer, even with an old automatic preference', async () => {
  const f = fixture({ automatic: true }), model = CANONICAL_CHAT_MODELS[0];
  f.api.send = vi.fn(() => Object.assign(Promise.resolve(), { admitted: Promise.resolve() }));
  f.publish(observedDiscovery);
  expect(f.view.composer().send.disabled).toBe(true);
  f.view.send('Hello');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled(); expect(f.api.send).not.toHaveBeenCalled();
  f.publish({ models: f.state().models.map(entry => entry.id === model.id ? { ...entry, availability: 'cached', localCached: true } : entry) });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.api.send).not.toHaveBeenCalled(); expect(f.view.composer().draft).toBe('Hello');
});
it('cancels an explicitly confirmed download while preserving the unsent draft', async () => {
  const f = fixture({ automatic: true }), model = CANONICAL_CHAT_MODELS[0]; f.api.send = vi.fn();
  f.publish(observedDiscovery); f.c.setDraft('Hello');
  expect(f.view.composer().optionalAction).toBe('download-local');
  f.c.downloadLocal(); await vi.waitFor(() => expect(f.view.snapshot().download?.ready).toBe(true));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled(); f.c.confirmDownload();
  await vi.waitFor(() => expect(f.api.downloadLocalModel).toHaveBeenCalledWith(model.id, true));
  f.publish({ acquisition: { phase: 'downloading', modelId: model.id, progress: { message: 'Downloading model files.', receivedBytes: 1, totalBytes: 2 } } });
  expect(f.view.composer().nextAction).toBe('cancel-download');
  f.c.cancelDownload(); expect(f.api.cancelModelDownload).toHaveBeenCalledOnce();
  f.publish({ acquisition: { phase: 'cancelled', modelId: model.id, error: 'Download cancelled.', progress: null } });
  expect(f.view.composer().draft).toBe('Hello'); expect(f.view.composer().send.disabled).toBe(true);
  f.c.send(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.api.downloadLocalModel).toHaveBeenCalledOnce(); expect(f.api.send).not.toHaveBeenCalled();
  expect(f.view.composer().nextLabels.downloadLocal).toBe('Retry download');
});
it('offers local download only as an optional recovery after no usable peers, through the size-and-consent dialog', async () => {
  const f = fixture(); expect(f.view.composer().nextAction).not.toBe('download-local');
  expect(f.view.composer().optionalAction).toBeNull();
  f.publish(observedDiscovery);
  // The contributor route's next action is searching again; the download is beside it, never in its place.
  expect(f.view.composer().nextAction).toBe('retry');
  expect(f.view.composer().optionalAction).toBe('download-local');
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled();
  f.c.downloadLocal();
  await vi.waitFor(() => expect(f.view.snapshot().download?.ready).toBe(true));
  expect(f.api.downloadLocalModel).not.toHaveBeenCalled();
  expect(f.view.snapshot().download.title).toBe('Download ' + CANONICAL_CHAT_MODELS[0].name);
  expect(f.view.snapshot().download.size).toBe('123 MB download');
  f.c.confirmDownload(); f.c.confirmDownload();
  await vi.waitFor(() => expect(f.api.downloadLocalModel).toHaveBeenCalledOnce());
  expect(f.api.downloadLocalModel).toHaveBeenCalledWith(CANONICAL_CHAT_MODELS[0].id, true);
});
it('does not let a perpetually preparing unusable peer hide the local fallback', () => {
  const f = fixture(); f.publish({ ...observedDiscovery, models: [{ ...f.state().models[0], availability: 'loading' }] });
  expect(f.view.composer().optionalAction).toBe('download-local');
  expect(f.view.composer().status.text).toBe('Model preparing…');
  expect(f.view.composer().send.disabled).toBe(true);
  expect(f.view.composer().acquisition.text).toBe('');
});
it('keeps downloads cancellable when a usable peer arrives and never fabricates unknown totals', () => {
  const f = fixture();
  f.publish({ acquisition: { phase: 'downloading', progress: { message: 'Downloading model files.', receivedBytes: 20, totalBytes: null } } });
  expect(f.view.composer().acquisition.progress).toEqual({ value: null, max: null });
  const ready = { ...f.state().models[0], availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] };
  f.publish({ models: [ready], defaultModels: { auto: ready }, defaultModel: ready });
  expect(f.view.composer().send.disabled).toBe(false); expect(f.view.composer().nextAction).toBe('cancel-download');
  const status = () => f.view.composer().acquisition.text;
  expect(status()).toContain('Network model ready.');
  f.publish({ models: [{ ...ready, availability: 'busy', networkAvailability: 'busy', reachableProviderIds: [] }] });
  expect(status()).toBe('Downloading model files.');
  f.publish({ models: [{ ...ready, availability: 'cached', localCached: true, networkAvailability: 'unavailable', reachableProviderIds: [] }] });
  expect(status()).toBe('Downloading model files.');
  f.c.cancelDownload(); expect(f.api.cancelModelDownload).toHaveBeenCalledOnce();
});
it('keeps capability failures actionable and checks failed metadata again without starting a download', async () => {
  const f = fixture(); f.publish({ ...observedDiscovery, localDownloadIssue: 'This browser needs WebGPU.' });
  expect(f.view.composer().nextAction).not.toBe('download-local');
  expect(f.view.composer().status.text).toContain('WebGPU');
  expect(f.view.composer().acquisition.text).toBe('');
  f.publish({ localDownloadIssue: null }); f.api.getModelDownload.mockRejectedValueOnce(Error('Network unavailable'));
  f.c.downloadLocal();
  await vi.waitFor(() => expect(f.view.snapshot().download?.retry).toBe(true));
  expect(f.view.snapshot().download.ready).toBe(false); f.c.retryDownloadCheck();
  await vi.waitFor(() => expect(f.view.snapshot().download?.ready).toBe(true));
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

// The owner's contradiction: a fresh visitor must never see a computer and a model that disagree.
for (const [preset, viewState, expected] of [
  ['nothing chosen (a fresh visitor)', null, { computer: 'network', group: 'shared', action: /^Answer with contributors$/, chip: 'Contributors' }],
  ['Standard', { privacy: openPolicy }, { computer: 'network', group: 'shared', action: /^Answer with contributors$/, chip: 'Contributors' }]
]) {
  it(`starts a fresh draft with a runnable computer and model under ${preset}`, () => {
    const f = viewState ? fixture({ viewState }) : fixture({ fresh: true });
    const model = { ...f.state().models[0], availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] };
    f.publish({ ...observedDiscovery, models: [model], defaultModel: model });
    f.c.openSheet();
    expect(f.view.checkedComputer()).toBe(expected.computer);
    const group = f.view.sheet().sections.find(section => section.rows.some(row => row.checked));
    expect(group.id).toBe(expected.group);
    expect(f.view.sheet().outcome.label).toMatch(expected.action);
    expect(f.view.sheet().outcome.disabled).toBe(false);
    expect(f.view.composer().chip.source).toBe(expected.chip);
  });
}
