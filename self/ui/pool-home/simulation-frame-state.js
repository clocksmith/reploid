/**
 * @fileoverview Reusable frame containers for the Reploid graph simulation.
 */

import {
  POOLDAY_GRAPH_PALETTES,
  POOLDAY_RAINBOW_COLORS
} from './constants.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const clampRange = (value, min, max) => Math.max(min, Math.min(max, value));

export const POOLDAY_CORE_NODE_CONFIG = Object.freeze([
  ['requester', 17, 0.2, 7],
  ['policy', 15, 0.9, 7],
  ['assignment', 21, 1.8, 8],
  ['agreement', 16, 3.3, 7],
  ['settlement', 15, 4.1, 7],
  ['ledger', 17, 4.8, 7]
]);

export const createFrameNode = (id = '') => ({
  id,
  role: id,
  core: false,
  baseX: 0,
  baseY: 0,
  offsetX: 0,
  offsetY: 0,
  x: 0,
  y: 0,
  size: 0,
  alpha: 1,
  pulse: 0,
  halo: 0,
  ringProgress: 0,
  topologyProgress: 0,
  online: true,
  presence: 1,
  lineDraw: 1,
  label: id,
  labelKind: id,
  labelStage: '',
  labelBody: ''
});

export const createFrameParticle = (index = 0) => ({
  index,
  x: 0,
  y: 0,
  size: 0,
  alpha: 0,
  tone: 'rainbow',
  toneIndex: 0,
  toneTo: null,
  toneToIndex: 0,
  toneBlend: 0,
  speed: 1
});

export const copyCanvasPointInto = (target, point, width, height, margin = 6) => {
  target.id = point.id;
  target.role = point.role;
  target.core = point.core === true;
  target.baseX = point.baseX || 0;
  target.baseY = point.baseY || 0;
  target.offsetX = point.offsetX || 0;
  target.offsetY = point.offsetY || 0;
  target.x = clampRange(point.x, margin, Math.max(margin, width - margin));
  target.y = clampRange(point.y, margin, Math.max(margin, height - margin));
  target.size = Math.max(0, Number(point.size) || 0);
  target.alpha = clamp01(point.alpha ?? 1);
  target.pulse = point.pulse || 0;
  target.halo = point.halo || 0;
  target.ringProgress = point.ringProgress || 0;
  target.topologyProgress = point.topologyProgress || 0;
  target.online = point.online !== false;
  target.presence = point.presence ?? 1;
  target.lineDraw = point.lineDraw ?? 1;
  target.label = point.label || point.id;
  target.labelKind = point.labelKind || point.role || point.id;
  target.labelStage = point.labelStage || '';
  target.labelBody = point.labelBody || '';
  return target;
};

export const copyParticleInto = (target, source, width, height, margin = 5) => {
  target.index = source.index;
  target.x = clampRange(source.x, margin, Math.max(margin, width - margin));
  target.y = clampRange(source.y, margin, Math.max(margin, height - margin));
  target.size = Math.max(0, Number(source.size) || 0);
  target.alpha = clamp01(source.alpha ?? 0);
  target.tone = source.tone || 'rainbow';
  target.toneIndex = source.toneIndex ?? 0;
  target.toneTo = source.toneTo || null;
  target.toneToIndex = source.toneToIndex ?? target.toneIndex;
  target.toneBlend = source.toneBlend ?? 0;
  target.speed = source.speed ?? 1;
  return target;
};

const mixColorInto = (target, from, to, amount) => {
  target[0] = Math.round(from[0] + (to[0] - from[0]) * amount);
  target[1] = Math.round(from[1] + (to[1] - from[1]) * amount);
  target[2] = Math.round(from[2] + (to[2] - from[2]) * amount);
  return target;
};

export const createPoolGraphPaletteFrame = () => ({
  primary: [0, 0, 0],
  evidence: [0, 0, 0],
  peer: [0, 0, 0],
  pipe: [0, 0, 0],
  accent: [0, 0, 0],
  rainbow: POOLDAY_RAINBOW_COLORS
});

export const resolvePoolGraphPalette = (layout, target = createPoolGraphPaletteFrame()) => {
  const from = POOLDAY_GRAPH_PALETTES[layout.paletteFromIndex] || POOLDAY_GRAPH_PALETTES[0];
  const to = POOLDAY_GRAPH_PALETTES[layout.paletteToIndex] || from;
  const blend = clamp01(layout.paletteBlend);
  mixColorInto(target.primary, from.primary, to.primary, blend);
  mixColorInto(target.evidence, from.evidence, to.evidence, blend);
  mixColorInto(target.peer, from.peer, to.peer, blend);
  mixColorInto(target.pipe, from.pipe, to.pipe, blend);
  mixColorInto(target.accent, from.accent, to.accent, blend);
  target.rainbow = POOLDAY_RAINBOW_COLORS;
  return target;
};

export const writeRoleAnchor = (
  target,
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
  motionScale = 1
) => {
  const base = graphPositions[id] || { x: 0.5, y: 0.5 };
  const motionCue = clamp01(motionScale);
  const breathe = 0.5 + 0.5 * Math.sin(time * 1.4 + phase);
  const baseX = width * base.x;
  const baseY = height * base.y;
  const cuePhase = phase + orbitCue * (1.2 + phase * 0.08);
  const cueOrbit = orbit * motionCue * (1 + orbitCue * 0.52);
  const offsetX = Math.cos(time * 0.52 + cuePhase) * cueOrbit;
  const offsetY = Math.sin(time * 0.46 + cuePhase * 1.3) * cueOrbit;
  target.id = id;
  target.role = id;
  target.core = true;
  target.baseX = baseX;
  target.baseY = baseY;
  target.offsetX = offsetX;
  target.offsetY = offsetY;
  target.x = baseX + offsetX;
  target.y = baseY + offsetY;
  target.size = size * (0.9 + breathe * 0.2);
  target.alpha = 1;
  target.pulse = breathe;
  target.halo = 0.55 + breathe * 0.45;
  target.ringProgress = countdownProgress;
  target.topologyProgress = transitionProgress;
  target.online = true;
  target.presence = 1;
  target.lineDraw = 1;
  return target;
};

export const writeParticipantAnchor = (
  target,
  spec,
  graphPositions,
  width,
  height,
  time,
  orbitCue,
  countdownProgress,
  transitionProgress,
  motionScale = 1
) => {
  const base = graphPositions[spec.id] || { x: spec.homeX, y: spec.homeY };
  const motionCue = clamp01(motionScale);
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.55 + spec.phase);
  const baseX = width * base.x;
  const baseY = height * base.y;
  const driftX = Math.cos(time * (0.78 + orbitCue * 0.10) + spec.phase + orbitCue * 1.6) * spec.driftX * (0.44 + orbitCue * 0.22) * motionCue
    + Math.sin(time * 0.33 + spec.phase * 1.4 + orbitCue) * spec.driftX * (0.22 + orbitCue * 0.10) * motionCue;
  const driftY = Math.sin(time * (0.72 + orbitCue * 0.10) + spec.phase + orbitCue * 1.4) * spec.driftY * (0.44 + orbitCue * 0.22) * motionCue
    + Math.cos(time * 0.41 + spec.phase * 1.2 + orbitCue) * spec.driftY * (0.18 + orbitCue * 0.10) * motionCue;
  target.id = spec.id;
  target.role = spec.role;
  target.index = spec.index;
  target.core = false;
  target.baseX = baseX;
  target.baseY = baseY;
  target.offsetX = driftX;
  target.offsetY = driftY;
  target.x = baseX + driftX;
  target.y = baseY + driftY;
  target.alpha = 0.78 + pulse * 0.18;
  target.size = spec.size * (0.78 + pulse * 0.5);
  target.presence = 1;
  target.lineDraw = 1;
  target.pulse = pulse;
  target.halo = 0.48 + pulse * 0.52;
  target.ringProgress = countdownProgress;
  target.topologyProgress = transitionProgress;
  target.online = true;
  return target;
};

export const writeAverageAnchor = (target, ids, offsetX, offsetY, nodeLookup) => {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const id of ids) {
    const node = nodeLookup[id];
    if (!node) continue;
    x += node.x;
    y += node.y;
    count += 1;
  }
  const divisor = Math.max(1, count);
  target.x = offsetX + x / divisor;
  target.y = offsetY + y / divisor;
  return target;
};
