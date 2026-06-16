/**
 * @fileoverview Canvas 2D compatibility renderer for the Reploid graph.
 */

import { POOLDAY_FLOW_TUNING, POOLDAY_GRAPH_PALETTES, POOLDAY_RAINBOW_COLORS } from './constants.js';
import {
  clamp01,
  easeInOutCubic,
  resolveFrameBounds,
  resolveLineGeometry,
  resolveLinePoint
} from './simulation-core.js';

const drawPreChangeCue = (ctx, frame, width, height, toneColor) => {
  const amount = clamp01(frame.countdownProgress ?? frame.anticipation ?? 0);
  if (amount <= 0.01) return;
  const eased = easeInOutCubic(amount);
  const time = Number(frame.time || 0);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'source-over';

  const cueLines = frame.lines || [];
  const stride = Math.max(1, Math.ceil(cueLines.length / 12));
  const cueCount = 2 + Math.floor(eased * 3);
  for (let index = 0; index < cueLines.length; index += stride) {
    const line = cueLines[index];
    const edgeCue = clamp01(line.flowCountdown ?? eased);
    for (let cue = 0; cue < cueCount; cue += 1) {
      const route = index + cue * 3;
      const progress = (
        time * (0.055 + edgeCue * 0.035)
        + edgeCue * 0.28
        + (line.phaseShift || 0) * 0.05
        + cue / cueCount
        + index * 0.017
      ) % 1;
      const point = resolveLinePoint(line, progress, width, height);
      const ringRadius = 3.6 + edgeCue * 9.5 + Math.sin(time * 2.2 + route) * 1.8;
      const start = time * (0.9 + eased * 1.8) + route * 0.56;
      const sweep = Math.PI * (0.48 + eased * 1.08);
      ctx.strokeStyle = toneColor('rainbow', 0.09 + edgeCue * 0.27, route);
      ctx.lineWidth = 0.9 + eased * 1.75;
      ctx.beginPath();
      ctx.arc(point.x, point.y, ringRadius, start, start + sweep);
      ctx.stroke();
    }
  }

  for (let index = 0; index < frame.nodes.length; index += 1) {
    const node = frame.nodes[index];
    const core = node.core === true;
    const local = clamp01((node.ringProgress ?? eased) - (index % 6) * 0.035);
    if (local <= 0.01) continue;
    const pulse = Math.sin(time * (1.1 + eased) + index * 0.8) * 0.5 + 0.5;
    const radius = node.size + (core ? 9 : 6) + local * (core ? 15 : 9) + pulse * 3;
    const start = -Math.PI * 0.5 + time * (0.66 + eased * 1.2) + index * 0.52;
    const sweep = Math.PI * 2 * (0.20 + local * 0.76);
    ctx.strokeStyle = toneColor('rainbow', 0.11 + local * (core ? 0.30 : 0.20), index + Math.round(eased * 6));
    ctx.lineWidth = (core ? 1.2 : 0.9) + local * 1.7;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, start, start + sweep);
    ctx.stroke();
  }

  ctx.restore();
};

const createPrismGradient = (ctx, start, end, toneColor, toneIndex, alpha) => {
  const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  gradient.addColorStop(0, toneColor('rainbow', alpha * 0.70, toneIndex));
  gradient.addColorStop(0.36, toneColor('rainbow', alpha, toneIndex + 2));
  gradient.addColorStop(0.68, toneColor('rainbow', alpha * 0.86, toneIndex + 4));
  gradient.addColorStop(1, toneColor('rainbow', alpha * 0.62, toneIndex + 6));
  return gradient;
};

const drawRuntimePrismField = (ctx, frame, width, height, toneColor) => {
  const time = Number(frame.time || 0);
  const nodes = frame.nodes || [];
  if (!nodes.length) return;
  const bounds = resolveFrameBounds(nodes, width, height);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let index = 0; index < 4; index += 1) {
    const radius = bounds.radius * (0.42 + index * 0.18);
    const drift = Math.sin(time * 0.52 + index * 1.7) * 18;
    const gradient = ctx.createRadialGradient(
      bounds.x + Math.cos(index * 1.9 + time * 0.18) * 42,
      bounds.y + Math.sin(index * 1.6 + time * 0.14) * 30,
      Math.max(8, radius * 0.08),
      bounds.x,
      bounds.y + drift,
      Math.max(60, radius)
    );
    gradient.addColorStop(0, toneColor('rainbow', 0.038, index * 2));
    gradient.addColorStop(0.48, toneColor('rainbow', 0.020, index * 2 + 2));
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(bounds.x, bounds.y + drift, Math.max(80, radius), 0, Math.PI * 2);
    ctx.fill();
  }
  const facetCount = Math.min(6, Math.max(2, Math.floor(nodes.length / 2)));
  for (let index = 0; index < facetCount; index += 1) {
    const a = nodes[index % nodes.length];
    const b = nodes[(index + 3) % nodes.length];
    const c = nodes[(index + 6) % nodes.length];
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.82 + index);
    ctx.fillStyle = toneColor('rainbow', POOLDAY_FLOW_TUNING.prismFacetAlpha * (0.48 + pulse * 0.52), index * 2);
    ctx.strokeStyle = toneColor('rainbow', POOLDAY_FLOW_TUNING.prismFacetAlpha * (0.38 + pulse * 0.42), index * 2 + 3);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

const drawRuntimeNodeHalos = (ctx, frame, toneColor) => {
  const time = Number(frame.time || 0);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let index = 0; index < frame.nodes.length; index += 1) {
    const node = frame.nodes[index];
    const core = node.core === true;
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.15 + index * 0.74);
    const radius = node.size * (core ? 6.8 : 5.2) + pulse * (core ? 10 : 7);
    const gradient = ctx.createRadialGradient(node.x, node.y, Math.max(1, node.size * 0.18), node.x, node.y, radius);
    gradient.addColorStop(0, toneColor('rainbow', POOLDAY_FLOW_TUNING.nodeGlowAlpha * (core ? 1.15 : 0.82), index + 2));
    gradient.addColorStop(0.44, toneColor('rainbow', POOLDAY_FLOW_TUNING.nodeGlowAlpha * 0.38, index + 4));
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawRuntimeEdgeGlow = (ctx, frame, width, height, toneColor) => {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  const stride = Math.max(1, Math.ceil(frame.lines.length / POOLDAY_FLOW_TUNING.maxGlowLines));
  for (let index = 0; index < frame.lines.length; index += stride) {
    const line = frame.lines[index];
    const { start, end, control } = resolveLineGeometry(line, width, height);
    const alpha = Math.min(0.32, (line.alpha || 0.1) * POOLDAY_FLOW_TUNING.edgeGlowAlpha * 2.6);
    ctx.strokeStyle = createPrismGradient(
      ctx,
      start,
      end,
      (tone, localAlpha, toneIndex) => toneColor(
        line.tone || tone,
        localAlpha,
        toneIndex,
        line.toneTo
          ? {
            toneTo: line.toneTo,
            toneToIndex: (line.toneToIndex ?? line.toneIndex ?? 0) + toneIndex - (line.toneIndex ?? 0),
            toneBlend: line.toneBlend ?? 0
          }
          : null
      ),
      line.toneIndex,
      alpha
    );
    ctx.lineWidth = Math.max(3, line.width * POOLDAY_FLOW_TUNING.edgeGlowWidth);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
};


export const drawPoolSimulation2D = (ctx, frame, width, height) => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const palette = frame.palette || POOLDAY_GRAPH_PALETTES[0];
  const flowEnergy = Number(frame.flowEnergy || 1);
  const rgba = (color, alpha) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp01(alpha)})`;
  const mixColor = (from, to, amount) => from.map((value, index) => Math.round(value + (to[index] - value) * amount));
  const rawToneColor = (tone, toneIndex = 0) => {
    const rainbow = palette.rainbow || POOLDAY_RAINBOW_COLORS;
    const index = ((Math.round(toneIndex) % rainbow.length) + rainbow.length) % rainbow.length;
    return tone === 'rainbow'
      ? rainbow[index]
      : palette[tone] || rainbow[index];
  };
  const toneMix = (item, toneIndexOffset = 0) => (
    item?.toneTo
      ? {
        toneTo: item.toneTo,
        toneToIndex: (item.toneToIndex ?? item.toneIndex ?? 0) + toneIndexOffset,
        toneBlend: item.toneBlend ?? 0
      }
      : null
  );
  const toneColor = (tone, alpha, toneIndex = 0, mix = null) => {
    const color = mix?.toneTo && clamp01(mix.toneBlend ?? 0) > 0
      ? mixColor(rawToneColor(tone, toneIndex), rawToneColor(mix.toneTo, mix.toneToIndex ?? toneIndex), clamp01(mix.toneBlend ?? 0))
      : rawToneColor(tone, toneIndex);
    return rgba(color, alpha);
  };
  ctx.save();
  ctx.globalAlpha = POOLDAY_FLOW_TUNING.backgroundBandAlpha;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1;
  for (let index = 0; index < 6; index += 1) {
    const y = height * (0.18 + index * 0.12);
    ctx.beginPath();
    ctx.moveTo(width * 0.10, y);
    ctx.bezierCurveTo(width * 0.34, y - 22, width * 0.62, y + 22, width * 0.92, y);
    ctx.stroke();
  }
  ctx.restore();
  drawRuntimePrismField(ctx, frame, width, height, toneColor);
  drawRuntimeNodeHalos(ctx, frame, toneColor);
  drawRuntimeEdgeGlow(ctx, frame, width, height, toneColor);
  drawPreChangeCue(ctx, frame, width, height, toneColor);
  frame.lines.forEach((line) => {
    const activeAlpha = line.alpha * (1.05 + flowEnergy * 0.50);
    const { start, end, control } = resolveLineGeometry(line, width, height);
    const drawPoint = {
      x: start.x + (end.x - start.x) * line.draw,
      y: start.y + (end.y - start.y) * line.draw
    };
    const drawControl = {
      x: start.x + (control.x - start.x) * line.draw,
      y: start.y + (control.y - start.y) * line.draw
    };
    ctx.lineWidth = line.width;
    ctx.strokeStyle = createPrismGradient(
      ctx,
      start,
      end,
      (tone, alpha, toneIndex) => toneColor(line.tone || tone, alpha, toneIndex, toneMix(line, toneIndex - line.toneIndex)),
      line.toneIndex,
      activeAlpha
    );
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(drawControl.x, drawControl.y, drawPoint.x, drawPoint.y);
    ctx.stroke();
    if (line.pulse > 0.02) {
      const pulsePoint = resolveLinePoint(line, clamp01(0.5 + Math.sin(line.pulse * Math.PI) * 0.34), width, height);
      ctx.fillStyle = toneColor(
        line.tone === 'primary' ? 'evidence' : line.tone,
        Math.min(0.64, activeAlpha + line.pulse * POOLDAY_FLOW_TUNING.pulseScale),
        line.toneIndex + 1,
        toneMix(line, 1)
      );
      ctx.beginPath();
      ctx.arc(pulsePoint.x, pulsePoint.y, 3 + line.pulse * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (const particle of frame.particles) {
    const particleHue = (particle.toneIndex ?? 0) + (particle.index % 5);
    if (particle.index % POOLDAY_FLOW_TUNING.shimmerStride === 0) {
      const shimmer = 0.58 + Math.sin((frame.time || 0) * 3 + particle.toneIndex) * 0.18;
      const glowRadius = particle.size * (2.2 + shimmer * 0.72);
      ctx.fillStyle = toneColor('rainbow', particle.alpha * POOLDAY_FLOW_TUNING.shimmerAlpha * 0.36, particleHue + 1);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(4, glowRadius), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = toneColor('rainbow', particle.alpha * 0.34, particleHue + 3);
    ctx.lineWidth = Math.max(0.7, particle.size * 0.18);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, Math.max(2.8, particle.size * 1.18), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = toneColor('rainbow', particle.alpha * 0.88, particleHue + 4);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = toneColor('rainbow', particle.alpha * 0.54, particleHue + 6);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, Math.max(1.2, particle.size * 0.34), 0, Math.PI * 2);
    ctx.fill();
  }
  frame.nodes.forEach((node, index) => {
    const core = node.core === true;
    ctx.strokeStyle = core ? toneColor('primary', 0.74, index) : toneColor('rainbow', node.alpha * 0.62, index);
    ctx.fillStyle = core ? toneColor('rainbow', node.alpha * 0.82, index + 3) : toneColor('rainbow', node.alpha * 0.54, index);
    ctx.lineWidth = core ? 2 : 1.25;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(node.x, node.y, Math.max(2, node.size * 0.28), 0, Math.PI * 2);
    ctx.fill();
  });
};
