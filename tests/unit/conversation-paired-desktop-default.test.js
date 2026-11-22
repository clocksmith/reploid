import { describe, it, expect, afterEach } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../apps/poolday/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

// A paired, online desktop needs no privacy dialog or model picker: the composer sends only to it.
describe('Paired desktop default', () => {
  let root, session, dispose;
  afterEach(async () => { dispose?.(); await session?.close(); root?.remove(); });

  const setup = ownerPairing => {
    const [model] = CANONICAL_CHAT_MODELS;
    const peers = [{ peerId: 'transport-1', model: model.id, modelIdentity: model.identity, readiness: 'ready',
      hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 }];
    const real = createChatSession({ storage: null, service: createChatTestService(),
      swarm: { getState: () => ({ consumer: { peers } }), connect: async () => {} } });
    const inject = state => ({ ...state, ownerPairing });
    session = { ...real, getState: () => inject(real.getState()),
      subscribe: listener => real.subscribe(state => listener(inject(state))) };
    root = document.createElement('div'); document.body.append(root);
    root.innerHTML = renderConversationWorkspace();
    const viewState = {};
    dispose = bindConversationWorkspace(root, session, { viewState });
    real.setCachedModels([]);
    return { model, viewState };
  };

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
});
