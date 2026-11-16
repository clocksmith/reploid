/**
 * @fileoverview Creates the graph simulation state and sizes its canvas for the device pixel ratio.
 */
import {
  POOLDAY_FLOW_TUNING,
  POOLDAY_GRAPH_NODE_IDS,
  POOLDAY_PARTICIPANT_NODE_IDS,
  SIMULATION_MAX_CANVAS_PIXELS,
  SIMULATION_MAX_PIXEL_RATIO,
  SIMULATION_MIN_PIXEL_RATIO,
  SIMULATION_TARGET_STEP_MS
} from './constants.js';
import { createSimulationLineProjector } from './simulation-flow-specs.js';
import {
  POOLDAY_CORE_NODE_CONFIG,
  createFrameNode,
  createFrameParticle,
  createPoolGraphPaletteFrame
} from './simulation-frame-state.js';
import { POINTER_SHOOTER_PARTICLE_COUNT } from './simulation-pointer-shooter.js';
import { createPoolNetworkVisualState, createPoolRunVisualState } from './simulation-visual-state.js';
import { clampRange } from './simulation-easing.js';
import {
  copyGraphPoints,
  createSimulationSeed,
  createSeededRandom,
  createPoolGraphLabelPlan,
  createHotPathFrame
} from './simulation-graph-plan.js';
import { createPoolGraphLayout } from './simulation-graph-layout.js';

export const createPoolSimulationState = () => {
  const seed = createSimulationSeed();
  const random = createSeededRandom(seed);
  const participantSpecs = POOLDAY_PARTICIPANT_NODE_IDS.map((id, index) => ({
    id,
    role: id.startsWith('verifier') ? 'verifier' : 'runner',
    index,
    phase: index * 1.7,
    size: 10 + (index % 3) * 1.5,
    presence: 1,
    lineDraw: 1,
    pulse: 0
  }));
  const roles = {};
  for (const [id] of POOLDAY_CORE_NODE_CONFIG) {
    const node = createFrameNode(id);
    node.core = true;
    roles[id] = node;
  }
  const participants = participantSpecs.map(({ id, role }) => {
    const node = createFrameNode(id);
    node.role = role;
    return node;
  });
  const nodeLookup = {};
  for (const [id] of POOLDAY_CORE_NODE_CONFIG) nodeLookup[id] = roles[id];
  for (const node of participants) nodeLookup[node.id] = node;
  const frameNodes = POOLDAY_GRAPH_NODE_IDS.map((id) => createFrameNode(id));
  const labelPlan = createPoolGraphLabelPlan(random);
  const labelAnchors = Object.fromEntries(
    POOLDAY_GRAPH_NODE_IDS.map((id) => [id, createFrameNode(id)])
  );
  const particles = Array.from({ length: POOLDAY_FLOW_TUNING.particleCount }, (_, index) => ({
    index,
    offset: (index * 0.113) % 1,
    speed: POOLDAY_FLOW_TUNING.baseSpeed
      + (index % 5) * POOLDAY_FLOW_TUNING.edgeSpeedStep
      + ((index % 7) / 7) * POOLDAY_FLOW_TUNING.speedJitter,
    edgeIndex: index,
    laneBias: (index % 5) - 2,
    tone: index % 4,
    participantIndex: index % participantSpecs.length,
    phase: index * 0.47,
    size: (2.7 + (index % 4) * 0.74) * POOLDAY_FLOW_TUNING.particleScale,
    routeId: '',
    routeBlend: 1
  }));
  const pointerShots = Array.from({ length: POINTER_SHOOTER_PARTICLE_COUNT }, (_, index) => ({
    index,
    active: false,
    lineIndex: 0,
    start: 0,
    direction: 1,
    age: 0,
    life: 1,
    speed: 1,
    originX: 0.5,
    originY: 0.5,
    toneIndex: index,
    lineRouteId: ''
  }));
  const frameParticles = [
    ...particles.map((particle) => createFrameParticle(particle.index)),
    ...pointerShots.map((shot) => createFrameParticle(POOLDAY_FLOW_TUNING.particleCount + shot.index))
  ];
  const frame = {
    lines: [],
    nodes: frameNodes,
    particles: frameParticles,
    peerCount: participants.length,
    participantCount: participants.length,
    topologyLabel: '',
    time: 0,
    flowEnergy: 1,
    anticipation: 0,
    transitionActive: false,
    transitionProgress: 0,
    topologyCue: 0,
    topologyProgress: 0,
    countdownProgress: 0,
    palette: createPoolGraphPaletteFrame(),
    labelAnchors,
    hotPath: createHotPathFrame()
  };
  const networkVisual = createPoolNetworkVisualState();
  const runVisual = createPoolRunVisualState();
  return {
    participantSpecs,
    participants,
    roles,
    nodeLookup,
    nodeLabelPlan: labelPlan,
    hotPathFrame: createHotPathFrame(),
    hotPathActiveIds: new Set(),
    frameNodes,
    frameParticles,
    labelAnchors,
    frame,
    networkVisual,
    runVisual,
    particles,
    pointerShots,
    pointer: {
      x: 0.5,
      y: 0.5,
      targetX: 0.5,
      targetY: 0.5,
      inside: false,
      holding: false,
      pointerId: null,
      moveEnergy: 0,
      shotAccumulator: 0,
      shotBurst: 0,
      shotCursor: 0,
      shotSerial: 0
    },
    seed,
    random,
    layout: createPoolGraphLayout(random),
    graphViewPositions: copyGraphPoints({}),
    lineProjector: createSimulationLineProjector(),
    particlePoint: { x: 0, y: 0 },
    pointerEdgeSearch: {
      previous: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
      point: { x: 0, y: 0 }
    },
    time: 0,
    motionTime: 0,
    lastFrameMs: performance.now() - SIMULATION_TARGET_STEP_MS
  };
};

export const resizePoolCanvas = (canvas, cssSize = null) => {
  const measured = cssSize?.width > 0 && cssSize?.height > 0
    ? cssSize
    : canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, measured.width);
  const cssHeight = Math.max(1, measured.height);
  const pixelBudgetRatio = Math.sqrt(SIMULATION_MAX_CANVAS_PIXELS / Math.max(1, cssWidth * cssHeight));
  const ratio = clampRange(
    Math.min(window.devicePixelRatio || 1, SIMULATION_MAX_PIXEL_RATIO, pixelBudgetRatio),
    SIMULATION_MIN_PIXEL_RATIO,
    SIMULATION_MAX_PIXEL_RATIO
  );
  const width = Math.max(1, Math.floor(cssWidth * ratio));
  const height = Math.max(1, Math.floor(cssHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
};
