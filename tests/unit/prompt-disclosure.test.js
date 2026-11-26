// Who can read the prompt, as each place on the page states it today (TRUST-01, FIRST-02 criterion 3): the composer
// line, the "Answer on" sheet line and its outcome sentence, the Standard row and the notes of "Who can read it?", the
// split note, the route rows and the invite notice. One table per case, so a wording that changes, or that two places
// state differently for the same case, shows here.
import { afterEach, expect, it } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { openConversation } from '../fixtures/conversation-view.js';
import { createExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';
import { describeCircleHost } from '../../apps/poolday/host/circle-invites.js';
import { formatHostDisclosure } from '../../server/circles/admission.js';
import { presetDisclosure } from '../../apps/poolday/ui/pool-home/privacy-controls.js';
import { ownDevicesChoice, protectionChoices, routeChoices } from '../../apps/poolday/ui/pool-home/choice-availability.js';
import { SPLIT_DISPLAY, splitReadersLine } from '../../shared/vendor/reploid/inference/protections.js';
import { DISCLOSURE_WORDING, promptDisclosure } from '../../apps/poolday/host/decisions/prompt-disclosure.js';
import { describeAnswerChoice } from '../../apps/poolday/ui/pool-home/conversation-model-picker.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const [SMALL, MEDIUM] = CANONICAL_CHAT_MODELS;
const DESKTOP = 'peer:0123456789abcdef01234567';
const served = model => ({ ...model, availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] });
const stored = model => ({ ...model, localCached: true, availability: 'cached', networkAvailability: 'unavailable' });
const open = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, computation: 'plaintext' });
const named = ids => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids }, computation: 'plaintext' });

/** The composer line, then the sheet line once "Answer on" is open, for one session state and staged view state. */
function readers(state, viewState = {}, { pick = null } = {}) {
  const host = createChatSession({ storage: null, models: [SMALL, MEDIUM] });
  cleanups.push(() => host.close());
  const current = { ...host.getState(), localDownloadIssue: null, discoveryPhase: 'observed', peerDiscoveryTimedOut: true, ...state };
  current.defaultModel ??= current.models[0];
  const api = { ...host, getState: () => current, subscribe: () => () => undefined,
    getModelDownload: async id => ({ id, sizeBytes: 1000 }), downloadLocalModel: async () => undefined };
  const view = openConversation(api, { viewState });
  cleanups.push(() => view.dispose());
  const composer = view.composer().disclosure;
  view.controller.openSheet();
  if (pick) pick(view.controller);
  return { composer, sheet: view.sheet().disclosure, outcome: view.sheet().outcome.issue };
}

it('states who can read the prompt in the composer and the "Answer on" sheet, case by case', () => {
  const pairing = { ownerPairing: { status: 'online', hostParticipantId: DESKTOP, hostLabel: 'Studio' } };
  const partition = { ...served(MEDIUM), selectionId: `${MEDIUM.id}/distributed`, partition: { planId: 'test', participantA: 'peer:a', participantB: 'peer:b' } };
  const pool = { ...served(MEDIUM), fleet: { requester: { participantId: 'peer:pool' } } };
  const table = {
    local: readers({ models: [stored(SMALL)] }),
    stored: readers({ models: [stored(SMALL), served(MEDIUM)] }, { privacy: createExecutionPolicy() }),
    desktop: readers({ models: [served(SMALL)], ...pairing }),
    invite: readers({ models: [served(SMALL)] }, { guestInvite: { hostPeerId: DESKTOP, hostLabel: 'Ada’s laptop', token: 'x'.repeat(43) } }),
    named: readers({ models: [served(SMALL)] }, { privacy: named(['peer:fedcba9876543210fedcba98']) }),
    split: readers({ models: [{ ...MEDIUM, availability: 'unavailable', networkAvailability: 'unavailable' }, partition] },
      { privacy: open, chosenModel: partition }),
    pool: readers({ models: [pool] }, { privacy: open, chosenModel: pool }),
    blocked: readers({ models: [stored(SMALL), served(MEDIUM)] }, { privacy: createExecutionPolicy(), privacyPreset: 'own-devices' },
      { pick: controller => controller.pickComputer('network') }),
    unusable: readers({ models: [{ ...SMALL, availability: 'unavailable', networkAvailability: 'unavailable' }] }, { privacy: open, privacyTouched: true }),
    finding: readers({ models: [SMALL, MEDIUM], discoveryPhase: 'searching', peerDiscoveryTimedOut: false }),
    'non-plaintext': readers({ models: [served(SMALL)] }, { privacy: { ...open, computation: 'cryptographic' } }),
  };
  expect(table).toMatchInlineSnapshot(`
    {
      "blocked": {
        "composer": "Nothing leaves this device.",
        "outcome": "Only your devices can read this chat, so contributors can’t answer. Using contributors lets the answering computer read your messages.",
        "sheet": "Nothing leaves this device unless you choose Use contributors.",
      },
      "desktop": {
        "composer": "Sending to Studio. Its operator can read your prompt.",
        "outcome": "",
        "sheet": "Sending to Studio. Its operator can read your prompt.",
      },
      "finding": {
        "composer": "A network provider could read your prompt.",
        "outcome": "No contributor serves this model now. Download it to run it here; you see its size first.",
        "sheet": "The answering computer can read your prompt.",
      },
      "invite": {
        "composer": "Sending to Ada’s laptop. Its operator can read your prompt.",
        "outcome": "",
        "sheet": "Sending to Ada’s laptop. Its operator can read your prompt.",
      },
      "local": {
        "composer": "Nothing leaves this device.",
        "outcome": "",
        "sheet": "Nothing leaves this device.",
      },
      "named": {
        "composer": "Named computers can read your prompt.",
        "outcome": "",
        "sheet": "The answering computer can read your prompt.",
      },
      "non-plaintext": {
        "composer": "The required computation mode is unavailable.",
        "outcome": "",
        "sheet": "The answering computer can read your prompt.",
      },
      "pool": {
        "composer": "The answering computer can read your prompt.",
        "outcome": "",
        "sheet": "The answering computer in your private pool can read your prompt.",
      },
      "split": {
        "composer": "Computers on this route can read the input for their own stages.",
        "outcome": "",
        "sheet": "Computers on this route can read the input for their own stages.",
      },
      "stored": {
        "composer": "Nothing leaves this device.",
        "outcome": "",
        "sheet": "Nothing leaves this device.",
      },
      "unusable": {
        "composer": "A network provider could read your prompt.",
        "outcome": "No contributor serves this model now. Download it to run it here; you see its size first.",
        "sheet": "The answering computer can read your prompt.",
      },
    }
  `);
});

it('states who can read it in "Who can read it?": the Standard row, the notes, the split note and the route rows', () => {
  expect({
    standardRow: protectionChoices().find(row => row.value === 'plaintext').status,
    standardNote: presetDisclosure('standard'),
    ownDevicesNote: presetDisclosure('own-devices'),
    ownDevicesWithDesktopNote: presetDisclosure('own-devices', { desktop: 'Studio' }),
    localRoute: routeChoices().find(row => row.value === 'local').status,
    ownDevicesOnLocalRoute: ownDevicesChoice({ route: 'local' }).status,
    splitNote: splitReadersLine(2),
    splitEdgesNote: SPLIT_DISPLAY['requester-edges'].line,
  }).toMatchInlineSnapshot(`
    {
      "localRoute": "This device runs the whole model. Nothing leaves it.",
      "ownDevicesNote": "Only this device runs the model. Nothing leaves this device, and no network participant sees its metadata.",
      "ownDevicesOnLocalRoute": "Unavailable: This device runs it; nothing leaves it.",
      "ownDevicesWithDesktopNote": "This device and Studio run the model and read your content in plaintext, so they can also see its access patterns; no other computer can read it. When Studio answers, a relay that carries the connection can see its timing and message sizes. Studio counts as yours because you approved its pairing code.",
      "splitEdgesNote": "Your devices handle the prompt and answer. Other computers see intermediate data that may reveal both.",
      "splitNote": "2 computers can read your message.",
      "standardNote": "The computer that answers reads your content in plaintext and can see its access patterns, and you approve it before anything is sent. The request's model identity, timing and message sizes can also be visible to the coordinators, credit ledgers and relays that carry the request.",
      "standardRow": "Computers that process your request can read the data they receive.",
    }
  `);
});

it('states who can read it in the sheet outcome sentence', () => {
  const network = { ...served(MEDIUM) };
  const pool = { ...served(MEDIUM), fleet: { requester: { participantId: 'peer:pool' } } };
  expect({
    onContributorsFromThisDevice: describeAnswerChoice(network, 'local').issue,
    onPoolFromThisDevice: describeAnswerChoice(pool, 'local').issue,
    blockedContributors: describeAnswerChoice(network, 'network', { block: 'own-devices' }).issue,
    blockedPool: describeAnswerChoice(pool, 'network', { block: 'own-devices' }).issue,
    guestOtherModel: describeAnswerChoice({ ...MEDIUM, availability: 'unavailable', networkAvailability: 'unavailable' }, 'network',
      { block: 'guest', locked: { label: 'Ada’s laptop' } }).issue,
  }).toMatchInlineSnapshot(`
    {
      "blockedContributors": "Only your devices can read this chat, so contributors can’t answer. Using contributors lets the answering computer read your messages.",
      "blockedPool": "Only your devices can read this chat, so your private pool can’t answer. Using it lets the answering pool computer read your messages.",
      "guestOtherModel": "Only Ada’s laptop may read your messages. Choose a model it runs.",
      "onContributorsFromThisDevice": "This model runs on contributors’ computers, not this device. The answering computer reads your messages.",
      "onPoolFromThisDevice": "This model runs on your private computers, not this device. The answering computer reads your messages.",
    }
  `);
});

it('states the invite notice the same way on the page and on the host that admits the guest', () => {
  expect(describeCircleHost('Ada’s laptop').notice).toMatchInlineSnapshot(`"This runs on Ada’s laptop. Its operator can read your prompt."`);
  expect(formatHostDisclosure({ hostPeerId: DESKTOP, hostLabel: 'Ada’s laptop' }).notice).toBe(describeCircleHost('Ada’s laptop').notice);
});

it('draws every wording from promptDisclosure, one table of cases by site', () => {
  const facts = { operator: 'Studio', desktop: 'Studio', stageCount: 2 };
  const table = Object.fromEntries(Object.entries(DISCLOSURE_WORDING).map(([name, sites]) =>
    [name, Object.fromEntries(Object.keys(sites).map(site => [site, typeof sites[site] === 'function' ? sites[site](facts) : sites[site]]))]));
  // The composer names no private pool: it states that case as the answering computer.
  expect(promptDisclosure({ site: 'composer', pool: true })).toBe(table.answering.composer);
  expect(promptDisclosure({ site: 'sheet', pool: true })).toBe(table.pool.sheet);
  expect(() => promptDisclosure({ site: 'invite', named: true })).toThrow(/states no disclosure/);
  // The cases whose sites state them in different words: the owner picks one wording for each.
  const differing = Object.entries(table).filter(([, sites]) => new Set(Object.values(sites)).size > 1).map(([name]) => name);
  expect(differing).toEqual(['local', 'operator', 'blocked', 'blocked-pool', 'stages', 'answering']);
});
