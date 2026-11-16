/**
 * @fileoverview Graph plans for the simulation: seeded randomness, topology order and points,
 * node label plans, the run's hot path and topology transitions.
 */
import {
  POOLDAY_GRAPH_VIEW_CENTER_PULL,
  POOLDAY_HOT_PATH_STEPS,
  POOLDAY_GRAPH_LABEL_ROLE_META,
  POOLDAY_GRAPH_LABEL_STAGES,
  POOLDAY_GRAPH_NODE_IDS,
  POOLDAY_GRAPH_TOPOLOGIES,
  POOLDAY_MORPH_TUNING,
  POOLDAY_PARTICIPANT_NODE_IDS
} from './constants.js';
import { pairFlowTransitionLines } from './simulation-flow-transition.js';
import { buildSimulationLineSpecs } from './simulation-flow-specs.js';
import { copyCanvasPointInto } from './simulation-frame-state.js';
import { clamp01, clampRange, easeInOutSine } from './simulation-easing.js';

export const cloneTopologyPoints = (topology) => Object.fromEntries(
  POOLDAY_GRAPH_NODE_IDS.map((id) => {
    const point = topology.points[id] || [0.5, 0.5];
    return [id, { x: point[0], y: point[1] }];
  })
);

export const copyGraphPoints = (points) => Object.fromEntries(
  POOLDAY_GRAPH_NODE_IDS.map((id) => [id, { ...(points[id] || { x: 0.5, y: 0.5 }) }])
);

const resolveCenteredGraphValue = (value) => 0.5 + (value - 0.5) * (1 - POOLDAY_GRAPH_VIEW_CENTER_PULL);

export const copyCenteredGraphPointsInto = (target, points) => {
  for (const id of POOLDAY_GRAPH_NODE_IDS) {
    const point = points[id] || { x: 0.5, y: 0.5 };
    const next = target[id] || { x: 0.5, y: 0.5 };
    next.x = clamp01(resolveCenteredGraphValue(point.x));
    next.y = clamp01(resolveCenteredGraphValue(point.y));
    target[id] = next;
  }
  return target;
};

export const createSimulationSeed = () => {
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

export const createSeededRandom = (seed) => {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

export const findTopologyByIndex = (index) => POOLDAY_GRAPH_TOPOLOGIES[
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

export const createPoolGraphLabelPlan = (random) => {
  const plan = {};
  for (let stageIndex = 0; stageIndex < POOLDAY_GRAPH_LABEL_STAGES.length; stageIndex += 1) {
    const stage = POOLDAY_GRAPH_LABEL_STAGES[stageIndex];
    const ids = shuffleValues(stage.ids, random);
    const roles = shuffleValues(stage.roles, random);
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const role = roles[index % roles.length];
      const meta = POOLDAY_GRAPH_LABEL_ROLE_META[role] || POOLDAY_GRAPH_LABEL_ROLE_META.infer;
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

export const createHotPathFrame = () => ({
  exampleQuery: '',
  activeStepId: POOLDAY_HOT_PATH_STEPS[0]?.id || '',
  activeStepIndex: 0,
  activeIds: POOLDAY_HOT_PATH_STEPS[0]?.ids || [],
  stepProgress: 0,
  intervalProgress: 0,
  steps: POOLDAY_HOT_PATH_STEPS
});

export const resolveRunHotPathFrame = (runVisual, target = createHotPathFrame()) => {
  const steps = POOLDAY_HOT_PATH_STEPS;
  const step = steps.find((candidate) => candidate.id === runVisual.phase) || null;
  target.exampleQuery = '';
  target.activeStepId = step?.id || '';
  target.activeStepIndex = step ? steps.indexOf(step) : -1;
  target.activeIds = step?.ids || (runVisual.state === 'running'
    ? POOLDAY_GRAPH_NODE_IDS
    : []);
  target.stepProgress = runVisual.state === 'complete' ? 1 : 0;
  target.intervalProgress = runVisual.state === 'complete' ? 1 : 0;
  target.steps = steps;
  return target;
};

export const applyNodeLabelPlan = (node, labelPlan = {}) => {
  const label = labelPlan[node.id];
  if (!label) return node;
  node.label = label.label;
  node.labelKind = label.role;
  node.labelStage = label.stage;
  node.labelBody = label.body;
  return node;
};

export const copyNodeLabelAnchorInto = (target, node, labelPlan, width, height) => {
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

export const createTopologyOrder = (currentIndex, random) => [
  currentIndex,
  ...shuffleValues(POOLDAY_GRAPH_TOPOLOGIES
    .map((_, index) => index)
    .filter((index) => index !== currentIndex), random)
];

export const getInitialGraphTopologyIndex = (random) => {
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
    const radius = 0.19 + random() * 0.31;
    const sourcePull = POOLDAY_PARTICIPANT_NODE_IDS.includes(id) ? 0.42 : 0.28;
    return [
      id,
      {
        x: clampRange(centerX + Math.cos(angle) * radius + (source.x - centerX) * sourcePull, 0.08, 0.92),
        y: clampRange(centerY + Math.sin(angle) * radius * 0.80 + (source.y - centerY) * sourcePull, 0.13, 0.87)
      }
    ];
  }));
};

export const createNextPoolGraphPlan = (layout, random) => {
  if (layout.phase === 'shape') {
    return {
      phase: 'float',
      targets: createFloatTopologyPoints(layout.targets || layout.positions, random),
      label: 'floating reassort',
      edgePreset: 'float',
      span: POOLDAY_MORPH_TUNING.floatSpan,
      transitionSpan: POOLDAY_MORPH_TUNING.floatSpan * POOLDAY_MORPH_TUNING.visualSpanScale,
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
    span: POOLDAY_MORPH_TUNING.shapeSpan,
    transitionSpan: POOLDAY_MORPH_TUNING.shapeSpan * POOLDAY_MORPH_TUNING.visualSpanScale,
    hold: POOLDAY_MORPH_TUNING.shapeHold,
    topologyIndex,
    topologyOrder,
    topologyOrderCursor: nextCursor
  };
};

export const createTopologyTransition = (fromPoints, toPoints, span = POOLDAY_MORPH_TUNING.shapeSpan, options = {}) => {
  const fromEdgePreset = options.fromEdgePreset || null;
  const toEdgePreset = options.toEdgePreset || null;
  const fromLineSpecs = options.fromLineSpecs || buildSimulationLineSpecs(fromEdgePreset || toEdgePreset || 'float');
  const toLineSpecs = buildSimulationLineSpecs(toEdgePreset || fromEdgePreset || 'float');
  const linePairs = pairFlowTransitionLines(fromLineSpecs, toLineSpecs);
  return {
    from: copyGraphPoints(fromPoints),
    to: copyGraphPoints(toPoints),
    span,
    progress: 0,
    fromEdgePreset,
    toEdgePreset,
    cueStart: clamp01(options.cueStart || 0),
    linePairs,
    settledLineSpecs: toLineSpecs
  };
};

export const resolveTransitionPoint = (id, transition) => {
  const from = transition.from[id] || { x: 0.5, y: 0.5 };
  const to = transition.to[id] || from;
  const raw = clamp01(transition.progress);
  if (raw >= 1) return { x: to.x, y: to.y };
  const eased = easeInOutSine(raw);
  return {
    x: clamp01(from.x + (to.x - from.x) * eased),
    y: clamp01(from.y + (to.y - from.y) * eased)
  };
};
