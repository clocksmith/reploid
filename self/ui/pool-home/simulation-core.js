/**
 * @fileoverview Simulation topology and frame generation for the Reploid graph.
 */

import {
  POOLDAY_FLOW_TUNING,
  POOLDAY_GRAPH_NODE_IDS,
  POOLDAY_GRAPH_PALETTES,
  POOLDAY_GRAPH_TOPOLOGIES,
  POOLDAY_MORPH_TUNING,
  POOLDAY_PARTICIPANT_LAYOUT,
  POOLDAY_PARTICIPANT_NODE_IDS,
  POOLDAY_RUNNER_NODE_IDS,
  POOLDAY_VERIFIER_NODE_IDS,
  POOLDAY_RAINBOW_COLORS,
  SIMULATION_FORCE_LERP,
  SIMULATION_MAX_CANVAS_PIXELS,
  SIMULATION_GENTLE_SPEED,
  SIMULATION_MAX_PIXEL_RATIO,
  SIMULATION_MAX_STEP_MS,
  SIMULATION_MIN_PIXEL_RATIO,
  SIMULATION_MIN_FORCE,
  SIMULATION_POINTER_LERP,
  SIMULATION_TARGET_STEP_MS
} from './constants.js';
import { pairFlowTransitionLines } from './simulation-flow-transition.js';
import {
  buildSimulationLineSpecs,
  createSimulationLineProjector
} from './simulation-flow-specs.js';

export const clamp01 = (value) => Math.max(0, Math.min(1, value));
export const clampRange = (value, min, max) => Math.max(min, Math.min(max, value));
const clampCanvasPoint = (point, width, height, margin = 6) => {
  if (!point) return point;
  return {
    ...point,
    x: clampRange(point.x, margin, Math.max(margin, width - margin)),
    y: clampRange(point.y, margin, Math.max(margin, height - margin)),
    alpha: clamp01(point.alpha ?? 1),
    size: Math.max(0, Number(point.size) || 0)
  };
};


const cloneTopologyPoints = (topology) => Object.fromEntries(
  POOLDAY_GRAPH_NODE_IDS.map((id) => {
    const point = topology.points[id] || [0.5, 0.5];
    return [id, { x: point[0], y: point[1] }];
  })
);

const copyGraphPoints = (points) => Object.fromEntries(
  POOLDAY_GRAPH_NODE_IDS.map((id) => [id, { ...(points[id] || { x: 0.5, y: 0.5 }) }])
);

const createSimulationSeed = () => {
  try {
    const requested = new URLSearchParams(globalThis.location?.search || '').get('seed');
    if (requested) {
      return [...requested].reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) >>> 0, 2166136261);
    }
    const values = new Uint32Array(1);
    globalThis.crypto?.getRandomValues?.(values);
    return values[0] || 2166136261;
  } catch {
    return 2166136261;
  }
};

const createSeededRandom = (seed) => {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const findTopologyByIndex = (index) => POOLDAY_GRAPH_TOPOLOGIES[
  ((index % POOLDAY_GRAPH_TOPOLOGIES.length) + POOLDAY_GRAPH_TOPOLOGIES.length) % POOLDAY_GRAPH_TOPOLOGIES.length
] || POOLDAY_GRAPH_TOPOLOGIES[0];

const shuffleValues = (values, random) => {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

const createTopologyOrder = (currentIndex, random) => [
  currentIndex,
  ...shuffleValues(POOLDAY_GRAPH_TOPOLOGIES
    .map((_, index) => index)
    .filter((index) => index !== currentIndex), random)
];

const TRANSITION_MOTION_PROFILES = Object.freeze({
  arc: {
    ease: 'sinePlateau',
    scatter: 0.024,
    assemble: 0.024,
    liftScale: 0.74,
    delayScale: 0.40
  },
  braid: {
    ease: 'sinePlateau',
    scatter: 0.048,
    assemble: 0.016,
    liftScale: 0.92,
    delayScale: 0.54
  },
  fan: {
    ease: 'sinePlateau',
    scatter: 0.036,
    assemble: 0.034,
    liftScale: 0.84,
    delayScale: 0.44
  },
  float: {
    ease: 'sinePlateau',
    scatter: 0.070,
    assemble: 0.010,
    liftScale: 0.96,
    delayScale: 0.70
  },
  fold: {
    ease: 'sinePlateau',
    scatter: 0.030,
    assemble: 0.030,
    liftScale: 0.80,
    delayScale: 0.40
  },
  orthogonal: {
    ease: 'sinePlateau',
    scatter: 0.020,
    assemble: 0.040,
    liftScale: 0.70,
    delayScale: 0.34
  },
  pipe: {
    ease: 'sinePlateau',
    scatter: 0.010,
    assemble: 0.020,
    liftScale: 0.52,
    delayScale: 0.22
  },
  root: {
    ease: 'sinePlateau',
    scatter: 0.014,
    assemble: 0.046,
    liftScale: 0.68,
    delayScale: 0.36
  }
});

const getInitialGraphTopologyIndex = (random) => {
  try {
    const shape = new URLSearchParams(globalThis.location?.search || '').get('shape');
    if (!shape) return Math.floor(random() * POOLDAY_GRAPH_TOPOLOGIES.length);
    const normalized = shape.trim().toLowerCase().replace(/\s+/g, '_');
    const index = POOLDAY_GRAPH_TOPOLOGIES.findIndex((topology) => (
      topology.id === normalized || topology.label.toLowerCase().replace(/\s+/g, '_') === normalized
    ));
    return index >= 0 ? index : Math.floor(random() * POOLDAY_GRAPH_TOPOLOGIES.length);
  } catch {
    return Math.floor(random() * POOLDAY_GRAPH_TOPOLOGIES.length);
  }
};

const createFloatTopologyPoints = (sourcePoints = {}, random) => {
  const centerX = 0.50 + (random() - 0.5) * 0.10;
  const centerY = 0.50 + (random() - 0.5) * 0.08;
  const rotation = random() * Math.PI * 2;
  return Object.fromEntries(POOLDAY_GRAPH_NODE_IDS.map((id, index) => {
    const source = sourcePoints[id] || { x: centerX, y: centerY };
    const angle = rotation + index * 2.399963229728653;
    const radius = 0.14 + random() * 0.25;
    const sourcePull = POOLDAY_PARTICIPANT_NODE_IDS.includes(id) ? 0.42 : 0.28;
    return [
      id,
      {
        x: clampRange(centerX + Math.cos(angle) * radius + (source.x - centerX) * sourcePull, 0.10, 0.90),
        y: clampRange(centerY + Math.sin(angle) * radius * 0.78 + (source.y - centerY) * sourcePull, 0.14, 0.86)
      }
    ];
  }));
};

const createNextPoolGraphPlan = (layout, random) => {
  if (layout.phase === 'shape') {
    return {
      phase: 'float',
      targets: createFloatTopologyPoints(layout.targets || layout.positions, random),
      label: 'floating reassort',
      edgePreset: 'float',
      mode: 'float',
      span: POOLDAY_MORPH_TUNING.floatSpan,
      hold: POOLDAY_MORPH_TUNING.floatHold
    };
  }

  let topologyOrder = layout.topologyOrder;
  let topologyOrderCursor = layout.topologyOrderCursor;
  if (!Array.isArray(topologyOrder) || topologyOrderCursor >= topologyOrder.length - 1) {
    topologyOrder = createTopologyOrder(layout.topologyIndex, random);
    topologyOrderCursor = 0;
  }
  const nextCursor = topologyOrderCursor + 1;
  const topologyIndex = topologyOrder[nextCursor] ?? layout.topologyIndex;
  const topology = findTopologyByIndex(topologyIndex);
  return {
    phase: 'shape',
    targets: cloneTopologyPoints(topology),
    label: topology.label,
    edgePreset: topology.edgePreset,
    mode: topology.morph || 'arc',
    span: POOLDAY_MORPH_TUNING.shapeSpan,
    hold: POOLDAY_MORPH_TUNING.shapeHold,
    topologyIndex,
    topologyOrder,
    topologyOrderCursor: nextCursor
  };
};

const createTopologyTransition = (fromPoints, toPoints, mode = 'arc', span = POOLDAY_MORPH_TUNING.shapeSpan, options = {}) => {
  const fromEdgePreset = options.fromEdgePreset || null;
  const toEdgePreset = options.toEdgePreset || null;
  const fromLineSpecs = options.fromLineSpecs || buildSimulationLineSpecs(fromEdgePreset || toEdgePreset || 'float');
  const toLineSpecs = buildSimulationLineSpecs(toEdgePreset || fromEdgePreset || 'float');
  const profile = TRANSITION_MOTION_PROFILES[mode] || TRANSITION_MOTION_PROFILES.arc;
  const linePairs = pairFlowTransitionLines(fromLineSpecs, toLineSpecs);
  return {
    from: copyGraphPoints(fromPoints),
    to: copyGraphPoints(toPoints),
    mode,
    span,
    progress: 0,
    profile,
    fromEdgePreset,
    toEdgePreset,
    cueStart: clamp01(options.cueStart || 0),
    twist: (options.random?.() || 0) > 0.5 ? 1 : -1,
    linePairs,
    settledLineSpecs: linePairs.map((pair) => pair.to),
    controls: Object.fromEntries(POOLDAY_GRAPH_NODE_IDS.map((id, index) => {
      const from = fromPoints[id] || { x: 0.5, y: 0.5 };
      const to = toPoints[id] || from;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(0.01, Math.hypot(dx, dy));
      const normalX = -dy / distance;
      const normalY = dx / distance;
      const participantIndex = POOLDAY_PARTICIPANT_NODE_IDS.indexOf(id);
      const lane = participantIndex >= 0 ? participantIndex : index;
      const lanePhase = ((lane % 5) - 2) / 2;
      return [
        id,
        {
          normalX,
          normalY,
          lanePhase,
          delay: (participantIndex >= 0 ? (lane % 6) * 0.018 : index * 0.01) * profile.delayScale,
          scatterX: ((options.random?.() || 0.5) - 0.5) * profile.scatter,
          scatterY: ((options.random?.() || 0.5) - 0.5) * profile.scatter * 0.82,
          assembleX: normalX * profile.assemble * (0.55 + Math.abs(lanePhase) * 0.45),
          assembleY: normalY * profile.assemble * (0.55 + Math.abs(lanePhase) * 0.45),
          spin: (index % 2 === 0 ? 1 : -1) * (0.65 + (lane % 3) * 0.16)
        }
      ];
    }))
  };
};

const resolveMorphLift = (transition, id, eased, raw) => {
  const control = transition.controls[id] || {};
  const lift = Math.sin(raw * Math.PI);
  const mode = transition.mode;
  const profile = transition.profile || TRANSITION_MOTION_PROFILES.arc;
  const scatterWave = Math.sin(raw * Math.PI) * Math.pow(1 - eased, 0.72);
  const assembleWave = Math.sin(raw * Math.PI) * Math.pow(eased, 0.72);
  const profileX = (control.scatterX || 0) * scatterWave + (control.assembleX || 0) * assembleWave;
  const profileY = (control.scatterY || 0) * scatterWave + (control.assembleY || 0) * assembleWave;
  const scaled = (point) => ({
    x: point.x * profile.liftScale + profileX,
    y: point.y * profile.liftScale + profileY
  });
  if (mode === 'orbit') return {
    x: Math.cos(raw * Math.PI * control.spin) * POOLDAY_MORPH_TUNING.swirlLift * lift,
    y: Math.sin(raw * Math.PI * control.spin) * POOLDAY_MORPH_TUNING.swirlLift * lift
  };
  if (mode === 'fan') return scaled({
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.arcLift * lift,
    y: ((control.normalY || 0) + (control.lanePhase || 0) * 0.32) * POOLDAY_MORPH_TUNING.arcLift * lift
  });
  if (mode === 'fold') return scaled({
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.foldLift * lift,
    y: Math.sin((raw - 0.5) * Math.PI) * POOLDAY_MORPH_TUNING.foldLift * (0.7 + Math.abs(control.lanePhase || 0)) * lift
  });
  if (mode === 'braid') return scaled({
    x: Math.sin(raw * Math.PI * 2 + (control.lanePhase || 0)) * POOLDAY_MORPH_TUNING.swirlLift * 0.62 * lift,
    y: Math.cos(raw * Math.PI * 2 + (control.lanePhase || 0)) * POOLDAY_MORPH_TUNING.swirlLift * 0.42 * lift
  });
  if (mode === 'slide') return scaled({
    x: 0,
    y: (control.lanePhase || 0) * POOLDAY_MORPH_TUNING.foldLift * lift
  });
  if (mode === 'root') return scaled({
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.arcLift * 0.42 * lift,
    y: -Math.abs(control.lanePhase || 0) * POOLDAY_MORPH_TUNING.arcLift * lift
  });
  if (mode === 'pipe') return scaled({
    x: Math.sin(raw * Math.PI * 2) * POOLDAY_MORPH_TUNING.pipeLift * 0.32 * lift,
    y: (control.lanePhase || 0) * POOLDAY_MORPH_TUNING.pipeLift * lift
  });
  if (mode === 'orthogonal') return scaled({
    x: (control.normalX || 0) * (1 - eased) * POOLDAY_MORPH_TUNING.arcLift * 0.52 * lift,
    y: (control.normalY || 0) * eased * POOLDAY_MORPH_TUNING.arcLift * 0.52 * lift
  });
  if (mode === 'float') return scaled({
    x: Math.cos(raw * Math.PI * control.spin) * POOLDAY_MORPH_TUNING.swirlLift * 0.74 * lift,
    y: Math.sin(raw * Math.PI * (1.2 + Math.abs(control.lanePhase || 0))) * POOLDAY_MORPH_TUNING.swirlLift * 0.52 * lift
  });
  return scaled({
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.arcLift * lift,
    y: (control.normalY || 0) * POOLDAY_MORPH_TUNING.arcLift * lift
  });
};

const resolveTransitionPoint = (id, transition) => {
  const from = transition.from[id] || { x: 0.5, y: 0.5 };
  const to = transition.to[id] || from;
  const control = transition.controls[id] || {};
  const raw = clamp01((transition.progress - (control.delay || 0)) / Math.max(0.001, 1 - (control.delay || 0)));
  if (raw >= 1) return { x: to.x, y: to.y };
  const eased = transition.profile?.ease === 'sinePlateau'
    ? easeSinePlateau(raw)
    : easeInOutSine(raw);
  const lift = resolveMorphLift(transition, id, eased, raw);
  return {
    x: clampRange(from.x + (to.x - from.x) * eased + lift.x, 0.04, 0.96),
    y: clampRange(from.y + (to.y - from.y) * eased + lift.y, 0.06, 0.96)
  };
};

const createPoolGraphLayout = (random) => {
  const initialIndex = getInitialGraphTopologyIndex(random);
  const firstTopology = findTopologyByIndex(initialIndex);
  const points = cloneTopologyPoints(firstTopology);
  const topologyOrder = createTopologyOrder(initialIndex, random);
  const layout = {
    positions: copyGraphPoints(points),
    targets: points,
    topologyIndex: initialIndex,
    topologyOrder,
    topologyOrderCursor: 0,
    phase: 'shape',
    label: firstTopology.label,
    edgePreset: firstTopology.edgePreset,
    edgeSpecs: buildSimulationLineSpecs(firstTopology.edgePreset),
    nextPlan: null,
    planStartedAt: 0,
    nextShiftAt: POOLDAY_MORPH_TUNING.shapeHold + random() * POOLDAY_MORPH_TUNING.holdJitter,
    transition: null,
    anticipation: 0,
    flowEnergy: 1,
    flowEnergyTarget: 1,
    paletteFromIndex: 0,
    paletteToIndex: 0,
    paletteBlend: 1
  };
  layout.nextPlan = createNextPoolGraphPlan(layout, random);
  return layout;
};

const pickPoolPaletteIndex = (currentIndex, random) => {
  if (POOLDAY_GRAPH_PALETTES.length < 2) return 0;
  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(random() * POOLDAY_GRAPH_PALETTES.length);
  }
  return nextIndex;
};

const shiftPoolGraphTarget = (layout, time, random) => {
  const fromEdgePreset = layout.edgePreset;
  const plan = layout.nextPlan || createNextPoolGraphPlan(layout, random);
  layout.phase = plan.phase;
  layout.targets = copyGraphPoints(plan.targets);
  layout.label = plan.label;
  if (plan.phase === 'shape') {
    layout.topologyIndex = plan.topologyIndex ?? layout.topologyIndex;
    layout.topologyOrder = plan.topologyOrder || layout.topologyOrder;
    layout.topologyOrderCursor = plan.topologyOrderCursor ?? layout.topologyOrderCursor;
  }
  layout.transition = createTopologyTransition(
    layout.positions,
    layout.targets,
    plan.mode || 'arc',
    plan.span,
    {
      fromEdgePreset,
      toEdgePreset: plan.edgePreset,
      fromLineSpecs: layout.edgeSpecs,
      cueStart: layout.anticipation,
      random
    }
  );
  layout.nextPlan = null;
  layout.nextShiftAt = time + plan.span + plan.hold + random() * POOLDAY_MORPH_TUNING.holdJitter;
  layout.flowEnergyTarget = 0.62 + random() * 0.92;
  layout.paletteFromIndex = layout.paletteToIndex;
  layout.paletteToIndex = pickPoolPaletteIndex(layout.paletteToIndex, random);
  layout.paletteBlend = 0;
};

const mixColor = (from, to, amount) => from.map((value, index) => (
  Math.round(value + (to[index] - value) * amount)
));

const resolvePoolGraphPalette = (layout) => {
  const from = POOLDAY_GRAPH_PALETTES[layout.paletteFromIndex] || POOLDAY_GRAPH_PALETTES[0];
  const to = POOLDAY_GRAPH_PALETTES[layout.paletteToIndex] || from;
  const blend = clamp01(layout.paletteBlend);
  return {
    primary: mixColor(from.primary, to.primary, blend),
    evidence: mixColor(from.evidence, to.evidence, blend),
    peer: mixColor(from.peer, to.peer, blend),
    pipe: mixColor(from.pipe, to.pipe, blend),
    accent: mixColor(from.accent, to.accent, blend),
    rainbow: POOLDAY_RAINBOW_COLORS
  };
};

const updatePoolGraphLayout = (state, safeDelta) => {
  const layout = state.layout;
  if (state.time >= layout.nextShiftAt) {
    shiftPoolGraphTarget(layout, state.time, state.random);
  }
  if (layout.transition) {
    layout.anticipation = 0;
    layout.transition.progress = clamp01(
      layout.transition.progress + safeDelta / Math.max(0.001, layout.transition.span)
    );
    for (const id of POOLDAY_GRAPH_NODE_IDS) {
      layout.positions[id] = resolveTransitionPoint(id, layout.transition);
    }
    if (layout.transition.progress >= 1) {
      for (const id of POOLDAY_GRAPH_NODE_IDS) {
        const target = layout.transition.to[id] || layout.positions[id];
        layout.positions[id] = { x: target.x, y: target.y };
      }
      layout.edgePreset = layout.transition.toEdgePreset || layout.edgePreset;
      layout.edgeSpecs = layout.transition.settledLineSpecs || buildSimulationLineSpecs(layout.edgePreset);
      layout.transition = null;
      layout.planStartedAt = state.time;
      layout.nextPlan = createNextPoolGraphPlan(layout, state.random);
    }
  } else {
    layout.anticipation = clamp01(
      1 - Math.max(0, layout.nextShiftAt - state.time) / POOLDAY_MORPH_TUNING.anticipationSpan
    );
    if (!layout.nextPlan) layout.nextPlan = createNextPoolGraphPlan(layout, state.random);
    const cycleSpan = Math.max(0.001, layout.nextShiftAt - layout.planStartedAt);
    const cycleProgress = clamp01((state.time - layout.planStartedAt) / cycleSpan);
    const preludeBlend = clamp01(
      POOLDAY_MORPH_TUNING.preludeDrift * easeInOutSine(cycleProgress)
      + POOLDAY_MORPH_TUNING.preludeSurge * Math.pow(layout.anticipation, 2.25)
    );
    const preludeRate = POOLDAY_MORPH_TUNING.preludeRate + layout.anticipation * 0.030;
    for (const id of POOLDAY_GRAPH_NODE_IDS) {
      const current = layout.positions[id];
      const target = layout.targets[id] || current;
      const nextTarget = layout.nextPlan?.targets?.[id] || target;
      const previewTarget = {
        x: target.x + (nextTarget.x - target.x) * preludeBlend,
        y: target.y + (nextTarget.y - target.y) * preludeBlend
      };
      const rate = Math.max(POOLDAY_MORPH_TUNING.settleRate, preludeRate);
      current.x = lerpToward(current.x, previewTarget.x, rate, safeDelta);
      current.y = lerpToward(current.y, previewTarget.y, rate, safeDelta);
    }
  }
  layout.flowEnergy = lerpToward(layout.flowEnergy, layout.flowEnergyTarget, 0.035, safeDelta);
  layout.paletteBlend = lerpToward(layout.paletteBlend, 1, 0.042, safeDelta);
  return layout.positions;
};

export const createPoolSimulationState = () => {
  const seed = createSimulationSeed();
  const random = createSeededRandom(seed);
  const participants = POOLDAY_PARTICIPANT_LAYOUT.map(({ id, role, point: [x, y] }, index) => ({
    id,
    role,
    index,
    x,
    y,
    phase: index * 1.7,
    driftX: 8 + (index % 3) * 3,
    driftY: 9 + (index % 2) * 4,
    size: 10 + (index % 3) * 1.5,
    presence: 1,
    lineDraw: 1,
    pulse: 0
  }));
  const particles = Array.from({ length: POOLDAY_FLOW_TUNING.particleCount }, (_, index) => ({
    index,
    offset: (index * 0.113) % 1,
    speed: POOLDAY_FLOW_TUNING.baseSpeed
      + (index % 5) * POOLDAY_FLOW_TUNING.edgeSpeedStep
      + ((index % 7) / 7) * POOLDAY_FLOW_TUNING.speedJitter,
    edgeIndex: index,
    laneBias: (index % 5) - 2,
    tone: index % 4,
    participantIndex: index % participants.length,
    phase: index * 0.47,
    size: (2.7 + (index % 4) * 0.74) * POOLDAY_FLOW_TUNING.particleScale
  }));
  return {
    participants,
    particles,
    pointer: {
      x: 0.5,
      y: 0.5,
      targetX: 0.5,
      targetY: 0.5,
      active: false,
      force: 0
    },
    seed,
    random,
    layout: createPoolGraphLayout(random),
    lineProjector: createSimulationLineProjector(),
    time: 0,
    lastFrameMs: performance.now() - SIMULATION_TARGET_STEP_MS
  };
};

export const resizePoolCanvas = (canvas) => {
  const box = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, box.width);
  const cssHeight = Math.max(1, box.height);
  const pixelBudgetRatio = Math.sqrt(SIMULATION_MAX_CANVAS_PIXELS / Math.max(1, cssWidth * cssHeight));
  const ratio = clampRange(
    Math.min(window.devicePixelRatio || 1, SIMULATION_MAX_PIXEL_RATIO, pixelBudgetRatio),
    SIMULATION_MIN_PIXEL_RATIO,
    SIMULATION_MAX_PIXEL_RATIO
  );
  const width = Math.max(1, Math.floor(box.width * ratio));
  const height = Math.max(1, Math.floor(box.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
};

const easeOutCubic = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - bounded, 3);
};

export const easeInOutCubic = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded < 0.5
    ? 4 * bounded * bounded * bounded
    : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
};

const easeInOutSine = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return -(Math.cos(Math.PI * bounded) - 1) / 2;
};

const easeSinePlateau = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  const shoulder = 0.32;
  if (bounded < shoulder) {
    const cruiseVelocity = 1 / (1 - shoulder);
    return cruiseVelocity * bounded * bounded / (2 * shoulder);
  }
  if (bounded > 1 - shoulder) {
    const cruiseVelocity = 1 / (1 - shoulder);
    const remaining = 1 - bounded;
    return 1 - cruiseVelocity * remaining * remaining / (2 * shoulder);
  }
  return (bounded - shoulder / 2) / (1 - shoulder);
};

const resolveTransitionBlend = (transition) => {
  const bounded = clamp01(transition?.progress || 0);
  return transition?.profile?.ease === 'sinePlateau'
    ? easeSinePlateau(bounded)
    : easeInOutSine(bounded);
};

const easeOutQuart = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - bounded, 4);
};

const lerpToward = (current, target, rate, deltaSeconds) => {
  const deltaMs = Math.max(0, Math.min(SIMULATION_MAX_STEP_MS, deltaSeconds * 1000));
  const deltaScale = deltaMs / SIMULATION_TARGET_STEP_MS;
  const blend = 1 - Math.pow(1 - rate, deltaScale);
  return current + (target - current) * blend;
};

const buildTransitionSimulationLines = ({ roles, participants, layout, time, projector }) => {
  const transition = layout.transition;
  if (!transition) {
    return projector.materializeLineSpecs({
      roles,
      participants,
      specs: layout.edgeSpecs || buildSimulationLineSpecs(layout.edgePreset),
      time
    });
  }
  const blend = resolveTransitionBlend(transition);
  if (!transition.linePairs?.length) {
    return projector.materializeLineSpecs({
      roles,
      participants,
      specs: buildSimulationLineSpecs(transition.toEdgePreset || layout.edgePreset),
      time
    });
  }
  return projector.materializeLinePairs({
    roles,
    participants,
    linePairs: transition.linePairs,
    time,
    blend
  });
};

const resolveParticleProgress = (particle, line, participant, time, flowScale, pointerForce = 0) => {
  const routeLength = line?.from && line?.to
    ? Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
    : 420;
  const lengthScale = clampRange(420 / Math.max(120, routeLength), 0.36, 1.20);
  return (
    particle.offset
    + (line?.flowPhase || 0) * 0.017
    + time * particle.speed * (line?.speed || 1) * (1.02 + participant.pulse * 0.18) * flowScale * lengthScale
    + pointerForce * 0.05
  ) % 1;
};

const smoothStep = (value) => {
  const bounded = clamp01(value);
  return bounded * bounded * (3 - 2 * bounded);
};

const resolveFlowVisibility = (progress) => (
  Math.pow(smoothStep(progress / 0.20) * smoothStep((1 - progress) / 0.20), 1.35)
);

export const resolveLineGeometry = (line, width, height) => {
  const from = line.from;
  const to = line.to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const laneIndex = Number(line.laneIndex || 0);
  const laneCount = Math.max(1, Number(line.laneCount || 1));
  const laneOffsetUnits = Number.isFinite(Number(line.laneOffset))
    ? Number(line.laneOffset)
    : laneIndex - (laneCount - 1) / 2;
  const laneOffset = laneOffsetUnits * POOLDAY_FLOW_TUNING.laneGap;
  const signedCurve = Number.isFinite(Number(line.signedCurve))
    ? Number(line.signedCurve)
    : Number(line.curve || 0) * (Number.isFinite(Number(line.curveSign)) ? Number(line.curveSign) : 1);
  const curveOffset = Math.min(width, height) * signedCurve;
  return {
    start: {
      x: from.x + normalX * laneOffset,
      y: from.y + normalY * laneOffset
    },
    end: {
      x: to.x + normalX * laneOffset,
      y: to.y + normalY * laneOffset
    },
    control: {
      x: (from.x + to.x) * 0.5 + normalX * (laneOffset + curveOffset),
      y: (from.y + to.y) * 0.5 + normalY * (laneOffset + curveOffset)
    }
  };
};

export const resolveLinePoint = (line, amount, width, height) => {
  const { start, end, control } = resolveLineGeometry(line, width, height);
  const ease = line.flowEase || 'sine';
  const t = ease === 'out'
    ? easeOutCubic(amount)
    : ease === 'quart'
      ? easeOutQuart(amount)
      : ease === 'cubic'
        ? easeInOutCubic(amount)
        : easeInOutSine(amount);
  const inv = 1 - t;
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y
  };
};

export const resolveFrameBounds = (nodes = [], width = 1, height = 1) => {
  if (!nodes.length) {
    return {
      x: width * 0.5,
      y: height * 0.5,
      radius: Math.min(width, height) * 0.24
    };
  }
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  const x = (minX + maxX) * 0.5;
  const y = (minY + maxY) * 0.5;
  const radius = Math.max(60, Math.min(width, height) * 0.12, Math.hypot(maxX - minX, maxY - minY) * 0.56);
  return { x, y, radius };
};


export const buildPoolSimulationFrame = (state, width, height, deltaSeconds = SIMULATION_TARGET_STEP_MS / 1000) => {
  const safeDelta = Math.max(0, Math.min(SIMULATION_MAX_STEP_MS / 1000, deltaSeconds));
  state.time += safeDelta * SIMULATION_GENTLE_SPEED;
  state.pointer.x = lerpToward(state.pointer.x, state.pointer.targetX, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.y = lerpToward(state.pointer.y, state.pointer.targetY, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.force = lerpToward(state.pointer.force, state.pointer.active ? 1 : 0, SIMULATION_FORCE_LERP, safeDelta);
  if (state.pointer.force < SIMULATION_MIN_FORCE) state.pointer.force = 0;

  const time = state.time;
  const graphPositions = updatePoolGraphLayout(state, safeDelta);
  const transitionProgress = clamp01(state.layout.transition?.progress || 0);
  const transitionSignal = state.layout.transition ? Math.sin(transitionProgress * Math.PI) : 0;
  const carriedCue = state.layout.transition
    ? (state.layout.transition.cueStart || 0) * Math.pow(1 - transitionProgress, 1.35)
    : 0;
  const topologyCue = Math.max(state.layout.anticipation || 0, carriedCue, transitionSignal * 0.58);
  const countdownProgress = Math.max(state.layout.anticipation || 0, transitionSignal);
  const orbitCue = easeInOutCubic(topologyCue);
  const makeRoleAnchor = (id, size, phase, orbit = 7) => {
    const base = graphPositions[id] || { x: 0.5, y: 0.5 };
    const breathe = 0.5 + 0.5 * Math.sin(time * 1.4 + phase);
    const baseX = width * base.x;
    const baseY = height * base.y;
    const cuePhase = phase + orbitCue * (1.2 + phase * 0.08);
    const cueOrbit = orbit * (1 + orbitCue * 0.52);
    const offsetX = Math.cos(time * 0.52 + cuePhase) * cueOrbit;
    const offsetY = Math.sin(time * 0.46 + cuePhase * 1.3) * cueOrbit;
    return {
      id,
      role: id,
      core: true,
      baseX,
      baseY,
      offsetX,
      offsetY,
      x: baseX + offsetX,
      y: baseY + offsetY,
      size: size * (0.9 + breathe * 0.2),
      alpha: 1,
      pulse: breathe,
      halo: 0.55 + breathe * 0.45,
      ringProgress: countdownProgress,
      topologyProgress: transitionProgress
    };
  };
  const roles = {
    requester: makeRoleAnchor('requester', 17, 0.2, 7),
    policy: makeRoleAnchor('policy', 15, 0.9, 7),
    assignment: makeRoleAnchor('assignment', 21, 1.8, 8),
    agreement: makeRoleAnchor('agreement', 16, 3.3, 7),
    settlement: makeRoleAnchor('settlement', 15, 4.1, 7),
    ledger: makeRoleAnchor('ledger', 17, 4.8, 7)
  };
  const pointerX = state.pointer.x * width;
  const pointerY = state.pointer.y * height;
  const participants = state.participants.map((participant) => {
    const base = graphPositions[participant.id] || { x: participant.x, y: participant.y };
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.55 + participant.phase);
    const baseX = width * base.x;
    const baseY = height * base.y;
    const dx = baseX - pointerX;
    const dy = baseY - pointerY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pointerLift = state.pointer.active || state.pointer.force > 0.02
      ? Math.max(0, 1 - distance / (width * 0.34)) * (10 + state.pointer.force * 16)
      : 0;
    const driftX = Math.cos(time * (0.78 + orbitCue * 0.10) + participant.phase + orbitCue * 1.6) * participant.driftX * (0.44 + orbitCue * 0.22)
      + Math.sin(time * 0.33 + participant.phase * 1.4 + orbitCue) * participant.driftX * (0.22 + orbitCue * 0.10)
      + (dx / distance) * pointerLift;
    const driftY = Math.sin(time * (0.72 + orbitCue * 0.10) + participant.phase + orbitCue * 1.4) * participant.driftY * (0.44 + orbitCue * 0.22)
      + Math.cos(time * 0.41 + participant.phase * 1.2 + orbitCue) * participant.driftY * (0.18 + orbitCue * 0.10)
      + (dy / distance) * pointerLift;
    return {
      ...participant,
      online: true,
      core: false,
      baseX,
      baseY,
      offsetX: driftX,
      offsetY: driftY,
      x: baseX + driftX,
      y: baseY + driftY,
      alpha: 0.78 + pulse * 0.18,
      size: participant.size * (0.78 + pulse * 0.5) + state.pointer.force * 1.2,
      presence: 1,
      lineDraw: 1,
      pulse,
      halo: 0.48 + pulse * 0.52,
      ringProgress: countdownProgress,
      topologyProgress: transitionProgress
    };
  });
  const flowScale = 0.72 + state.layout.flowEnergy * 0.42;
  const lines = buildTransitionSimulationLines({
    roles,
    participants,
    layout: state.layout,
    time,
    projector: state.lineProjector
  });
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    line.pulse += orbitCue * (0.08 + (index % 5) * 0.018);
    line.speed *= 1 + orbitCue * 0.16;
    line.width *= 1 + orbitCue * 0.08;
    line.flowCountdown = countdownProgress;
    line.phaseShift = topologyCue;
    line.topologyProgress = transitionProgress;
  }
  const particles = state.particles.map((particle) => {
    const line = lines[particle.edgeIndex % Math.max(1, lines.length)];
    const participant = participants[particle.participantIndex % participants.length];
    const flowPulse = Math.sin(time * 6.2 + particle.phase) * 0.5 + 0.5;
    const progress = resolveParticleProgress(particle, line, participant, time, flowScale, state.pointer.force);
    const point = line
      ? resolveLinePoint(line, progress, width, height)
      : { x: roles.assignment.x, y: roles.assignment.y };
    const flowAlpha = line?.flowAlpha ?? 1;
    const visibility = resolveFlowVisibility(progress);
    const particleScale = line?.particleScale ?? 1;
    const sizeWidth = line?.width ?? 1;
    const sizeScale = particleScale * (0.88 + Math.min(3, sizeWidth) * 0.075);
    return {
      index: particle.index,
      x: point.x,
      y: point.y,
      size: (particle.size + flowPulse * 2.45 + participant.pulse * 0.9) * sizeScale,
      alpha: clamp01((0.34 + flowPulse * 0.60) * (0.84 + state.layout.flowEnergy * 0.22) * flowAlpha * visibility),
      tone: line?.tone || 'rainbow',
      toneIndex: line?.toneIndex ?? particle.tone,
      toneTo: line?.toneTo || null,
      toneToIndex: line?.toneToIndex ?? particle.tone,
      toneBlend: line?.toneBlend ?? 0,
      speed: line?.speed ?? 1
    };
  });
  const activeEdgePreset = state.layout.transition?.toEdgePreset || state.layout.edgePreset;
  const averageAnchor = (ids, offsetX = 0, offsetY = 0) => {
    const selected = ids
      .map((id) => roles[id] || participants.find((participant) => participant.id === id))
      .filter(Boolean);
    const divisor = Math.max(1, selected.length);
    return selected.reduce((acc, node) => ({
      x: acc.x + node.x / divisor,
      y: acc.y + node.y / divisor
    }), { x: offsetX, y: offsetY });
  };
  const runnerOffset = activeEdgePreset === 'bowtie_exchange' || activeEdgePreset === 'star_rendezvous'
    ? -height * 0.11
    : -height * 0.06;
  const verifierOffset = activeEdgePreset === 'honeycomb' || activeEdgePreset === 'triangulation'
    ? -height * 0.03
    : -height * 0.05;
  const nodeLookup = new Map([
    ...Object.values(roles).map((node) => [node.id, node]),
    ...participants.map((node) => [node.id, node])
  ]);
  const nodes = POOLDAY_GRAPH_NODE_IDS
    .map((id) => nodeLookup.get(id))
    .filter(Boolean);
  return {
    lines,
    nodes: nodes.map((node) => clampCanvasPoint(node, width, height, 8)),
    particles: particles.map((particle) => clampCanvasPoint(particle, width, height, 5)),
    peerCount: participants.length,
    participantCount: participants.length,
    topologyLabel: state.layout.label,
    time,
    flowEnergy: state.layout.flowEnergy,
    anticipation: state.layout.anticipation,
    transitionActive: Boolean(state.layout.transition),
    transitionProgress,
    topologyCue,
    topologyProgress: transitionProgress,
    countdownProgress,
    palette: resolvePoolGraphPalette(state.layout),
    labelAnchors: {
      requester: roles.requester,
      policy: roles.policy,
      runners: averageAnchor(POOLDAY_RUNNER_NODE_IDS, 0, runnerOffset),
      verifiers: averageAnchor(POOLDAY_VERIFIER_NODE_IDS, 0, verifierOffset),
      settlement: roles.settlement,
      ledger: roles.ledger,
    }
  };
};
