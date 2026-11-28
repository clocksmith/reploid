// Critical user journey FIRST-02 (docs/critical-user-journeys.md, "The public-page bar"): type and send, nothing else. These are
// the decisions behind it in the conversation controller (apps/poolday/host/decisions/conversation-controller.js):
// which computer and model a visitor who chose nothing gets, that the composer names the model the request is
// created with, that the automatic choice follows availability, and that a model the person picked is never
// replaced for them.
import { afterEach, expect, it, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { openConversation } from '../fixtures/conversation-view.js';
import { ANSWER_CHOICE_STORAGE_KEY } from '../../apps/poolday/ui/pool-home/answer-choice.js';
import { selectAvailableChatModel } from '../../apps/poolday/host/chat-view.js';
import profile from '../../apps/poolday/config/work-profile.json' with { type: 'json' };

const cleanups = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const observed = { discoveryPhase: 'observed', peerDiscoveryTimedOut: true, network: { consumer: { connectionState: 'connected', peers: [] } } };
const key = model => model.selectionId || model.id;
const served = model => ({ ...model, availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] });
const memory = (entries = {}) => {
  const saved = new Map(Object.entries(entries));
  return { getItem: name => saved.get(name) ?? null, setItem: (name, value) => saved.set(name, String(value)), saved };
};
const [SMALL, MEDIUM] = CANONICAL_CHAT_MODELS;

/** The host's real chat session with discovery and capacity published by the test. `defaultModels` is derived by the
 * session's own selection (chat-view.js selectAvailableChatModel over the profile's preference order), so the
 * controller reads what the page reads. */
function fixture({ storage = null, session: reuse = null, draft = null } = {}) {
  const session = reuse ?? createChatSession({ storage: null, service: createChatTestService(), models: [SMALL, MEDIUM] });
  if (!reuse) cleanups.push(() => session.close());
  const derive = state => {
    const defaultModels = Object.fromEntries(['auto', 'local', 'network'].map(location =>
      [location, selectAvailableChatModel(state.models, profile.chatModelPreference, location)]));
    return { ...state, defaultModels, defaultModel: defaultModels.auto || state.models.find(model => model.id === profile.defaultModelId) || state.models[0] || null };
  };
  let state = derive({ ...session.getState(), localDownloadIssue: null, peerDiscoveryTimedOut: false, discoveryPhase: 'searching',
    network: { connecting: true, consumer: { connectionState: 'connecting', peers: [] } } });
  const listeners = new Set(), created = [], sent = [];
  const api = { ...session, getState: () => state,
    subscribe: callback => { listeners.add(callback); callback(state); return () => listeners.delete(callback); },
    getModelDownload: vi.fn(async id => ({ id, sizeBytes: 123000000 })), downloadLocalModel: vi.fn(async () => {}), connect: vi.fn(async () => {}),
    // What Send asks the session for. The session is not asked to run anything: no provider exists here. The new
    // thread is selected as the session selects it.
    createThread(options) {
      created.push(options);
      const thread = { id: 'thread-' + created.length, model: options.model, privacy: options.privacy, messages: [], attempts: [], grants: [],
        permissions: { sharingScope: options.sharingScope, executionLocation: options.executionLocation } };
      publish({ threads: [...(state.threads || []), thread], selectedId: thread.id, activeThread: thread });
      return thread.id;
    },
    select: async id => publish({ selectedId: id, activeThread: (state.threads || []).find(thread => thread.id === id) ?? null }),
    send(threadId, content) { sent.push({ threadId, content }); const done = Promise.resolve({ status: 'completed' }); done.admitted = Promise.resolve(); return done; },
    // A draft left in the composer by an earlier visit, as the session keeps it.
    getDraft: id => id == null && draft ? { text: draft, files: [] } : undefined, saveDraft: async () => {} };
  function publish(update) { state = derive({ ...state, ...update }); listeners.forEach(callback => callback(state)); }
  const view = openConversation(api, { storage, viewState: {} });
  cleanups.push(() => view.dispose());
  return { api, view, c: view.controller, created, sent, session, publish, state: () => state };
}
const chip = f => f.view.composer().chip;

it('sends a first visitor\'s question to the model the composer names, with no sheet and no stored pick', async () => {
  const storage = memory(), f = fixture({ storage });
  f.publish({ ...observed, models: [SMALL, served(MEDIUM)] });
  // Before Send: the computer, the model and who can read it are stated, and nothing asks the visitor to choose.
  expect([chip(f).source, chip(f).name, chip(f).availability]).toEqual(['Contributors', MEDIUM.name, 'ready']);
  expect(f.view.composer().disclosure).toBe('The answering computer can read your prompt.');
  expect(f.view.composer().privacy.caption).toBe('Standard');
  expect(f.view.composer().status.text).not.toMatch(/credit|cost/i);
  expect(f.view.composer().nextAction).toBeNull();
  f.view.send('First question');
  expect(f.view.sheet().open).toBe(false);
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(f.created).toHaveLength(1);
  expect(key(f.created[0].model)).toBe(chip(f).selectionId);
  expect(f.created[0].model.identity).toBe(MEDIUM.identity);
  expect(f.created[0]).toMatchObject({ executionLocation: 'network', sharingScope: 'mesh',
    privacy: { placement: 'network-allowed', recipients: { kind: 'open' }, computation: 'plaintext' } });
  // The page's own choice is not recorded as the visitor's.
  expect(storage.saved.has(ANSWER_CHOICE_STORAGE_KEY)).toBe(false);
});

it('holds a Send pressed while computers are being found and sends it to the model that turns up', async () => {
  const f = fixture();
  f.c.setDraft('Typed before discovery settled');
  // No model is named while none is known, and nothing is pinned to the draft.
  expect([chip(f).source, chip(f).name]).toEqual(['', 'Finding computers…']);
  expect(f.view.composer().send.disabled).toBe(false);
  f.c.send();
  expect(f.view.sheet().open).toBe(false);
  expect(f.view.composer().status.text).toBe('Finding computers…');
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  expect(f.created).toHaveLength(0);
  f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(SMALL));
  expect(f.sent[0].content).toBe('Typed before discovery settled');
});

it('keeps a first visitor on contributors when nobody can answer, says nothing was sent, and never sends the held question elsewhere', async () => {
  // The held Send outlives the discovery wait: it ends when its intent expires, 30 s after the press.
  vi.useFakeTimers({ now: 1_000_000 });
  const f = fixture();
  f.view.send('Typed before discovery settled');
  f.publish(observed);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  expect(chip(f).source).toBe('Contributors');
  await vi.advanceTimersByTimeAsync(30_000);
  vi.useRealTimers();
  expect(f.created).toHaveLength(0);
  // The route stays the one the composer named; it does not turn into this device.
  expect(chip(f).source).toBe('Contributors');
  expect(f.view.composer().status.text).toBe('No computer answered in 30 seconds. Nothing was sent.');
  expect(f.view.composer().route).toMatchObject({ destination: 'contributors', status: 'unavailable', send: 'none' });
  expect(f.view.composer().draft).toBe('Typed before discovery settled');
  // A second press sends nothing and opens nothing.
  expect(f.view.composer().send.disabled).toBe(true);
  f.c.send();
  expect(f.view.sheet().open).toBe(false);
  expect(f.created).toHaveLength(0);
  // Editing the kept text clears the notice.
  f.c.setDraft('Typed before discovery settled, again');
  expect(f.view.composer().status.text).toBe('');
});

it('moves the automatic choice when its computer leaves, also under a typed draft, and back to none when all leave', () => {
  const f = fixture();
  f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  expect(chip(f).selectionId).toBe(key(SMALL));
  f.c.setDraft('Half a question');
  f.publish({ models: [SMALL, served(MEDIUM)] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(MEDIUM), 'ready']);
  // A second computer for the first model does not move a draft off a model that is still served.
  f.publish({ models: [served(SMALL), served(MEDIUM)] });
  expect(chip(f).selectionId).toBe(key(MEDIUM));
  f.publish({ models: [SMALL, MEDIUM] });
  // With no computer left the route is still contributors, and Send says nothing can answer.
  expect(chip(f).source).toBe('Contributors');
  expect(chip(f).availability).toBe('unavailable');
  expect(f.view.composer().send.disabled).toBe(true);
});

it('replaces a typed automatic draft’s preparing model with a reachable ready model even without a session default', () => {
  const f = fixture();
  f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  f.c.setDraft('Keep this exact draft');
  const preparing = { ...SMALL, availability: 'loading', networkAvailability: 'loading', reachableProviderIds: [] };
  f.publish({ defaultModels: {}, defaultModel: preparing, models: [preparing, served(MEDIUM)] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(MEDIUM), 'ready']);
  expect(f.view.composer()).toMatchObject({ draft: 'Keep this exact draft', status: { text: '' }, nextAction: null });
  expect(f.sent).toHaveLength(0);
});

it('uses a ready contributor rather than waiting for the automatic draft model when it becomes busy', () => {
  const f = fixture();
  f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  f.c.setDraft('Keep this exact draft');
  f.publish({ models: [{ ...served(SMALL), availability: 'busy', networkAvailability: 'busy' }, served(MEDIUM)] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(MEDIUM), 'ready']);
  expect(f.view.composer().draft).toBe('Keep this exact draft');
  expect(f.sent).toHaveLength(0);
});

it('does not settle on whichever computer advertised first: during the discovery wait a typed draft follows the preferred model and settles as soon as the top model is ready', async () => {
  const f = fixture();
  // The first advertisement settles discovery's phase on a lower-ranked model while the bounded wait is still running.
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, models: [SMALL, served(MEDIUM)] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(MEDIUM), 'waiting']);
  f.c.setDraft('Typed in the first second');
  f.publish({ models: [served(SMALL), served(MEDIUM)] });
  // Once the top-ranked preferred model is ready, no higher-ranked public model can displace it: it settles immediately.
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(SMALL), 'ready']);
  f.publish({ models: [served(SMALL), served(MEDIUM)].reverse() });
  expect(chip(f).selectionId).toBe(key(SMALL));
  f.c.send();
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(SMALL));
});

// The deployed first-visit walk at b8c3432b: the chip named the 27B model, Ready, about 2 s after load, while the
// bounded discovery wait was still open; a computer serving the preferred 0.8B model answered inside it, and the
// question typed meanwhile went to the 0.8B model. While only a lower-ranked model is ready inside the wait, the
// automatic choice is provisional (no model named Ready, Send held); as soon as the top-ranked model is ready (or the
// wait ends), it settles and dispatches.
it('holds a Send pressed while the automatic choice is provisional and sends it as soon as the top model is ready or the wait ends', async () => {
  const f = fixture();
  // The first computer advertises a less preferred model; the session's bounded wait (chat-session.js) is still open.
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [SMALL, served(MEDIUM)] });
  expect(chip(f).availability).not.toBe('ready');
  expect(chip(f).label).not.toContain(MEDIUM.name);
  expect(f.view.composer().route).toMatchObject({ destination: 'contributors', status: 'waiting', send: 'queue' });
  expect(f.view.composer().disclosure).toBe('The answering computer can read your prompt.');
  f.view.send('Typed while computers were still answering');
  await new Promise(resolve => setTimeout(resolve, 0));
  // Nothing lands on the first computer to advertise: the Send is the host's held intent.
  expect(f.created).toHaveLength(0);
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  expect(f.session.sendIntents.state().intent.selection).toEqual({ mode: 'auto' });
  // A computer serving the top-ranked preferred model answers inside the wait: settles and dispatches immediately without waiting 8 s.
  f.publish({ models: [served(SMALL), served(MEDIUM)] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(SMALL), 'ready']);
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(f.created).toHaveLength(1);
  expect(key(f.created[0].model)).toBe(key(SMALL));
  expect(f.created[0]).toMatchObject({ executionLocation: 'network', privacy: { recipients: { kind: 'open' } } });

  // When the top-ranked model advertises first inside the wait, it is Ready at once and Send dispatches with zero startup hold.
  const immediate = fixture();
  immediate.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), MEDIUM] });
  expect([chip(immediate).selectionId, chip(immediate).availability]).toEqual([key(SMALL), 'ready']);
  expect(immediate.view.composer().route).toMatchObject({ destination: 'contributors', status: 'ready', send: 'dispatch' });
  immediate.view.send('Sent immediately on top preferred model');
  await vi.waitFor(() => expect(immediate.sent).toHaveLength(1));
  expect(key(immediate.created[0].model)).toBe(key(SMALL));

  // With no better computer, the wait's end sends the held question to the model the composer then names.
  const g = fixture();
  g.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [SMALL, served(MEDIUM)] });
  g.view.send('Typed while computers were still answering');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(g.created).toHaveLength(0);
  g.publish({ peerDiscoveryTimedOut: true });
  expect([chip(g).selectionId, chip(g).availability]).toEqual([key(MEDIUM), 'ready']);
  await vi.waitFor(() => expect(g.sent).toHaveLength(1));
  expect(key(g.created[0].model)).toBe(key(MEDIUM));

  // A pick is not provisional: inside the same wait it is named as ready and answers at once.
  const h = fixture({ storage: memory(pickOf(MEDIUM)) });
  h.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), served(MEDIUM)] });
  expect([chip(h).selectionId, chip(h).availability]).toEqual([key(MEDIUM), 'ready']);
  h.view.send('For the model I picked');
  await vi.waitFor(() => expect(h.sent).toHaveLength(1));
  expect(key(h.created[0].model)).toBe(key(MEDIUM));
});

it('prefers a ready contributor over cached weights and falls back locally without changing a saved opt-out', () => {
  const stored = fixture();
  stored.publish({ ...observed, models: [{ ...SMALL, availability: 'cached', localCached: true }, served(MEDIUM)] });
  expect([chip(stored).source, chip(stored).selectionId]).toEqual(['Contributors', key(MEDIUM)]);
  stored.publish({ models: [{ ...SMALL, availability: 'cached', localCached: true }, MEDIUM] });
  expect([chip(stored).source, chip(stored).selectionId]).toEqual(['This device', key(SMALL)]);
  expect(stored.view.composer().disclosure).toBe('Nothing leaves this device.');
  const off = fixture();
  off.publish({ ...observed, remoteAnswersEnabled: false, models: [{ ...SMALL, availability: 'cached', localCached: true }, served(MEDIUM)] });
  expect(chip(off).source).toBe('This device');
});

it('keeps a picked model when nothing serves it: says so, sends nothing, and offers the other model only as a choice', async () => {
  const storage = memory(), f = fixture({ storage });
  f.publish({ ...observed, models: [served(SMALL), served(MEDIUM)] });
  f.c.openSheet();
  f.c.pickModel(key(MEDIUM));
  await vi.waitFor(() => expect(f.view.sheet().open).toBe(false));
  expect(JSON.parse(storage.saved.get(ANSWER_CHOICE_STORAGE_KEY))).toMatchObject({ selectionId: key(MEDIUM), route: 'contributors', picked: true });
  f.publish({ models: [served(SMALL), MEDIUM] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(MEDIUM), 'unavailable']);
  expect(f.view.composer().status.text).toBe('No eligible computer found for this model.');
  expect(f.view.composer().send.disabled).toBe(true);
  expect(f.view.composer().nextAction).toBe('review-shared');
  f.view.send('For the model I picked');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.created).toHaveLength(0);

  // The next visit starts on the pick and keeps it after the discovery wait, with or without a draft.
  const next = fixture({ storage, session: f.session });
  expect(chip(next).selectionId).toBe(key(MEDIUM));
  next.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  expect([chip(next).selectionId, chip(next).availability, chip(next).source]).toEqual([key(MEDIUM), 'unavailable', 'Contributors']);
  expect(next.view.composer().send.disabled).toBe(true);
  // New thread carries the pick too.
  next.c.newThread();
  await vi.waitFor(() => expect(chip(next).selectionId).toBe(key(MEDIUM)));
  // When its computer returns, the pick answers.
  next.publish({ models: [served(SMALL), served(MEDIUM)] });
  expect([chip(next).selectionId, chip(next).availability]).toEqual([key(MEDIUM), 'ready']);
  next.view.send('For the model I picked');
  await vi.waitFor(() => expect(next.created).toHaveLength(1));
  expect(key(next.created[0].model)).toBe(key(MEDIUM));
});

it('does not treat a model that came with the computer, or an older record, as a pick', async () => {
  const storage = memory(), f = fixture({ storage });
  f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  // The visitor changes only the computer; the model shown came with it.
  f.c.openSheet();
  f.c.pickComputer('network');
  await vi.waitFor(() => expect(f.view.checkedComputer()).toBe('network'));
  f.c.commitSheet();
  await vi.waitFor(() => expect(f.view.sheet().open).toBe(false));
  expect(JSON.parse(storage.saved.get(ANSWER_CHOICE_STORAGE_KEY))).toMatchObject({ selectionId: key(SMALL), route: 'contributors', picked: false });
  expect(chip(f).selectionId).toBe(key(SMALL));
  f.publish({ models: [SMALL, served(MEDIUM)] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(MEDIUM), 'ready']);

  // A later visit keeps the computer and chooses the model from what is available.
  const next = fixture({ storage, session: f.session });
  next.publish({ ...observed, models: [SMALL, served(MEDIUM)] });
  expect([chip(next).source, chip(next).selectionId]).toEqual(['Contributors', key(MEDIUM)]);
  // So does a record written before picks were marked.
  const legacy = memory({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify({ selectionId: key(SMALL), identity: SMALL.identity, route: 'contributors' }) });
  const old = fixture({ storage: legacy, session: f.session });
  old.publish({ ...observed, models: [SMALL, served(MEDIUM)] });
  expect([chip(old).source, chip(old).selectionId, chip(old).availability]).toEqual(['Contributors', key(MEDIUM), 'ready']);
});

it('carries a pick to New thread when the draft was typed before the pick', async () => {
  const f = fixture({ storage: memory() });
  f.publish({ ...observed, models: [served(SMALL), served(MEDIUM)] });
  f.c.setDraft('Typed before picking');
  expect(chip(f).selectionId).toBe(key(SMALL));
  f.c.openSheet();
  f.c.pickModel(key(MEDIUM));
  await vi.waitFor(() => expect(f.view.sheet().open).toBe(false));
  expect(chip(f).selectionId).toBe(key(MEDIUM));
  f.c.newThread();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(chip(f).selectionId).toBe(key(MEDIUM));
  f.publish({ models: [served(SMALL), served(MEDIUM)] });
  f.c.send();
  await vi.waitFor(() => expect(f.created).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(MEDIUM));
});

const POOL = { ...MEDIUM, selectionId: 'private:me:' + MEDIUM.id, name: 'Pool medium', source: undefined,
  fleet: { poolIdentity: 'pool', requester: { participantId: 'me' } },
  availability: 'ready', networkAvailability: 'ready', localReady: false, localCached: false, providerIds: [] };
const pickOf = model => ({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify({ selectionId: key(model), identity: model.identity, name: model.name, route: 'contributors', picked: true }) });

it('shows a remembered pick that is not listed yet as the chosen model, and sends its question nowhere else', async () => {
  // A private pool's model is listed only once the pool's state has loaded; a public computer advertises first.
  const f = fixture({ storage: memory(pickOf(POOL)), draft: 'For my own pool' });
  expect([chip(f).selectionId, chip(f).name]).toEqual([key(POOL), POOL.name]);
  expect(f.view.composer().send.disabled).toBe(true);
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), MEDIUM] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(POOL), 'waiting']);
  expect(f.view.composer().status.text).toBe('Finding computers…');
  expect(f.view.composer().send.disabled).toBe(true);
  f.c.send();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.created).toHaveLength(0);
  // The sheet opens on the pick, listed as unavailable.
  f.c.openSheet();
  expect(f.view.sheet().selectedKey).toBe(key(POOL));
  f.c.closeSheet();
  f.publish({ models: [served(SMALL), MEDIUM, POOL] });
  expect([chip(f).selectionId, chip(f).availability, chip(f).source]).toEqual([key(POOL), 'ready', 'Private computers']);
  f.publish({ peerDiscoveryTimedOut: true });
  f.c.send();
  await vi.waitFor(() => expect(f.created).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(POOL));
});

it('keeps a remembered pick whose selection never appears: unavailable, Send off, the record kept, until it is listed', async () => {
  const storage = memory(pickOf(POOL)), f = fixture({ storage });
  f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  expect([chip(f).selectionId, chip(f).name, chip(f).availability]).toEqual([key(POOL), POOL.name, 'unavailable']);
  expect(f.view.composer().status.text).toBe('No eligible computer found for this model.');
  expect(f.view.composer().send.disabled).toBe(true);
  f.view.send('For my own pool');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.created).toHaveLength(0);
  expect(JSON.parse(storage.saved.get(ANSWER_CHOICE_STORAGE_KEY))).toMatchObject({ selectionId: key(POOL), picked: true });
  // New thread keeps showing it; a later listing makes it the model that answers.
  f.c.newThread();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(POOL), 'unavailable']);
  f.publish({ models: [served(SMALL), MEDIUM, POOL] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(POOL), 'ready']);
  f.c.send();
  await vi.waitFor(() => expect(f.created).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(POOL));
  // A pick whose build changed is not the model the person chose: it is shown unavailable, not swapped for the new build.
  const rebuilt = fixture({ storage: memory(pickOf({ ...MEDIUM, identity: 'sha256:' + '0'.repeat(64) })) });
  rebuilt.publish({ ...observed, models: [served(SMALL), served(MEDIUM)] });
  expect([chip(rebuilt).selectionId, chip(rebuilt).availability]).toEqual([key(MEDIUM), 'unavailable']);
  expect(rebuilt.view.composer().send.disabled).toBe(true);
});

it('holds a returning visitor\'s Send for whichever model turns up when their record names only a computer', async () => {
  // Every record written before picks were marked, and any sheet commit without a model pick, is such a record.
  const record = () => memory({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify({ selectionId: key(SMALL), identity: SMALL.identity, route: 'contributors' }) });
  const f = fixture({ storage: record() });
  f.c.setDraft('Typed before discovery settled');
  // No model is named while none is known: the record's model is not a pick.
  expect([chip(f).source, chip(f).name]).toEqual(['', 'Finding computers…']);
  expect(f.view.composer().send.disabled).toBe(false);
  f.c.send();
  expect(f.view.composer().status.text).toBe('Finding computers…');
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [SMALL, served(MEDIUM)] });
  // The first computer to advertise does not take it while the discovery wait is open; the wait's end does.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.created).toHaveLength(0);
  f.publish({ peerDiscoveryTimedOut: true });
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(MEDIUM));
  expect(f.created[0]).toMatchObject({ executionLocation: 'network', privacy: { recipients: { kind: 'open' } } });

  // With nobody to answer, the hold ends when its intent expires (30 s after the press, not with the discovery
  // wait), with a stated reason, and the draft stays.
  vi.useFakeTimers({ now: 2_000_000 });
  const alone = fixture({ storage: record() });
  alone.view.send('Typed before discovery settled');
  expect(alone.view.composer().nextAction).toBe('cancel-queued');
  alone.publish(observed);
  await vi.advanceTimersByTimeAsync(0);
  expect(alone.view.composer().nextAction).toBe('cancel-queued');
  await vi.advanceTimersByTimeAsync(30_000);
  vi.useRealTimers();
  expect(alone.created).toHaveLength(0);
  expect(alone.view.composer().status.text).toBe('No computer answered in 30 seconds. Nothing was sent.');
  expect(alone.view.composer().nextAction).toBeNull();
  expect(alone.view.composer().draft).toBe('Typed before discovery settled');
});

it('bounds a held Send by the discovery wait: it says it is waiting for capacity, then goes the way a Send pressed now would', async () => {
  const f = fixture();
  f.view.send('Held while the only computer is busy');
  expect(f.view.composer().status.text).toBe('Finding computers…');
  // The only computer is busy, or advertised but not reachable yet: the composer names its model as able to answer.
  const busy = { ...SMALL, availability: 'busy', networkAvailability: 'busy', providerIds: ['peer'], reachableProviderIds: [] };
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [busy, MEDIUM] });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(SMALL), 'waiting']);
  expect(f.view.composer().status.text).toBe('Waiting for capacity.');
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  expect(f.sent).toHaveLength(0);
  // The wait ends: the question is sent to the model shown, as pressing Send now would send it.
  f.publish({ peerDiscoveryTimedOut: true });
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(SMALL));
  expect(f.sent[0].content).toBe('Held while the only computer is busy');
  expect(f.view.composer().nextAction).not.toBe('cancel-queued');
});

it('holds no Send while the network is turned off: the composer says it is paused and offers Reconnect', async () => {
  // A stored "network off" choice: the swarm starts paused (work-swarm.js), which the session reports as this phase.
  const paused = { discoveryPhase: 'paused', peerDiscoveryTimedOut: true, network: { paused: true, consumer: null } };
  const returning = fixture({ storage: memory({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify({ selectionId: key(SMALL), identity: SMALL.identity, route: 'contributors' }) }) });
  returning.publish(paused);
  expect(returning.view.composer().status.text).toBe('Network paused.');
  expect([returning.view.composer().nextAction, returning.view.composer().nextLabels.retry]).toEqual(['retry', 'Reconnect']);
  returning.view.send('Typed with the network off');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(returning.view.composer().nextAction).toBe('retry');
  expect(returning.created).toHaveLength(0);
  // A first visitor is not told computers are being found, and nothing is held either.
  const first = fixture();
  first.publish(paused);
  expect(chip(first).name).not.toBe('Finding computers…');
  first.view.send('Typed with the network off');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(first.view.composer().nextAction).not.toBe('cancel-queued');
  expect(first.created).toHaveLength(0);
});

it('chooses the automatic model by the session\'s preference order, not by catalog or advertisement order', async () => {
  expect(profile.chatModelPreference.indexOf(SMALL.id)).toBeLessThan(profile.chatModelPreference.indexOf(MEDIUM.id));
  const f = fixture();
  // Both are served and the catalog lists the less preferred one first.
  f.publish({ ...observed, models: [served(MEDIUM), served(SMALL)] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(SMALL), 'ready']);
  // A ready model is chosen before a busy one, whatever the preference.
  f.publish({ models: [served(MEDIUM), { ...served(SMALL), availability: 'busy', networkAvailability: 'busy' }] });
  expect(chip(f).selectionId).toBe(key(MEDIUM));
  f.publish({ models: [served(MEDIUM), served(SMALL)] });
  f.view.send('To the preferred model');
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(chip(f).selectionId);
});

it('keeps finding computers, and keeps a held Send, when a split route or a private pool is seen before any public computer', async () => {
  const SPLIT = { ...MEDIUM, selectionId: MEDIUM.id + '#split', name: 'Medium split', partition: { planId: 'p', participantA: 'a', participantB: 'b' },
    availability: 'ready', networkAvailability: 'ready', providerIds: [], reachableProviderIds: [] };
  const f = fixture();
  f.view.send('Held while computers are found');
  // The session keeps searching on this evidence (chat-session.js servedEvidence); the composer must not name a
  // route the automatic path does not send to, nor drop the question.
  f.publish({ models: [SMALL, MEDIUM, SPLIT, POOL] });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([chip(f).source, chip(f).name]).toEqual(['', 'Finding computers…']);
  expect(f.view.composer().status.text).toBe('Finding computers…');
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  expect(f.created).toHaveLength(0);
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), MEDIUM, SPLIT, POOL] });
  f.publish({ peerDiscoveryTimedOut: true });
  await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(SMALL));
});

it('lists a model nobody serves yet as Finding computers in the "Answer on" sheet until the discovery wait is over', () => {
  // A model this device can neither store nor download: only a computer serving it can answer.
  const LARGE = { ...MEDIUM, id: 'large', name: 'Large', identity: 'sha256:' + 'b'.repeat(64), source: null,
    availability: 'unavailable', networkAvailability: 'unavailable', providerIds: [], reachableProviderIds: [] };
  const f = fixture();
  const row = id => f.view.modelRows().find(item => item.value === id);
  const section = id => f.view.sheet().sections.find(item => item.rows.some(row => row.value === id))?.label;
  f.publish({ models: [SMALL, LARGE] });
  f.c.openSheet();
  // Discovery is still searching.
  expect([section('large'), row('large').status]).toMatchInlineSnapshot(`
    [
      "Public network",
      "Finding computers…",
    ]
  `);
  // Another model's computer answered first: discovery has settled on it, inside the bounded wait.
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), LARGE] });
  expect([section('large'), row('large').status]).toMatchInlineSnapshot(`
    [
      "Public network",
      "Finding computers…",
    ]
  `);
  // Only how it reads changed: a tap stages it, commits nothing, and Send still goes to the model that is served.
  f.c.pickModel('large');
  expect([f.view.sheet().open, f.view.sheet().outcome.action, f.created.length]).toEqual([true, '', 0]);
  f.c.closeSheet();
  expect(chip(f).selectionId).toBe(key(SMALL));
  f.c.openSheet();
  // The wait is over and nobody serves it: it is unavailable.
  f.publish({ ...observed, models: [served(SMALL), LARGE] });
  expect([section('large'), row('large').status]).toMatchInlineSnapshot(`
    [
      "Unavailable · 1",
      "Unavailable",
    ]
  `);
  // Its computer arrives.
  f.publish({ ...observed, models: [served(SMALL), served(LARGE)] });
  expect([section('large'), row('large').status]).toMatchInlineSnapshot(`
    [
      "Public network",
      "Ready · 1 computer",
    ]
  `);
});

it('waits for a remembered public pick during the discovery wait: Finding computers, then the pick answers, or stays unavailable', async () => {
  // Listed but not served yet while another computer has settled discovery: the pick waits, it is not replaced.
  const f = fixture({ storage: memory(pickOf(MEDIUM)) });
  expect(chip(f).selectionId).toBe(key(MEDIUM));
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), MEDIUM] });
  expect([chip(f).selectionId, chip(f).availability]).toEqual([key(MEDIUM), 'waiting']);
  expect(f.view.composer().status.text).toBe('Finding computers…');
  // Send holds the question for the pick, not for whichever model is served.
  f.view.send('For the remembered pick');
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  expect(f.view.composer().status.text).toBe(`Waiting for a computer running ${MEDIUM.name}…`);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.created).toHaveLength(0);
  // Its computer arrives inside the wait: the held question goes to the pick.
  f.publish({ models: [served(SMALL), served(MEDIUM)] });
  await vi.waitFor(() => expect(f.created).toHaveLength(1));
  expect(key(f.created[0].model)).toBe(key(MEDIUM));

  // Its computer never arrives: when the wait ends the pick stays, unavailable, and Send stays off.
  const g = fixture({ storage: memory(pickOf(MEDIUM)) });
  g.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), MEDIUM] });
  g.publish({ peerDiscoveryTimedOut: true });
  expect([chip(g).selectionId, chip(g).availability]).toEqual([key(MEDIUM), 'unavailable']);
  expect(g.view.composer().status.text).toBe('No eligible computer found for this model.');
  expect(g.view.composer().send.disabled).toBe(true);
  // A computer that turns up later still makes it the model that answers.
  g.publish({ models: [served(SMALL), served(MEDIUM)] });
  expect([chip(g).selectionId, chip(g).availability]).toEqual([key(MEDIUM), 'ready']);
});

it('drops a held Send when the draft changes, the sheet opens, search changes or the thread changes', async () => {
  const held = () => { const f = fixture(); f.view.send('Held'); expect(f.view.composer().nextAction).toBe('cancel-queued'); return f; };
  const settle = async f => {
    f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
    await new Promise(resolve => setTimeout(resolve, 0));
    return f.sent.length;
  };
  let f = held(); f.c.setDraft('Held, edited');
  expect(f.view.composer().nextAction).not.toBe('cancel-queued');
  expect(await settle(f)).toBe(0);
  f = held(); f.c.openSheet();
  expect(f.view.composer().nextAction).not.toBe('cancel-queued');
  f.c.closeSheet();
  expect(await settle(f)).toBe(0);
  f = held(); f.c.toggleSearch();
  expect(await settle(f)).toBe(0);
  f = held(); f.c.newThread();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(await settle(f)).toBe(0);
  // Untouched, the same hold is sent once a computer serves a model.
  f = held();
  expect(await settle(f)).toBe(1);
});

// The Send intent (reploid.send-intent/1, apps/poolday/host/send-intents.js): the chat host owns the held Send and its
// 30 s expiry; the controller renders it.
it('expires a held Send 30 s after the press whatever discovery is doing, creates nothing, and keeps the typed text', async () => {
  vi.useFakeTimers({ now: 5_000_000 });
  try {
    const f = fixture();
    f.view.send('Held while computers are found');
    expect(f.view.composer().nextAction).toBe('cancel-queued');
    expect(f.view.composer().sendIntent).toMatchObject({ status: 'held', expiresAt: 5_000_000 + 30000 });
    // Discovery is still searching at 29 s: the hold stands.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(f.view.composer().nextAction).toBe('cancel-queued');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.view.composer().nextAction).not.toBe('cancel-queued');
    expect(f.view.composer().sendIntent).toMatchObject({ status: 'expired' });
    expect(f.created).toHaveLength(0);
    expect(f.view.composer().draft).toBe('Held while computers are found');
    // A computer arriving after the expiry sends nothing: a new Send is needed.
    f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
    await vi.advanceTimersByTimeAsync(10);
    expect(f.created).toHaveLength(0);
    expect(f.sent).toHaveLength(0);
    expect(f.view.composer().draft).toBe('Held while computers are found');
    f.c.send();
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
  } finally { vi.useRealTimers(); }
});

it('keeps a held Send past the end of the discovery wait until a computer arrives inside the 30 s', async () => {
  vi.useFakeTimers({ now: 6_000_000 });
  try {
    const f = fixture();
    f.view.send('Held across the discovery wait');
    // The discovery wait ends with nobody to answer: the hold is not bound by it.
    f.publish(observed);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(f.view.composer().nextAction).toBe('cancel-queued');
    expect(f.created).toHaveLength(0);
    f.publish({ models: [served(SMALL), MEDIUM] });
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    expect(key(f.created[0].model)).toBe(key(SMALL));
  } finally { vi.useRealTimers(); }
});

it('dispatches nothing when the selection changes between Send and a ready route', async () => {
  const f = fixture();
  f.view.send('Held, then the selection changes');
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  // Another surface of the same host changes the selection while the Send is held.
  f.session.sendIntents.select({ mode: 'pinned', artifact: { identity: MEDIUM.identity, adapterIdentities: [] } });
  f.publish({ ...observed, models: [served(SMALL), MEDIUM] });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.created).toHaveLength(0);
  expect(f.sent).toHaveLength(0);
  expect(f.view.composer().draft).toBe('Held, then the selection changes');
});

it('holds a pin to its exact artifact: a model of the same name and id with other weights never answers it', async () => {
  const f = fixture({ storage: memory(pickOf(MEDIUM)) });
  f.publish({ discoveryPhase: 'observed', peerDiscoveryTimedOut: false, network: observed.network, models: [served(SMALL), MEDIUM] });
  f.view.send('For the exact pick');
  expect(f.view.composer().nextAction).toBe('cancel-queued');
  expect(f.session.sendIntents.state().intent.selection).toEqual({ mode: 'pinned', artifact: { identity: MEDIUM.identity, adapterIdentities: [] } });
  const impostor = { ...served(MEDIUM), identity: 'sha256:' + 'c'.repeat(64) };
  f.publish({ models: [served(SMALL), impostor] });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.created).toHaveLength(0);
  expect(f.sent).toHaveLength(0);
});

it('names the model and provider on the answer from its execution evidence, not from the current picker', () => {
  const f = fixture();
  f.publish({ ...observed, models: [served(SMALL), served(MEDIUM)] });
  // The picker shows the small model; the answer was served by the medium one, as its signed receipt states.
  expect(chip(f).selectionId).toBe(key(SMALL));
  const thread = { id: 'thread-r', model: SMALL, privacy: null, grants: [], permissions: { sharingScope: 'mesh', executionLocation: 'network' },
    messages: [{ id: 'u', role: 'user', content: 'Q' }, { id: 'a', role: 'assistant', content: 'A', attemptId: 'at' }],
    attempts: [{ id: 'at', status: 'completed', createdAt: 1, finishedAt: 2, request: { model: SMALL },
      execution: { provider: 'peer', placement: 'peer-whole-request', peerId: 'peer-medium', modelId: MEDIUM.id, modelIdentity: MEDIUM.identity,
        adapterIdentities: [], executionReceipt: { provider: 'peer-medium', model: MEDIUM.id, modelIdentity: MEDIUM.identity } } }] };
  f.publish({ threads: [thread], selectedId: thread.id, activeThread: thread });
  const answer = f.view.snapshot().messages.find(row => row.role === 'assistant');
  expect(answer.activity.readable).toBe(`${MEDIUM.name} · Shared computer`);
  expect(answer.activity.title).toContain('1 computer');
});
