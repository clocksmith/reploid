import { describe, it, expect, afterEach, vi } from 'vitest';
import { creditCapText, renderConversationWorkspace, bindConversationWorkspace } from '../../apps/poolday/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

// A paired, online desktop needs no privacy dialog or model picker: the composer sends only to it.
describe('Paired desktop default', () => {
  let root, session, dispose;
  afterEach(async () => { dispose?.(); await session?.close(); root?.remove(); });

  const setup = (ownerPairing, extra = {}) => {
    const [model] = CANONICAL_CHAT_MODELS;
    const peers = extra.peers ?? [{ peerId: 'transport-1', model: model.id, modelIdentity: model.identity, readiness: 'ready',
      hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 }];
    const real = createChatSession({ storage: null, service: createChatTestService(),
      swarm: { getState: () => ({ consumer: { peers } }), connect: async () => {} } });
    const inject = state => ({ ...state, ownerPairing, ...(extra.guestAccess ? { guestAccess: extra.guestAccess() } : {}), ...(extra.state ?? {}) });
    session = { ...real, getState: () => inject(real.getState()),
      subscribe: listener => real.subscribe(state => listener(inject(state))), ...(extra.guestJoin ? { guestJoin: extra.guestJoin } : {}) };
    root = document.createElement('div'); document.body.append(root);
    root.innerHTML = renderConversationWorkspace();
    const viewState = {};
    dispose = bindConversationWorkspace(root, session, { viewState });
    real.setCachedModels([]);
    return { model, viewState };
  };

  it('states the most a priced route can cost, and nothing for a route without terms', () => {
    expect(creditCapText({ creditCap: { maximum: 1600, unit: 'noncash-service-credit' } })).toBe(`This answer costs at most ${(1600).toLocaleString()} service credits.`);
    expect(creditCapText({ creditCap: { maximum: 1 } })).toBe('This answer costs at most 1 service credit.');
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
    expect(root.querySelector('[data-composer-send]').disabled).toBe(false);
    expect(root.textContent).toContain(`Sending to ${host}.`);
  });

  it('names an unreachable paired desktop and says how to bring it back, without promising to wake it', () => {
    setup({ status: 'offline', paired: true, canSend: false, hostParticipantId: 'peer:91d1d9293ca2d973191156dc', hostLabel: 'Mars' },
      { peers: [], state: { discoveryPhase: 'observed' } });
    expect(root.querySelector('[data-model-status]').textContent).toBe('Mars is offline. Open Reploid on Mars.');
    expect(root.textContent).not.toMatch(/wake/i);
  });

  describe('a stale tap on the desktop row', () => {
    const host = 'peer:91d1d9293ca2d973191156dc';
    const tapDesktop = () => {
      // The row as it was drawn before the desktop's state changed.
      const row = root.querySelector('[data-execution-choice="desktop"]');
      row.disabled = false;
      row.setAttribute('aria-pressed', 'false');
      row.click();
    };
    const online = () => ({ status: 'online', paired: true, canSend: true, hostParticipantId: host, hostLabel: 'Mars',
      readyModel: CANONICAL_CHAT_MODELS[0].id, disclosure: { readableBy: `Readable by: ${host}`, notice: `This runs on ${host}.` } });

    it('keeps the conversation on the desktop while it is offline', () => {
      const pairing = online();
      const { viewState } = setup(pairing);
      Object.assign(pairing, { status: 'offline', canSend: false });
      tapDesktop();
      expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    });

    it('never opens the conversation to any contributor once the desktop is gone', () => {
      const pairing = online();
      const { viewState } = setup(pairing);
      Object.assign(pairing, { status: 'unpaired', paired: false, canSend: false, hostParticipantId: null });
      tapDesktop();
      expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    });
  });

  it('leaves the default policy alone when no desktop is paired', () => {
    const { viewState } = setup({ status: 'unpaired', paired: false, canSend: false, hostParticipantId: null });
    expect(viewState.privacy).toBeUndefined();
  });

  it('locks a guest invite to its host, keeps that lock over a manual choice and clears the token from the address', () => {
    const host = 'peer:860c7025bc31969cada679cd';
    history.replaceState(null, '', `/#circle=${'T'.repeat(43)}&host=${encodeURIComponent(host)}&name=Mars`);
    const { viewState } = setup({ status: 'unpaired', paired: false, canSend: false, hostParticipantId: null });
    expect(location.hash).toBe('');
    expect(viewState.guestInvite.hostPeerId).toBe(host);
    expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    expect(root.textContent).toContain('Sending to Mars.');
    history.replaceState(null, '', '/');
  });

  it('offers one Join action for an invite, keeps Send off until joined, then sends only to that host', async () => {
    const host = 'peer:860c7025bc31969cada679cd', token = 'T'.repeat(43);
    history.replaceState(null, '', `/#circle=${token}&host=${encodeURIComponent(host)}&name=Mars&room=reploid-swarm-owner-abc`);
    let guest = { status: 'none', joined: false, hostParticipantId: null, hostLabel: null, error: '' };
    const guestJoin = { join: vi.fn(async () => { guest = { status: 'online', joined: true, hostParticipantId: host, hostLabel: 'Mars',
      readyModel: CANONICAL_CHAT_MODELS[0].id, error: '' }; return {}; }) };
    const { viewState } = setup({ status: 'unpaired', paired: false, canSend: false, hostParticipantId: null },
      { guestAccess: () => guest, guestJoin });
    const join = root.querySelector('[data-join-host]');
    expect(join.hidden).toBe(false);
    expect(join.textContent).toBe('Join Mars');
    expect(root.querySelector('[data-composer-send]').disabled).toBe(true);
    join.click();
    expect(guestJoin.join).toHaveBeenCalledWith({ hostPeerId: host, token, hostLabel: 'Mars', roomId: 'reploid-swarm-owner-abc' });
    await vi.waitFor(() => expect(viewState.guestInvite).toBeNull());
    expect(join.hidden).toBe(true);
    expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    expect(root.querySelector('[data-composer-send]').disabled).toBe(false);
    history.replaceState(null, '', '/');
  });
});
