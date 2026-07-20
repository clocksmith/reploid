/**
 * @fileoverview Reusable frame containers for the Reploid graph simulation.
 */

import {
  POOLDAY_GRAPH_PALETTES,
  POOLDAY_GRAPH_VIEW_MARGIN_PX,
  POOLDAY_RAINBOW_COLORS
} from './constants.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const clampRange = (value, min, max) => Math.max(min, Math.min(max, value));

const resolveCanvasCoordinate = (value = 0.5, size = 1) => {
  const margin = Math.min(POOLDAY_GRAPH_VIEW_MARGIN_PX, Math.max(0, size * 0.5));
  const usableSize = Math.max(0, size - margin * 2);
  if (usableSize <= 0) return size * 0.5;
  return margin + clamp01(value) * usableSize;
};

export const POOLDAY_CORE_NODE_CONFIG = Object.freeze([
  ['requester', 17],
  ['policy', 15],
  ['assignment', 21],
  ['agreement', 16],
  ['settlement', 15],
  ['ledger', 17]
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
  hotPathActive: false,
  liveWeight: 0,
  liveId: null,
  liveProvider: false,
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
  target.hotPathActive = point.hotPathActive === true;
  target.liveWeight = clamp01(point.liveWeight ?? 0);
  target.liveId = point.liveId || null;
  target.liveProvider = point.liveProvider === true;
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

export const rgbToHsl = (r, g, b) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
};

export const hslToRgb = (h, s, l) => {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

export const lerpHue = (h1, h2, t) => {
  let diff = h2 - h1;
  diff = ((diff + 180) % 360 + 360) % 360 - 180;
  return (h1 + diff * t + 360) % 360;
};

const mixColorInto = (target, from, to, amount) => {
  const [h1, s1, l1] = rgbToHsl(from[0], from[1], from[2]);
  const [h2, s2, l2] = rgbToHsl(to[0], to[1], to[2]);
  const h = lerpHue(h1, h2, amount);
  const s = s1 + (s2 - s1) * amount;
  const l = l1 + (l2 - l1) * amount;
  const [r, g, b] = hslToRgb(h, s, l);
  target[0] = r;
  target[1] = g;
  target[2] = b;
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
  graphPositions,
  width,
  height,
  countdownProgress,
  transitionProgress
) => {
  const base = graphPositions[id] || { x: 0.5, y: 0.5 };
  const baseX = resolveCanvasCoordinate(base.x, width);
  const baseY = resolveCanvasCoordinate(base.y, height);
  target.id = id;
  target.role = id;
  target.core = true;
  target.baseX = baseX;
  target.baseY = baseY;
  target.offsetX = 0;
  target.offsetY = 0;
  target.x = baseX;
  target.y = baseY;
  target.size = size;
  target.alpha = 1;
  target.pulse = 0;
  target.halo = 0;
  target.ringProgress = countdownProgress;
  target.topologyProgress = transitionProgress;
  target.online = true;
  target.presence = 1;
  target.lineDraw = 1;
  target.hotPathActive = false;
  return target;
};

export const writeParticipantAnchor = (
  target,
  spec,
  graphPositions,
  width,
  height,
  time,
  countdownProgress,
  transitionProgress
) => {
  const base = graphPositions[spec.id] || { x: 0.5, y: 0.5 };
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.55 + spec.phase);
  const baseX = resolveCanvasCoordinate(base.x, width);
  const baseY = resolveCanvasCoordinate(base.y, height);
  target.id = spec.id;
  target.role = spec.role;
  target.index = spec.index;
  target.core = false;
  target.baseX = baseX;
  target.baseY = baseY;
  target.offsetX = 0;
  target.offsetY = 0;
  target.x = baseX;
  target.y = baseY;
  target.alpha = 0.78 + pulse * 0.18;
  target.size = spec.size * (0.78 + pulse * 0.5);
  target.presence = 1;
  target.lineDraw = 1;
  target.hotPathActive = false;
  target.pulse = pulse;
  target.halo = 0;
  target.ringProgress = countdownProgress;
  target.topologyProgress = transitionProgress;
  target.online = true;
  return target;
};
