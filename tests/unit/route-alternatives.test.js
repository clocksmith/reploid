import { afterEach, describe, expect, it } from 'vitest';
import { routeAlternatives } from '../../apps/poolday/ui/pool-home/route-alternatives.js';
import { openConversation } from '../fixtures/conversation-view.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

const model = (network, local = false) => ({ id: 'm', networkAvailability: network ? 'ready' : 'unavailable', localReady: local });
const offline = { id: 'peer:desktop', label: 'Studio', status: 'offline' };
const keys = input => routeAlternatives(input).map(offer => offer.key);

describe('routes offered when the chosen tier cannot answer', () => {
  it('offers only routes that exist, each saying who could read the request', () => {
    const offers = routeAlternatives({ current: 'desktop', model: model(true, true), desktop: offline });
    expect(offers.map(offer => offer.key)).toEqual(['device', 'contributors']);
    expect(offers[0].reads).toBe('Stays on this device.');
    expect(offers[1].reads).toMatch(/operator .* can read this conversation/);
  });

  it('offers nothing when no other route exists, so the composer stops and says why', () => {
    expect(keys({ current: 'desktop', model: model(false), desktop: offline })).toEqual([]);
  });

  it('offers nothing while the chosen route can answer', () => {
    expect(keys({ current: 'desktop', model: model(true), desktop: { ...offline, status: 'online' } })).toEqual([]);
    expect(keys({ current: 'contributors', model: model(true) })).toEqual([]);
    expect(keys({ current: 'device', model: model(true, true) })).toEqual([]);
  });

  it('never offers a guest another computer, or judges a custom list of computers', () => {
    expect(keys({ current: 'desktop', model: model(true), desktop: { ...offline, guest: true } })).toEqual([]);
    expect(keys({ current: 'named', model: model(true) })).toEqual([]);
  });

  it('waits while computers are still being found, while answering and for a fresh visitor', () => {
    for (const state of [{ searching: true }, { busy: true }, { closed: true }, { fresh: true }]) {
      expect(keys({ current: 'desktop', model: model(true), desktop: offline, ...state })).toEqual([]);
    }
  });
});

describe('taking an offer', () => {
  let view, session;
  afterEach(async () => { view?.dispose(); await session?.close(); });

  it('a conversation the person put on the desktop widens only when they pick the offer, and nothing is sent', async () => {
    const host = 'peer:91d1d9293ca2d973191156dc', [catalog] = CANONICAL_CHAT_MODELS;
    const pairing = { status: 'online', paired: true, canSend: true, hostParticipantId: host, hostLabel: 'Studio', readyModel: catalog.id,
      disclosure: { readableBy: `Readable by: ${host}`, notice: `This runs on ${host}.` } };
    const peers = [{ peerId: 'transport-1', model: catalog.id, modelIdentity: catalog.identity, readiness: 'ready', role: 'provider',
      hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 }];
    const real = createChatSession({ storage: null, service: createChatTestService(),
      swarm: { getState: () => ({ consumer: { peers } }), connect: async () => {} } });
    const inject = state => ({ ...state, ownerPairing: pairing, discoveryPhase: 'observed' });
    let sent = 0;
    session = { ...real, getState: () => inject(real.getState()), subscribe: listener => real.subscribe(state => listener(inject(state))),
      send: (...args) => { sent += 1; return real.send(...args); } };
    const viewState = {};
    view = openConversation(session, { viewState });
    real.setCachedModels([]);
    expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    expect(view.composer().routeAlternatives).toEqual([]);
    // The person chooses the desktop: that restriction is theirs, and it stays when the desktop goes offline.
    view.controller.openSheet(); view.controller.pickComputer('desktop'); view.controller.closeSheet();

    Object.assign(pairing, { status: 'offline', canSend: false });
    real.setCachedModels([]);
    const offers = view.composer().routeAlternatives;
    expect(offers.length).toBeGreaterThan(0);
    // Being offered a lower tier changes nothing.
    expect(viewState.privacy.recipients).toEqual({ kind: 'named', ids: [host] });
    const contributors = offers.find(offer => offer.key === 'contributors');
    expect(contributors.reads).toContain('can read this conversation');
    view.controller.takeRouteAlternative('contributors');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(viewState.privacy.recipients).toEqual({ kind: 'open', ids: [] });
    expect(sent).toBe(0);
  });
});
