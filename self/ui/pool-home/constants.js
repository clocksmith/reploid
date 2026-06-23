/**
 * @fileoverview Constants for the Reploid product home.
 *
 * The root pool implementation namespace is internal.
 * Public UI copy intentionally keeps the Reploid name.
 */

export const PRODUCT_ROUTES = Object.freeze({
  '/': 'mesh',
  '/run': 'run',
  '/mesh': 'mesh',
  '/record': 'record',
  '/contribute': 'mesh',
  '/agents': 'mesh',
  '/receipts': 'record',
  '/reputation': 'record'
});

export const PUBLIC_PRODUCT_NAME = 'Reploid';
export const POOLDAY_NAME = PUBLIC_PRODUCT_NAME;
export const POOLDAY_PROTOCOL = 'Verified Browser Inference';
export const POOLDAY_VERSION_TAG = 'vBI-1.6';
export const SIMULATION_TARGET_STEP_MS = 1000 / 60;
export const SIMULATION_MAX_STEP_MS = 1000 / 16;
export const SIMULATION_GENTLE_SPEED = 0.72;
export const SIMULATION_POINTER_LERP = 0.12;
export const SIMULATION_FORCE_LERP = 0.08;
export const SIMULATION_MIN_FORCE = 0.002;
export const SIMULATION_MAX_PIXEL_RATIO = 1.35;
export const SIMULATION_MIN_PIXEL_RATIO = 0.72;
export const SIMULATION_MAX_CANVAS_PIXELS = 1_250_000;
export const POOLDAY_RECEIPT_LEDGER_LIMIT = 10;
export const POOLDAY_NODE_GRID_SQUARES = 20;
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
  pulseScale: 0.42,
  coreLineWidth: 1.55,
  peerLineWidth: 1.18,
  pipeLineWidth: 1.34,
  backgroundBandAlpha: 0.10,
  prismFacetAlpha: 0.026,
  nodeGlowAlpha: 0.092,
  edgeGlowAlpha: 0.11,
  edgeGlowWidth: 4.2,
  maxGlowLines: 18,
  shimmerStride: 3,
  shimmerAlpha: 0.58
});
export const POOLDAY_RENDERER_LINE_SEGMENTS = 11;
export const POOLDAY_RENDERER_BAND_SEGMENTS = 24;
export const POOLDAY_MORPH_TUNING = Object.freeze({
  shapeHold: 6.1,
  floatHold: 2.3,
  holdJitter: 1.15,
  shapeSpan: 4.35,
  floatSpan: 3.15,
  anticipationSpan: 2.35,
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
export const POOLDAY_PARTICIPANT_LAYOUT = Object.freeze([
  { id: 'runner0', role: 'runner', point: [0.44, 0.30] },
  { id: 'runner1', role: 'runner', point: [0.44, 0.43] },
  { id: 'runner2', role: 'runner', point: [0.44, 0.57] },
  { id: 'runner3', role: 'runner', point: [0.44, 0.70] },
  { id: 'verifier0', role: 'verifier', point: [0.64, 0.42] },
  { id: 'verifier1', role: 'verifier', point: [0.64, 0.58] }
]);
export const POOLDAY_PARTICIPANT_NODE_IDS = Object.freeze(
  POOLDAY_PARTICIPANT_LAYOUT.map((item) => item.id)
);
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
    label: 'receipt tree',
    edgePreset: 'receipt_tree',
    morph: 'root',
    points: {
      requester: [0.50, 0.15],
      policy: [0.50, 0.28],
      assignment: [0.50, 0.40],
      runner0: [0.25, 0.56],
      runner1: [0.38, 0.60],
      runner2: [0.62, 0.60],
      runner3: [0.75, 0.56],
      verifier0: [0.42, 0.72],
      verifier1: [0.58, 0.72],
      agreement: [0.50, 0.80],
      settlement: [0.50, 0.88],
      ledger: [0.50, 0.94]
    }
  },
  {
    id: 'runner_reduce',
    label: 'runner reduce',
    edgePreset: 'runner_reduce',
    morph: 'pipe',
    points: {
      requester: [0.12, 0.50],
      policy: [0.22, 0.50],
      assignment: [0.34, 0.50],
      runner0: [0.48, 0.28],
      runner1: [0.48, 0.42],
      runner2: [0.48, 0.58],
      runner3: [0.48, 0.72],
      verifier0: [0.64, 0.42],
      verifier1: [0.64, 0.58],
      agreement: [0.75, 0.50],
      settlement: [0.84, 0.50],
      ledger: [0.94, 0.50]
    }
  },
  {
    id: 'star_rendezvous',
    label: 'star rendezvous',
    edgePreset: 'star_rendezvous',
    morph: 'fan',
    points: {
      assignment: [0.50, 0.50],
      requester: [0.18, 0.50],
      policy: [0.32, 0.30],
      runner0: [0.36, 0.22],
      runner1: [0.55, 0.18],
      runner2: [0.36, 0.78],
      runner3: [0.55, 0.82],
      verifier0: [0.72, 0.36],
      verifier1: [0.72, 0.64],
      agreement: [0.80, 0.50],
      settlement: [0.87, 0.50],
      ledger: [0.94, 0.50]
    }
  },
  {
    id: 'hourglass',
    label: 'hourglass',
    edgePreset: 'hourglass',
    morph: 'fold',
    points: {
      requester: [0.08, 0.16],
      policy: [0.18, 0.32],
      runner0: [0.16, 0.50],
      runner1: [0.20, 0.68],
      assignment: [0.42, 0.46],
      agreement: [0.55, 0.54],
      runner2: [0.78, 0.26],
      runner3: [0.82, 0.74],
      verifier0: [0.88, 0.40],
      verifier1: [0.88, 0.60],
      settlement: [0.80, 0.82],
      ledger: [0.92, 0.86]
    }
  },
  {
    id: 'bowtie_exchange',
    label: 'bowtie exchange',
    edgePreset: 'bowtie_exchange',
    morph: 'fold',
    points: {
      requester: [0.10, 0.50],
      policy: [0.22, 0.50],
      runner0: [0.26, 0.22],
      runner1: [0.26, 0.78],
      runner2: [0.38, 0.36],
      assignment: [0.41, 0.50],
      agreement: [0.62, 0.50],
      runner3: [0.70, 0.64],
      verifier0: [0.82, 0.22],
      verifier1: [0.82, 0.78],
      settlement: [0.76, 0.50],
      ledger: [0.92, 0.50]
    }
  },
  {
    id: 'braided_lanes',
    label: 'braided lanes',
    edgePreset: 'braided_lanes',
    morph: 'braid',
    points: {
      requester: [0.11, 0.50],
      policy: [0.24, 0.24],
      assignment: [0.34, 0.38],
      runner0: [0.43, 0.72],
      runner1: [0.50, 0.25],
      runner2: [0.58, 0.70],
      runner3: [0.66, 0.30],
      verifier0: [0.72, 0.62],
      verifier1: [0.78, 0.36],
      agreement: [0.82, 0.50],
      settlement: [0.88, 0.50],
      ledger: [0.94, 0.50]
    }
  },
  {
    id: 'triangulation',
    label: 'triangulation',
    edgePreset: 'triangulation',
    morph: 'fan',
    points: {
      requester: [0.18, 0.35],
      policy: [0.50, 0.16],
      assignment: [0.39, 0.35],
      agreement: [0.61, 0.35],
      runner0: [0.28, 0.56],
      runner1: [0.42, 0.61],
      runner2: [0.58, 0.61],
      runner3: [0.72, 0.56],
      verifier0: [0.46, 0.72],
      verifier1: [0.60, 0.72],
      settlement: [0.54, 0.84],
      ledger: [0.54, 0.94]
    }
  },
  {
    id: 'honeycomb',
    label: 'honeycomb',
    edgePreset: 'honeycomb',
    morph: 'orthogonal',
    points: {
      requester: [0.18, 0.42],
      policy: [0.34, 0.26],
      assignment: [0.55, 0.26],
      runner0: [0.43, 0.42],
      runner1: [0.72, 0.42],
      runner2: [0.34, 0.58],
      verifier0: [0.56, 0.58],
      runner3: [0.78, 0.58],
      verifier1: [0.47, 0.74],
      agreement: [0.65, 0.74],
      settlement: [0.78, 0.76],
      ledger: [0.78, 0.90]
    }
  }
]);
export const POOLDAY_FLOW_CORE_NODES = Object.freeze([
  {
    id: 'requester',
    label: 'Request',
    caption: 'ask',
    body: 'The user or app asking Reploid to run a job with a declared model, policy, and receipt requirement.',
    x: '16%',
    y: '58%'
  },
  {
    id: 'policy',
    label: 'Policy',
    caption: 'gate',
    body: 'The rule gate that checks model requirements, trust level, point spend, and what proof is needed.',
    x: '28%',
    y: '39%'
  },
  {
    id: 'runners',
    label: 'Runners',
    caption: 'run',
    body: 'Browser nodes that do the model work and return signed execution receipts.',
    x: '48%',
    y: '32%'
  },
  {
    id: 'verifiers',
    label: 'Verifiers',
    caption: 'check',
    body: 'Independent checks that compare receipts, outputs, and policy requirements before acceptance.',
    x: '66%',
    y: '44%'
  },
  {
    id: 'settlement',
    label: 'Settle',
    caption: 'accept',
    body: 'The acceptance step that finalizes the checked result and applies points or reputation effects.',
    x: '78%',
    y: '56%'
  },
  {
    id: 'ledger',
    label: 'Ledger',
    caption: 'record',
    body: 'The record of accepted receipts, decisions, and local reputation evidence.',
    x: '80%',
    y: '58%'
  }
]);
export const POOLDAY_GRAPH_LABEL_ROLE_META = Object.freeze({
  consumer: {
    label: 'Consumer',
    body: 'Requests work, accepts a receipt, and compares the delivered result against the declared intent.'
  },
  producer: {
    label: 'Producer',
    body: 'Publishes work intent or model capability into the browser network for another peer to consume.'
  },
  coordinator: {
    label: 'Coordinator',
    body: 'Matches capability, policy, and receipt requirements before peers exchange work.'
  },
  provider: {
    label: 'Provider',
    body: 'Runs the selected model or runtime lane and signs the execution receipt.'
  },
  verifier: {
    label: 'Verifier',
    body: 'Checks receipt fields, model compatibility, output policy, and agreement before acceptance.'
  },
  settlement: {
    label: 'Settlement',
    body: 'Applies acceptance, reputation, and point evidence after verification reaches agreement.'
  },
  ledger: {
    label: 'Ledger',
    body: 'Stores accepted receipts, peer history, and local routing evidence.'
  }
});
export const POOLDAY_GRAPH_LABEL_STAGES = Object.freeze([
  {
    id: 'intent',
    label: 'Intent',
    ids: ['requester', 'policy'],
    roles: ['consumer', 'consumer']
  },
  {
    id: 'match',
    label: 'Match',
    ids: ['assignment', 'runner0'],
    roles: ['coordinator', 'provider']
  },
  {
    id: 'execute',
    label: 'Execute',
    ids: ['runner1', 'runner2', 'runner3'],
    roles: ['provider', 'producer', 'producer']
  },
  {
    id: 'verify',
    label: 'Verify',
    ids: ['verifier0', 'verifier1', 'agreement'],
    roles: ['verifier', 'verifier', 'verifier']
  },
  {
    id: 'record',
    label: 'Record',
    ids: ['settlement', 'ledger'],
    roles: ['settlement', 'ledger']
  }
]);
const DEFAULT_GRAPH_ROLE_BY_ID = Object.freeze(Object.fromEntries(
  POOLDAY_GRAPH_LABEL_STAGES.flatMap((stage) => stage.ids.map((id, index) => [id, stage.roles[index]]))
));
export const POOLDAY_FLOW_LABELS = Object.freeze(POOLDAY_GRAPH_NODE_IDS.map((id) => {
  const point = POOLDAY_GRAPH_TOPOLOGIES[0].points[id] || [0.5, 0.5];
  const role = DEFAULT_GRAPH_ROLE_BY_ID[id] || 'provider';
  const meta = POOLDAY_GRAPH_LABEL_ROLE_META[role] || POOLDAY_GRAPH_LABEL_ROLE_META.provider;
  return {
    id,
    label: meta.label,
    body: meta.body,
    x: `${Math.round(point[0] * 100)}%`,
    y: `${Math.round(point[1] * 100)}%`
  };
}));
export const POOLDAY_FLOW_NODE_COUNT = POOLDAY_GRAPH_NODE_IDS.length;

export const POOLDAY_PEER_LEDGER_STORAGE_KEY = 'reploid.peerLedgerEvents.v1';
export const ROUTE_COPY = Object.freeze({
  home: {
    eyebrow: POOLDAY_PROTOCOL,
    title: POOLDAY_NAME,
    body: 'Browser inference with receipts.'
  },
  run: {
    eyebrow: 'Run',
    title: 'Run',
    body: 'Send a prompt and stream the result.'
  },
  mesh: {
    eyebrow: 'Mesh',
    title: 'Mesh',
    body: 'View the browser mesh and start this tab as a node.'
  },
  record: {
    eyebrow: 'Record',
    title: 'Record',
    body: 'Review completed work.'
  }
});
