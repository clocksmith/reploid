/**
 * @fileoverview Constants for the Reploid product home.
 *
 * The root pool implementation namespace is internal.
 * Reploid is the public name. Poolday remains an internal implementation name.
 */
import chatPrompts from '../../config/chat-prompts.json' with { type: 'json' };

export const PUBLIC_PRODUCT_NAME = 'Reploid';
export const POOLDAY_NAME = PUBLIC_PRODUCT_NAME;
export const POOLDAY_PROTOCOL = 'Browser AI';
export const POOLDAY_VERSION_TAG = 'vBI-1.6';
export const POOLDAY_NETWORK_VISUAL_EVENT = 'reploid:pool-network-visual-state';
export const POOLDAY_RUN_VISUAL_EVENT = 'reploid:pool-run-visual-state';

const createPooldayRoute = (route) => Object.freeze({
  ...route
});

export const POOLDAY_ROUTE_DEFINITIONS = Object.freeze([
  createPooldayRoute({
    id: 'experiments', path: '/experiments', label: 'Experiments', primary: false,
    title: 'Experiments', eyebrow: 'Research plugins', body: 'Run a study and inspect its evidence.'
  }),
  createPooldayRoute({
    id: 'home',
    primary: false,
    path: '/',
    label: 'Production',
    eyebrow: POOLDAY_PROTOCOL,
    title: 'Production',
    body: 'Share compute or storage. See what this computer produces.'
  }),
  createPooldayRoute({
    id: 'ask',
    path: '/ask',
    label: 'Run a model',
    eyebrow: POOLDAY_PROTOCOL,
    title: 'Run a model',
    body: 'Choose a model and enter your input.',
    primary: false
  }),
  createPooldayRoute({
    id: 'network',
    primary: false,
    path: '/network',
    label: 'Network',
    eyebrow: POOLDAY_PROTOCOL,
    title: 'Network',
    body: 'Choose what this device provides. Inspect compatible models, sharing limits, and peer jobs.'
  }),
  createPooldayRoute({
    id: 'compute',
    path: '/compute',
    label: 'Sequence provider',
    eyebrow: POOLDAY_PROTOCOL,
    title: 'Sequence provider',
    body: 'Legacy sequence execution and artifact participation.',
    primary: false
  }),
  createPooldayRoute({
    id: 'improve',
    path: '/improve',
    label: 'Changes',
    eyebrow: POOLDAY_PROTOCOL,
    title: 'Improve',
    body: 'Retain attempts, evaluate changes independently, and keep adoption explicit.'
  }),
  createPooldayRoute({
    id: 'examples',
    path: '/examples',
    label: 'Examples',
    eyebrow: POOLDAY_PROTOCOL,
    title: 'Examples',
    body: 'Protein analysis and document search exercise specific model operations.',
    primary: false
  }),
  createPooldayRoute({
    id: 'records',
    path: '/records',
    label: 'Recent jobs',
    eyebrow: POOLDAY_PROTOCOL,
    title: 'Recent jobs',
    body: 'Results and unfinished jobs.',
    primary: false
  }),
  createPooldayRoute({
    id: 'room-1',
    path: '/room-1',
    label: 'Research Room-1',
    eyebrow: 'Research evidence',
    title: 'Research Room-1',
    body: 'Review public protein research.',
    primary: false
  })
]);

export const POOLDAY_ROUTE_ALIASES = Object.freeze({
  '/history': 'records',
  '/work': 'home'
});

export const PRODUCT_ROUTES = Object.freeze(Object.fromEntries(
  [
    ...POOLDAY_ROUTE_DEFINITIONS.map((route) => [route.path, route.id]),
    ...Object.entries(POOLDAY_ROUTE_ALIASES)
  ]
));

export const POOLDAY_NAV_ROUTES = Object.freeze(POOLDAY_ROUTE_DEFINITIONS
  .filter((route) => route.primary !== false)
  .map((route) => Object.freeze({
    id: route.id,
    path: route.path,
    label: route.label
  })));

export const ROUTE_COPY = Object.freeze(Object.fromEntries(
  POOLDAY_ROUTE_DEFINITIONS.map((route) => [route.id, Object.freeze({
    eyebrow: route.eyebrow,
    title: route.title,
    body: route.body
  })])
));

export const POOLDAY_ASK_PLACEHOLDERS = Object.freeze([
  'Sequence: MRLGCSLAWLLLFLLLSVAA',
  'Sequence: MSKKSTAEQLAAQQAELRQ',
  'Sequence: MAGAASPCANGCGPGP',
  'Sequence: MSSGSSAVAAALPVAAAP',
  'Sequence: MKVLVVLLCLVPAYG',
  'Sequence: MRPSGTAAALAALLA',
  'Sequence: MKLALFLVLLCFTAS',
  'Sequence: MLPLLLALLGLLGHA',
  'Sequence: MAPLALLLLGLVAGA',
  'Sequence: MSGQGQGQGQGQGQG',
  'Sequence: MSFSSASARVSSARS',
  'Sequence: MGGKWSKSSVIGWPT',
  'Sequence: MASLSQLAAQQAELR'
]);

export const POOLDAY_SEQUENCE_ASK_PLACEHOLDERS = Object.freeze(
  POOLDAY_ASK_PLACEHOLDERS
    .filter((prompt) => prompt.startsWith('Sequence:'))
    .map((prompt) => prompt.replace(/^Sequence:\s*/, ''))
);

export const POOLDAY_TEXT_ASK_PLACEHOLDERS = Object.freeze([...chatPrompts]);

const choosePlaceholder = (placeholders, random = Math.random) => {
  const index = Math.floor(
    Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * placeholders.length
  );
  return placeholders[index] || placeholders[0] || '';
};

export const choosePooldayAskPlaceholder = (random = Math.random) => (
  choosePlaceholder(POOLDAY_ASK_PLACEHOLDERS, random)
);

export const choosePooldayAskPlaceholderForLane = (lane = 'sequence', random = Math.random) => {
  const placeholders = lane === 'sequence'
    ? POOLDAY_SEQUENCE_ASK_PLACEHOLDERS
    : POOLDAY_TEXT_ASK_PLACEHOLDERS;
  return choosePlaceholder(placeholders, random);
};

export const POOLDAY_RECEIPT_LEDGER_LIMIT = 10;
export const POOLDAY_STREAM_CHUNK_SIZE = 18;
export const POOLDAY_STREAM_TICK_MS = 14;

export const POOLDAY_RUNNER_NODE_IDS = Object.freeze(['runner0', 'runner1', 'runner2', 'runner3']);
export const POOLDAY_VERIFIER_NODE_IDS = Object.freeze(['verifier0', 'verifier1']);
export const POOLDAY_PARTICIPANT_NODE_IDS = Object.freeze([
  ...POOLDAY_RUNNER_NODE_IDS,
  ...POOLDAY_VERIFIER_NODE_IDS
]);

export const POOLDAY_RECEIPT_LEDGER_STORAGE_KEY = 'reploid.receiptLedgerRows.v1';
export const POOLDAY_PEER_LEDGER_STORAGE_KEY = 'reploid.peerLedgerEvents.v1';
