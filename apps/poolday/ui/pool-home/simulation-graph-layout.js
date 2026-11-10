/**
 * @fileoverview The simulation's live graph layout: creation, palette and target shifts, and the
 * per-frame morph toward the next planned topology.
 */
import { POOLDAY_GRAPH_NODE_IDS, POOLDAY_GRAPH_PALETTES, POOLDAY_MORPH_TUNING } from './constants.js';
import { buildSimulationLineSpecs } from './simulation-flow-specs.js';
import { clamp01, easeInOutCubic, easeInOutSine, lerpToward } from './simulation-easing.js';
import {
  cloneTopologyPoints,
  copyGraphPoints,
  findTopologyByIndex,
  createTopologyOrder,
  getInitialGraphTopologyIndex,
  createNextPoolGraphPlan,
  createTopologyTransition,
  resolveTransitionPoint
} from './simulation-graph-plan.js';

export const createPoolGraphLayout = (random) => {
  const initialIndex = getInitialGraphTopologyIndex(random);
  const firstTopology = findTopologyByIndex(initialIndex);
  const points = cloneTopologyPoints(firstTopology);
  const topologyOrder = createTopologyOrder(initialIndex, random);
  const initialJitter = random() * POOLDAY_MORPH_TUNING.holdJitter;
  const firstShiftAt = (POOLDAY_MORPH_TUNING.shapeHold + initialJitter) * POOLDAY_MORPH_TUNING.scheduleSpanScale;
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
    nextShiftAt: firstShiftAt,
    scheduleSpan: firstShiftAt,
    transition: null,
    transitionRelease: 0,
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
    plan.transitionSpan || plan.span,
    {
      fromEdgePreset,
      toEdgePreset: plan.edgePreset,
      fromLineSpecs: layout.edgeSpecs,
      cueStart: layout.anticipation
    }
  );
  layout.nextPlan = null;
  layout.transitionRelease = 0;
  const scheduleSpan = (
    plan.span + plan.hold + random() * POOLDAY_MORPH_TUNING.holdJitter
  ) * POOLDAY_MORPH_TUNING.scheduleSpanScale;
  layout.scheduleSpan = scheduleSpan;
  layout.nextShiftAt = time + scheduleSpan;
  layout.stableHoldProgress = 1;
  layout.stableRelease = 1;
  layout.flowEnergyTarget = 0.62 + random() * 0.92;
  layout.paletteFromIndex = layout.paletteToIndex;
  layout.paletteToIndex = pickPoolPaletteIndex(layout.paletteToIndex, random);
  layout.paletteBlend = 0;
};

export const updatePoolGraphLayout = (state, safeDelta) => {
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
      layout.transitionRelease = 1;
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
    layout.transitionRelease = lerpToward(layout.transitionRelease || 0, 0, 0.055, safeDelta);
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
