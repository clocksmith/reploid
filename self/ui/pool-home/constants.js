/**
 * @fileoverview Constants for the Reploid product home.
 *
 * The root pool implementation namespace is internal.
 * Public UI copy intentionally keeps the Reploid name.
 */

export const PUBLIC_PRODUCT_NAME = 'Reploid';
export const POOLDAY_NAME = PUBLIC_PRODUCT_NAME;
export const POOLDAY_PROTOCOL = 'Verified Browser Inference';
export const POOLDAY_VERSION_TAG = 'vBI-1.6';

const createPooldayRoute = (route) => Object.freeze({
  ...route
});

export const POOLDAY_ROUTE_DEFINITIONS = Object.freeze([
  createPooldayRoute({
    id: 'home',
    path: '/',
    label: 'Home',
    eyebrow: POOLDAY_PROTOCOL,
    title: POOLDAY_NAME,
    body: 'Run browser models together.'
  }),
  createPooldayRoute({
    id: 'ask',
    path: '/ask',
    label: 'Ask',
    eyebrow: 'Ask',
    title: 'Ask',
    body: 'Ask matching browser tabs for an answer.'
  }),
  createPooldayRoute({
    id: 'compute',
    path: '/compute',
    label: 'Compute',
    eyebrow: 'Compute',
    title: 'Compute',
    body: 'Share this tab as a live model worker.'
  }),
  createPooldayRoute({
    id: 'history',
    path: '/history',
    label: 'History',
    eyebrow: 'History',
    title: 'History',
    body: 'Review answers saved in this browser.'
  }),
  createPooldayRoute({
    id: 'network',
    path: '/network',
    label: 'Network',
    eyebrow: 'Network',
    title: 'Network',
    body: 'See public room health and recent network activity.'
  })
]);

export const PRODUCT_ROUTES = Object.freeze(Object.fromEntries(
  POOLDAY_ROUTE_DEFINITIONS.map((route) => [route.path, route.id])
));

export const POOLDAY_NAV_ROUTES = Object.freeze(POOLDAY_ROUTE_DEFINITIONS.map((route) => Object.freeze({
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
  'Dinner ideas tonight',
  'Explain quantum physics',
  'Plan a roadtrip',
  'Write a resignation',
  'Fix my resume',
  'Summarize this article',
  'Best budget laptop',
  'Healthy lunch ideas',
  'Learn Spanish basics',
  'Plan leg day',
  'Debug this error',
  'Write a poem',
  'Compare electric cars',
  'Explain compound interest',
  'Birthday gift ideas',
  'Plan date night',
  'Improve this email',
  'Make a study plan',
  'Easy pasta recipe',
  'Explain black holes',
  'Write product copy',
  'Plan weekend trip',
  'Find cheap flights',
  'Summarize meeting notes',
  'Translate this sentence',
  'Name my startup',
  'Create workout plan',
  'Explain tax brackets',
  'Write thank you',
  'Plan family vacation',
  'Fix JavaScript bug',
  'Compare phone plans',
  'Meal prep ideas',
  'Learn guitar chords',
  'Write cover letter',
  'Explain mortgage rates',
  'Best dog names',
  'Plan birthday party',
  'Simplify this text',
  'Make packing list',
  'Explain climate change',
  'Draft text reply',
  'Find dinner recipe',
  'Plan home workout',
  'Compare headphones',
  'Write Instagram caption',
  'Explain inflation simply',
  'Create quiz questions',
  'Plan garden layout',
  'Improve LinkedIn profile',
  'Write apology note',
  'Explain calories burned',
  'Find movie recommendations',
  'Plan weekly meals',
  'Write bedtime story',
  'Explain stock options',
  'Make travel itinerary',
  'Fix grammar errors',
  'Compare credit cards',
  'Write wedding toast',
  'Plan morning routine',
  'Explain photosynthesis simply',
  'Find book recommendations',
  'Create budget plan'
]);

export const choosePooldayAskPlaceholder = (random = Math.random) => {
  const index = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * POOLDAY_ASK_PLACEHOLDERS.length);
  return POOLDAY_ASK_PLACEHOLDERS[index] || POOLDAY_ASK_PLACEHOLDERS[0];
};

export const SIMULATION_TARGET_STEP_MS = 1000 / 60;
export const SIMULATION_MAX_STEP_MS = 1000 / 16;
export const SIMULATION_RESUME_GAP_MS = SIMULATION_MAX_STEP_MS * 4;
export const SIMULATION_MOTION_CLOCK_WRAP_SECONDS = 3600;
export const SIMULATION_GENTLE_SPEED = 0.72;
export const SIMULATION_POINTER_LERP = 0.12;
export const SIMULATION_MAX_PIXEL_RATIO = 1.35;
export const SIMULATION_MIN_PIXEL_RATIO = 0.72;
export const SIMULATION_MAX_CANVAS_PIXELS = 1_250_000;
export const POOLDAY_GRAPH_VIEW_CENTER_PULL = 0.25;
export const POOLDAY_GRAPH_VIEW_MARGIN_PX = 64;
export const POOLDAY_RECEIPT_LEDGER_LIMIT = 10;
export const POOLDAY_STREAM_CHUNK_SIZE = 18;
export const POOLDAY_STREAM_TICK_MS = 14;
export const POOLDAY_FLOW_TUNING = Object.freeze({
  particleCount: 80,
  baseSpeed: 0.118,
  speedJitter: 0.026,
  edgeSpeedStep: 0.008,
  laneGap: 11,
  curveLift: 0.034,
  pipeCurveLift: 0.006,
  particleScale: 1.05,
  coreLineWidth: 1.55,
  peerLineWidth: 1.18,
  pipeLineWidth: 1.34,
  backgroundBandAlpha: 0.10,
  prismFacetAlpha: 0.026,
  edgeGlowAlpha: 0.11,
  edgeGlowWidth: 4.2,
  maxGlowLines: 18
});
export const POOLDAY_RENDERER_LINE_SEGMENTS = 20;
export const POOLDAY_RENDERER_BAND_SEGMENTS = 24;
export const POOLDAY_MORPH_TUNING = Object.freeze({
  shapeHold: 6.1,
  floatHold: 2.3,
  holdJitter: 1.15,
  shapeSpan: 4.35,
  floatSpan: 3.15,
  visualSpanScale: 2 / 3,
  scheduleSpanScale: 4 / 3,
  anticipationSpan: 2.35,
  stableHoldSpan: 3.6,
  stableReleaseSpan: 0.92,
  arcLift: 0.105,
  swirlLift: 0.078,
  foldLift: 0.064,
  pipeLift: 0.048,
  settleRate: 0.018,
  preludeDrift: 0.034,
  preludeSurge: 0.118,
  preludeRate: 0.014
});
export const POOLDAY_RAINBOW_COLORS = Object.freeze([
  [246, 82, 118],
  [247, 139, 83],
  [238, 197, 82],
  [105, 210, 153],
  [68, 199, 217],
  [104, 145, 236],
  [174, 122, 238]
]);
export const POOLDAY_RUNNER_NODE_IDS = Object.freeze(['runner0', 'runner1', 'runner2', 'runner3']);
export const POOLDAY_VERIFIER_NODE_IDS = Object.freeze(['verifier0', 'verifier1']);
export const POOLDAY_PARTICIPANT_NODE_IDS = Object.freeze([
  ...POOLDAY_RUNNER_NODE_IDS,
  ...POOLDAY_VERIFIER_NODE_IDS
]);
export const POOLDAY_GRAPH_NODE_IDS = Object.freeze([
  'requester',
  'policy',
  'assignment',
  ...POOLDAY_RUNNER_NODE_IDS,
  ...POOLDAY_VERIFIER_NODE_IDS,
  'agreement',
  'settlement',
  'ledger'
]);
export const POOLDAY_GRAPH_PALETTES = Object.freeze([
  {
    id: 'rainbow-prism',
    primary: [68, 199, 217],
    evidence: [247, 139, 83],
    peer: [104, 145, 236],
    pipe: [105, 210, 153],
    accent: [246, 82, 118]
  },
  {
    id: 'rainbow-warm',
    primary: [247, 139, 83],
    evidence: [238, 197, 82],
    peer: [174, 122, 238],
    pipe: [68, 199, 217],
    accent: [246, 82, 118]
  },
  {
    id: 'rainbow-cool',
    primary: [104, 145, 236],
    evidence: [105, 210, 153],
    peer: [246, 82, 118],
    pipe: [174, 122, 238],
    accent: [238, 197, 82]
  },
  {
    id: 'rainbow-violet',
    primary: [174, 122, 238],
    evidence: [246, 82, 118],
    peer: [68, 199, 217],
    pipe: [238, 197, 82],
    accent: [104, 145, 236]
  }
]);
export const POOLDAY_GRAPH_TOPOLOGIES = Object.freeze([
  {
    id: 'receipt_tree',
    label: 'history tree',
    edgePreset: 'receipt_tree',
    morph: 'root',
    points: {
      requester: [0.50, 0.09],
      policy: [0.50, 0.20],
      assignment: [0.50, 0.33],
      runner0: [0.20, 0.50],
      runner1: [0.40, 0.50],
      runner2: [0.60, 0.50],
      runner3: [0.80, 0.50],
      verifier0: [0.38, 0.68],
      verifier1: [0.62, 0.68],
      agreement: [0.50, 0.80],
      settlement: [0.50, 0.90],
      ledger: [0.50, 0.97]
    }
  },
  {
    id: 'runner_reduce',
    label: 'runner reduce',
    edgePreset: 'runner_reduce',
    morph: 'pipe',
    points: {
      requester: [0.08, 0.50],
      policy: [0.20, 0.50],
      assignment: [0.32, 0.50],
      runner0: [0.46, 0.22],
      runner1: [0.46, 0.40],
      runner2: [0.46, 0.60],
      runner3: [0.46, 0.78],
      verifier0: [0.64, 0.40],
      verifier1: [0.64, 0.60],
      agreement: [0.78, 0.50],
      settlement: [0.88, 0.50],
      ledger: [0.96, 0.50]
    }
  },
  {
    id: 'star_rendezvous',
    label: 'star rendezvous',
    edgePreset: 'star_rendezvous',
    morph: 'fan',
    points: {
      assignment: [0.50, 0.50],
      requester: [0.12, 0.50],
      policy: [0.28, 0.50],
      runner0: [0.42, 0.24],
      runner1: [0.30, 0.42],
      runner2: [0.30, 0.58],
      runner3: [0.42, 0.76],
      verifier0: [0.70, 0.38],
      verifier1: [0.70, 0.62],
      agreement: [0.82, 0.50],
      settlement: [0.90, 0.50],
      ledger: [0.96, 0.50]
    }
  },
  {
    id: 'hourglass',
    label: 'hourglass',
    edgePreset: 'hourglass',
    morph: 'fold',
    points: {
      requester: [0.10, 0.16],
      policy: [0.25, 0.30],
      runner0: [0.20, 0.22],
      runner1: [0.20, 0.78],
      assignment: [0.44, 0.50],
      agreement: [0.56, 0.50],
      runner2: [0.80, 0.22],
      runner3: [0.80, 0.78],
      verifier0: [0.72, 0.42],
      verifier1: [0.72, 0.58],
      settlement: [0.82, 0.72],
      ledger: [0.92, 0.86]
    }
  },
  {
    id: 'bowtie_exchange',
    label: 'bowtie exchange',
    edgePreset: 'bowtie_exchange',
    morph: 'fold',
    points: {
      requester: [0.08, 0.50],
      policy: [0.20, 0.50],
      runner0: [0.32, 0.22],
      runner1: [0.32, 0.78],
      runner2: [0.42, 0.36],
      assignment: [0.45, 0.50],
      agreement: [0.58, 0.50],
      runner3: [0.68, 0.64],
      verifier0: [0.74, 0.22],
      verifier1: [0.74, 0.78],
      settlement: [0.86, 0.50],
      ledger: [0.96, 0.50]
    }
  },
  {
    id: 'braided_lanes',
    label: 'braided lanes',
    edgePreset: 'braided_lanes',
    morph: 'braid',
    points: {
      requester: [0.08, 0.50],
      policy: [0.20, 0.50],
      runner0: [0.32, 0.24],
      runner1: [0.32, 0.76],
      assignment: [0.44, 0.50],
      runner2: [0.56, 0.76],
      runner3: [0.56, 0.24],
      verifier0: [0.68, 0.24],
      verifier1: [0.68, 0.76],
      agreement: [0.80, 0.50],
      settlement: [0.90, 0.50],
      ledger: [0.96, 0.50]
    }
  },
  {
    id: 'triangulation',
    label: 'triangulation',
    edgePreset: 'triangulation',
    morph: 'fan',
    points: {
      requester: [0.18, 0.32],
      policy: [0.50, 0.12],
      assignment: [0.38, 0.40],
      agreement: [0.62, 0.40],
      runner0: [0.24, 0.65],
      runner1: [0.42, 0.72],
      runner2: [0.58, 0.72],
      runner3: [0.76, 0.65],
      verifier0: [0.46, 0.84],
      verifier1: [0.60, 0.84],
      settlement: [0.53, 0.92],
      ledger: [0.53, 0.98]
    }
  },
  {
    id: 'honeycomb',
    label: 'honeycomb',
    edgePreset: 'honeycomb',
    morph: 'orthogonal',
    points: {
      policy: [0.38, 0.22],
      assignment: [0.56, 0.22],
      requester: [0.24, 0.40],
      runner0: [0.42, 0.40],
      runner1: [0.60, 0.40],
      runner2: [0.34, 0.58],
      verifier0: [0.52, 0.58],
      runner3: [0.70, 0.58],
      verifier1: [0.44, 0.76],
      agreement: [0.62, 0.76],
      settlement: [0.78, 0.76],
      ledger: [0.86, 0.90]
    }
  }
]);
export const POOLDAY_GRAPH_LABEL_ROLE_META = Object.freeze({
  prompt: {
    label: 'Prompt',
    body: 'Send a prompt with a declared model, policy, and acceptance rule.'
  },
  policy: {
    label: 'Policy',
    body: 'Check whether the request can route and what verification is required.'
  },
  match: {
    label: 'Match',
    body: 'Pair the request with compatible browser nodes in the current room.'
  },
  infer: {
    label: 'Infer',
    body: 'Run the selected model in a contributor tab and sign the result.'
  },
  verify: {
    label: 'Verify',
    body: 'Check output, model identity, policy, and agreement before acceptance.'
  },
  answer: {
    label: 'Answer',
    body: 'Return accepted work with signed receipt and local routing evidence.'
  }
});
export const POOLDAY_GRAPH_LABEL_STAGES = Object.freeze([
  {
    id: 'prompt',
    label: 'Prompt',
    ids: ['requester'],
    roles: ['prompt']
  },
  {
    id: 'policy',
    label: 'Policy',
    ids: ['policy'],
    roles: ['policy']
  },
  {
    id: 'match',
    label: 'Match',
    ids: ['assignment'],
    roles: ['match']
  },
  {
    id: 'infer',
    label: 'Infer',
    ids: ['runner0', 'runner1', 'runner2', 'runner3'],
    roles: ['infer', 'infer', 'infer', 'infer']
  },
  {
    id: 'verify',
    label: 'Verify',
    ids: ['verifier0', 'verifier1', 'agreement'],
    roles: ['verify', 'verify', 'verify']
  },
  {
    id: 'answer',
    label: 'Answer',
    ids: ['settlement', 'ledger'],
    roles: ['answer', 'answer']
  }
]);
export const POOLDAY_HOT_PATH_EXAMPLE_QUERY = 'Explain battery safety for a school robotics team';
export const POOLDAY_HOT_PATH_STEPS = Object.freeze([
  {
    id: 'prompt',
    label: 'Prompt',
    ids: ['requester'],
    text: 'Explain battery safety for a school robotics team'
  },
  {
    id: 'policy',
    label: 'Policy',
    ids: ['policy'],
    text: 'Educational safety answer allowed with local verification'
  },
  {
    id: 'match',
    label: 'Match',
    ids: ['assignment'],
    text: 'Find Qwen capable tabs with signed manifests'
  },
  {
    id: 'infer',
    label: 'Infer',
    ids: ['runner0', 'runner1', 'runner2', 'runner3'],
    text: 'Stream practical Li ion handling guidance'
  },
  {
    id: 'verify',
    label: 'Verify',
    ids: ['verifier0', 'verifier1', 'agreement'],
    text: 'Check model hash policy and agreement'
  },
  {
    id: 'answer',
    label: 'Answer',
    ids: ['settlement', 'ledger'],
    text: 'Use fire safe charging inspect swollen packs'
  }
]);
const DEFAULT_GRAPH_ROLE_BY_ID = Object.freeze(Object.fromEntries(
  POOLDAY_GRAPH_LABEL_STAGES.flatMap((stage) => stage.ids.map((id, index) => [id, stage.roles[index]]))
));
export const POOLDAY_FLOW_LABELS = Object.freeze(POOLDAY_GRAPH_NODE_IDS.map((id) => {
  const point = POOLDAY_GRAPH_TOPOLOGIES[0].points[id] || [0.5, 0.5];
  const role = DEFAULT_GRAPH_ROLE_BY_ID[id] || 'infer';
  const meta = POOLDAY_GRAPH_LABEL_ROLE_META[role] || POOLDAY_GRAPH_LABEL_ROLE_META.infer;
  return {
    id,
    label: meta.label,
    body: meta.body,
    x: `${Math.round(point[0] * 100)}%`,
    y: `${Math.round(point[1] * 100)}%`
  };
}));

export const POOLDAY_RECEIPT_LEDGER_STORAGE_KEY = 'reploid.receiptLedgerRows.v1';
export const POOLDAY_PEER_LEDGER_STORAGE_KEY = 'reploid.peerLedgerEvents.v1';
