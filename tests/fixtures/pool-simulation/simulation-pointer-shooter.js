/**
 * @fileoverview Pointer particles: the nearest line magnet, shots spawned by pointer movement and
 * the particles they write into each frame.
 */
import { POOLDAY_FLOW_TUNING } from './constants.js';
import { clamp01, clampRange, easeOutCubic, lerpToward, smoothStep } from './simulation-easing.js';
import { resolveLineRouteId, findLineByRouteId, resolveLinePointInto } from './simulation-lines.js';

export const POINTER_SHOOTER_PARTICLE_COUNT = 12;
const POINTER_SHOOTER_EDGE_SAMPLES = 6;
const POINTER_SHOOTER_CAPTURE = 0.18;
const POINTER_SHOOTER_HOLD_RATE = 18;
const POINTER_SHOOTER_MOVE_RATE = 52;
const POINTER_SHOOTER_MAX_SPAWN_PER_FRAME = 9;

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
  shot.lineRouteId = resolveLineRouteId(nearest.bestLine);
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

export const writePointerShooterParticles = (state, lines, width, height, safeDelta, time, flowScale) => {
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
    const line = findLineByRouteId(lines, shot.lineRouteId) || lines[shot.lineIndex % lines.length];
    if (!line) {
      shot.active = false;
      hidePointerShotFrame(target, index);
      continue;
    }
    shot.lineRouteId = resolveLineRouteId(line) || shot.lineRouteId;
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
