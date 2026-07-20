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
export const POOLDAY_NETWORK_VISUAL_EVENT = 'reploid:pool-network-visual-state';
export const POOLDAY_RUN_VISUAL_EVENT = 'reploid:pool-run-visual-state';

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
    label: 'Run',
    eyebrow: 'Run',
    title: 'Run',
    body: 'Send one prompt. Read the answer, then inspect its proof.'
  }),
  createPooldayRoute({
    id: 'compute',
    path: '/compute',
    label: 'Contribute',
    eyebrow: 'Contribute',
    title: 'Contribute',
    body: 'Let this tab answer compatible runs. Stop at any time.'
  }),
  createPooldayRoute({
    id: 'records',
    path: '/records',
    label: 'Records',
    eyebrow: 'Records',
    title: 'Records',
    body: 'Answers, contributions, and room events in one ledger.'
  })
]);

export const POOLDAY_ROUTE_ALIASES = Object.freeze({
  '/history': 'records',
  '/network': 'records'
});

export const PRODUCT_ROUTES = Object.freeze(Object.fromEntries(
  [
    ...POOLDAY_ROUTE_DEFINITIONS.map((route) => [route.path, route.id]),
    ...Object.entries(POOLDAY_ROUTE_ALIASES)
  ]
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
  // Biological / Protein Sequence Workloads
  'Sequence: MRLGCSLAWLLLFLLLSVAA',
  'Sequence: MSKKSTAEQLAAQQAELRQ',
  'Sequence: MAGAASPCANGCGPGP',
  'Sequence: MSSGSSAVAAALPVAAAP',
  'Sequence: ATGCGTACGTTACGTAGCTAG',
  'Sequence: MKVLVVLLCLVPAYG',
  'Sequence: MRPSGTAAALAALLA',
  'Sequence: MKLALFLVLLCFTAS',
  'Sequence: MLPLLLALLGLLGHA',
  'Sequence: MAPLALLLLGLVAGA',
  'Sequence: MSGQGQGQGQGQGQG',
  'Sequence: MSFSSASARVSSARS',
  'Sequence: MGGKWSKSSVIGWPT',
  'Sequence: MASLSQLAAQQAELR',
  'Sequence: MATGGTGGTAGCTAG',

  // Tech-heavy / Agent Substrate Workloads
  'Optimize WGSL compute shader',
  'Write WebRTC routing validator',
  'Generate canvas particle system',
  'Audit IndexedDB VFS connector',
  'Repair EventBus subscription leaks',
  'Implement Custom Schema Parser',
  'Validate peer consensus signatures',
  'Compile custom WASM bindings',
  'Resolve dependency injection cycles',
  'Verify transaction ledger history',
  'Measure WebGPU device memory',
  'Optimize Float32 matrix transposition',
  'Benchmark peer network latency',
  'Trace agent loop execution',
  'Build Genesis snapshot recovery',
  'Qualify LoRA adapter shards',
  'Decompound nested transaction hashes',
  'Enforce runtime safety boundaries',
  'Audit secret exposure risks',
  'Inspect signature verification workers',
  'Synchronize decentralized client logs',
  'Verify ring consensus quorum',
  'Optimize WebGPU pipeline layouts',
  'Rebuild virtual filesystem indexes',
  'Profile browser memory overhead',

  // Common / General Use Cases
  'Dinner ideas tonight',
  'Plan a roadtrip',
  'Debug this error',
  'Write a resignation',
  'Summarize this article',
  'Healthy lunch ideas',
  'Translate this sentence',
  'Create budget plan',
  'Explain compound interest',
  'Plan weekly meals',
  'Write apology note',
  'Find movie recommendations',
  'Write wedding toast',
  'Plan morning routine',
  'Find book recommendations',
  'Compare electric cars',
  'Learn Spanish basics',
  'Write a poem',
  'Name my startup',
  'Create workout plan',
  'Explain tax brackets',
  'Write thank you',
  'Compare phone plans',
  'Meal prep ideas'
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
export const SIMULATION_MAX_PIXEL_RATIO = 1;
export const SIMULATION_MIN_PIXEL_RATIO = 0.65;
export const SIMULATION_MAX_CANVAS_PIXELS = 650_000;
export const POOLDAY_GRAPH_VIEW_CENTER_PULL = 0.25;
export const POOLDAY_GRAPH_VIEW_MARGIN_PX = 64;
export const POOLDAY_RECEIPT_LEDGER_LIMIT = 10;
export const POOLDAY_STREAM_CHUNK_SIZE = 18;
export const POOLDAY_STREAM_TICK_MS = 14;
export const POOLDAY_FLOW_TUNING = Object.freeze({
  particleCount: 32,
  baseSpeed: 0.118,
  speedJitter: 0.026,
  edgeSpeedStep: 0.008,
  laneGap: 11,
  curveLift: 0.034,
  pipeCurveLift: 0.006,
  particleScale: 1.05,
  coreLineWidth: 1.55,
  peerLineWidth: 1.18,
  pipeLineWidth: 1.34
});
export const POOLDAY_RENDERER_LINE_SEGMENTS = 8;
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
    symmetry: 'none',
    points: {
      requester: [0.50, 0.08],
      policy: [0.20, 0.33],
      assignment: [0.38, 0.33],
      agreement: [0.62, 0.33],
      settlement: [0.80, 0.33],
      runner0: [0.10, 0.62],
      runner1: [0.26, 0.62],
      runner2: [0.74, 0.62],
      runner3: [0.90, 0.62],
      verifier0: [0.38, 0.62],
      verifier1: [0.62, 0.62],
      ledger: [0.50, 0.90]
    }
  },
  {
    id: 'runner_reduce',
    label: 'runner reduce',
    edgePreset: 'runner_reduce',
    symmetry: 'x-axis',
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
    symmetry: 'x-axis',
    points: {
      assignment: [0.50, 0.50],
      requester: [0.08, 0.50],
      policy: [0.22, 0.50],
      runner0: [0.375, 0.284],
      runner1: [0.265, 0.415],
      runner2: [0.265, 0.585],
      runner3: [0.375, 0.716],
      verifier0: [0.625, 0.284],
      verifier1: [0.625, 0.716],
      agreement: [0.78, 0.50],
      settlement: [0.88, 0.50],
      ledger: [0.96, 0.50]
    }
  },
  {
    id: 'hourglass',
    label: 'hourglass',
    edgePreset: 'hourglass',
    symmetry: 'x-axis',
    points: {
      requester: [0.08, 0.50],
      policy: [0.20, 0.50],
      runner0: [0.30, 0.22],
      runner1: [0.30, 0.78],
      assignment: [0.42, 0.50],
      agreement: [0.58, 0.50],
      runner2: [0.70, 0.22],
      runner3: [0.70, 0.78],
      verifier0: [0.76, 0.36],
      verifier1: [0.76, 0.64],
      settlement: [0.84, 0.50],
      ledger: [0.94, 0.50]
    }
  },
  {
    id: 'bowtie_exchange',
    label: 'bowtie exchange',
    edgePreset: 'bowtie_exchange',
    symmetry: 'x-axis',
    points: {
      requester: [0.08, 0.50],
      policy: [0.20, 0.50],
      runner0: [0.32, 0.20],
      runner1: [0.32, 0.80],
      runner2: [0.42, 0.35],
      assignment: [0.45, 0.50],
      agreement: [0.55, 0.50],
      runner3: [0.42, 0.65],
      verifier0: [0.68, 0.35],
      verifier1: [0.68, 0.65],
      settlement: [0.80, 0.50],
      ledger: [0.92, 0.50]
    }
  },
  {
    id: 'braided_lanes',
    label: 'braided lanes',
    edgePreset: 'braided_lanes',
    symmetry: 'x-axis',
    points: {
      requester: [0.08, 0.50],
      policy: [0.20, 0.50],
      runner0: [0.32, 0.25],
      runner1: [0.32, 0.75],
      assignment: [0.44, 0.50],
      runner2: [0.56, 0.75],
      runner3: [0.56, 0.25],
      verifier0: [0.68, 0.25],
      verifier1: [0.68, 0.75],
      agreement: [0.80, 0.50],
      settlement: [0.90, 0.50],
      ledger: [0.96, 0.50]
    }
  },
  {
    id: 'triangulation',
    label: 'triangulation',
    edgePreset: 'triangulation',
    symmetry: 'none',
    points: {
      requester: [0.50, 0.25],
      policy: [0.50, 0.10],
      assignment: [0.35, 0.40],
      agreement: [0.65, 0.40],
      runner0: [0.20, 0.65],
      runner1: [0.40, 0.75],
      runner2: [0.60, 0.75],
      runner3: [0.80, 0.65],
      verifier0: [0.40, 0.85],
      verifier1: [0.60, 0.85],
      settlement: [0.50, 0.92],
      ledger: [0.50, 0.98]
    }
  },
  {
    id: 'honeycomb',
    label: 'honeycomb',
    edgePreset: 'honeycomb',
    symmetry: 'none',
    points: {
      policy: [0.34, 0.18],
      assignment: [0.58, 0.18],
      requester: [0.18, 0.34],
      runner0: [0.42, 0.34],
      runner1: [0.66, 0.34],
      verifier0: [0.46, 0.50],
      verifier1: [0.54, 0.50],
      runner2: [0.34, 0.66],
      runner3: [0.58, 0.66],
      ledger: [0.82, 0.66],
      agreement: [0.42, 0.82],
      settlement: [0.66, 0.82]
    }
  },
  {
    id: 'dodecagon',
    label: 'dodecagon',
    edgePreset: 'dodecagon',
    symmetry: 'none',
    points: {
      requester: [0.900, 0.500],
      policy: [0.846, 0.700],
      assignment: [0.700, 0.846],
      runner0: [0.500, 0.900],
      runner1: [0.300, 0.846],
      runner2: [0.154, 0.700],
      runner3: [0.100, 0.500],
      verifier0: [0.154, 0.300],
      verifier1: [0.300, 0.154],
      agreement: [0.500, 0.100],
      settlement: [0.700, 0.154],
      ledger: [0.846, 0.300]
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
