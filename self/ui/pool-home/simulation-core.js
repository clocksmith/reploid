/**
 * @fileoverview Simulation topology and frame generation for the Reploid graph.
 */

import {
  POOLDAY_FLOW_TUNING,
  POOLDAY_GRAPH_LABEL_ROLE_META,
  POOLDAY_GRAPH_LABEL_STAGES,
  POOLDAY_GRAPH_NODE_IDS,
  POOLDAY_GRAPH_PALETTES,
  POOLDAY_GRAPH_TOPOLOGIES,
  POOLDAY_MORPH_TUNING,
  POOLDAY_PARTICIPANT_NODE_IDS,
  SIMULATION_MAX_CANVAS_PIXELS,
  SIMULATION_GENTLE_SPEED,
  SIMULATION_MAX_PIXEL_RATIO,
  SIMULATION_MAX_STEP_MS,
  SIMULATION_MOTION_CLOCK_WRAP_SECONDS,
  SIMULATION_MIN_PIXEL_RATIO,
  SIMULATION_POINTER_LERP,
  SIMULATION_TARGET_STEP_MS
} from './constants.js';
import { pairFlowTransitionLines } from './simulation-flow-transition.js';
import {
  buildSimulationLineSpecs,
  createSimulationLineProjector
} from './simulation-flow-specs.js';
import {
  POOLDAY_CORE_NODE_CONFIG,
  copyCanvasPointInto,
  copyParticleInto,
  createFrameNode,
  createFrameParticle,
  createPoolGraphPaletteFrame,
  resolvePoolGraphPalette,
  writeParticipantAnchor,
  writeRoleAnchor
} from './simulation-frame-state.js';

const POINTER_SHOOTER_PARTICLE_COUNT = 32;
const POINTER_SHOOTER_EDGE_SAMPLES = 18;
const POINTER_SHOOTER_CAPTURE = 0.18;
const POINTER_SHOOTER_HOLD_RATE = 18;
const POINTER_SHOOTER_MOVE_RATE = 52;
const POINTER_SHOOTER_MAX_SPAWN_PER_FRAME = 9;

export const clamp01 = (value) => Math.max(0, Math.min(1, value));
export const clampRange = (value, min, max) => Math.max(min, Math.min(max, value));

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

const createPoolGraphLabelPlan = (random) => {
  const plan = {};
  for (let stageIndex = 0; stageIndex < POOLDAY_GRAPH_LABEL_STAGES.length; stageIndex += 1) {
    const stage = POOLDAY_GRAPH_LABEL_STAGES[stageIndex];
    const ids = shuffleValues(stage.ids, random);
    const roles = shuffleValues(stage.roles, random);
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const role = roles[index % roles.length];
      const meta = POOLDAY_GRAPH_LABEL_ROLE_META[role] || POOLDAY_GRAPH_LABEL_ROLE_META.run;
      const stagger = index - (ids.length - 1) / 2;
      plan[id] = {
        id,
        role,
        label: meta.label,
        stage: stage.id,
        stageLabel: stage.label,
        body: `${stage.label} step: ${meta.body}`,
        offsetX: stagger * 12,
        offsetY: -20 - stageIndex * 2 - Math.abs(stagger) * 3
      };
    }
  }
  return plan;
};

const applyNodeLabelPlan = (node, labelPlan = {}) => {
  const label = labelPlan[node.id];
  if (!label) return node;
  node.label = label.label;
  node.labelKind = label.role;
  node.labelStage = label.stage;
  node.labelBody = label.body;
  return node;
};

const copyNodeLabelAnchorInto = (target, node, labelPlan, width, height) => {
  copyCanvasPointInto(target, node, width, height, 0);
  const label = labelPlan[node.id] || {};
  target.x = clampRange(target.x + (label.offsetX || 0), 8, Math.max(8, width - 8));
  target.y = clampRange(target.y + (label.offsetY || 0), 8, Math.max(8, height - 8));
  target.label = label.label || node.label || node.id;
  target.labelKind = label.role || node.labelKind || node.role || node.id;
  target.labelStage = label.stage || node.labelStage || '';
  target.labelBody = label.body || node.labelBody || '';
  return target;
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
    stableHoldProgress: 0,
    stableRelease: 0,
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
  layout.stableHoldProgress = 1;
  layout.stableRelease = 1;
  layout.flowEnergyTarget = 0.62 + random() * 0.92;
  layout.paletteFromIndex = layout.paletteToIndex;
  layout.paletteToIndex = pickPoolPaletteIndex(layout.paletteToIndex, random);
  layout.paletteBlend = 0;
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
      layout.stableHoldProgress = 0;
      layout.stableRelease = 0;
      layout.nextPlan = createNextPoolGraphPlan(layout, state.random);
    }
  } else {
    const holdElapsed = Math.max(0, state.time - layout.planStartedAt);
    const stableHoldSpan = Math.max(0.001, POOLDAY_MORPH_TUNING.stableHoldSpan);
    const stableReleaseSpan = Math.max(0.001, POOLDAY_MORPH_TUNING.stableReleaseSpan);
    const stableReleaseRaw = clamp01((holdElapsed - stableHoldSpan) / stableReleaseSpan);
    layout.stableHoldProgress = clamp01(holdElapsed / stableHoldSpan);
    layout.stableRelease = easeInOutCubic(stableReleaseRaw);
    const rawAnticipation = clamp01(
      1 - Math.max(0, layout.nextShiftAt - state.time) / POOLDAY_MORPH_TUNING.anticipationSpan
    );
    layout.anticipation = rawAnticipation * layout.stableRelease;
    if (!layout.nextPlan) layout.nextPlan = createNextPoolGraphPlan(layout, state.random);
    const cycleSpan = Math.max(0.001, layout.nextShiftAt - layout.planStartedAt);
    const cycleProgress = clamp01((state.time - layout.planStartedAt) / cycleSpan);
    const preludeBlend = clamp01(
      POOLDAY_MORPH_TUNING.preludeDrift * layout.stableRelease * easeInOutSine(cycleProgress)
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
  const participantSpecs = POOLDAY_PARTICIPANT_NODE_IDS.map((id, index) => ({
    id,
    role: id.startsWith('verifier') ? 'verifier' : 'runner',
    index,
    phase: index * 1.7,
    driftX: 8 + (index % 3) * 3,
    driftY: 9 + (index % 2) * 4,
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
    size: (2.7 + (index % 4) * 0.74) * POOLDAY_FLOW_TUNING.particleScale
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
    toneIndex: index
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
    labelAnchors
  };
  return {
    participantSpecs,
    participants,
    roles,
    nodeLookup,
    nodeLabelPlan: labelPlan,
    frameNodes,
    frameParticles,
    labelAnchors,
    frame,
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

const resolveParticleProgress = (particle, line, participant, time, flowScale) => {
  const routeLength = line?.from && line?.to
    ? Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
    : 420;
  const lengthScale = clampRange(420 / Math.max(120, routeLength), 0.36, 1.20);
  return (
    particle.offset
    + (line?.flowPhase || 0) * 0.017
    + time * particle.speed * (line?.speed || 1) * (1.02 + participant.pulse * 0.18) * flowScale * lengthScale
  ) % 1;
};

const smoothStep = (value) => {
  const bounded = clamp01(value);
  return bounded * bounded * (3 - 2 * bounded);
};

const resolveFlowVisibility = (progress) => (
  Math.pow(smoothStep(progress / 0.20) * smoothStep((1 - progress) / 0.20), 1.35)
);

const resolveNearestLineMagnet = (lines, x, y, width, height, scratch) => {
  if (!lines.length) return null;
  const previous = scratch.previous;
  const current = scratch.current;
  scratch.bestLine = null;
  scratch.bestIndex = 0;
  scratch.bestAmount = 0;
  scratch.bestDistanceSq = Infinity;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    resolveLinePointInto(previous, line, 0, width, height);
    let previousAmount = 0;
    for (let sampleIndex = 1; sampleIndex <= POINTER_SHOOTER_EDGE_SAMPLES; sampleIndex += 1) {
      const currentAmount = sampleIndex / POINTER_SHOOTER_EDGE_SAMPLES;
      resolveLinePointInto(current, line, currentAmount, width, height);
      const segmentX = current.x - previous.x;
      const segmentY = current.y - previous.y;
      const segmentLengthSq = segmentX * segmentX + segmentY * segmentY;
      const segmentProgress = segmentLengthSq > 0
        ? clamp01(((x - previous.x) * segmentX + (y - previous.y) * segmentY) / segmentLengthSq)
        : 0;
      const projectedX = previous.x + segmentX * segmentProgress;
      const projectedY = previous.y + segmentY * segmentProgress;
      const distanceX = x - projectedX;
      const distanceY = y - projectedY;
      const distanceSq = distanceX * distanceX + distanceY * distanceY;
      if (distanceSq < scratch.bestDistanceSq) {
        scratch.bestLine = line;
        scratch.bestIndex = lineIndex;
        scratch.bestAmount = previousAmount + (currentAmount - previousAmount) * segmentProgress;
        scratch.bestDistanceSq = distanceSq;
      }
      previous.x = current.x;
      previous.y = current.y;
      previousAmount = currentAmount;
    }
  }
  return scratch.bestLine ? scratch : null;
};

const spawnPointerShot = (state, lines, width, height) => {
  const pointer = state.pointer;
  const originX = clamp01(pointer.targetX);
  const originY = clamp01(pointer.targetY);
  const nearest = resolveNearestLineMagnet(
    lines,
    originX * width,
    originY * height,
    width,
    height,
    state.pointerEdgeSearch
  );
  if (!nearest) return false;
  const slot = pointer.shotCursor % state.pointerShots.length;
  const serial = pointer.shotSerial;
  const shot = state.pointerShots[slot];
  const random = state.random;
  const jitter = (random() - 0.5) * 0.12;
  const start = clampRange(nearest.bestAmount + jitter, 0.035, 0.965);
  const direction = start > 0.76
    ? -1
    : start < 0.24
      ? 1
      : (serial % 2 === 0 ? 1 : -1);
  shot.active = true;
  shot.lineIndex = nearest.bestIndex;
  shot.start = start;
  shot.direction = direction;
  shot.age = 0;
  shot.life = 0.68 + random() * 0.36;
  shot.speed = 0.56 + random() * 0.38 + Math.min(1.4, pointer.moveEnergy || 0) * 0.18;
  shot.originX = originX;
  shot.originY = originY;
  shot.toneIndex = (nearest.bestLine.toneIndex ?? serial) + (serial % 7);
  pointer.shotCursor = (slot + 1) % state.pointerShots.length;
  pointer.shotSerial += 1;
  return true;
};

const hidePointerShotFrame = (target, index) => {
  target.index = POOLDAY_FLOW_TUNING.particleCount + index;
  target.x = 0;
  target.y = 0;
  target.size = 0;
  target.alpha = 0;
  target.tone = 'rainbow';
  target.toneIndex = index;
  target.toneTo = null;
  target.toneToIndex = index;
  target.toneBlend = 0;
  target.speed = 0;
};

const writePointerShooterParticles = (state, lines, width, height, safeDelta, time, flowScale) => {
  const pointer = state.pointer;
  if (pointer.holding && lines.length > 0) {
    const moveEnergy = Math.min(1.8, pointer.moveEnergy || 0);
    pointer.shotAccumulator += safeDelta * (POINTER_SHOOTER_HOLD_RATE + moveEnergy * POINTER_SHOOTER_MOVE_RATE)
      + (pointer.shotBurst || 0);
    pointer.shotBurst = 0;
    let spawned = 0;
    while (pointer.shotAccumulator >= 1 && spawned < POINTER_SHOOTER_MAX_SPAWN_PER_FRAME) {
      if (!spawnPointerShot(state, lines, width, height)) break;
      pointer.shotAccumulator -= 1;
      spawned += 1;
    }
    if (spawned >= POINTER_SHOOTER_MAX_SPAWN_PER_FRAME) {
      pointer.shotAccumulator = Math.min(pointer.shotAccumulator, 0.96);
    }
  } else {
    pointer.shotAccumulator = 0;
    pointer.shotBurst = 0;
  }
  pointer.moveEnergy = lerpToward(pointer.moveEnergy || 0, 0, 0.24, safeDelta);

  const frameOffset = state.particles.length;
  const point = state.particlePoint;
  for (let index = 0; index < state.pointerShots.length; index += 1) {
    const shot = state.pointerShots[index];
    const target = state.frameParticles[frameOffset + index];
    if (!shot.active || lines.length <= 0) {
      shot.active = false;
      hidePointerShotFrame(target, index);
      continue;
    }
    const line = lines[shot.lineIndex % lines.length];
    if (!line) {
      shot.active = false;
      hidePointerShotFrame(target, index);
      continue;
    }
    shot.age += safeDelta;
    const lifeProgress = shot.age / Math.max(0.001, shot.life);
    const routeProgress = shot.start + shot.direction * shot.age * shot.speed * (line.speed || 1) * flowScale * 0.38;
    if (lifeProgress >= 1 || routeProgress < -0.06 || routeProgress > 1.06) {
      shot.active = false;
      hidePointerShotFrame(target, index);
      continue;
    }
    const edgeProgress = clamp01(routeProgress);
    resolveLinePointInto(point, line, edgeProgress, width, height);
    const capture = easeOutCubic(shot.age / POINTER_SHOOTER_CAPTURE);
    const sourceX = shot.originX * width;
    const sourceY = shot.originY * height;
    const pulse = Math.sin(time * 9.4 + index * 1.37) * 0.5 + 0.5;
    const lifeFade = smoothStep(lifeProgress / 0.16) * smoothStep((1 - lifeProgress) / 0.28);
    const flowAlpha = line.flowAlpha ?? 1;
    const particleScale = line.particleScale ?? 1;
    target.index = POOLDAY_FLOW_TUNING.particleCount + index;
    target.x = sourceX + (point.x - sourceX) * capture;
    target.y = sourceY + (point.y - sourceY) * capture;
    target.size = (3.7 + (1 - capture) * 2.8 + pulse * 1.1) * particleScale;
    target.alpha = clamp01((0.50 + capture * 0.38) * lifeFade * (0.82 + state.layout.flowEnergy * 0.18) * flowAlpha);
    target.tone = line.tone || 'rainbow';
    target.toneIndex = shot.toneIndex;
    target.toneTo = line.toneTo || null;
    target.toneToIndex = line.toneToIndex ?? shot.toneIndex;
    target.toneBlend = line.toneBlend ?? 0;
    target.speed = line.speed ?? 1;
  }
};

const resolveLineGeometryScalarsInto = (target, line, width, height) => {
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
  target.startX = from.x + normalX * laneOffset;
  target.startY = from.y + normalY * laneOffset;
  target.endX = to.x + normalX * laneOffset;
  target.endY = to.y + normalY * laneOffset;
  target.controlX = (from.x + to.x) * 0.5 + normalX * (laneOffset + curveOffset);
  target.controlY = (from.y + to.y) * 0.5 + normalY * (laneOffset + curveOffset);
  return target;
};

export const resolveLineGeometry = (line, width, height) => {
  const geometry = resolveLineGeometryScalarsInto({}, line, width, height);
  return {
    start: {
      x: geometry.startX,
      y: geometry.startY
    },
    end: {
      x: geometry.endX,
      y: geometry.endY
    },
    control: {
      x: geometry.controlX,
      y: geometry.controlY
    }
  };
};

export const resolveLinePoint = (line, amount, width, height) => {
  return resolveLinePointInto({ x: 0, y: 0 }, line, amount, width, height);
};

const LINE_POINT_GEOMETRY = {};

export const resolveLinePointInto = (target, line, amount, width, height) => {
  const geometry = resolveLineGeometryScalarsInto(LINE_POINT_GEOMETRY, line, width, height);
  const ease = line.flowEase || 'sine';
  const t = ease === 'out'
    ? easeOutCubic(amount)
    : ease === 'quart'
      ? easeOutQuart(amount)
      : ease === 'cubic'
        ? easeInOutCubic(amount)
        : easeInOutSine(amount);
  const inv = 1 - t;
  target.x = inv * inv * geometry.startX + 2 * inv * t * geometry.controlX + t * t * geometry.endX;
  target.y = inv * inv * geometry.startY + 2 * inv * t * geometry.controlY + t * t * geometry.endY;
  return target;
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
  const clockDelta = safeDelta * SIMULATION_GENTLE_SPEED;
  state.time += clockDelta;
  state.motionTime = (Number(state.motionTime || 0) + clockDelta) % SIMULATION_MOTION_CLOCK_WRAP_SECONDS;
  state.pointer.x = lerpToward(state.pointer.x, state.pointer.targetX, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.y = lerpToward(state.pointer.y, state.pointer.targetY, SIMULATION_POINTER_LERP, safeDelta);

  const time = state.motionTime;
  const graphPositions = updatePoolGraphLayout(state, safeDelta);
  const transitionProgress = clamp01(state.layout.transition?.progress || 0);
  const transitionSignal = state.layout.transition ? Math.sin(transitionProgress * Math.PI) : 0;
  const carriedCue = state.layout.transition
    ? (state.layout.transition.cueStart || 0) * Math.pow(1 - transitionProgress, 1.35)
    : 0;
  const topologyCue = Math.max(state.layout.anticipation || 0, carriedCue, transitionSignal * 0.58);
  const countdownProgress = Math.max(state.layout.anticipation || 0, transitionSignal);
  const orbitCue = easeInOutCubic(topologyCue);
  const anchorMotionScale = state.layout.transition
    ? 1
    : clamp01(Math.max(state.layout.stableRelease || 0, topologyCue));
  const roles = state.roles;
  for (const [id, size, phase, orbit] of POOLDAY_CORE_NODE_CONFIG) {
    writeRoleAnchor(
      roles[id],
      id,
      size,
      phase,
      orbit,
      graphPositions,
      width,
      height,
      time,
      orbitCue,
      countdownProgress,
      transitionProgress,
      anchorMotionScale
    );
  }
  const participants = state.participants;
  for (let index = 0; index < state.participantSpecs.length; index += 1) {
    writeParticipantAnchor(
      participants[index],
      state.participantSpecs[index],
      graphPositions,
      width,
      height,
      time,
      orbitCue,
      countdownProgress,
      transitionProgress,
      anchorMotionScale
    );
  }
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
    const basePulse = Number.isFinite(line.basePulse) ? line.basePulse : line.pulse;
    const baseSpeed = Number.isFinite(line.baseSpeed) ? line.baseSpeed : line.speed;
    const baseWidth = Number.isFinite(line.baseWidth) ? line.baseWidth : line.width;
    line.pulse = basePulse + orbitCue * (0.08 + (index % 5) * 0.018);
    line.speed = baseSpeed * (1 + orbitCue * 0.16);
    line.width = baseWidth * (1 + orbitCue * 0.08);
    line.flowCountdown = countdownProgress;
    line.phaseShift = topologyCue;
    line.topologyProgress = transitionProgress;
  }
  const renderParticleScratch = state.frameParticles;
  for (let index = 0; index < state.particles.length; index += 1) {
    const particle = state.particles[index];
    const line = lines[particle.edgeIndex % Math.max(1, lines.length)];
    const participant = participants[particle.participantIndex % participants.length];
    const flowPulse = Math.sin(time * 6.2 + particle.phase) * 0.5 + 0.5;
    const progress = resolveParticleProgress(particle, line, participant, time, flowScale);
    const point = state.particlePoint;
    if (line) {
      resolveLinePointInto(point, line, progress, width, height);
    } else {
      point.x = roles.assignment.x;
      point.y = roles.assignment.y;
    }
    const flowAlpha = line?.flowAlpha ?? 1;
    const visibility = resolveFlowVisibility(progress);
    const particleScale = line?.particleScale ?? 1;
    const sizeWidth = line?.width ?? 1;
    const sizeScale = particleScale * (0.88 + Math.min(3, sizeWidth) * 0.075);
    const target = renderParticleScratch[index];
    target.index = particle.index;
    target.x = point.x;
    target.y = point.y;
    target.size = (particle.size + flowPulse * 2.45 + participant.pulse * 0.9) * sizeScale;
    target.alpha = clamp01((0.34 + flowPulse * 0.60) * (0.84 + state.layout.flowEnergy * 0.22) * flowAlpha * visibility);
    target.tone = line?.tone || 'rainbow';
    target.toneIndex = line?.toneIndex ?? particle.tone;
    target.toneTo = line?.toneTo || null;
    target.toneToIndex = line?.toneToIndex ?? particle.tone;
    target.toneBlend = line?.toneBlend ?? 0;
    target.speed = line?.speed ?? 1;
  }
  writePointerShooterParticles(state, lines, width, height, safeDelta, time, flowScale);
  const nodeLookup = state.nodeLookup;
  for (let index = 0; index < POOLDAY_GRAPH_NODE_IDS.length; index += 1) {
    const id = POOLDAY_GRAPH_NODE_IDS[index];
    applyNodeLabelPlan(nodeLookup[id], state.nodeLabelPlan);
    copyCanvasPointInto(state.frameNodes[index], nodeLookup[id], width, height, 8);
  }
  for (let index = 0; index < renderParticleScratch.length; index += 1) {
    copyParticleInto(state.frameParticles[index], renderParticleScratch[index], width, height, 5);
  }
  const labelAnchors = state.labelAnchors;
  for (const id of POOLDAY_GRAPH_NODE_IDS) {
    copyNodeLabelAnchorInto(labelAnchors[id], nodeLookup[id], state.nodeLabelPlan, width, height);
  }
  const frame = state.frame;
  frame.lines = lines;
  frame.nodes = state.frameNodes;
  frame.particles = state.frameParticles;
  frame.peerCount = participants.length;
  frame.participantCount = participants.length;
  frame.topologyLabel = state.layout.label;
  frame.time = time;
  frame.flowEnergy = state.layout.flowEnergy;
  frame.anticipation = state.layout.anticipation;
  frame.stableHoldProgress = state.layout.stableHoldProgress;
  frame.stableRelease = state.layout.stableRelease;
  frame.anchorMotionScale = anchorMotionScale;
  frame.transitionActive = Boolean(state.layout.transition);
  frame.transitionProgress = transitionProgress;
  frame.topologyCue = topologyCue;
  frame.topologyProgress = transitionProgress;
  frame.countdownProgress = countdownProgress;
  frame.palette = resolvePoolGraphPalette(state.layout, frame.palette);
  frame.labelAnchors = labelAnchors;
  return frame;
};
