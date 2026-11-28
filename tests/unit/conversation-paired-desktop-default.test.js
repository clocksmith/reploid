import { createExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { creditCapText, createConversationController } from '../../apps/poolday/host/decisions/conversation-controller.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

// A paired, online desktop needs no privacy dialog or model picker: the composer sends only to it.
describe('Paired desktop default', () => {
  let controller, session;
  afterEach(async () => { controller?.dispose(); await session?.close(); });
  const composer = () => controller.getSnapshot().composer;

  const setup = (ownerPairing, extra = {}) => {
    const [model] = CANONICAL_CHAT_MODELS;
    const peers = extra.peers ?? [{ peerId: 'transport-1', model: model.id, modelIdentity: model.identity, readiness: 'ready',
      hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 }];
    const real = createChatSession({ storage: null, service: createChatTestService(),
      swarm: { getState: () => ({ consumer: { peers } }), connect: async () => {} } });
    const inject = state => ({ ...state, ownerPairing, ...(extra.guestAccess ? { guestAccess: extra.guestAccess() } : {}), ...(extra.state ?? {}) });
    session = { ...real, getState: () => inject(real.getState()),
      subscribe: listener => real.subscribe(state => listener(inject(state))), ...(extra.guestJoin ? { guestJoin: extra.guestJoin } : {}) };
    const viewState = {};
    controller = createConversationController(session, { viewState, href: () => location.href,
      forgetInvite: () => history.replaceState(history.state, '', location.pathname + location.search) });
    real.setCachedModels([]);
    return { model, viewState };
  };

  it('states the most a priced route can cost, and nothing for a route without terms', () => {
    expect(creditCapText({ creditCap: { maximum: 1600, unit: 'noncash-service-credit' } })).toBe(`This answer costs at most ${(1600).toLocaleString()} service credits.`);
    expect(creditCapText({ creditCap: { maximum: 1 } })).toBe('This answer costs at most 1 service credit.');
    // The host's reading of the account says before Send when the ledger would refuse; enough credit adds nothing.
    expect(creditCapText({ creditCap: { maximum: 48, spendable: 32 } })).toBe('This answer costs at most 48 service credits. '
      + 'Your account can cover 32 now, so this would be refused before anything is sent. Serving answers for others earns more.');
    expect(creditCapText({ creditCap: { maximum: 48, spendable: -5 } })).toContain('Your account can cover 0 now');
    expect(creditCapText({ creditCap: { maximum: 48, spendable: 48 } })).toBe('This answer costs at most 48 service credits.');
    for (const route of [{}, null, { creditCap: { maximum: 0 } }, { creditCap: { maximum: 1.5 } }]) expect(creditCapText(route)).toBe('');
  });

  it('restricts a new conversation to the paired desktop and its ready model without opening any dialog', () => {
    const host = 'peer:91d1d9293ca2d973191156dc';
    const { model, viewState } = setup({ status: 'online', paired: true, canSend: true, hostParticipantId: host,
      hostLabel: host, readyModel: CANONICAL_CHAT_MODELS[0].id,
      disclosure: { readableBy: `Readable by: ${host}`, notice: `This runs on ${host}. Its operator can read your prompt.` } });
    expect(viewState.privacy.placement).toBe('network-allowed');
    expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    expect(viewState.privacy.computation).toBe('plaintext');
    expect(viewState.chosenModel?.id).toBe(model.id);
    expect(composer().send.disabled).toBe(false);
    expect(composer().disclosure).toContain('Sending to your desktop.');
  });

  describe('a saved pairing whose desktop is offline', () => {
    const host = 'peer:91d1d9293ca2d973191156dc';
    const offline = () => ({ status: 'offline', paired: true, canSend: false, hostParticipantId: host, hostLabel: 'Mars' });
    const served = model => [{ peerId: 'contributor-1', model: model.id, modelIdentity: model.identity, readiness: 'ready', role: 'provider',
      hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 }];

    it('leaves an unpinned automatic conversation on an eligible contributor, with no desktop banner and no private name', () => {
      const [model] = CANONICAL_CHAT_MODELS;
      setup(offline(), { peers: served(model), state: { discoveryPhase: 'observed', peerDiscoveryTimedOut: true } });
      expect(composer().route).toMatchObject({ destination: 'contributors', status: 'ready', send: 'dispatch' });
      expect(composer().chip.source).toBe('Contributors');
      expect(composer().status.text).not.toMatch(/offline/i);
      expect(composer().send.disabled).toBe(false);
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('Mars');
    });

    it('blocks a conversation restricted to your devices, names the desktop generically and never offers Send to a contributor', () => {
      const [model] = CANONICAL_CHAT_MODELS;
      const { viewState } = setup(offline(), { peers: served(model), state: { discoveryPhase: 'observed', peerDiscoveryTimedOut: true } });
      viewState.privacyTouched = true;
      viewState.privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [host] }, computation: 'plaintext' });
      controller.setDraft('Only for my desktop');
      expect(composer().route).toMatchObject({ destination: 'desktop', restricted: true, status: 'blocked', send: 'none' });
      expect(composer().status.text).toBe('Your desktop is offline. Open Reploid on your desktop.');
      expect(composer().chip.source).toBe('Your desktop');
      expect(composer().chip.availability).toBe('unavailable');
      expect(composer().placeholder).toBe('Message…');
      expect(composer().nextAction).toBeNull();
      expect(composer().send.disabled).toBe(true);
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('Mars');
      expect(JSON.stringify(controller.getSnapshot())).not.toMatch(/wake/i);
      // Nothing is dispatched, and the restriction stands.
      const send = vi.spyOn(session, 'send');
      controller.send();
      expect(send).not.toHaveBeenCalled();
      expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
      expect(composer().draft).toBe('Only for my desktop');
    });

    it('keeps a thread restricted to your devices blocked while the desktop is offline, and never switches it', async () => {
      const [model] = CANONICAL_CHAT_MODELS;
      setup(offline(), { peers: served(model), state: { discoveryPhase: 'observed', peerDiscoveryTimedOut: true } });
      const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [host] }, computation: 'plaintext' });
      const threadId = await session.createThread({ model, executionLocation: 'network', privacy });
      await session.select(threadId);
      await vi.waitFor(() => expect(controller.getSnapshot().selectedId).toBe(threadId));
      controller.setDraft('Thread message');
      expect(composer().route).toMatchObject({ destination: 'desktop', restricted: true, status: 'blocked', send: 'none' });
      expect(composer().status.text).toBe('Your desktop is offline. Open Reploid on your desktop.');
      const send = vi.spyOn(session, 'send');
      controller.send();
      expect(send).not.toHaveBeenCalled();
      expect(session.getState().activeThread.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('Mars');
    });

    it('returns a draft that followed the desktop only by default to automatic once the desktop goes offline', () => {
      const pairing = { status: 'online', paired: true, canSend: true, hostParticipantId: host, hostLabel: 'Mars',
        readyModel: CANONICAL_CHAT_MODELS[0].id, disclosure: { readableBy: 'x', notice: 'x' } };
      const { viewState } = setup(pairing, { state: { discoveryPhase: 'observed', peerDiscoveryTimedOut: true } });
      expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
      Object.assign(pairing, { status: 'offline', canSend: false, readyModel: null });
      controller.setDraft('Any eligible computer');
      expect(viewState.privacy).toBeUndefined();
      expect(composer().route.destination).toBe('contributors');
      expect(composer().status.text).not.toMatch(/offline/i);
    });

    it('keeps an explicit desktop pick on the desktop and blocked while it is offline', () => {
      const pairing = { status: 'online', paired: true, canSend: true, hostParticipantId: host, hostLabel: 'Mars',
        readyModel: CANONICAL_CHAT_MODELS[0].id, disclosure: { readableBy: 'x', notice: 'x' } };
      const { viewState } = setup(pairing, { state: { discoveryPhase: 'observed', peerDiscoveryTimedOut: true } });
      controller.openSheet(); controller.pickComputer('desktop'); controller.closeSheet();
      Object.assign(pairing, { status: 'offline', canSend: false, readyModel: null });
      controller.setDraft('Still for my desktop');
      expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
      expect(composer().route.status).toBe('blocked');
      expect(composer().send.disabled).toBe(true);
    });
  });

  describe('a stale tap on the desktop row', () => {
    const host = 'peer:91d1d9293ca2d973191156dc';
    // A tap on the desktop row as it was drawn before the desktop's state changed.
    const tapDesktop = () => { controller.openSheet(); controller.pickComputer('desktop'); };
    const online = () => ({ status: 'online', paired: true, canSend: true, hostParticipantId: host, hostLabel: 'Studio',
      readyModel: CANONICAL_CHAT_MODELS[0].id, disclosure: { readableBy: `Readable by: ${host}`, notice: `This runs on ${host}.` } });

    it('keeps the conversation on the desktop while it is offline', () => {
      const pairing = online();
      const { viewState } = setup(pairing);
      Object.assign(pairing, { status: 'offline', canSend: false });
      tapDesktop();
      expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    });

    it('changes nothing for a tap on a desktop that is gone', () => {
      const pairing = online();
      const { viewState } = setup(pairing);
      Object.assign(pairing, { status: 'unpaired', paired: false, canSend: false, hostParticipantId: null });
      tapDesktop();
      // The tap is refused: it neither restricts nor opens the conversation. The draft had followed the desktop only by
      // default, so it is automatic again.
      expect(viewState.privacyTouched).toBeFalsy();
      expect(viewState.privacy).toBeUndefined();
      expect(composer().error).toBe('That desktop is no longer available. Nothing was changed.');
    });
  });

  it('leaves the default policy alone when no desktop is paired', () => {
    const { viewState } = setup({ status: 'unpaired', paired: false, canSend: false, hostParticipantId: null });
    expect(viewState.privacy).toBeUndefined();
  });

  it('locks a guest invite to its host, keeps that lock over a manual choice and clears the token from the address', () => {
    const host = 'peer:860c7025bc31969cada679cd';
    history.replaceState(null, '', `/#circle=${'T'.repeat(43)}&host=${encodeURIComponent(host)}&name=Studio`);
    const { viewState } = setup({ status: 'unpaired', paired: false, canSend: false, hostParticipantId: null });
    expect(location.hash).toBe('');
    expect(viewState.guestInvite.hostPeerId).toBe(host);
    expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    expect(composer().disclosure).toContain('Sending to Studio.');
    history.replaceState(null, '', '/');
  });

  it('offers one Join action for an invite, keeps Send off until joined, then sends only to that host', async () => {
    const host = 'peer:860c7025bc31969cada679cd', token = 'T'.repeat(43);
    history.replaceState(null, '', `/#circle=${token}&host=${encodeURIComponent(host)}&name=Studio&room=reploid-swarm-owner-abc`);
    let guest = { status: 'none', joined: false, hostParticipantId: null, hostLabel: null, error: '' };
    const guestJoin = { join: vi.fn(async () => { guest = { status: 'online', joined: true, hostParticipantId: host, hostLabel: 'Studio',
      readyModel: CANONICAL_CHAT_MODELS[0].id, error: '' }; return {}; }) };
    const { viewState } = setup({ status: 'unpaired', paired: false, canSend: false, hostParticipantId: null },
      { guestAccess: () => guest, guestJoin });
    expect(composer().nextAction).toBe('join');
    expect(composer().nextLabels.join).toBe('Join Studio');
    expect(composer().send.disabled).toBe(true);
    controller.joinHost();
    expect(guestJoin.join).toHaveBeenCalledWith({ hostPeerId: host, token, hostLabel: 'Studio', roomId: 'reploid-swarm-owner-abc' });
    await vi.waitFor(() => expect(viewState.guestInvite).toBeNull());
    expect(composer().nextAction).not.toBe('join');
    expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    expect(composer().send.disabled).toBe(false);
    history.replaceState(null, '', '/');
  });
});
