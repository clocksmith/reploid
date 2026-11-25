import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindConversationWorkspace, renderConversationWorkspace } from '../../apps/poolday/ui/pool-home/conversation-workspace.js';
import { createChatSession } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { createRoutePreference, DEFAULT_ROUTE_PREFERENCE, normalizeRoutePreference, rankRoutes, ROUTE_PREFERENCES, routeObservations } from '../../apps/poolday/host/route-preference.js';

const candidate = (name, availableSlots = 1) => ({ peerId: `conn-${name}`, verifiedIdentity: `peer:${name}`, contributionScore: 0, availableSlots });
const answer = (recipient, { status = 'completed', error = null, characters = 100, seconds = 10, id, model = 'model-a' } = {}) => ({
  attempt: { id, responseId: `${id}-r`, status, error, createdAt: 1000, finishedAt: 1000 + seconds * 1000,
    request: { model: { identity: model } }, privacyBinding: { route: { hops: [{ recipient, placement: 'remote', disclosure: 'plaintext' }] } } },
  message: { id: `${id}-r`, role: 'assistant', content: 'x'.repeat(characters) }
});
const thread = rows => {
  const made = rows.map(([recipient, options], index) => answer(recipient, { ...options, id: `a${index}` }));
  return { attempts: made.map(row => row.attempt), messages: made.map(row => row.message) };
};

describe('route observations', () => {
  it('counts finished and dropped answers per computer, with the median output rate', () => {
    const seen = routeObservations([thread([
      ['peer:a', { characters: 100, seconds: 10 }], ['peer:a', { characters: 300, seconds: 10 }], ['peer:a', { characters: 500, seconds: 10 }],
      ['peer:a', { status: 'failed', error: 'Execution peer disconnected; retry requires a new attempt' }],
    ])], 'model-a');
    expect(seen.get('peer:a')).toEqual({ completed: 3, dropped: 1, charactersPerSecond: 30 });
  });

  it('measures speed per model, and keeps a computer\'s record across models', () => {
    const rows = thread([['peer:a', { characters: 100, seconds: 10 }], ['peer:a', { characters: 9000, seconds: 10, model: 'model-b' }],
      ['peer:a', { status: 'failed', error: 'Execution peer disconnected; retry requires a new attempt', model: 'model-b' }]]);
    expect(routeObservations([rows], 'model-a').get('peer:a')).toEqual({ completed: 2, dropped: 1, charactersPerSecond: 10 });
    expect(routeObservations([rows], 'model-b').get('peer:a').charactersPerSecond).toBe(900);
    expect(routeObservations([rows], 'model-c').get('peer:a').charactersPerSecond).toBeNull();
    expect(routeObservations([rows]).get('peer:a').charactersPerSecond).toBeNull();
  });

  it('does not hold a refusal, a model error or a stopped answer against a computer', () => {
    const seen = routeObservations([thread([
      ['peer:a', { status: 'failed', error: 'Host denied remote prompt disclosure' }],
      ['peer:a', { status: 'failed', error: 'No GPU' }], ['peer:a', { status: 'cancelled' }],
    ])]);
    expect(seen.has('peer:a')).toBe(false);
  });

  it('ignores an answer that crossed several computers', () => {
    const row = thread([['peer:a', {}]]);
    row.attempts[0].privacyBinding.route.hops.push({ recipient: 'peer:b', placement: 'remote', disclosure: 'plaintext' });
    expect(routeObservations([row]).size).toBe(0);
  });
});

describe('ranking eligible computers', () => {
  const fastButFlaky = ['peer:fast', { characters: 1000, seconds: 10 }];
  const drop = ['peer:fast', { status: 'failed', error: 'Execution peer disconnected; retry requires a new attempt' }];
  const slowAndSteady = ['peer:steady', { characters: 100, seconds: 10 }];
  const seen = routeObservations([thread([fastButFlaky, drop, drop, drop, slowAndSteady, slowAndSteady, slowAndSteady])], 'model-a');
  const both = [candidate('steady'), candidate('fast')];

  it('each preference puts a different computer first when the evidence differs', () => {
    expect(rankRoutes(both, 'faster', seen)[0]).toBe('conn-fast');
    expect(rankRoutes(both, 'more-reliable', seen)[0]).toBe('conn-steady');
  });

  it('only orders the computers it was given', () => {
    for (const { id } of ROUTE_PREFERENCES) expect(rankRoutes(both, id, seen).sort()).toEqual(['conn-fast', 'conn-steady']);
  });

  it('keeps the default order when nothing is known or the evidence ties', () => {
    expect(rankRoutes(both, 'faster', new Map())).toBeNull();
    expect(rankRoutes([candidate('only')], 'faster', seen)).toBeNull();
    const tied = routeObservations([thread([['peer:x', {}], ['peer:y', {}]])], 'model-a');
    expect(rankRoutes([candidate('y'), candidate('x')], 'balanced', tied)).toEqual(['conn-y', 'conn-x']);
  });

  it('ignores evidence for a connection that has not proven its identity', () => {
    const unproven = [{ ...candidate('fast'), verifiedIdentity: null }, { ...candidate('other'), verifiedIdentity: null }];
    expect(rankRoutes(unproven, 'faster', seen)).toBeNull();
  });

  it('does not let speed on another model decide', () => {
    const rows = thread([['peer:fast', { characters: 9000, model: 'model-b' }], ['peer:fast', { characters: 10 }], ['peer:steady', { characters: 100 }]]);
    expect(rankRoutes(both, 'faster', routeObservations([rows], 'model-a'))[0]).toBe('conn-steady');
    expect(rankRoutes(both, 'faster', routeObservations([rows], 'model-b'))[0]).toBe('conn-fast');
  });

  it('scores an unreported slot count between full and free', () => {
    const even = routeObservations([thread([['peer:a', {}], ['peer:b', {}]])], 'model-a');
    const row = (name, slots) => ({ ...candidate(name), availableSlots: slots });
    expect(rankRoutes([row('a', 0), row('b', null)], 'balanced', even)[0]).toBe('conn-b');
    expect(rankRoutes([row('a', null), row('b', 4)], 'balanced', even)[0]).toBe('conn-b');
  });

  it('offers no cost preference while no offer carries a price', () => {
    expect(ROUTE_PREFERENCES.map(({ id }) => id)).not.toContain('lower-cost');
    expect(normalizeRoutePreference('lower-cost')).toBe(DEFAULT_ROUTE_PREFERENCE);
  });
});

describe('the stored preference', () => {
  const memory = (values = new Map()) => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });

  it('defaults to Balanced, persists a choice and refuses an unknown one', () => {
    const storage = memory();
    const preference = createRoutePreference({ storage });
    expect(preference.get()).toBe(DEFAULT_ROUTE_PREFERENCE);
    preference.set('faster');
    expect(createRoutePreference({ storage }).get()).toBe('faster');
    expect(() => preference.set('cheapest')).toThrow('Unknown answer preference');
    expect(preference.get()).toBe('faster');
  });

  it('treats a corrupt stored value as the default', () => {
    expect(normalizeRoutePreference('nonsense')).toBe(DEFAULT_ROUTE_PREFERENCE);
    expect(createRoutePreference({ storage: memory(new Map([['REPLOID_ROUTE_PREFERENCE', 'nonsense']])) }).get()).toBe(DEFAULT_ROUTE_PREFERENCE);
  });
});

describe('the Settings control', () => {
  let root, session, dispose;
  afterEach(async () => { dispose?.(); await session?.close(); root?.remove(); });

  it('shows the stored preference, and a change reaches the session and survives', () => {
    const values = new Map([['REPLOID_ROUTE_PREFERENCE', 'more-reliable']]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const routePreference = createRoutePreference({ storage });
    session = createChatSession({ storage: null, service: createChatTestService(), routePreference,
      swarm: { getState: () => ({ consumer: { peers: [] } }), connect: async () => {} } });
    root = document.createElement('div'); document.body.append(root);
    root.innerHTML = renderConversationWorkspace();
    dispose = bindConversationWorkspace(root, session, { viewState: {} });
    session.setCachedModels([]);
    // Three exclusive modes are one segmented radio group, derived from whether several computers may answer.
    const choices = [...root.querySelectorAll('[data-route-preference]')];
    expect(choices[0].closest('[role=radiogroup]')).not.toBeNull();
    expect(choices.map(input => input.closest('label').textContent)).toEqual(['Balanced', 'Faster', 'More reliable']);
    expect(choices.find(input => input.checked).value).toBe('more-reliable');
    const reason = root.querySelector('[data-route-preference-reason]').textContent;
    expect(choices.every(input => input.disabled === !!reason)).toBe(true);
    const listener = vi.fn();
    const stop = session.subscribe(listener);
    const faster = choices.find(input => input.value === 'faster');
    faster.disabled = false; faster.click();
    stop();
    expect(session.getRoutePreference()).toBe('faster');
    expect(values.get('REPLOID_ROUTE_PREFERENCE')).toBe('faster');
    expect(listener).toHaveBeenCalled();
  });
});
