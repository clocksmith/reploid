// The conversation workspace on the host's real chat session: the composer, "Answer on", "Who can read it?", the
// reviewed download, the queued Send and Threads, through the conversation controller
// (apps/poolday/host/decisions/conversation-controller.js) that the React screens render. Markup and focus are the
// component library's and are tested there (tests/unit/poolday-ui).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { openConversation } from '../fixtures/conversation-view.js';
import { modelVariantLabel } from '../../apps/poolday/ui/components/model-select.js';
import { createExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';
import { createDetailsServices } from '../../apps/poolday-react/src/features/details/infrastructure/hostDetails';

const openPolicy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const peerFor = (model, extra = {}) => ({ peerId: model.id, model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true,
  availableSlots: 1, identityProtocol: 1, admissionProtocol: 2, ...extra });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Conversation workspace', () => {
  let session, service, view;
  // The workspace tests exercise model discovery and selection after an explicit opt-in to contributors.
  const open = (target, options = {}) => {
    view?.dispose();
    const viewState = options.viewState ?? {};
    if (!options.fresh) viewState.privacy ??= openPolicy;
    view = openConversation(target, { ...options, viewState });
    return view;
  };
  const c = () => view.controller;
  const composer = () => view.composer();
  const selected = () => composer().chip.selectionId;
  const digest = () => `${composer().chip.source} · ${composer().chip.name}`;
  const sheet = () => view.sheet();
  const checked = () => view.checkedComputer();
  // While capacity is missing, Send never dispatches: it is either off or it queues the draft for later.
  const expectSendDoesNotDispatch = () => {
    if (composer().send.disabled) return;
    const original = composer().draft, calls = service.calls.length;
    if (!original.trim()) c().setDraft('Probe');
    c().send();
    expect(service.calls).toHaveLength(calls);
    expect(composer().nextAction).toBe('cancel-queued');
    c().cancelQueuedSend();
    c().setDraft(original);
  };
  const chooseShared = async id => {
    // Computer first (the sheet stays open), then the model; the primary commits if the model tap has not already.
    c().openSheet();
    c().pickComputer('network');
    if (id) c().pickModel(id);
    if (sheet().open) c().runSheetAction();
    await vi.waitFor(() => expect(sheet().open).toBe(false));
  };
  const withoutIssue = (target, extra = {}) => ({ ...target,
    getState: () => ({ ...target.getState(), localDownloadIssue: null }),
    subscribe: fn => target.subscribe(state => fn({ ...state, localDownloadIssue: null })), ...extra });
  beforeEach(() => {
    history.replaceState(null, '', '/');
    service = createChatTestService();
    session = createChatSession({ storage: null, service, models: [CANONICAL_CHAT_MODELS[1]] });
    open(withoutIssue(session, { getModelDownload: async id => ({ id, sizeBytes: 123000000 }) }));
  });
  afterEach(async () => { view?.dispose(); view = null; await session.close(); });

  it('edits inference privacy from the composer without sending, changing the draft or losing edits on refresh', async () => {
    const id = session.createThread({ sharingScope: 'mesh' });
    c().setDraft('Keep this question');
    // The chip names the thread's protection: a new local conversation is Standard protection on your devices only.
    expect(composer().privacy.label).toBe('Who can read it: Standard · Your devices');
    expect(composer().privacy.caption).toBe('Standard · Your devices');
    // Opening it from under an open Answer on sheet closes the sheet first.
    const advanced = () => { c().openSheet(); expect(sheet().open).toBe(true); c().openPrivacy(); expect(sheet().open).toBe(false); };
    advanced();
    let dialog = view.snapshot().privacy;
    expect(dialog.open).toBe(true);
    expect(dialog.protection).toBe('plaintext');
    expect(dialog.protections.map(row => row.value)).toEqual(['plaintext', 'secret-sharing', 'homomorphic', 'attested']);
    expect(dialog.protections[0].status).toBe('Computers that process your request can read the data they receive.');
    for (const row of dialog.protections.slice(1)) {
      expect(row.disabled).toBe(true);
      expect(row.status).toMatch(/\. Unavailable: \S/);
    }
    // Where it runs: the five routes; a local conversation runs on this device, where "Only your devices" does not apply.
    expect(dialog.routes.map(row => row.value)).toEqual(['local', 'remote', 'split', 'split-local-edges', 'auto']);
    expect(dialog.route).toBe('local');
    expect(dialog.routes.find(row => row.value === 'split-local-edges').disabled).toBe(true);
    expect(dialog.ownDevicesOption.disabled).toBe(true);
    expect(dialog.preset).toBe('own-devices');
    expect(dialog.note).toMatch(/^Only this device runs the model/);
    c().pickRoute('auto');
    await session.renameThread(id, 'Refresh the workspace');
    expect(view.snapshot().privacy.route).toBe('auto');
    c().closePrivacy();
    expect(session.getState().activeThread.privacy).toMatchObject({ placement: 'local-only', recipients: { kind: 'none', ids: [] } });
    advanced();
    expect(view.snapshot().privacy.route).toBe('local');
    c().pickRoute('auto');
    c().applyPrivacy();
    await vi.waitFor(() => expect(view.snapshot().privacy.open).toBe(false));
    expect(session.getState().activeThread.privacy.recipients).toEqual({ kind: 'open', ids: [] });
    expect(composer().chip.source).toBe('Contributors');
    // Standard on approved computers: the chip shows "Standard".
    expect(composer().privacy.label).toBe('Who can read it: Standard');
    expect(composer().privacy.caption).toBe('Standard');
    expect(composer().draft).toBe('Keep this question');
    expect(session.getState().activeThread.messages).toHaveLength(0);
  });

  it('never turns Send into a download, even with the legacy automatic-download setting on', async () => {
    localStorage.setItem('reploid.auto-download.v1', 'on');
    const downloadLocalModel = vi.fn(), send = vi.fn();
    const observed = state => ({ ...state, peerDiscoveryTimedOut: true, discoveryPhase: 'observed', localDownloadIssue: null });
    open({ ...session, send, downloadLocalModel, getState: () => observed(session.getState()),
      subscribe: fn => session.subscribe(state => fn(observed(state))), getModelDownload: async () => ({ sizeBytes: 123000000 }) });
    view.send('Keep this question');
    expect(composer().send.disabled).toBe(true);
    // Availability is its own indicator; the selector keeps naming the destination.
    expect(composer().chip.availability).toBe('unavailable');
    expect(downloadLocalModel).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    c().downloadLocal();
    await vi.waitFor(() => expect(view.snapshot().download?.size).toContain('123 MB'));
    expect(downloadLocalModel).not.toHaveBeenCalled();
    c().closeDownload();
    expect(composer().draft).toBe('Keep this question');
    localStorage.removeItem('reploid.auto-download.v1');
  });

  it('keeps personal search in the composer and respects turning it off for a single answer', async () => {
    session.setCachedModels([CANONICAL_CHAT_MODELS[1]]);
    session.createThread({ sharingScope: 'local' });
    const webState = { enabled: true, url: 'https://search.example.test/mcp', status: { message: '' } };
    const webSearch = { enabled: () => true, state: () => webState, subscribe(fn) { fn(webState); return () => {}; } };
    const send = vi.fn(async () => {});
    open({ ...session, send }, { webSearch });
    expect(composer().search).toEqual({ visible: true, pressed: true });
    c().toggleSearch();
    view.send('Without search');
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]).toHaveLength(3);
    await vi.waitFor(() => expect(composer().draft).toBe(''));
    c().toggleSearch();
    view.send('With search');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][3]).toEqual({ retrieval: {} });
  });

  it('keeps every configured model visible in the picker before discovery without offering an unavailable one', async () => {
    await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers: [] } }) } });
    open(session);
    c().openSheet();
    expect(sheet().open).toBe(true);
    const names = view.modelRows().map(row => row.title);
    for (const model of CANONICAL_CHAT_MODELS) expect(names).toContain(modelVariantLabel(model));
    c().pickModel(CANONICAL_CHAT_MODELS[0].id);
    expect(sheet().selectedKey).toBe(CANONICAL_CHAT_MODELS[0].id);
    expect(sheet().outcome.disabled).toBe(true);
    expect(sheet().outcome.issue).toMatch(/^Finding computers…/);
    session.refreshNetwork();
    expect(sheet().selectedKey).toBe(CANONICAL_CHAT_MODELS[0].id);
    expectSendDoesNotDispatch();
    expect(service.calls).toHaveLength(0);
  });

  it('updates automatic defaults as capacity arrives, but preserves explicit choices and existing threads', async () => {
    await session.close();
    let peers = [];
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }), connect: async () => {} } });
    open(session);
    const [small, medium, large] = CANONICAL_CHAT_MODELS;
    const publish = models => { peers = models.map(model => peerFor(model)); session.setCachedModels([]); };
    publish([medium]); expect(selected()).toBe(medium.id);
    expect(composer().send.disabled).toBe(false);
    expect(digest()).toContain(medium.name);
    c().setDraft('Keep the selected destination');
    publish([small, medium]); expect(selected()).toBe(medium.id);
    c().setDraft('');
    // The automatic default is the smallest model a contributor serves.
    publish([small, medium]); expect(selected()).toBe(small.id);
    publish([medium, large]); expect(selected()).toBe(medium.id);
    publish([small, medium, large]); expect(selected()).toBe(small.id);
    await chooseShared(large.id);
    publish([small, large]); expect(selected()).toBe(large.id);
    // New thread keeps the person's choice while a computer still serves it, and new capacity does not replace it.
    c().newThread(); await tick();
    expect(selected()).toBe(large.id);
    publish([small, medium, large]); expect(selected()).toBe(large.id);
    // Nothing serves it now, but computers are still being looked for: a new thread keeps it until that wait ends.
    publish([small, medium]);
    c().newThread(); await tick();
    expect(selected()).toBe(large.id);
    session.createThread({ model: medium });
    publish([small]);
    expect(session.getState().activeThread.model.id).toBe(medium.id);
    expect(digest()).toContain(medium.name);
  });

  it('keeps the chosen model and computer for each new thread and the next visit while a computer serves it', async () => {
    await session.close();
    let peers = [];
    const [small, medium] = CANONICAL_CHAT_MODELS;
    const serve = list => { peers = list.map(model => peerFor(model)); session.refreshNetwork(); };
    session = createChatSession({ storage: null, service, swarm: { connect: async () => {},
      getState: () => ({ introductionState: 'connected', consumer: { connectionState: 'connected', peers } }) } });
    const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) };
    // A first visitor: no computer chosen yet.
    const bind = () => open(session, { fresh: true, viewState: {}, storage });
    bind();
    serve([small, medium]);
    expect(selected()).toBe(small.id);
    await chooseShared(medium.id);
    expect(selected()).toBe(medium.id); expect(composer().chip.source).toBe('Contributors');
    expect(JSON.parse(saved.get('reploid.answer-choice.v1'))).toEqual({ selectionId: medium.id, identity: medium.identity, route: 'contributors', picked: true, name: medium.name });
    // An answered thread, then New thread: the same model and computer, not the default.
    session.createThread({ model: medium, privacy: openPolicy, executionLocation: 'network' });
    await vi.waitFor(() => expect(session.getState().activeThread).not.toBeNull());
    c().newThread();
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    expect(selected()).toBe(medium.id); expect(composer().chip.source).toBe('Contributors');
    expect(composer().send.disabled).toBe(false);
    // The next visit starts there too, without asking again where to run.
    bind();
    expect(selected()).toBe(medium.id); expect(composer().chip.source).toBe('Contributors');
    expect(composer().send.disabled).toBe(false);
    // A later visit where another computer advertises first: discovery settles on that advertisement, but the
    // remembered model keeps its place and the composer still reads as finding computers until its own arrives.
    vi.useFakeTimers();
    try {
      const visit = list => {
        view.dispose(); view = null; void session.close();
        session = createChatSession({ storage: null, service, swarm: { connect: async () => {},
          getState: () => ({ introductionState: 'connected', consumer: { connectionState: 'connected', peers } }) } });
        serve(list); bind();
      };
      visit([small]);
      expect(session.getState().discoveryPhase).toBe('observed');
      expect(selected()).toBe(medium.id);
      expect(composer().status.text).toBe('Finding computers…');
      expectSendDoesNotDispatch();
      serve([medium, small]);
      expect(selected()).toBe(medium.id); expect(composer().send.disabled).toBe(false);
      // A visit where it never arrives: the pick stays after the bounded wait. The composer says nothing serves it
      // and Send is off; the served model is not sent to in its place.
      visit([small]);
      expect(selected()).toBe(medium.id);
      vi.advanceTimersByTime(8000);
      expect(selected()).toBe(medium.id);
      expect(composer().chip.availability).toBe('unavailable');
      expect(composer().status.text).toContain('No eligible computer found for this model.');
      expect(composer().send.disabled).toBe(true);
      // The choice stays remembered for a visit where it is served again.
      expect(JSON.parse(saved.get('reploid.answer-choice.v1')).selectionId).toBe(medium.id);
      visit([medium, small]);
      expect(selected()).toBe(medium.id);
    } finally { vi.useRealTimers(); }
  });

  it('remembers This device as the computer for the next visit', () => {
    const model = CANONICAL_CHAT_MODELS[1];
    session.setCachedModels([model]);
    const saved = new Map([['reploid.answer-choice.v1', JSON.stringify({ selectionId: model.id, identity: model.identity, route: 'device' })]]);
    open(session, { fresh: true, viewState: {}, storage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) } });
    expect(selected()).toBe(model.id);
    expect(composer().chip.source).toBe('This device');
    expect(composer().disclosure).toBe('Nothing leaves this device.');
  });

  it('updates an untouched open picker with discovered capacity but keeps a staged explicit choice', async () => {
    await session.close();
    let peers = [];
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    open(session);
    c().openSheet();
    const fallback = sheet().selectedKey;
    const ready = CANONICAL_CHAT_MODELS.find(model => model.id !== fallback);
    peers = [peerFor(ready, { peerId: 'ready' })];
    session.refreshNetwork();
    expect(selected()).toBe(ready.id);
    expect(sheet().selectedKey).toBe(ready.id);
    expect(sheet().outcome.disabled).toBe(false);
    c().pickModel(fallback);
    session.refreshNetwork();
    expect(sheet().selectedKey).toBe(fallback);
    expect(sheet().outcome.disabled).toBe(true);
    c().closeSheet(); c().openSheet();
    expect(sheet().selectedKey).toBe(ready.id);
  });

  it('keeps a clicked automatic choice staged when another model is discovered before confirmation', async () => {
    await session.close();
    const [small, medium] = CANONICAL_CHAT_MODELS;
    let peers = [peerFor(small)];
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    open(session);
    c().openSheet();
    expect(sheet().selectedKey).toBe(small.id);
    c().pickModel(small.id, { browsing: true });
    peers = [peerFor(small), peerFor(medium)];
    session.refreshNetwork();
    expect(sheet().selectedKey).toBe(small.id);
    c().runSheetAction();
    await vi.waitFor(() => expect(sheet().open).toBe(false));
    expect(selected()).toBe(small.id);
    session.refreshNetwork();
    expect(selected()).toBe(small.id);
    expect(service.calls).toHaveLength(0);
  });

  it('stages a browsed local model without changing the composer, and applies it with the computer tap', async () => {
    await session.close();
    const [small, , large] = CANONICAL_CHAT_MODELS;
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers: [peerFor(large)] } }) } });
    session.setCachedModels([small]); open(session);
    expect(selected()).toBe(large.id);
    c().openSheet();
    expect(view.computer('local').disabled).toBe(false);
    c().pickModel(small.id, { browsing: true });
    expect(selected()).toBe(large.id);
    c().closeSheet();
    expect(digest()).toContain('Contributors');
    // A computer tap is the choice itself: it applies the staged model there.
    c().openSheet(); c().pickModel(small.id, { browsing: true }); c().pickComputer('local');
    if (sheet().open) c().runSheetAction();
    await vi.waitFor(() => expect(selected()).toBe(small.id));
    expect(digest()).toContain('This device');
    expect(service.calls).toHaveLength(0);
  });

  it('fills an editable draft from a starter without sending, and hides starters for existing conversations', async () => {
    const starter = composer().startingPrompt;
    expect(starter).not.toBeNull();
    c().useStartingPrompt(starter.text);
    expect(composer().draft).toBe(starter.text);
    expect(view.snapshot().focus.target).toBe('composer');
    // The starter keeps its place while a draft is written, so nothing moves.
    expect(composer().startingPrompt.inert).toBe(true);
    expect(service.calls).toHaveLength(0);
    expect(session.getDraft(null).text).toBe(starter.text);
    c().setDraft('');
    expect(composer().startingPrompt.inert).toBe(false);
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    view.send('My own question');
    await vi.waitFor(() => expect(session.getState().activeThread?.attempts[0]?.status).toBe('completed'));
    expect(composer().startingPrompt).toBeNull();
    c().newThread();
    await vi.waitFor(() => expect(composer().startingPrompt).not.toBeNull());
  });

  it('disables unavailable shared execution and commits a source change without replacing a thread', async () => {
    await session.close();
    const model = CANONICAL_CHAT_MODELS[1]; let peers = [];
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    session.setCachedModels([model]); open(session);
    const id = session.createThread({ model, sharingScope: 'local', privacy: openPolicy });
    c().openSheet();
    c().pickComputer('network');
    expect(checked()).toBe('network');
    // No contributor has it yet, but it is stored here: the fix is named instead of a dead button.
    expect(sheet().outcome.label).toBe('Use this device');
    expect(sheet().outcome.issue).toMatch(/It is on this device/);
    peers = [peerFor(model, { peerId: 'shared' })];
    session.refreshNetwork();
    c().pickComputer('network');
    expect(session.getState().activeThread.permissions.sharingScope).toBe('local');
    expect(digest()).toContain('This device');
    c().runSheetAction();
    await vi.waitFor(() => expect(session.getState().activeThread.permissions.executionLocation).toBe('network'));
    expect(session.getState().activeThread.id).toBe(id);
    expect(digest()).toContain('Contributors');
    expect(service.calls).toHaveLength(0);
  });

  it('keeps the composer and draft while network capacity is unavailable', () => {
    expectSendDoesNotDispatch();
    // Within the discovery window an unavailable model reads as still being looked for.
    expect(composer().status.text).toBe('Finding computers…');
    expect(digest()).toBe('Contributors · ' + CANONICAL_CHAT_MODELS[1].name);
    expect(composer().chip.availability).toBe('waiting');
    expect(composer().chip.label).toContain('Finding computers');
    expect(composer().chip.visible).toBe(true);
    expect(composer().send.visible).toBe(true);
    expect(composer().nextAction).not.toBe('retry');
    expect(composer().placeholder).toBeTruthy();
    expect(JSON.stringify(view.snapshot())).not.toMatch(/Mesh Active|Distributed Intelligence|Contributing|Scope:|Recent Improvements|LoRA/);
  });

  it('holds Network through model selection and discovery, then reviews a local download only on an explicit switch', async () => {
    await session.close();
    const [small, medium] = CANONICAL_CHAT_MODELS;
    let peers = [peerFor(medium)];
    session = createChatSession({ storage: null, service, models: [small, medium], swarm: { getState: () => ({ consumer: { peers } }) } });
    const downloadLocalModel = vi.fn();
    const viewState = { chosenModel: medium, executionLocation: 'network' };
    open(withoutIssue(session, { downloadLocalModel, getModelDownload: async id => ({ id, sizeBytes: 1200000000 }) }), { viewState });
    c().setDraft('Keep this draft');
    c().openSheet();
    const group = id => sheet().sections.find(section => section.rows.some(row => row.value === id))?.id;
    expect(group(small.id)).toBe('download');
    c().pickModel(small.id);
    // Nobody shares it: the reason and the Download fix sit beside it, and the primary button does the same.
    expect(checked()).toBe('network');
    expect(sheet().outcome.issue).toMatch(/^No contributor serves this model now/);
    expect(sheet().outcome.label).toBe(`Download ${small.name}`);
    peers.push(peerFor(small)); session.refreshNetwork();
    expect(checked()).toBe('network');
    expect(sheet().outcome.disabled).toBe(false);
    expect(sheet().outcome.label).toBe('Answer with contributors');
    peers = [peerFor(medium)]; session.refreshNetwork();
    c().runSheetAction();
    expect(view.snapshot().download?.open).toBe(true);
    await vi.waitFor(() => expect(view.snapshot().download?.ready).toBe(true));
    expect(view.snapshot().download.size).toBe('1200 MB download');
    c().closeDownload();
    expect(viewState.chosenModel.id).toBe(medium.id);
    expect(viewState.executionLocation).toBe('network');
    expect(composer().draft).toBe('Keep this draft');
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);

    // Cancel returns to the same Network choice. Finishing the reviewed download
    // stages local execution for this exact model; only the primary commits it.
    expect(sheet().open).toBe(true);
    expect(checked()).toBe('network');
    downloadLocalModel.mockImplementation(async () => session.setCachedModels([small]));
    c().runSheetAction();
    await vi.waitFor(() => expect(view.snapshot().download?.ready).toBe(true));
    c().confirmDownload();
    await vi.waitFor(() => expect(checked()).toBe('local'));
    expect(downloadLocalModel).toHaveBeenCalledWith(small.id, true);
    expect(sheet().selectedKey).toBe(small.id);
    expect(sheet().outcome.label).toBe('Answer on this device');
    expect(view.snapshot().download).toBeNull();
    expect(viewState.chosenModel.id).toBe(medium.id);
    c().runSheetAction();
    await vi.waitFor(() => expect(viewState.executionLocation).toBe('local'));
    expect(viewState.chosenModel.id).toBe(small.id);
    expect(composer().draft).toBe('Keep this draft');
    expect(service.calls).toHaveLength(0);
  });

  it('discards a pending local switch when the conversation changes during acquisition', async () => {
    await session.close();
    const [small, medium] = CANONICAL_CHAT_MODELS;
    session = createChatSession({ storage: null, service, models: [small, medium] });
    const origin = session.createThread({ model: medium, sharingScope: 'mesh', executionLocation: 'network', privacy: openPolicy });
    let finish;
    const downloadLocalModel = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    open(withoutIssue(session, { downloadLocalModel, getModelDownload: async id => ({ id, sizeBytes: 1200000000 }) }));
    c().openSheet();
    c().pickModel(small.id);
    c().runSheetAction();
    await vi.waitFor(() => expect(view.snapshot().download?.ready).toBe(true));
    c().confirmDownload();
    await vi.waitFor(() => expect(downloadLocalModel).toHaveBeenCalledOnce());
    const other = session.createThread({ model: medium, sharingScope: 'mesh', executionLocation: 'network', privacy: openPolicy });
    session.setCachedModels([small]); finish(); await tick();
    if (sheet().open) expect(checked()).toBe('network');
    expect(session.getState().activeThread.id).toBe(other);
    for (const id of [origin, other]) expect(session.getState().threads.find(thread => thread.id === id).model.id).toBe(medium.id);
    expect(service.calls).toHaveLength(0);
  });

  it('names the computers serving a whole-model variant without selecting it or changing the draft', async () => {
    await session.close();
    const [small, medium] = CANONICAL_CHAT_MODELS;
    session = createChatSession({ storage: null, service, models: [small, medium], swarm: { getState: () => ({ consumer: { peers: [peerFor(small), peerFor(medium)] } }) } });
    const viewState = { chosenModel: medium, executionLocation: 'network' };
    open(session, { viewState });
    c().setDraft('Keep this text');
    c().openSheet();
    const row = view.modelRows().find(item => item.value === small.id);
    expect(row.status).toBe('Ready · 1 computer');
    expect(row.providers.label).toBe(`View 1 computer serving ${small.name}`);
    // The row's chevron opens Computers narrowed to them (the composition passes this filter).
    expect(c().modelProviders(small.id)).toEqual({ providerIds: [small.id], label: small.name });
    c().closeSheet();
    expect(viewState.chosenModel.id).toBe(medium.id);
    expect(composer().draft).toBe('Keep this text');
    expect(service.calls).toHaveLength(0);
  });

  it('keeps a model with only pinned metadata discoverable and enables it when a provider or local cache appears', async () => {
    await session.close();
    const model = { ...CANONICAL_CHAT_MODELS[1], source: { files: CANONICAL_CHAT_MODELS[1].source.files } };
    let peers = [];
    session = createChatSession({ storage: null, service, models: [model], swarm: { getState: () => ({ consumer: { peers } }) } });
    const downloadInfo = vi.fn();
    open(withoutIssue(session, { getModelDownload: downloadInfo }));
    c().openSheet();
    c().pickModel(model.id);
    const group = () => sheet().sections.find(section => section.rows.some(row => row.value === model.id))?.id;
    expect(group()).toBe('unavailable');
    expect(sheet().outcome.disabled).toBe(true);
    expect(view.computer('network').disabled).toBe(false);
    expect(sheet().outcome.issue).toMatch(/^Finding computers…/);
    expect(sheet().localFit).toBe('');
    expect(downloadInfo).not.toHaveBeenCalled();
    peers = [peerFor(model, { peerId: 'shared' })];
    session.refreshNetwork();
    expect(group()).toBe('shared');
    expect(view.computer('network').disabled).toBe(false);
    expect(sheet().outcome.label).toBe('Answer with contributors');
    expect(sheet().outcome.disabled).toBe(false);
    peers = []; session.setCachedModels([model]);
    expect(group()).toBe('local');
    expect(view.computer('local').disabled).toBe(false);
    expect(service.calls).toHaveLength(0);
  });

  it('offers a reviewed model download for sharing and does nothing on cancel', async () => {
    c().startSharing(CANONICAL_CHAT_MODELS[1].id);
    await vi.waitFor(() => expect(view.snapshot().download?.ready).toBe(true));
    expect(view.snapshot().download.open).toBe(true);
    expect(view.snapshot().download.size).toBe('123 MB download');
    expect(view.snapshot().download.confirm).toBe('Download & share');
    expect(service.calls).toHaveLength(0);
    c().closeDownload();
    expect(view.snapshot().download).toBeNull();
    expect(service.calls).toHaveLength(0);
  });

  it('shows declared answer limits before sending, including the history allowance', () => {
    const model = { ...CANONICAL_CHAT_MODELS[1], availability: 'ready' };
    const project = state => ({ ...state, models: [model], answerLimits: [{ selectionId: model.id,
      cells: [{ maxConcurrency: 1, maxPromptTokens: 512, maxAnswerTokens: 255 },
        { maxConcurrency: 1, maxPromptTokens: 1024, maxAnswerTokens: 63 }] }] });
    open({ ...session, getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))) });
    c().openSheet();
    expect(sheet().open).toBe(true);
    const limit = composer().answerLimit;
    expect(limit).toContain('255 answer tokens for up to 512 input tokens');
    expect(limit).toContain('63 answer tokens for up to 1024 input tokens');
    expect(limit).toContain('Input includes conversation history');
    expect(service.calls).toHaveLength(0);
  });

  it('does not ask to change models while an admitted conversation is still running', () => {
    const model = { ...CANONICAL_CHAT_MODELS[1], availability: 'unavailable', networkAvailability: 'unavailable' };
    const project = state => ({ ...state, selectedId: 'running', runningIds: ['running'], models: [model],
      activeThread: { id: 'running', model, messages: [], attempts: [{ id: 'a', status: 'executing' }],
        permissions: { executionLocation: 'network', sharingScope: 'mesh' } } });
    open({ ...session, getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))) });
    expect(composer().privacy.disabled).toBe(true);
    expect(composer().status.text).toBe('');
    expect(composer().stop.visible).toBe(true);
    c().openSheet();
    expect(sheet().open).toBe(false);
  });

  it('previews optional capped context and retains each conversation setting', async () => {
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    const details = createDetailsServices({ host: { chat: session } });
    const stop = details.subscribe(() => {});
    expect(details.context(view.snapshot().draftContext)).toMatchObject({ enabled: true, maxWords: 16 });
    // A new conversation's context is staged with the draft and sent with its first message.
    c().setDraftContext({ enabled: true, maxWords: 32 });
    const preview = details.context(view.snapshot().draftContext).content;
    expect(preview).toContain('Reploid');
    expect(preview.split(/\s+/u).length).toBeLessThanOrEqual(32);
    let busyWhileRunning = false;
    const unsubscribe = session.subscribe(state => { if (state.runningIds.length) busyWhileRunning ||= details.project(null).busy; });
    view.send('First question');
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[0].status).toBe('completed'));
    unsubscribe();
    expect(busyWhileRunning).toBe(true);
    const first = session.getState().activeThread;
    expect(first.systemContext.content).toBe(preview);
    expect(first.attempts[0].request.messages[0]).toEqual({ role: 'system', content: preview });
    const other = session.createThread({ sharingScope: 'local', contextPrompt: { enabled: false } });
    expect(details.context(null).enabled).toBe(false);
    session.select(first.id);
    expect(details.context(null)).toMatchObject({ enabled: true, maxWords: 32 });
    await details.setContext(first.id, { enabled: false, maxWords: 32 });
    expect(session.getState().activeThread.systemContext.content).toBe('');
    expect(session.getState().threads.find(item => item.id === other).systemContext.content).toBe('');
    stop();
  });

  it('lists each exact model variant once, with its execution routes', async () => {
    const base = CANONICAL_CHAT_MODELS[1];
    const whole = { ...base, executionModes: ['whole-model', 'partition'], availability: 'ready', networkAvailability: 'ready', providerIds: ['peer-a'] };
    const route = { ...whole, selectionId: base.id + '/route', availability: 'ready', networkAvailability: 'ready', providerIds: [],
      partition: { route: { schema: 'reploid.partition-route/v1', stages: [{ participantId: 'peer-b' }, { participantId: 'peer-c' }] } } };
    const adapted = { ...whole, selectionId: base.id + '/adapter', name: 'Named adapter', adapters: [{ id: 'adapter', identity: 'sha256:adapter', name: 'Named adapter' }],
      availability: 'unavailable', networkAvailability: 'unavailable', providerIds: [] };
    const peers = [{ ...peerFor(base, { peerId: 'peer-a' }), hardware: { vendor: 'AMD', device: 'Reported GPU A', description: 'Driver string' } }];
    const project = state => ({ ...state, models: [whole, route, adapted], network: { consumer: { peers }, connections: [{ id: 'peer-a', phase: 'connected' }] } });
    open({ ...session, getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))) });
    c().openSheet();
    // One choice per variant: the base model and its adapter, not one per route.
    expect(view.modelRows().map(row => row.title)).toEqual([base.name, 'Named adapter']);
    expect(view.modelRows().find(row => row.checked).value).toBe(base.id);
    // Technical facts and routes wait in the sheet's details, not in the rows.
    expect(sheet().detailsOpen).toBe(false);
    expect(sheet().facts).toContain('Q4K');
    expect(sheet().routes.map(row => row.selectionId)).toEqual([base.id, route.selectionId]);
    expect(JSON.stringify(sheet().routes)).not.toMatch(/Reported GPU A|Driver string/);
    expect(sheet().routes.find(row => row.selectionId === route.selectionId).type).toContain('Distributed');
    // Choosing the distributed route keeps the same variant entry and changes only the route.
    c().pickModel(route.selectionId, { browsing: true });
    expect(sheet().selectedKey).toBe(route.selectionId);
    expect(view.modelRows()).toHaveLength(2);
    expect(view.modelRows().find(row => row.checked).title).toBe(base.name);
    // Each adapter has its own readiness.
    expect(view.modelRows().find(row => row.title === 'Named adapter').status).toBe('No computer serves it now');
    if (sheet().open && !sheet().outcome.disabled) c().runSheetAction();
    await vi.waitFor(() => expect(digest()).toBe(`Contributors · ${base.name}`));
  });

  it('selects the ready shared route through the composer picker without claiming an unavailable route is selected', async () => {
    const base = { ...CANONICAL_CHAT_MODELS[1], availability: 'unavailable', networkAvailability: 'unavailable' };
    const route = { ...base, selectionId: base.id + '/distributed', partition: { planId: 'test' }, availability: 'ready', networkAvailability: 'ready' };
    let state = { ...session.getState(), models: [base, route], defaultModel: base, defaultModels: null, peerDiscoveryTimedOut: true, discoveryPhase: 'observed', localDownloadIssue: null };
    let emit; const download = vi.fn();
    open({ ...session, downloadLocalModel: download, getModelDownload: async id => ({ id, sizeBytes: 123000000 }),
      getState: () => state, subscribe(fn) { emit = fn; fn(state); return () => {}; } }, { viewState: { chosenModel: base } });
    c().setDraft('hi');
    await chooseShared(route.selectionId);
    expect(selected()).toBe(route.selectionId);
    expect(composer().send.disabled).toBe(false);
    expect(composer().disclosure).toContain('Computers on this route can read the input for their own stages');
    expect(composer().chip.label).toContain(`Contributors · ${base.name}`);
    expect(composer().nextAction).not.toBe('download-local');
    expect(composer().draft).toBe('hi');
    state = { ...state, models: [base, { ...route, availability: 'unavailable', networkAvailability: 'unavailable' }] }; emit(state);
    expect(composer().send.disabled).toBe(true);
    expect(composer().status.text).toContain('No eligible computer');
    expect(composer().nextAction).not.toBe('download-local');
    expect(download).not.toHaveBeenCalled();
  });

  it('does not widen a local-only choice when a different model is only shared', async () => {
    await session.close();
    const [small, large] = CANONICAL_CHAT_MODELS;
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers: [peerFor(large, { peerId: 'shared' })] } }) } });
    session.setCachedModels([small]); open(session);
    session.createThread({ model: small, sharingScope: 'local' });
    c().openSheet();
    c().pickModel(large.id, { browsing: true });
    expect(checked()).toBe('local');
    // The preset is explained beside the model, and widening it is a separate, named action.
    expect(sheet().outcome.issue).toMatch(/^Only your devices can read this chat/);
    expect(sheet().outcome.label).toBe('Use contributors');
    expect(sheet().disclosure).toBe('Nothing leaves this device.');
    // A Contributors tap under the preset applies nothing either; it keeps the explanation and the offer.
    c().pickComputer('network');
    expect(sheet().disclosure).toMatch(/unless you choose Use contributors/);
    expect(session.getState().activeThread.permissions.sharingScope).toBe('local');
    expect(session.getState().activeThread.privacy.placement).toBe('local-only');
    expect(service.calls).toHaveLength(0);
  });

  it('keeps the composer source local until shared execution is confirmed in the picker', async () => {
    const model = { ...CANONICAL_CHAT_MODELS[1], localCached: true, availability: 'cached', networkAvailability: 'ready' };
    const state = { ...session.getState(), models: [model], defaultModel: model };
    open({ ...session, getState: () => state, subscribe(fn) { fn(state); return () => {}; } });
    expect(digest()).toContain('This device');
    await chooseShared(model.id);
    expect(digest()).toContain('Contributors');
    expect(composer().chip.label).toContain('Contributors');
    expect(service.calls).toHaveLength(0);
  });

  it('never pairs this device with a shared-only model: a tap moves the computer, a preset needs Use contributors', async () => {
    const stored = { ...CANONICAL_CHAT_MODELS[0], localCached: true, availability: 'cached', networkAvailability: 'unavailable' };
    const shared = { ...CANONICAL_CHAT_MODELS[1], availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] };
    const state = { ...session.getState(), models: [stored, shared], defaultModel: shared, discoveryPhase: 'observed', localDownloadIssue: null };
    const bind = viewState => open({ ...session, getState: () => state, subscribe(fn) { fn(state); return () => {}; } }, { fresh: true, viewState });
    // The owner's report: a fresh draft on this device must never open with a shared-only model chosen.
    // It opens on the model stored here, and its primary answers here.
    let viewState = {}; bind(viewState);
    c().openSheet();
    expect(checked()).toBe('local');
    expect(sheet().selectedKey).toBe(stored.id);
    expect(sheet().outcome.issue).toBe('');
    expect(sheet().outcome.label).toBe('Answer on this device');
    expect(digest()).toContain(stored.name);
    // This device keeps only a model that runs here; the shared model moves the computer to Contributors, staged and stated.
    c().pickComputer('network'); c().pickComputer('local');
    expect(sheet().selectedKey).toBe(stored.id);
    expect(sheet().outcome.label).toBe('Answer on this device');
    c().pickModel(shared.id, { browsing: true });
    expect(checked()).toBe('network');
    expect(sheet().open).toBe(true);
    expect(sheet().disclosure).toBe('The answering computer can read your prompt.');
    expect(sheet().outcome.label).toBe('Answer with contributors');
    c().runSheetAction();
    await vi.waitFor(() => expect(sheet().open).toBe(false));
    expect(viewState.privacy.recipients.kind).toBe('open');
    expect(digest()).toContain('Contributors');

    // Under "Only your devices" a shared model this device can download stays on this device, offered as its download;
    // tapping Contributors explains the preset, and Use contributors is the explicit preset change.
    viewState = { privacy: createExecutionPolicy(), privacyPreset: 'own-devices' }; bind(viewState);
    c().openSheet();
    c().pickModel(shared.id, { browsing: true });
    expect(checked()).toBe('local');
    expect(sheet().outcome.label).toBe(`Download ${shared.name}`);
    expect(viewState.privacy.placement).toBe('local-only');
    c().pickComputer('network');
    expect(sheet().outcome.issue).toMatch(/^Only your devices can read this chat/);
    expect(sheet().outcome.label).toBe('Use contributors');
    c().runSheetAction();
    await vi.waitFor(() => expect(sheet().open).toBe(false));
    expect(viewState.privacyPreset).toBe('standard');
    expect(viewState.privacy.recipients.kind).toBe('open');
    expect(service.calls).toHaveLength(0);
  });

  it('labels an adapted model once without merging distinct selections', () => {
    const state = { ...session.getState(), models: [
      { id: 'base', name: 'Base model', availability: 'ready' },
      { id: 'base', selectionId: 'adapted', name: 'Named adapter', adapters: [{ name: 'Named adapter', identity: 'a' }], availability: 'ready' },
      { id: 'base', selectionId: 'other', name: 'Base model', adapters: [{ name: 'Other adapter', identity: 'b' }], availability: 'ready' }
    ] };
    open({ ...session, getState: () => state, subscribe(fn) { fn(state); return () => {}; } });
    c().openSheet();
    expect(view.modelRows().map(row => [row.value, row.title])).toEqual([['base', 'Base model'], ['adapted', 'Named adapter'], ['other', 'Base model + Other adapter']]);
  });

  it('shows observed remote preparation without claiming readiness or asking to reconnect', async () => {
    await session.close();
    const peer = { available: true, description: { phase: 'loading',
      offer: { id: CANONICAL_CHAT_MODELS[1].id, identity: CANONICAL_CHAT_MODELS[1].identity } } };
    session = createChatSession({ storage: null, service, models: [CANONICAL_CHAT_MODELS[1]],
      swarm: { getState: () => ({ partitionPeers: [peer], consumer: { peers: [] } }) } });
    open(session);
    c().setDraft('Keep my question');
    expect(composer().status.text).toBe('Model preparing…');
    expect(composer().nextAction).not.toBe('retry');
    expectSendDoesNotDispatch();
    expect(service.calls).toHaveLength(0);
    peer.available = false; session.refreshNetwork();
    expect(composer().status.text).toContain('Finding computers…');
    expect(composer().nextAction).not.toBe('retry');
    expect(composer().draft).toBe('Keep my question');
  });

  it('uses the selected whole-request model preparation state without treating other models as capacity', async () => {
    await session.close();
    const model = CANONICAL_CHAT_MODELS[0], other = CANONICAL_CHAT_MODELS[1];
    const peers = [model, other].map((item, index) => ({ ...peerFor(item, { peerId: 'peer-' + index }), readiness: 'loading', availableSlots: 0 }));
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { connectionState: 'connected', peers } }) } });
    open(session, { viewState: { chosenModel: model } });
    c().setDraft('Keep my question');
    expect(composer().nextAction).not.toBe('retry');
    expectSendDoesNotDispatch();
    peers[0].readiness = 'ready'; peers[0].availableSlots = 1; session.refreshNetwork();
    expect(composer().send.disabled).toBe(false);
    expect(composer().nextAction).not.toBe('retry');
    peers.shift(); session.refreshNetwork();
    expect(selected()).toBe(model.id);
    expectSendDoesNotDispatch();
    expect(composer().nextAction).not.toBe('retry');
    expect(composer().draft).toBe('Keep my question');
    expect(service.calls).toHaveLength(0);
  });

  it('shows effective sharing choices and applies opt-outs before downloading without sending the draft', async () => {
    const events = [], model = CANONICAL_CHAT_MODELS[1];
    const project = state => ({ ...state, discoveryPhase: 'observed', localDownloadIssue: null,
      network: { ...state.network, computeEnabled: true, files: { enabled: true } } });
    open({ ...session, getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))),
      getModelDownload: async () => ({ id: model.id, sizeBytes: 2e9 }),
      getLocalModelFit: async () => ({ sizeBytes: 2e9, freeBytes: 1e9, gpuBytes: 3e9 }),
      setComputeContribution: async enabled => events.push(['compute', enabled]),
      setCachedFileContribution: async enabled => events.push(['files', enabled]),
      downloadLocalModel: async id => events.push(['download', id]) });
    c().setDraft('Keep this draft');
    c().downloadLocal();
    await vi.waitFor(() => expect(view.snapshot().download?.fit).toContain('Estimated GPU memory 3 GB'));
    expect(view.snapshot().download.fit).toContain('smaller than a fresh download');
    expect(view.snapshot().download.sharingValues).toEqual(['compute', 'files']);
    c().setDownloadSharing([]); c().closeDownload();
    expect(events).toEqual([]);
    c().downloadLocal();
    await vi.waitFor(() => expect(view.snapshot().download?.ready).toBe(true));
    expect(view.snapshot().download.sharingValues).toEqual(['compute', 'files']);
    c().setDownloadSharing([]); c().confirmDownload();
    await vi.waitFor(() => expect(events).toEqual([['compute', false], ['files', false], ['download', model.id]]));
    expect(composer().draft).toBe('Keep this draft');
    expect(service.calls).toHaveLength(0);
  });

  it('starts contribution only after the download confirmation, preserving the chat draft', async () => {
    const setSharing = vi.fn(), setComputeContribution = vi.fn();
    open(withoutIssue(session, { setSharing, setComputeContribution, getLocalModelFit: async () => null, getModelDownload: async id => ({ id, sizeBytes: 123000000 }) }));
    c().setDraft('Keep this question');
    c().startSharing(CANONICAL_CHAT_MODELS[1].id);
    await vi.waitFor(() => expect(view.snapshot().download?.ready).toBe(true));
    expect(view.snapshot().download.sharingValues).toContain('compute');
    expect(setComputeContribution).not.toHaveBeenCalled();
    expect(setSharing).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
    c().confirmDownload();
    await vi.waitFor(() => expect(setSharing).toHaveBeenCalledWith(true, CANONICAL_CHAT_MODELS[1].id, true));
    expect(composer().draft).toBe('Keep this question');
    expect(service.calls).toHaveLength(0);
  });

  it('names storage-only sharing on the button and never starts compute for it', async () => {
    const events = [], setSharing = vi.fn();
    open(withoutIssue(session, { setSharing, getLocalModelFit: async () => null, getModelDownload: async id => ({ id, sizeBytes: 123000000 }),
      setComputeContribution: async enabled => events.push(['compute', enabled]),
      setCachedFileContribution: async enabled => events.push(['files', enabled]),
      downloadLocalModel: async id => events.push(['download', id]) }));
    c().startSharing(CANONICAL_CHAT_MODELS[1].id);
    await vi.waitFor(() => expect(view.snapshot().download?.ready).toBe(true));
    c().setDownloadSharing(['files']);
    expect(view.snapshot().download.confirm).toBe('Download and share model files');
    expect(view.snapshot().download.explanation).toContain('does not answer requests');
    c().setDownloadSharing([]);
    expect(view.snapshot().download.confirm).toBe('Download model');
    c().setDownloadSharing(['files']);
    c().confirmDownload();
    await vi.waitFor(() => expect(events).toContainEqual(['download', CANONICAL_CHAT_MODELS[1].id]));
    expect(events).toContainEqual(['files', true]);
    expect(events).not.toContainEqual(['compute', true]);
    expect(setSharing).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
  });

  it('starts directly, appends followups and pins the conversation model', async () => {
    session.setCachedModels([CANONICAL_CHAT_MODELS[1]]);
    session.createThread({ sharingScope: 'local' });
    view.send('First message');
    await vi.waitFor(() => expect(session.getState().threads[0]?.attempts[0]?.status).toBe('completed'));
    expect(view.snapshot().messages.map(message => message.content).join(' ')).toContain('Fixture: First message');
    view.send('Followup');
    await vi.waitFor(() => expect(session.getState().activeThread.messages).toHaveLength(4));
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[1].status).toBe('completed'));
    expect(service.calls[0].source).toBe(CANONICAL_CHAT_MODELS[1].id);
  });

  it('offers a new model directly without changing an existing thread or draft', async () => {
    await session.close();
    session = createChatSession({ storage: null, service, models: CANONICAL_CHAT_MODELS.slice(0, 2) });
    open(session);
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    const id = session.createThread({ sharingScope: 'local' });
    c().setDraft('Keep this draft');
    c().openSheet();
    expect(sheet().open).toBe(true);
    expect(sheet().threadNote).toBe(true);
    expect(session.getState().selectedId).toBe(id);
    session.setCachedModels([CANONICAL_CHAT_MODELS[0]]);
    c().pickModel(CANONICAL_CHAT_MODELS[0].id, { browsing: true });
    c().runSheetAction();
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    expect(session.getState().threads[0].model.id).toBe(CANONICAL_CHAT_MODELS[1].id);
    session.select(id); expect(composer().draft).toBe('Keep this draft');
  });

  function waitingDraft(creation = null) {
    const model = CANONICAL_CHAT_MODELS[1], send = vi.fn(async () => {});
    let offer = { ...model, availability: 'unavailable', networkAvailability: 'unavailable', reachableProviderIds: [] };
    let phase = 'searching', notify;
    const getState = () => ({ ...session.getState(), discoveryPhase: phase, models: [offer], defaultModel: offer });
    const publish = () => notify(getState());
    open({ ...session, getState, send,
      createThread: creation ? async options => { await creation; return session.createThread(options); } : session.createThread,
      subscribe(listener) { notify = listener; return session.subscribe(publish); } });
    const write = text => c().setDraft(text);
    write('Exact question');
    return { send, write, setOffer(changes) { offer = { ...offer, ...changes }; publish(); }, setPhase(value) { phase = value; publish(); } };
  }

  it('queues a draft on Send while computers are being found, then sends it once a reachable slot appears', async () => {
    const f = waitingDraft();
    c().send();
    expect(composer().nextAction).toBe('cancel-queued');
    expect(composer().status.text).toContain('Waiting for a computer running');
    f.setOffer({ availability: 'ready', networkAvailability: 'ready', reachableProviderIds: [] });
    await Promise.resolve();
    expect(f.send).not.toHaveBeenCalled();
    f.setOffer({ reachableProviderIds: ['live'] });
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect(f.send.mock.calls[0].slice(1)).toEqual(['Exact question', []]);
    expect(session.getState().activeThread.permissions.executionLocation).toBe('network');
  });

  it('keeps the queued draft on the new conversation when its provider leaves during thread creation', async () => {
    let resume;
    const f = waitingDraft(new Promise(resolve => { resume = resolve; }));
    const draft = '  Exact question\n';
    f.write(draft);
    c().send();
    f.setOffer({ availability: 'ready', networkAvailability: 'ready', reachableProviderIds: ['live'] });
    await Promise.resolve();
    f.setOffer({ availability: 'unavailable', networkAvailability: 'unavailable', reachableProviderIds: [] });
    resume();
    await vi.waitFor(() => expect(session.getState().selectedId).toBeTruthy());
    expect(f.send).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(composer().draft).toBe(draft));
    expect(session.getDraft(session.getState().selectedId).text).toBe(draft);
  });

  it.each(['edit', 'identity', 'interrupt', 'cancel', 'retry'])('disarms queued delivery after %s and preserves the draft', async change => {
    const f = waitingDraft(), id = CANONICAL_CHAT_MODELS[1].identity;
    c().send();
    if (change === 'edit') { f.write('Edited question'); f.write('Exact question'); }
    if (change === 'identity') { f.setOffer({ identity: id + '-replaced' }); f.setOffer({ identity: id }); }
    if (change === 'interrupt') { f.setPhase('interrupted'); f.setPhase('searching'); }
    if (change === 'cancel') c().cancelQueuedSend();
    if (change === 'retry') { f.setPhase('observed'); c().retryConnection(); }
    f.setOffer({ availability: 'ready', networkAvailability: 'ready', reachableProviderIds: ['live'] });
    await Promise.resolve();
    expect(f.send).not.toHaveBeenCalled();
    expect(composer().nextAction).not.toBe('cancel-queued');
    expect(composer().draft).toBe('Exact question');
  });

  it('carries the text and file to the switched model without overwriting a separate unsent conversation', async () => {
    await session.close();
    const [first, second] = CANONICAL_CHAT_MODELS;
    session = createChatSession({ storage: null, service, models: [first, second] });
    const separate = { text: 'Another unsent question', files: [{ name: 'other.txt', text: 'other' }] };
    const carried = { text: 'Continue this question', files: [{ name: 'source.txt', text: 'source' }] };
    await session.saveDraft(null, separate);
    session.setCachedModels([first, second]);
    const origin = session.createThread({ model: first, sharingScope: 'local' });
    await session.saveDraft(origin, carried);
    open(session);
    c().openSheet();
    c().pickModel(second.id, { browsing: true });
    c().runSheetAction();
    await vi.waitFor(() => expect(sheet().open).toBe(false));
    const destination = session.getState().activeThread;
    expect(destination.id).not.toBe(origin);
    expect(destination.model.id).toBe(second.id);
    expect(session.getDraft(destination.id)).toEqual(carried);
    expect(session.getDraft(origin)).toEqual(carried);
    expect(session.getDraft(null)).toEqual(separate);
    expect(composer().draft).toBe(carried.text);
    expect(composer().files.map(file => file.name)).toContain('source.txt');
    expect(service.calls).toHaveLength(0);
  });

  it('keeps the newer selection when a switch is still saving the original draft', async () => {
    await session.close();
    const [first, second] = CANONICAL_CHAT_MODELS;
    session = createChatSession({ storage: null, service, models: [first, second] });
    session.setCachedModels([first, second]);
    const elsewhere = session.createThread({ model: first, sharingScope: 'local' });
    const origin = session.createThread({ model: first, sharingScope: 'local' });
    await session.saveDraft(elsewhere, { text: 'Different draft', files: [] });
    let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    const saveDraft = vi.fn(async (id, draft) => { await gate; return session.saveDraft(id, draft); });
    open({ ...session, saveDraft });
    c().setDraft('Original draft');
    c().openSheet();
    c().pickModel(second.id, { browsing: true });
    c().runSheetAction();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalled());
    await session.select(elsewhere);
    resume();
    await vi.waitFor(() => expect(sheet().open ? sheet().sections.flatMap(section => section.rows).every(row => !row.disabled) : true).toBe(true));
    expect(session.getState().selectedId).toBe(elsewhere);
    await vi.waitFor(() => expect(composer().draft).toBe('Different draft'));
    expect(session.getDraft(origin).text).toBe('Original draft');
  });

  it('keeps the picker blocking edits until a pending model switch has saved the current draft', async () => {
    await session.close();
    session = createChatSession({ storage: null, service, models: CANONICAL_CHAT_MODELS.slice(0, 2) });
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    let finish;
    const saved = new Promise(resolve => { finish = resolve; });
    const saveDraft = vi.fn().mockImplementationOnce(() => saved).mockResolvedValue(undefined);
    open({ ...session, saveDraft });
    session.createThread({ sharingScope: 'local' });
    c().openSheet();
    session.setCachedModels([CANONICAL_CHAT_MODELS[0]]);
    c().pickModel(CANONICAL_CHAT_MODELS[0].id, { browsing: true });
    c().runSheetAction();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(sheet().open).toBe(true);
    expect(sheet().outcome.disabled).toBe(true);
    expect(view.modelRows().every(row => row.disabled)).toBe(true);
    finish();
    await vi.waitFor(() => expect(sheet().open).toBe(false));
    expect(view.snapshot().focus.target).toBe('composer');
  });

  it('preserves a local-only grant when choosing a model that also has shared capacity', async () => {
    const model = CANONICAL_CHAT_MODELS[1];
    await session.close();
    session = createChatSession({ storage: null, service, models: [model], swarm: { getState: () => ({ consumer: { peers: [peerFor(model, { peerId: 'peer' })] } }) } });
    await session.prepareLocalModel(model.id);
    open(session);
    const original = session.createThread({ model, sharingScope: 'local' });
    c().openSheet(); c().runSheetAction();
    await vi.waitFor(() => expect(sheet().open).toBe(false));
    view.send('Keep this answer local');
    await vi.waitFor(() => expect(session.getState().activeThread?.id).toBe(original));
    expect(session.getState().activeThread.permissions.executionLocation).toBe('local');
    expect(session.getState().activeThread.permissions.sharingScope).toBe('local');
  });

  it('applies an available model on tap, keeps the draft and leaves the original thread on its model', async () => {
    const first = CANONICAL_CHAT_MODELS[0], second = CANONICAL_CHAT_MODELS[1];
    const peers = [first, second].map((model, index) => peerFor(model, { peerId: 'peer-' + index }));
    await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    open(session);
    const id = session.createThread({ model: first, privacy: openPolicy });
    c().setDraft('Keep this draft');
    c().openSheet();
    c().pickModel(second.id);
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    expect(sheet().open).toBe(false);
    expect(selected()).toBe(second.id);
    session.select(id);
    expect(session.getState().activeThread.model.id).toBe(first.id);
    expect(composer().draft).toBe('Keep this draft');
  });

  it('does not commit a model whose capacity disappears; the primary waits until it can answer again', async () => {
    const first = CANONICAL_CHAT_MODELS[0], second = CANONICAL_CHAT_MODELS[1];
    let peers = [peerFor(first, { peerId: 'peer-0' })];
    await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    open(session);
    const id = session.createThread({ model: first, privacy: openPolicy });
    c().openSheet();
    c().pickModel(second.id);
    expect(sheet().open).toBe(true);
    expect(sheet().outcome.disabled).toBe(true);
    expect(session.getState().selectedId).toBe(id);
    peers = [...peers, peerFor(second, { peerId: 'peer-1' })];
    session.refreshNetwork();
    expect(sheet().selectedKey).toBe(second.id);
    expect(sheet().outcome.disabled).toBe(false);
  });

  it('renames, archives, and restores a thread without changing its purpose or draft', async () => {
    const id = session.createThread({ purpose: 'Original instruction' });
    c().setDraft('Preserve draft');
    c().openRename(id);
    expect(view.snapshot().rename.value).toBe('Original instruction');
    c().setRenameValue('My thread'); c().saveRename();
    await vi.waitFor(() => expect(session.getState().activeThread.title).toBe('My thread'));
    expect(session.getState().activeThread.purpose).toBe('Original instruction');
    c().archiveThread(id);
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    c().showArchived(true);
    expect(view.snapshot().threads.items[0].title).toBe('My thread');
    c().archiveThread(id);
    await vi.waitFor(() => expect(session.getState().selectedId).toBe(id));
    expect(composer().draft).toBe('Preserve draft');
  });

  it('keeps drafts separate while selecting threads and starting a new one', async () => {
    const first = session.createThread({ purpose: 'First' });
    c().setDraft('Draft for first');
    c().newThread(); await tick();
    expect(composer().draft).toBe('');
    c().setDraft('New draft');
    c().selectThread(view.snapshot().threads.items[0].id); await tick();
    expect(session.getState().selectedId).toBe(first);
    expect(composer().draft).toBe('Draft for first');
    c().newThread(); await tick();
    expect(composer().draft).toBe('New draft');
  });

  it('keeps the stable placeholder and does not create empty stored threads', async () => {
    const previous = composer().placeholder;
    c().newThread(); await tick();
    expect(composer().placeholder).toBe(previous);
    expect(session.getState().threads).toHaveLength(0);
    expect(view.snapshot().messages).toEqual([]);
  });

  it('lists archived threads without losing the draft', () => {
    const id = session.createThread({ sharingScope: 'local' });
    session.archiveThread(id);
    c().setDraft('Keep my phone draft');
    c().showArchived(true);
    expect(view.snapshot().threads.archived).toBe(true);
    expect(view.snapshot().threads.items.map(item => item.id)).toEqual([id]);
    expect(composer().draft).toBe('Keep my phone draft');
  });

  it('surfaces execution failures instead of invented answers', async () => {
    service.open = async () => { throw new Error('GPU unavailable'); };
    const thread = session.createThread({ sharingScope: 'local' });
    await session.send(thread, 'Hello');
    const answer = view.snapshot().messages.at(-1);
    expect(answer.systemText).toBe('This answer could not finish.');
    expect(answer.error).toContain('GPU unavailable');
    expect(answer.content).not.toContain('Executing via');
  });

  it('keeps another thread running when the selected thread is cancelled', async () => {
    const first = session.createThread({ sharingScope: 'local' }), second = session.createThread({ sharingScope: 'local' });
    const a = session.send(first, 'First'), b = session.send(second, 'Second');
    session.select(first);
    expect(composer().stop.visible).toBe(true);
    c().stop();
    const [one, two] = await Promise.all([a, b]);
    expect(one.status).toBe('cancelled'); expect(two.status).toBe('completed');
    session.select(second);
    expect(view.snapshot().messages.map(message => message.content).join(' ')).toContain('Fixture: Second');
  });

  it('shows activity only for the executing selected thread and clears it on cancellation', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const scheduler = { getState: () => ({}), close: async () => {},
      async schedule(request, controls) {
        controls.onDelta('Working');
        await pending;
        return { content: 'Done', model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [] };
      } };
    await session.close();
    session = createChatSession({ storage: null, service, scheduler });
    const cancel = vi.fn(session.cancel);
    open(withoutIssue(session, { cancel, getModelDownload: async id => ({ id, sizeBytes: 123000000 }) }));
    const thread = session.createThread({ sharingScope: 'local' });
    const completion = session.send(thread, 'Hello');
    const answer = () => view.snapshot().messages.find(message => message.role === 'assistant');
    try {
      await vi.waitFor(() => expect(answer()?.activity?.active).toBe(true));
      session.select(null);
      expect(view.snapshot().messages).toEqual([]);
      session.select(thread);
      expect(answer().activity.active).toBe(true);
      c().stop();
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith(thread));
    } finally { release(); await completion; }
    expect(answer().activity?.active ?? false).toBe(false);
  });

  it('retries a failed response as a new attempt and preserves its partial text', async () => {
    let invocation = 0;
    const scheduler = { getState: () => ({}), close: async () => {},
      async schedule(request, controls) {
        controls.onDelta(invocation++ ? 'Recovered answer' : 'Partial answer');
        if (invocation === 1) throw new Error('Contributor disconnected');
        return { content: 'Recovered answer', model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [] };
      } };
    await session.close();
    session = createChatSession({ storage: null, service, scheduler });
    open(withoutIssue(session, { getModelDownload: async id => ({ id, sizeBytes: 123000000 }) }));
    session.setCachedModels([CANONICAL_CHAT_MODELS[1]]);
    const thread = session.createThread({ sharingScope: 'local' });
    await session.send(thread, 'Keep this question');
    expect(view.snapshot().messages.map(message => message.content).join(' ')).toContain('Partial answer');
    const retry = view.snapshot().messages.at(-1).retry;
    expect(retry.disabled).toBe(false);
    c().retryAttempt(retry.attemptId);
    await vi.waitFor(() => expect(session.getState().activeThread.attempts.at(-1).status).toBe('completed'));
    const result = session.getState().activeThread;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].retryOf).toBe(result.attempts[0].id);
    expect(result.messages.map(message => message.content)).toEqual(['Keep this question', 'Partial answer', 'Recovered answer']);
  });

  it('retains a deliberate new-thread model selection when its capacity disappears', async () => {
    const first = CANONICAL_CHAT_MODELS[0], second = CANONICAL_CHAT_MODELS[1];
    let peers = [first, second].map((model, index) => peerFor(model, { peerId: 'peer-' + index }));
    await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    open(session);
    await chooseShared(second.id);
    peers = peers.slice(0, 1); session.refreshNetwork();
    expect(selected()).toBe(second.id);
    expectSendDoesNotDispatch();
    c().openSheet();
    expect(view.modelRows().find(row => row.value === second.id).status).not.toMatch(/^Ready/);
  });

  it('automatically selects newly available capacity and preserves a thread model when its peer leaves', async () => {
    const model = CANONICAL_CHAT_MODELS[0];
    let peers = [];
    await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ discoveryScope: 'public', consumer: { peers } }) } });
    open(withoutIssue(session, { getModelDownload: async id => ({ id, sizeBytes: 123000000 }) }));
    expectSendDoesNotDispatch();
    expect(composer().chip.activity).toBe('idle');
    peers = [peerFor(model, { peerId: 'ready-peer' })];
    session.refreshNetwork();
    expect(selected()).toBe(model.id);
    expect(composer().send.disabled).toBe(false);
    expect(composer().chip.activity).toBe('ready');
    session.createThread();
    peers = []; session.refreshNetwork();
    expect(composer().chip.activity).toBe('idle');
    expect(selected()).toBe(model.id);
    expect(composer().send.disabled).toBe(true);
    view.send('Keep my draft');
    expect(composer().draft).toBe('Keep my draft');
    expect(session.getState().activeThread.attempts).toEqual([]);
    expect(view.snapshot().download).toBeNull();
  });

  it('preserves drafts and attachments when selecting a shared model without initiating downloads or disclosing contents', async () => {
    const [small, medium] = CANONICAL_CHAT_MODELS;
    const peers = [small, medium].map((model, index) => peerFor(model, { peerId: 'peer-' + index }));
    const downloadLocalModel = vi.fn();
    await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ discoveryScope: 'public', consumer: { peers } }) } });
    open({ ...session, downloadLocalModel });
    c().setDraft('Draft with private notes');
    c().attach([new File(['Private file body'], 'notes.txt', { type: 'text/plain' })]);
    await vi.waitFor(() => expect(composer().files.map(file => file.name)).toContain('notes.txt'));
    await chooseShared(small.id);
    expect(view.snapshot().focus.target).toBe('composer');
    expect(composer().draft).toBe('Draft with private notes');
    expect(composer().files.map(file => file.name)).toContain('notes.txt');
    expect(selected()).toBe(small.id);
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
    expect(session.getState().threads).toHaveLength(0);
  });
});
