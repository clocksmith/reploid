/**
 * Who can read the prompt: the one source of that sentence for every place the page states it. A place passes what
 * it knows (where the request runs, who it is named to, the model's kind) and its `site`; the case is decided here in
 * one order, and the wording is the one that site shows for that case.
 *
 * Several sites state the same case in different words today. Each keeps its own wording in WORDING below, so this
 * module changes no visible text; picking one wording per case is the owner's decision
 * (tests/unit/prompt-disclosure.test.js pins every wording, site by site).
 */
import { EXECUTION_BACKENDS } from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { PROTECTION_DISPLAY, SPLIT_DISPLAY, splitReadersLine } from '../../../../shared/vendor/reploid/inference/protections.js';

/**
 * Where each wording is shown:
 * - `composer`: the line above the message field;
 * - `sheet`: the line of the "Answer on" sheet;
 * - `outcome`: the sheet's sentence beside the chosen model;
 * - `invite`: the notice of a host invite link;
 * - `protection`: the Standard row of "Who can read it?";
 * - `preset`: the note under "Who can read it?";
 * - `route`: the This device row of "Where it runs";
 * - `own-devices`: why "Only your devices" is off on This device;
 * - `split-note`: the note of a route in stages in "Who can read it?";
 * - `alternative`: an offer of another route beside the composer, when the chosen one cannot answer.
 */
export const DISCLOSURE_SITES = Object.freeze(['composer', 'sheet', 'outcome', 'invite', 'protection', 'preset', 'route', 'own-devices', 'split-note', 'alternative']);

const METADATA_WORDS = { 'model-id': 'model identity', timing: 'timing', length: 'message sizes', 'access-patterns': 'access patterns' };
const sentence = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
// A plaintext executor reads the content, so it also sees access patterns; the rest can reach the carriers too.
const NETWORK_METADATA = EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata.filter(item => item !== 'access-patterns')
  .map(item => METADATA_WORDS[item] || item);

const NOTHING_LEAVES = 'Nothing leaves this device.';
const ANSWERING = 'The answering computer can read your prompt.';
const STAGES = 'Computers on this route can read the input for their own stages.';
const sendingTo = ({ operator }) => `Sending to ${operator}. Its operator can read your prompt.`;
const BLOCKED_SHEET = 'Nothing leaves this device unless you choose Use contributors.';

/** Each case's wording, by site. A function receives the facts the site passed. */
const WORDING = Object.freeze({
  'unavailable-mode': { composer: 'The required computation mode is unavailable.' },
  local: {
    composer: NOTHING_LEAVES, sheet: NOTHING_LEAVES,
    route: 'This device runs the whole model. Nothing leaves it.',
    'own-devices': 'This device runs it; nothing leaves it.',
    alternative: 'Stays on this device.',
    preset: 'Only this device runs the model. Nothing leaves this device, and no network participant sees its metadata.'
  },
  'own-devices': {
    preset: ({ desktop }) => `This device and ${desktop} run the model and read your content in plaintext, so they can also see its access patterns; no other computer can read it. When ${desktop} answers, a relay that carries the connection can see its timing and message sizes. ${desktop[0].toUpperCase()}${desktop.slice(1)} counts as yours because you approved its pairing code.`
  },
  operator: {
    composer: sendingTo, sheet: sendingTo,
    invite: ({ operator }) => `This runs on ${operator}. Its operator can read your prompt.`,
    outcome: ({ operator }) => `Only ${operator} may read your messages. Choose a model it runs.`,
    alternative: ({ operator }) => `The operator of ${operator} can read this conversation.`
  },
  blocked: {
    sheet: BLOCKED_SHEET,
    outcome: 'Only your devices can read this chat, so contributors can’t answer. Using contributors lets the answering computer read your messages.'
  },
  'blocked-pool': {
    sheet: BLOCKED_SHEET,
    outcome: 'Only your devices can read this chat, so your private pool can’t answer. Using it lets the answering pool computer read your messages.'
  },
  named: { composer: 'Named computers can read your prompt.' },
  stages: { composer: STAGES, sheet: STAGES, 'split-note': ({ stageCount }) => splitReadersLine(stageCount) },
  'stages-edges': { 'split-note': SPLIT_DISPLAY['requester-edges'].line },
  'could-read': { composer: 'A network provider could read your prompt.' },
  pool: { sheet: 'The answering computer in your private pool can read your prompt.' },
  answering: {
    composer: ANSWERING, sheet: ANSWERING,
    outcome: 'The answering computer reads your messages.',
    alternative: 'The operator of the computer that answers can read this conversation.',
    protection: PROTECTION_DISPLAY.plaintext.line,
    preset: `The computer that answers reads your content in plaintext and can see its access patterns, and you approve it before anything is sent. The request's ${sentence(NETWORK_METADATA)} can also be visible to the coordinators, credit ledgers and relays that carry the request.`
  }
});
// A case a site has no wording of its own for is stated as the broader case (the composer names no private pool).
const BROADER = Object.freeze({ pool: 'answering' });

/** The case, decided in the order every site decides it: the first fact that holds names who can read the prompt. */
export function disclosureCase({ computation = 'plaintext', local = false, desktop = null, operator = null, blocked = false,
  named = false, stages = false, edges = false, usable = true, pool = false } = {}) {
  if (computation !== 'plaintext') return 'unavailable-mode';
  if (local) return 'local';
  if (desktop) return 'own-devices';
  if (operator) return 'operator';
  if (blocked) return pool ? 'blocked-pool' : 'blocked';
  if (named) return 'named';
  if (stages) return edges ? 'stages-edges' : 'stages';
  if (!usable) return 'could-read';
  return pool ? 'pool' : 'answering';
}

/**
 * The sentence `site` shows for these facts.
 * @param {{ site: string, computation?: string, local?: boolean, desktop?: string|null, operator?: string|null,
 *   blocked?: boolean, named?: boolean, stages?: boolean, edges?: boolean, stageCount?: number, usable?: boolean, pool?: boolean }} facts
 */
export function promptDisclosure({ site, ...facts }) {
  if (!DISCLOSURE_SITES.includes(site)) throw new Error(`Unknown disclosure site: ${site}`);
  let name = disclosureCase(facts);
  while (WORDING[name][site] === undefined && BROADER[name]) name = BROADER[name];
  const wording = WORDING[name][site];
  if (wording === undefined) throw new Error(`The ${site} states no disclosure for ${name}`);
  return typeof wording === 'function' ? wording(facts) : wording;
}

/** Every case and the wording each site gives it: the table the owner picks one wording per case from. */
export const DISCLOSURE_WORDING = WORDING;
