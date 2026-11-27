// The headless conversation workspace (apps/poolday/host/decisions/conversation-controller.js) on the host's real
// chat session, with discovery and capacity supplied by a fixture, as the first-visitor journeys drive it.
import { describe, it, expect } from 'vitest';
import { createExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';
import { createConversationController } from '../../apps/poolday/host/decisions/conversation-controller.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';

function fixtureSession({ discoveryPhase = 'observed', models = [CANONICAL_CHAT_MODELS[0]] } = {}) {
  const host = createChatSession({ storage: null, models });
  const listeners = new Set();
  let reads = 0;
  let state = { ...host.getState(), peerDiscoveryTimedOut: discoveryPhase === 'observed', discoveryPhase, localDownloadIssue: null };
  const notify = () => listeners.forEach(listener => listener(state));
  const api = {
    ...host,
    getState: () => { reads++; return state; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    connect: async () => {},
    getModelDownload: async id => ({ id, sizeBytes: 123000000 }),
    downloadLocalModel: async () => {}
  };
  return {
    api, reads: () => reads,
    set(change) { state = { ...state, ...change }; notify(); },
    peer() {
      state = { ...state, discoveryPhase: 'observed', peerDiscoveryTimedOut: true, models: [{ ...state.models[0], availability: 'ready', networkAvailability: 'ready',
        providerIds: ['fixture-peer'], reachableProviderIds: ['fixture-peer'] }] };
      notify();
    }
  };
}

const memoryStorage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('conversation controller', () => {
  it('starts a first visitor on contributors, says nothing can answer yet, and keeps the download optional', () => {
    const fixture = fixtureSession();
    const controller = createConversationController(fixture.api, { href: () => 'http://localhost/' });
    const { composer } = controller.getSnapshot();
    // One resolved route: every indicator names contributors, and none implies this device is ready.
    expect(composer.route).toMatchObject({ destination: 'contributors', status: 'unavailable', send: 'none' });
    expect(composer.status.text).toBe('No eligible computer found for this model.');
    expect(composer.nextAction).toBe('retry');
    expect(composer.optionalAction).toBe('download-local');
    expect(composer.chip.source).toBe('Contributors');
    expect(composer.chip.availability).toBe('unavailable');
    expect(composer.placeholder).toBe('Message…');
    expect(composer.privacy.caption).toBe('Standard');
    expect(composer.send.disabled).toBe(true);
    controller.dispose();
  });

  it('queues the first Send while computers are found without asking where to run, and cancels back to the draft', async () => {
    const fixture = fixtureSession({ discoveryPhase: 'searching' });
    const controller = createConversationController(fixture.api, { href: () => 'http://localhost/' });
    controller.setDraft('Explain ocean tides.');
    expect(controller.getSnapshot().composer.status.text).toContain('Finding computers');
    controller.send();
    let snapshot = controller.getSnapshot();
    expect(snapshot.sheet.open).toBe(false);
    // No model is named yet, so the wait names none.
    expect(snapshot.composer.status.text).toBe('Finding computers…');
    expect(snapshot.composer.nextAction).toBe('cancel-queued');
    controller.cancelQueuedSend();
    expect(controller.getSnapshot().composer.status.text).toContain('Finding computers');
    fixture.peer();
    snapshot = controller.getSnapshot();
    expect(snapshot.composer.disclosure).toBe('The answering computer can read your prompt.');
    expect(snapshot.composer.draft).toBe('Explain ocean tides.');
    expect(snapshot.messages).toEqual([]);
    controller.dispose();
  });

  it('sends nothing once disposed: a Send queued while computers are found does not leave after the screen closes', async () => {
    const fixture = fixtureSession({ discoveryPhase: 'searching' });
    const sends = [];
    fixture.api.send = (...args) => { sends.push(args); return Promise.resolve(); };
    const controller = createConversationController(fixture.api, { href: () => 'http://localhost/' });
    controller.setDraft('Explain ocean tides.');
    controller.send();
    expect(controller.getSnapshot().composer.nextAction).toBe('cancel-queued');
    // A computer turns up and the screen closes in the same tick, before the held Send's microtask runs.
    fixture.peer();
    controller.dispose();
    await tick(); await tick();
    // Nor does a direct Send after dispose go out.
    controller.send();
    await tick(); await tick();
    expect(sends).toEqual([]);
  });

  it('stages protection and route in "Who can read it?" and applies them only with Apply', async () => {
    const fixture = fixtureSession();
    const controller = createConversationController(fixture.api, { href: () => 'http://localhost/', viewState: { privacy: createExecutionPolicy() } });
    controller.openPrivacy();
    let { privacy } = controller.getSnapshot();
    expect(privacy.open).toBe(true);
    expect(privacy.protection).toBe('plaintext');
    expect(privacy.route).toBe('local');
    expect(privacy.protections.map(row => row.value)).toEqual(['plaintext', 'secret-sharing', 'homomorphic', 'attested']);
    expect(privacy.protections.filter(row => row.disabled).map(row => row.value)).toEqual(['secret-sharing', 'homomorphic', 'attested']);
    expect(privacy.ownDevicesOption.disabled).toBe(true);
    controller.pickRoute('auto');
    expect(controller.getSnapshot().composer.privacy.caption).toBe('Standard · Your devices');
    controller.applyPrivacy();
    await tick();
    privacy = controller.getSnapshot().privacy;
    expect(privacy.open).toBe(false);
    expect(controller.getSnapshot().composer.privacy.caption).toBe('Standard');
    controller.openPrivacy();
    controller.pickProtection('homomorphic');
    controller.applyPrivacy();
    await tick();
    expect(controller.getSnapshot().privacy.error).toMatch(/unavailable here\. Nothing was changed\./);
    controller.dispose();
  });

  it('remembers the Answer on choice for the next visit', async () => {
    const storage = memoryStorage();
    const fixture = fixtureSession();
    fixture.peer();
    const first = createConversationController(fixture.api, { storage, href: () => 'http://localhost/' });
    first.openSheet();
    first.pickComputer('network');
    await tick();
    first.closeSheet();
    first.openSheet();
    first.commitSheet();
    await tick(); await tick();
    first.dispose();
    expect(JSON.parse(storage.getItem('reploid.answer-choice.v1')).route).toBe('contributors');
    const next = createConversationController(fixture.api, { storage, href: () => 'http://localhost/' });
    expect(next.getSnapshot().composer.chip.source).toBe('Contributors');
    next.dispose();
  });

  it('does more work per update for a longer conversation only where it changed, never per thread', async () => {
    const measure = async threadCount => {
      const fixture = fixtureSession();
      fixture.peer();
      let projected = 0;
      const controller = createConversationController(fixture.api, { href: () => 'http://localhost/', onProjectMessage: () => { projected++; } });
      const base = fixture.api.getState();
      const model = base.models[0];
      const threads = Array.from({ length: threadCount }, (_, index) => ({
        id: `thread-${index}`, model, createdAt: index, permissions: { sharingScope: 'mesh', executionLocation: 'network' }, privacy: null,
        messages: [{ id: `u-${index}`, role: 'user', content: `Question ${index}` }, { id: `a-${index}`, role: 'assistant', content: `Answer ${index}`, attemptId: `at-${index}` }],
        attempts: [{ id: `at-${index}`, status: 'completed', createdAt: index, finishedAt: index + 1 }]
      }));
      fixture.set({ threads, selectedId: 'thread-0', activeThread: threads[0] });
      const readsBefore = fixture.reads();
      projected = 0;
      // One streaming update to the selected thread's answer, delivered as the host delivers it: a fresh copy of everything.
      for (let step = 0; step < 5; step++) {
        const copy = structuredClone(threads);
        copy[0].messages[1].content += ` more ${step}`;
        fixture.set({ threads: copy, activeThread: copy[0] });
      }
      await tick();
      controller.dispose();
      return { projected, reads: fixture.reads() - readsBefore };
    };
    const few = await measure(2), many = await measure(30);
    // Only the changed answer is re-projected on each update, whatever the number of threads.
    expect(few.projected).toBe(5);
    expect(many.projected).toBe(few.projected);
    // The controller works from the state each notification delivers; it never rebuilds the host's state itself.
    expect(many.reads).toBe(0);
  });
});
