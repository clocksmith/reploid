/**
 * @fileoverview Simulation topology and frame generation for the Reploid graph.
 * This entry builds each frame from the simulation-* modules in this folder:
 * visual state, graph plan and layout, lines, pointer particles and easing.
 */
import {
  POOLDAY_GRAPH_NODE_IDS,
  POOLDAY_PARTICIPANT_NODE_IDS,
  SIMULATION_GENTLE_SPEED,
  SIMULATION_MAX_STEP_MS,
  SIMULATION_MOTION_CLOCK_WRAP_SECONDS,
  SIMULATION_POINTER_LERP,
  SIMULATION_TARGET_STEP_MS
} from './constants.js';
import {
  POOLDAY_CORE_NODE_CONFIG,
  copyCanvasPointInto,
  copyParticleInto,
  resolvePoolGraphPalette,
  writeParticipantAnchor,
  writeRoleAnchor
} from './simulation-frame-state.js';
import { clamp01, easeInOutCubic, lerpToward, lerpTowardSnapped } from './simulation-easing.js';
import {
  copyCenteredGraphPointsInto,
  resolveRunHotPathFrame,
  applyNodeLabelPlan,
  copyNodeLabelAnchorInto
} from './simulation-graph-plan.js';
import { updatePoolGraphLayout } from './simulation-graph-layout.js';
import {
  pickParticleLine,
  buildTransitionSimulationLines,
  resolveParticleProgress,
  resolveFlowVisibility,
  resolveLinePointInto
} from './simulation-lines.js';
import { writePointerShooterParticles } from './simulation-pointer-shooter.js';

export { setPoolSimulationNetworkVisualState, setPoolSimulationRunVisualState } from './simulation-visual-state.js';
export { clamp01, clampRange, easeInOutCubic } from './simulation-easing.js';
export { createPoolSimulationState, resizePoolCanvas } from './simulation-state.js';
export { resolveLineGeometryInto, resolveLineGeometry, resolveLinePoint, resolveLinePointInto, resolveFrameBounds } from './simulation-lines.js';

const PARTICLE_ROUTE_FADE_RATE = 0.16;

export const buildPoolSimulationFrame = (state, width, height, deltaSeconds = SIMULATION_TARGET_STEP_MS / 1000) => {
  const safeDelta = Math.max(0, Math.min(SIMULATION_MAX_STEP_MS / 1000, deltaSeconds));
  const clockDelta = safeDelta * SIMULATION_GENTLE_SPEED;
  state.time += clockDelta;
  state.motionTime = (Number(state.motionTime || 0) + clockDelta) % SIMULATION_MOTION_CLOCK_WRAP_SECONDS;
  state.pointer.x = lerpToward(state.pointer.x, state.pointer.targetX, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.y = lerpToward(state.pointer.y, state.pointer.targetY, SIMULATION_POINTER_LERP, safeDelta);

  const time = state.motionTime;
  const networkVisual = state.networkVisual;
  const runVisual = state.runVisual;
  const runEnergyTarget = runVisual.state === 'running'
    ? 1
    : runVisual.state === 'submitting' || runVisual.state === 'complete'
      ? 0.72
      : runVisual.state === 'error'
        ? 0.38
        : 0.22;
  runVisual.energy = lerpTowardSnapped(runVisual.energy, runEnergyTarget, 0.09, safeDelta);
  networkVisual.simulationMix = lerpTowardSnapped(
    networkVisual.simulationMix,
    networkVisual.mode === 'live' ? 0 : 1,
    0.10,
    safeDelta
  );
  const layoutPositions = updatePoolGraphLayout(state, safeDelta);
  const graphPositions = copyCenteredGraphPointsInto(state.graphViewPositions, layoutPositions);
  const hotPath = resolveRunHotPathFrame(runVisual, state.hotPathFrame);
  const hotPathActiveIds = state.hotPathActiveIds;
  hotPathActiveIds.clear();
  for (const id of hotPath.activeIds || []) hotPathActiveIds.add(id);
  const transitionProgress = clamp01(state.layout.transition?.progress || 0);
  const transitionSignal = state.layout.transition ? Math.sin(transitionProgress * Math.PI) : 0;
  const carriedCue = state.layout.transition
    ? (state.layout.transition.cueStart || 0) * Math.pow(1 - transitionProgress, 1.35)
    : 0;
  const topologyCue = Math.max(state.layout.anticipation || 0, carriedCue, transitionSignal * 0.58);
  const countdownProgress = Math.max(state.layout.anticipation || 0, carriedCue, transitionSignal);
  const topologyEase = easeInOutCubic(topologyCue);
  const layoutMotionScale = state.layout.transition
    ? 1
    : clamp01(Math.max(state.layout.transitionRelease || 0, state.layout.stableRelease || 0, topologyCue));
  const roles = state.roles;
  for (const [id, size] of POOLDAY_CORE_NODE_CONFIG) {
    writeRoleAnchor(
      roles[id],
      id,
      size,
      graphPositions,
      width,
      height,
      countdownProgress,
      transitionProgress
    );
    roles[id].hotPathActive = hotPathActiveIds.has(id);
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
      countdownProgress,
      transitionProgress
    );
    const slot = networkVisual.slots[index];
    slot.mix = lerpTowardSnapped(
      slot.mix,
      index < networkVisual.liveParticipantCount ? 1 : 0,
      0.12,
      safeDelta
    );
    participants[index].liveWeight = slot.mix;
    participants[index].liveId = slot.id;
    participants[index].liveProvider = slot.provider;
    participants[index].size *= 1 + slot.mix * 0.10;
    participants[index].alpha *= 0.72 + slot.mix * 0.28;
    participants[index].hotPathActive = hotPathActiveIds.has(participants[index].id);
  }
  networkVisual.liveMix = networkVisual.slots.reduce((sum, slot) => sum + slot.mix, 0)
    / Math.max(1, networkVisual.slots.length);
  const flowScale = (0.72 + state.layout.flowEnergy * 0.42) * (0.52 + runVisual.energy * 0.48);
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
    line.hotPathActive = (
      hotPathActiveIds.has(line.fromId)
      || hotPathActiveIds.has(line.toId)
      || hotPathActiveIds.has(line.targetFromId)
      || hotPathActiveIds.has(line.targetToId)
    );
    line.hotPathStage = hotPath.activeStepId;
    line.pulse = basePulse + topologyEase * (0.08 + (index % 5) * 0.018);
    line.speed = baseSpeed * (1 + topologyEase * 0.16);
    line.width = baseWidth * (1 + topologyEase * 0.08);
    line.flowCountdown = countdownProgress;
    line.phaseShift = topologyCue;
    line.topologyProgress = transitionProgress;
  }
  const renderParticleScratch = state.frameParticles;
  const liveParticleCount = Math.min(
    state.particles.length,
    Math.max(networkVisual.messageCount, networkVisual.recent.length)
  );
  for (let index = 0; index < state.particles.length; index += 1) {
    const particle = state.particles[index];
    const target = renderParticleScratch[index];
    if (index >= liveParticleCount && networkVisual.simulationMix === 0) {
      target.size = 0;
      target.alpha = 0;
      continue;
    }
    const line = pickParticleLine(particle, lines);
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
    particle.routeBlend = lerpToward(particle.routeBlend ?? 1, 1, PARTICLE_ROUTE_FADE_RATE, safeDelta);
    target.index = particle.index;
    target.x = point.x;
    target.y = point.y;
    target.size = (particle.size + flowPulse * 2.45 + participant.pulse * 0.9) * sizeScale;
    target.alpha = clamp01(
      (0.34 + flowPulse * 0.60)
      * (0.84 + state.layout.flowEnergy * 0.22)
      * flowAlpha
      * visibility
      * (particle.routeBlend ?? 1)
      * (0.42 + runVisual.energy * 0.58)
      * (index < liveParticleCount ? 1 : networkVisual.simulationMix)
    );
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
    const node = nodeLookup[id];
    const anchor = copyNodeLabelAnchorInto(labelAnchors[id], node, state.nodeLabelPlan, width, height);
    if (node.liveWeight > 0.01 && POOLDAY_PARTICIPANT_NODE_IDS.includes(id)) {
      const identity = node.liveId ? ` ${node.liveId}` : '';
      anchor.labelBody = `${node.liveProvider ? 'Live contributor' : 'Live peer'}${identity} in this room.`;
    }
  }
  const frame = state.frame;
  frame.lines = lines;
  frame.nodes = state.frameNodes;
  frame.particles = state.frameParticles;
  frame.peerCount = participants.length;
  frame.participantCount = participants.length;
  frame.topologyLabel = state.layout.label;
  frame.time = time;
  frame.flowEnergy = state.layout.flowEnergy * (0.36 + runVisual.energy * 0.64);
  frame.anticipation = state.layout.anticipation;
  frame.stableHoldProgress = state.layout.stableHoldProgress;
  frame.stableRelease = state.layout.stableRelease;
  frame.transitionRelease = state.layout.transitionRelease || 0;
  frame.layoutMotionScale = layoutMotionScale;
  frame.transitionActive = Boolean(state.layout.transition);
  frame.transitionProgress = transitionProgress;
  frame.topologyCue = topologyCue;
  frame.topologyProgress = transitionProgress;
  frame.countdownProgress = countdownProgress;
  frame.palette = resolvePoolGraphPalette(state.layout, frame.palette);
  frame.labelAnchors = labelAnchors;
  frame.hotPath = hotPath;
  frame.networkMode = networkVisual.mode;
  frame.networkLiveMix = networkVisual.liveMix;
  frame.networkPeerCount = networkVisual.peerCount;
  frame.networkProviderCount = networkVisual.providerCount;
  frame.networkMessageCount = networkVisual.messageCount;
  frame.runState = runVisual.state;
  frame.runPhase = runVisual.phase;
  return frame;
};
