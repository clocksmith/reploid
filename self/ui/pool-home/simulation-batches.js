/**
 * @fileoverview Shared render-batch generation for GPU graph renderers.
 */

import {
  POOLDAY_FLOW_TUNING,
  POOLDAY_GRAPH_PALETTES,
  POOLDAY_RAINBOW_COLORS,
  POOLDAY_RENDERER_BAND_SEGMENTS,
  POOLDAY_RENDERER_LINE_SEGMENTS
} from './constants.js';
import {
  clamp01,
  easeInOutCubic,
  resolveFrameBounds,
  resolveLineGeometry,
  resolveLinePointInto
} from './simulation-core.js';

const normalizePoolGpuColor = (color, alpha = 1) => [
  (color?.[0] ?? 0) / 255,
  (color?.[1] ?? 0) / 255,
  (color?.[2] ?? 0) / 255,
  clamp01(alpha)
];

const mixPoolColor = (from, to, amount) => from.map((value, index) => value + (to[index] - value) * amount);

const WHITE_FILL_COLOR = Object.freeze([1, 1, 1, 1]);
const BACKGROUND_BAND_COLOR = Object.freeze([0, 0, 0, 0.018]);
const POOL_CIRCLE_CORNERS = Object.freeze([
  [-1, -1],
  [1, -1],
  [-1, 1],
  [-1, 1],
  [1, -1],
  [1, 1]
]);

const resolvePoolRawToneColor = (frame, tone, toneIndex = 0) => {
  const palette = frame.palette || POOLDAY_GRAPH_PALETTES[0];
  const rainbow = palette.rainbow || POOLDAY_RAINBOW_COLORS;
  const index = ((Math.round(toneIndex) % rainbow.length) + rainbow.length) % rainbow.length;
  return tone === 'rainbow'
    ? rainbow[index]
    : (palette[tone] || rainbow[index]);
};

const flowToneMix = (item, toneIndexOffset = 0) => (
  item?.toneTo
    ? {
      toneTo: item.toneTo,
      toneToIndex: (item.toneToIndex ?? item.toneIndex ?? 0) + toneIndexOffset,
      toneBlend: item.toneBlend ?? 0
    }
    : null
);

const resolvePoolRenderToneColor = (frame, tone, alpha, toneIndex = 0, mix = null) => {
  const fromColor = resolvePoolRawToneColor(frame, tone, toneIndex);
  const blend = clamp01(mix?.toneBlend ?? 0);
  const color = mix?.toneTo && blend > 0
    ? mixPoolColor(fromColor, resolvePoolRawToneColor(frame, mix.toneTo, mix.toneToIndex ?? toneIndex), blend)
    : fromColor;
  return normalizePoolGpuColor(color, alpha);
};

const pushPoolFillVertex = (vertices, x, y, color) => {
  vertices.push6(x, y, color[0], color[1], color[2], color[3]);
};

const pushPoolFillTriangleCoords = (
  vertices,
  ax,
  ay,
  bx,
  by,
  cx,
  cy,
  colorA,
  colorB = colorA,
  colorC = colorA
) => {
  pushPoolFillVertex(vertices, ax, ay, colorA);
  pushPoolFillVertex(vertices, bx, by, colorB);
  pushPoolFillVertex(vertices, cx, cy, colorC);
};

const pushPoolFillTriangle = (vertices, a, b, c, colorA, colorB = colorA, colorC = colorA) => {
  pushPoolFillTriangleCoords(vertices, a.x, a.y, b.x, b.y, c.x, c.y, colorA, colorB, colorC);
};

const pushPoolCircleVertex = (vertices, x, y, radius, uvX, uvY, inner, color) => {
  vertices.push9(
    x + uvX * radius,
    y + uvY * radius,
    uvX,
    uvY,
    inner,
    color[0],
    color[1],
    color[2],
    color[3]
  );
};

const pushPoolCircle = (vertices, x, y, radius, color, inner = 0) => {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0 || color[3] <= 0) return;
  for (const [uvX, uvY] of POOL_CIRCLE_CORNERS) {
    pushPoolCircleVertex(vertices, x, y, radius, uvX, uvY, inner, color);
  }
};

const createFloatList = (initialCapacity = 1024) => {
  let data = new Float32Array(initialCapacity);
  let view = data.subarray(0, 0);
  let viewLength = 0;
  const list = {
    get data() {
      return data;
    },
    length: 0,
    reset() {
      this.length = 0;
    },
    ensure(nextLength) {
      if (data.length >= nextLength) return;
      let nextCapacity = data.length || 1024;
      while (nextCapacity < nextLength) nextCapacity = Math.ceil(nextCapacity * 1.6);
      data = new Float32Array(nextCapacity);
      view = data.subarray(0, 0);
      viewLength = 0;
    },
    push6(a, b, c, d, e, f) {
      const start = this.length;
      this.ensure(start + 6);
      data[start] = a;
      data[start + 1] = b;
      data[start + 2] = c;
      data[start + 3] = d;
      data[start + 4] = e;
      data[start + 5] = f;
      this.length = start + 6;
    },
    push9(a, b, c, d, e, f, g, h, i) {
      const start = this.length;
      this.ensure(start + 9);
      data[start] = a;
      data[start + 1] = b;
      data[start + 2] = c;
      data[start + 3] = d;
      data[start + 4] = e;
      data[start + 5] = f;
      data[start + 6] = g;
      data[start + 7] = h;
      data[start + 8] = i;
      this.length = start + 9;
    },
    view() {
      if (view.buffer !== data.buffer || viewLength !== this.length) {
        view = data.subarray(0, this.length);
        viewLength = this.length;
      }
      return view;
    }
  };
  return list;
};

const samplePoolQuadraticInto = (out, start, control, end, amount) => {
  const t = clamp01(amount);
  const inv = 1 - t;
  out.x = inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x;
  out.y = inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y;
  return out;
};

const samplePoolCubicInto = (out, a, b, c, d, amount) => {
  const t = clamp01(amount);
  const inv = 1 - t;
  out.x = inv * inv * inv * a.x + 3 * inv * inv * t * b.x + 3 * inv * t * t * c.x + t * t * t * d.x;
  out.y = inv * inv * inv * a.y + 3 * inv * inv * t * b.y + 3 * inv * t * t * c.y + t * t * t * d.y;
  return out;
};

const pushPoolLineSegmentMesh = (vertices, a, b, lineWidth, colorA, colorB) => {
  const half = Math.max(0.35, lineWidth / 2);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 0.001) return;
  const normalX = -dy / distance * half;
  const normalY = dx / distance * half;
  const a0x = a.x + normalX;
  const a0y = a.y + normalY;
  const a1x = a.x - normalX;
  const a1y = a.y - normalY;
  const b0x = b.x + normalX;
  const b0y = b.y + normalY;
  const b1x = b.x - normalX;
  const b1y = b.y - normalY;
  pushPoolFillTriangleCoords(vertices, a0x, a0y, a1x, a1y, b0x, b0y, colorA, colorA, colorB);
  pushPoolFillTriangleCoords(vertices, a1x, a1y, b1x, b1y, b0x, b0y, colorA, colorB, colorB);
};

const pushSampledPoolLineMesh = (vertices, segments, sampleAt, lineWidth, colorAt) => {
  const previous = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  sampleAt(previous, 0);
  for (let index = 0; index < segments; index += 1) {
    const amountA = index / Math.max(1, segments);
    const amountB = (index + 1) / Math.max(1, segments);
    sampleAt(current, amountB);
    pushPoolLineSegmentMesh(
      vertices,
      previous,
      current,
      lineWidth,
      colorAt(amountA, index),
      colorAt(amountB, index + 1)
    );
    previous.x = current.x;
    previous.y = current.y;
  }
};

const pushPoolPrismLine = (vertices, frame, line, width, height, alpha, lineWidth) => {
  const { start, end, control } = resolveLineGeometry(line, width, height);
  const draw = clamp01(line.draw ?? 1);
  pushSampledPoolLineMesh(vertices, POOLDAY_RENDERER_LINE_SEGMENTS, (out, amount) => (
    samplePoolQuadraticInto(out, start, control, end, draw * amount)
  ), lineWidth, (amount) => {
    const local = Math.max(0.62, 1 - Math.abs(amount - 0.48) * 0.56);
    const offset = amount * 6;
    return resolvePoolRenderToneColor(frame, line.tone || 'rainbow', alpha * local, line.toneIndex + offset, flowToneMix(line, offset));
  });
};

const pushPoolBezierBand = (vertices, width, y, color) => {
  const a = { x: width * 0.10, y };
  const b = { x: width * 0.34, y: y - 22 };
  const c = { x: width * 0.62, y: y + 22 };
  const d = { x: width * 0.92, y };
  pushSampledPoolLineMesh(vertices, POOLDAY_RENDERER_BAND_SEGMENTS, (out, amount) => (
    samplePoolCubicInto(out, a, b, c, d, amount)
  ), 1, () => color);
};

export const createPoolRenderBatchBuilder = () => {
  const outputPool = [];
  const outputs = [];
  const scratch = {
    whiteField: createFloatList(64),
    backgroundLines: createFloatList(4096),
    prismCircles: createFloatList(512),
    facetFill: createFloatList(512),
    haloCircles: createFloatList(1024),
    edgeGlowFill: createFloatList(4096),
    cueCircles: createFloatList(2048),
    lineFill: createFloatList(8192),
    linePulseCircles: createFloatList(1024),
    particleCircles: createFloatList(8192),
    nodeCircles: createFloatList(1024)
  };
  const scratchArrays = Object.values(scratch);
  const tempPoint = { x: 0, y: 0 };
  const resetScratch = () => {
    for (const vertices of scratchArrays) vertices.reset();
    outputs.length = 0;
  };
  const pushBatch = (kind, vertices) => {
    if (vertices.length <= 0) return;
    const outputIndex = outputs.length;
    const view = vertices.view();
    const output = outputPool[outputIndex] || {
      kind,
      data: view,
      length: vertices.length,
      byteLength: vertices.length * 4
    };
    output.kind = kind;
    output.data = view;
    output.length = vertices.length;
    output.byteLength = vertices.length * 4;
    outputs.push(output);
    outputPool[outputIndex] = output;
  };

  return (frame, width, height) => {
    resetScratch();
    pushPoolFillTriangleCoords(scratch.whiteField, 0, 0, width, 0, 0, height, WHITE_FILL_COLOR);
    pushPoolFillTriangleCoords(scratch.whiteField, 0, height, width, 0, width, height, WHITE_FILL_COLOR);
    pushBatch('fill', scratch.whiteField);

    for (let index = 0; index < 6; index += 1) {
      pushPoolBezierBand(scratch.backgroundLines, width, height * (0.18 + index * 0.12), BACKGROUND_BAND_COLOR);
    }
    pushBatch('fill', scratch.backgroundLines);

    const nodes = frame.nodes || [];
    if (nodes.length > 0) {
      const time = Number(frame.time || 0);
      const bounds = resolveFrameBounds(nodes, width, height);
      for (let index = 0; index < 4; index += 1) {
        const radius = bounds.radius * (0.42 + index * 0.18);
        const drift = Math.sin(time * 0.52 + index * 1.7) * 18;
        const centerX = bounds.x + Math.cos(index * 1.9 + time * 0.18) * 22;
        const centerY = bounds.y + Math.sin(index * 1.6 + time * 0.14) * 18 + drift * 0.4;
        pushPoolCircle(
          scratch.prismCircles,
          centerX,
          centerY,
          Math.max(80, radius),
          resolvePoolRenderToneColor(frame, 'rainbow', 0.018 + index * 0.004, index * 2)
        );
      }
    }
    pushBatch('circle', scratch.prismCircles);

    if (nodes.length > 0) {
      const time = Number(frame.time || 0);
      const facetCount = Math.min(6, Math.max(2, Math.floor(nodes.length / 2)));
      for (let index = 0; index < facetCount; index += 1) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.82 + index);
        const color = resolvePoolRenderToneColor(
          frame,
          'rainbow',
          POOLDAY_FLOW_TUNING.prismFacetAlpha * (0.48 + pulse * 0.52),
          index * 2
        );
        pushPoolFillTriangle(
          scratch.facetFill,
          nodes[index % nodes.length],
          nodes[(index + 3) % nodes.length],
          nodes[(index + 6) % nodes.length],
          color
        );
      }
    }
    pushBatch('fill', scratch.facetFill);

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const core = node.core === true;
      const pulse = 0.5 + 0.5 * Math.sin((frame.time || 0) * 1.15 + index * 0.74);
      const radius = node.size * (core ? 6.8 : 5.2) + pulse * (core ? 10 : 7);
      pushPoolCircle(
        scratch.haloCircles,
        node.x,
        node.y,
        radius,
        resolvePoolRenderToneColor(frame, 'rainbow', POOLDAY_FLOW_TUNING.nodeGlowAlpha * (core ? 0.60 : 0.44), index + 2)
      );
    }
    pushBatch('circle', scratch.haloCircles);

    const edgeStride = Math.max(1, Math.ceil((frame.lines || []).length / POOLDAY_FLOW_TUNING.maxGlowLines));
    for (let index = 0; index < (frame.lines || []).length; index += edgeStride) {
      const line = frame.lines[index];
      const alpha = Math.min(0.32, (line.alpha || 0.1) * POOLDAY_FLOW_TUNING.edgeGlowAlpha * 2.6);
      pushPoolPrismLine(scratch.edgeGlowFill, frame, line, width, height, alpha, Math.max(3, line.width * POOLDAY_FLOW_TUNING.edgeGlowWidth));
    }
    pushBatch('fill', scratch.edgeGlowFill);

    const cueAmount = clamp01(frame.countdownProgress ?? frame.anticipation ?? 0);
    if (cueAmount > 0.01) {
      const eased = easeInOutCubic(cueAmount);
      const time = Number(frame.time || 0);
      const cueLines = frame.lines || [];
      const cueStride = Math.max(1, Math.ceil(cueLines.length / 12));
      const cueCount = 2 + Math.floor(eased * 3);
      for (let index = 0; index < cueLines.length; index += cueStride) {
        const line = cueLines[index];
        const edgeCue = clamp01(line.flowCountdown ?? cueAmount);
        for (let cue = 0; cue < cueCount; cue += 1) {
          const route = index + cue * 3;
          const progress = (
            time * (0.055 + edgeCue * 0.035)
            + edgeCue * 0.28
            + (line.phaseShift || 0) * 0.05
            + cue / cueCount
            + index * 0.017
          ) % 1;
          const point = resolveLinePointInto(tempPoint, line, progress, width, height);
          const ringRadius = 3.6 + edgeCue * 9.5 + Math.sin(time * 2.2 + route) * 1.8;
          pushPoolCircle(
            scratch.cueCircles,
            point.x,
            point.y,
            ringRadius,
            resolvePoolRenderToneColor(frame, 'rainbow', 0.09 + edgeCue * 0.27, route),
            0.62
          );
        }
      }
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const core = node.core === true;
        const local = clamp01((node.ringProgress ?? eased) - (index % 6) * 0.035);
        if (local <= 0.01) continue;
        const pulse = Math.sin(time * (1.1 + eased) + index * 0.8) * 0.5 + 0.5;
        const radius = node.size + (core ? 9 : 6) + local * (core ? 15 : 9) + pulse * 3;
        pushPoolCircle(
          scratch.cueCircles,
          node.x,
          node.y,
          radius,
          resolvePoolRenderToneColor(frame, 'rainbow', 0.11 + local * (core ? 0.30 : 0.20), index + Math.round(eased * 6)),
          0.70
        );
      }
    }
    pushBatch('circle', scratch.cueCircles);

    const flowEnergy = Number(frame.flowEnergy || 1);
    for (const line of frame.lines || []) {
      const activeAlpha = line.alpha * (1.05 + flowEnergy * 0.50);
      pushPoolPrismLine(scratch.lineFill, frame, line, width, height, activeAlpha, line.width);
      if (line.pulse > 0.02) {
        const pulsePoint = resolveLinePointInto(tempPoint, line, clamp01(0.5 + Math.sin(line.pulse * Math.PI) * 0.34), width, height);
        pushPoolCircle(
          scratch.linePulseCircles,
          pulsePoint.x,
          pulsePoint.y,
          3 + line.pulse * 7,
          resolvePoolRenderToneColor(
            frame,
            line.tone === 'primary' ? 'evidence' : line.tone,
            Math.min(0.64, activeAlpha + line.pulse * POOLDAY_FLOW_TUNING.pulseScale),
            line.toneIndex + 1,
            flowToneMix(line, 1)
          )
        );
      }
    }
    pushBatch('fill', scratch.lineFill);
    pushBatch('circle', scratch.linePulseCircles);

    for (const particle of frame.particles || []) {
      const particleHue = (particle.toneIndex ?? 0) + (particle.index % 5);
      if (particle.index % POOLDAY_FLOW_TUNING.shimmerStride === 0) {
        const shimmer = 0.58 + Math.sin((frame.time || 0) * 3 + particle.toneIndex) * 0.18;
        const glowRadius = particle.size * (2.2 + shimmer * 0.72);
        pushPoolCircle(
          scratch.particleCircles,
          particle.x,
          particle.y,
          Math.max(4, glowRadius),
          resolvePoolRenderToneColor(
            frame,
            'rainbow',
            particle.alpha * POOLDAY_FLOW_TUNING.shimmerAlpha * 0.36,
            particleHue + 1
          )
        );
      }
      pushPoolCircle(
        scratch.particleCircles,
        particle.x,
        particle.y,
        Math.max(2.8, particle.size * 1.36),
        resolvePoolRenderToneColor(frame, 'rainbow', particle.alpha * 0.30, particleHue + 3),
        0.58
      );
      pushPoolCircle(
        scratch.particleCircles,
        particle.x,
        particle.y,
        particle.size * 0.92,
        resolvePoolRenderToneColor(frame, 'rainbow', particle.alpha * 0.88, particleHue + 4)
      );
      pushPoolCircle(
        scratch.particleCircles,
        particle.x,
        particle.y,
        Math.max(1.2, particle.size * 0.34),
        resolvePoolRenderToneColor(frame, 'rainbow', particle.alpha * 0.54, particleHue + 6)
      );
    }
    pushBatch('circle', scratch.particleCircles);

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const core = node.core === true;
      pushPoolCircle(
        scratch.nodeCircles,
        node.x,
        node.y,
        node.size + (core ? 1.9 : 1.2),
        core
          ? resolvePoolRenderToneColor(frame, 'primary', 0.74, index)
          : resolvePoolRenderToneColor(frame, 'rainbow', node.alpha * 0.62, index),
        0.74
      );
      pushPoolCircle(
        scratch.nodeCircles,
        node.x,
        node.y,
        Math.max(2, node.size * 0.28),
        core
          ? resolvePoolRenderToneColor(frame, 'rainbow', node.alpha * 0.82, index + 3)
          : resolvePoolRenderToneColor(frame, 'rainbow', node.alpha * 0.54, index)
      );
    }
    pushBatch('circle', scratch.nodeCircles);
    return outputs;
  };
};
