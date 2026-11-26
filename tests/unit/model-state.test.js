// The shared model checks: a model's key, whether it is stored on this device, and which availability statuses
// count as serving, usable, preparing or selectable. Each test reads the check through the places that use it, so
// the places agree with the composer's routing reading (model-select.js modelExecutionState).
import { afterEach, expect, it } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { openConversation } from '../fixtures/conversation-view.js';
import { modelChoiceGroups, modelExecutionState } from '../../apps/poolday/ui/components/model-select.js';
import { selectAvailableChatModel, servesPublicAnswers } from '../../apps/poolday/host/chat-view.js';
import { startingLocalModel } from '../../apps/poolday/ui/pool-home/choice-availability.js';
import { canDownloadModelHere } from '../../apps/poolday/ui/pool-home/conversation-model-picker.js';
import { answerChoiceOf } from '../../apps/poolday/ui/pool-home/answer-choice.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const [SMALL, MEDIUM] = CANONICAL_CHAT_MODELS;
const pool = { requester: { participantId: 'peer:pool' } };

function composerFor(models) {
  const host = createChatSession({ storage: null, models: [SMALL, MEDIUM] });
  cleanups.push(() => host.close());
  const state = { ...host.getState(), models, defaultModel: models[0], localDownloadIssue: null, discoveryPhase: 'searching', peerDiscoveryTimedOut: false };
  const view = openConversation({ ...host, getState: () => state, subscribe: () => () => undefined }, { viewState: {} });
  cleanups.push(() => view.dispose());
  return view.composer();
}

it('keys a model by its selection, else its id', () => {
  expect(answerChoiceOf({ id: 'm', selectionId: 'm/split', identity: 'x' }).selectionId).toBe('m/split');
  expect(answerChoiceOf({ id: 'm', identity: 'x' }).selectionId).toBe('m');
});

it('names the serving, usable, preparing and selectable statuses', () => {
  const status = networkAvailability => modelExecutionState({ networkAvailability }, 'network');
  expect(['ready', 'busy', 'cached', 'loading', 'preparing', 'unavailable'].filter(value => status(value).usable)).toEqual(['ready', 'busy', 'cached']);
  expect(['ready', 'busy', 'loading', 'preparing', 'unavailable'].filter(value => servesPublicAnswers({ networkAvailability: value })))
    .toEqual(['ready', 'busy']);
  expect(modelChoiceGroups(['loading', 'preparing', 'unavailable'].map(value => ({ id: value, networkAvailability: value })), { location: 'network', keep: [] })
    .map(group => [group.id, group.models.map(model => model.id)])).toEqual([['shared', ['loading', 'preparing']], ['network-unavailable', ['unavailable']]]);
});

it('reads a private pool model with local flags the way each place reads it today', () => {
  const pooled = { ...SMALL, fleet: pool, localCached: true, availability: 'cached', networkAvailability: 'unavailable' };
  // The routing reading: stored here, so it runs here.
  expect(modelExecutionState(pooled, 'auto').source).toBe('local');
  // The conversation's first-visit check and the local starting model leave a private pool's model out.
  expect(composerFor([pooled, { ...MEDIUM }]).disclosure).toBe('A network provider could read your prompt.');
  expect(startingLocalModel([pooled])).toBe(null);
  expect(canDownloadModelHere({ ...pooled, localCached: false, availability: 'unavailable', source: { baseUrl: 'https://x/' } }, {}, true)).toBe(false);
});

it('reads a model marked cached only by its availability the way each place reads it today', () => {
  const cached = { ...SMALL, availability: 'cached' };
  expect(modelExecutionState(cached, 'local').status).toBe('cached');
  // The session's starting choice on this device reads only localCached.
  expect(selectAvailableChatModel([cached], [], 'local')).toBe(null);
});

it('lists a split route with local flags the way each place lists it today', () => {
  const split = { ...MEDIUM, selectionId: `${MEDIUM.id}/split`, partition: { planId: 'p' }, localCached: true, networkAvailability: 'unavailable' };
  expect(modelExecutionState(split, 'auto').source).toBe('network');
  expect(modelChoiceGroups([split], { location: 'auto' }).map(group => group.id)).toEqual(['local']);
});
