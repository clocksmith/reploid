/**
 * @fileoverview Compact Zero objective seed library.
 */

export const ZERO_KATAMARI_GOAL = Object.freeze({
  view: 'L1 DOM Katamari',
  level: 1,
  text: 'Build a playable DOM katamari overlay in the current page/runtime area: use CreateTool to install and load it, scan buttons, cards, and forms into physics pickups, let the player roll a growing selector ball, export captures, and save an improvement log for the next run.'
});

const LEGACY_ZERO_KATAMARI_GOALS = new Set([
  'Build a playable Katamari-style DOM overlay: install and load it with CreateTool, mount a transparent full-screen layer over the current page, scan visible DOM nodes into physics pickups, let the player roll a growing ball to collect elements, then orbit, inspect, export robust selectors, and save selector-quality notes for the next self-improvement pass.'
]);

const ZERO_GOAL_LIBRARY = Object.freeze([
  ZERO_KATAMARI_GOAL,
  Object.freeze({
    view: 'Context Packet',
    text: 'Evolve compact context packets against fixed tasks and keep only the packet with better evidence.'
  }),
  Object.freeze({
    view: 'VFS Atlas',
    text: 'Map the writable VFS into a live atlas, verify readback paths, and patch the weakest self-hosting edge.'
  }),
  Object.freeze({
    view: 'Tool Observatory',
    text: 'Instrument tool calls with visible success, failure, latency, and artifact traces, then repair one unreliable path.'
  }),
  Object.freeze({
    view: 'UI Patch Proof',
    text: 'Patch one Zero UI surface through shadow evidence, reload it, and show the before-after proof in the page.'
  }),
  Object.freeze({
    view: 'Service Worker Mirror',
    text: 'Trace service-worker module loading from VFS to DOM, then prove one stale-module fallback cannot hide source drift.'
  }),
  Object.freeze({
    view: 'Prompt Mirror',
    text: 'Render the active prompt contract, tool surface, and writable roots, then flag one mismatch with source evidence.'
  }),
  Object.freeze({
    view: 'Capability Receipt',
    text: 'Probe browser storage, workers, WebGPU, and DOM access, then save a receipt that guides the next self-edit.'
  })
]);

export const DEFAULT_ZERO_GOAL = ZERO_GOAL_LIBRARY[0].text;

const normalizeText = (value) => String(value || '').trim();

export function normalizeZeroGoal(value) {
  const goal = normalizeText(value);
  if (!goal || LEGACY_ZERO_KATAMARI_GOALS.has(goal)) return DEFAULT_ZERO_GOAL;
  return goal;
}

const createSeededRandom = (seed) => {
  let state = (Number(seed) || 0) >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

export function getZeroGoalEntries() {
  return ZERO_GOAL_LIBRARY.map((goal) => ({ ...goal }));
}

export function getRandomZeroGoal(seed = Date.now(), currentGoal = '') {
  const current = normalizeText(currentGoal);
  const candidates = ZERO_GOAL_LIBRARY.filter((goal) => normalizeText(goal.text) !== current);
  const source = candidates.length > 0 ? candidates : ZERO_GOAL_LIBRARY;
  const random = createSeededRandom(seed);
  const index = Math.floor(random() * source.length);
  const goal = source[index] || source[0];
  return goal ? { ...goal } : null;
}

export function formatGoalPacket(goalValue) {
  const goal = normalizeText(goalValue);
  if (!goal) return null;
  return {
    text: goal,
    source: 'zero-home',
    createdAt: new Date().toISOString()
  };
}
