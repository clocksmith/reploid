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
  resolveFrameBounds,
  resolveLineGeometryInto
} from './simulation-core.js';

const wrapPoolIndex = (index, length) => ((index % length) + length) % length;

const writePoolRgbColorInto = (target, color) => {
  target[0] = color?.[0] ?? 255;
  target[1] = color?.[1] ?? 255;
  target[2] = color?.[2] ?? 255;
  return target;
};

const resolveRainbowRgbInto = (target, rainbow, toneIndex = 0) => {
  const length = Math.max(1, rainbow.length);
  const baseIndex = Math.floor(toneIndex);
  const from = rainbow[wrapPoolIndex(baseIndex, length)] || [255, 255, 255];
  const to = rainbow[wrapPoolIndex(baseIndex + 1, length)] || [255, 255, 255];
  const amount = toneIndex - baseIndex;
  target[0] = from[0] + (to[0] - from[0]) * amount;
  target[1] = from[1] + (to[1] - from[1]) * amount;
  target[2] = from[2] + (to[2] - from[2]) * amount;
  return target;
};

const BACKGROUND_BAND_COLOR = Object.freeze([0, 0, 0, 0.018]);
const POOL_CIRCLE_CORNERS = Object.freeze([
  [-1, -1],
  [1, -1],
  [-1, 1],
  [-1, 1],
  [1, -1],
  [1, 1]
]);

const resolvePoolRawToneRgbInto = (target, frame, tone, toneIndex = 0) => {
  const palette = frame.palette || POOLDAY_GRAPH_PALETTES[0];
  const rainbow = palette.rainbow || POOLDAY_RAINBOW_COLORS;
  if (tone === 'rainbow') return resolveRainbowRgbInto(target, rainbow, toneIndex);
  const paletteColor = palette[tone];
  return paletteColor
    ? writePoolRgbColorInto(target, paletteColor)
    : resolveRainbowRgbInto(target, rainbow, toneIndex);
};

const resolvePoolRenderToneColorInto = (
  target,
  mixScratch,
  frame,
  tone,
  alpha,
  toneIndex = 0,
  toneTo = null,
  toneToIndex = toneIndex,
  toneBlend = 0
) => {
  resolvePoolRawToneRgbInto(target, frame, tone, toneIndex);
  const blend = clamp01(toneBlend);
  if (toneTo && blend > 0) {
    resolvePoolRawToneRgbInto(mixScratch, frame, toneTo, toneToIndex);
    target[0] += (mixScratch[0] - target[0]) * blend;
    target[1] += (mixScratch[1] - target[1]) * blend;
    target[2] += (mixScratch[2] - target[2]) * blend;
  }
  target[0] /= 255;
  target[1] /= 255;
  target[2] /= 255;
  target[3] = clamp01(alpha);
  return target;
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

const createPoolBatchScratch = () => ({
  previous: { x: 0, y: 0 },
  current: { x: 0, y: 0 },
  colorA: [0, 0, 0, 0],
  colorB: [0, 0, 0, 0],
  fadeColorA: [0, 0, 0, 0],
  fadeColorB: [0, 0, 0, 0],
  color: [0, 0, 0, 0],
  mixColor: [0, 0, 0, 0],
  lineGeometry: {
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    control: { x: 0, y: 0 }
  },
  bandA: { x: 0, y: 0 },
  bandB: { x: 0, y: 0 },
  bandC: { x: 0, y: 0 },
  bandD: { x: 0, y: 0 }
});

const writePoolAlphaScaledColorInto = (target, color, alphaScale) => {
  target[0] = color[0];
  target[1] = color[1];
  target[2] = color[2];
  target[3] = color[3] * alphaScale;
  return target;
};

const pushPoolLineSegmentMesh = (vertices, a, b, lineWidth, colorA, colorB, sampleScratch) => {
  const half = Math.max(0.35, lineWidth / 2);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 0.001) return;
  const directionX = dx / distance;
  const directionY = dy / distance;
  const extension = Math.min(1.15, distance * 0.22);
  const startX = a.x - directionX * extension;
  const startY = a.y - directionY * extension;
  const endX = b.x + directionX * extension;
  const endY = b.y + directionY * extension;
  const unitNormalX = -directionY;
  const unitNormalY = directionX;
  const fringe = Math.max(0.78, Math.min(1.45, lineWidth * 0.36 + 0.48));
  const outer = half + fringe;
  const innerX = unitNormalX * half;
  const innerY = unitNormalY * half;
  const outerX = unitNormalX * outer;
  const outerY = unitNormalY * outer;
  const fadeColorA = writePoolAlphaScaledColorInto(sampleScratch.fadeColorA, colorA, 0);
  const fadeColorB = writePoolAlphaScaledColorInto(sampleScratch.fadeColorB, colorB, 0);
  const aPlusX = startX + innerX;
  const aPlusY = startY + innerY;
  const aMinusX = startX - innerX;
  const aMinusY = startY - innerY;
  const bPlusX = endX + innerX;
  const bPlusY = endY + innerY;
  const bMinusX = endX - innerX;
  const bMinusY = endY - innerY;
  const aOuterPlusX = startX + outerX;
  const aOuterPlusY = startY + outerY;
  const bOuterPlusX = endX + outerX;
  const bOuterPlusY = endY + outerY;
  const aOuterMinusX = startX - outerX;
  const aOuterMinusY = startY - outerY;
  const bOuterMinusX = endX - outerX;
  const bOuterMinusY = endY - outerY;
  pushPoolFillTriangleCoords(vertices, aPlusX, aPlusY, aMinusX, aMinusY, bPlusX, bPlusY, colorA, colorA, colorB);
  pushPoolFillTriangleCoords(vertices, aMinusX, aMinusY, bMinusX, bMinusY, bPlusX, bPlusY, colorA, colorB, colorB);
  pushPoolFillTriangleCoords(vertices, aOuterPlusX, aOuterPlusY, aPlusX, aPlusY, bOuterPlusX, bOuterPlusY, fadeColorA, colorA, fadeColorB);
  pushPoolFillTriangleCoords(vertices, aPlusX, aPlusY, bPlusX, bPlusY, bOuterPlusX, bOuterPlusY, colorA, colorB, fadeColorB);
  pushPoolFillTriangleCoords(vertices, aMinusX, aMinusY, aOuterMinusX, aOuterMinusY, bMinusX, bMinusY, colorA, fadeColorA, colorB);
  pushPoolFillTriangleCoords(vertices, aOuterMinusX, aOuterMinusY, bOuterMinusX, bOuterMinusY, bMinusX, bMinusY, fadeColorA, fadeColorB, colorB);
};

const pushSampledPoolLineMesh = (vertices, segments, sampleAt, lineWidth, colorAt, sampleScratch) => {
  const previous = sampleScratch.previous;
  const current = sampleScratch.current;
  sampleAt(previous, 0);
  for (let index = 0; index < segments; index += 1) {
    const amountA = index / Math.max(1, segments);
    const amountB = (index + 1) / Math.max(1, segments);
    sampleAt(current, amountB);
    colorAt(sampleScratch.colorA, amountA, index);
    colorAt(sampleScratch.colorB, amountB, index + 1);
    pushPoolLineSegmentMesh(
      vertices,
      previous,
      current,
      lineWidth,
      sampleScratch.colorA,
      sampleScratch.colorB,
      sampleScratch
    );
    previous.x = current.x;
    previous.y = current.y;
  }
};

const pushPoolPrismLine = (vertices, frame, line, width, height, alpha, lineWidth, segments, sampleScratch) => {
  const { start, end, control } = resolveLineGeometryInto(sampleScratch.lineGeometry, line, width, height);
  const draw = clamp01(line.draw ?? 1);
  pushSampledPoolLineMesh(vertices, segments, (out, amount) => (
    samplePoolQuadraticInto(out, start, control, end, draw * amount)
  ), lineWidth, (out, amount) => {
    const local = Math.max(0.62, 1 - Math.abs(amount - 0.48) * 0.56);
    const offset = amount * 6;
    resolvePoolRenderToneColorInto(
      out,
      sampleScratch.mixColor,
      frame,
      line.tone || 'rainbow',
      alpha * local,
      line.toneIndex + offset,
      line.toneTo || null,
      (line.toneToIndex ?? line.toneIndex ?? 0) + offset,
      line.toneBlend ?? 0
    );
  }, sampleScratch);
};

const pushPoolBezierBand = (vertices, width, y, color, segments, sampleScratch) => {
  const a = sampleScratch.bandA;
  const b = sampleScratch.bandB;
  const c = sampleScratch.bandC;
  const d = sampleScratch.bandD;
  a.x = width * 0.10;
  a.y = y;
  b.x = width * 0.34;
  b.y = y - 22;
  c.x = width * 0.62;
  c.y = y + 22;
  d.x = width * 0.92;
  d.y = y;
  pushSampledPoolLineMesh(vertices, segments, (out, amount) => (
    samplePoolCubicInto(out, a, b, c, d, amount)
  ), 1, (out) => {
    out[0] = color[0];
    out[1] = color[1];
    out[2] = color[2];
    out[3] = color[3];
  }, sampleScratch);
};

export const createPoolRenderBatchBuilder = () => {
  const outputPool = [];
  const outputs = [];
  const scratch = {
    backgroundLines: createFloatList(16384),
    prismCircles: createFloatList(512),
    facetFill: createFloatList(512),
    edgeGlowFill: createFloatList(65536),
    lineFill: createFloatList(65536),
    particleCircles: createFloatList(8192),
    nodeCircles: createFloatList(1024)
  };
  const scratchArrays = Object.values(scratch);
  const sampleScratch = createPoolBatchScratch();
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
    const renderQuality = Math.max(0.62, Math.min(1, Number(frame.renderQuality ?? 1) || 1));
    const lineSegments = Math.max(7, Math.round(POOLDAY_RENDERER_LINE_SEGMENTS * renderQuality));
    const bandSegments = Math.max(12, Math.round(POOLDAY_RENDERER_BAND_SEGMENTS * renderQuality));
    const color = sampleScratch.color;
    const mixColor = sampleScratch.mixColor;
    for (let index = 0; index < 6; index += 1) {
      pushPoolBezierBand(scratch.backgroundLines, width, height * (0.18 + index * 0.12), BACKGROUND_BAND_COLOR, bandSegments, sampleScratch);
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
          resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', 0.018 + index * 0.004, index * 2)
        );
      }
    }
    pushBatch('circle', scratch.prismCircles);

    if (nodes.length > 0) {
      const time = Number(frame.time || 0);
      const facetCount = Math.min(6, Math.max(2, Math.floor(nodes.length / 2)));
      for (let index = 0; index < facetCount; index += 1) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.82 + index);
        pushPoolFillTriangle(
          scratch.facetFill,
          nodes[index % nodes.length],
          nodes[(index + 3) % nodes.length],
          nodes[(index + 6) % nodes.length],
          resolvePoolRenderToneColorInto(
            color,
            mixColor,
            frame,
            'rainbow',
            POOLDAY_FLOW_TUNING.prismFacetAlpha * (0.48 + pulse * 0.52),
            index * 2
          )
        );
      }
    }
    pushBatch('fill', scratch.facetFill);

    const glowLines = frame.lines || [];
    const glowBudget = Math.min(1, Math.max(8, POOLDAY_FLOW_TUNING.maxGlowLines * renderQuality) / Math.max(1, glowLines.length));
    for (let index = 0; index < glowLines.length; index += 1) {
      const line = glowLines[index];
      const hotPathBoost = line.hotPathActive ? 3.4 : 1;
      const alpha = Math.min(0.62, (line.alpha || 0.1) * POOLDAY_FLOW_TUNING.edgeGlowAlpha * 2.6 * glowBudget * hotPathBoost);
      pushPoolPrismLine(
        scratch.edgeGlowFill,
        frame,
        line,
        width,
        height,
        alpha,
        Math.max(3, line.width * POOLDAY_FLOW_TUNING.edgeGlowWidth * (line.hotPathActive ? 2.2 : 1)),
        lineSegments,
        sampleScratch
      );
    }
    pushBatch('fill', scratch.edgeGlowFill);

    const flowEnergy = Number(frame.flowEnergy || 1);
    for (const line of frame.lines || []) {
      const hotPathBoost = line.hotPathActive ? 1.62 : 1;
      const activeAlpha = line.alpha * (1.05 + flowEnergy * 0.50) * hotPathBoost;
      pushPoolPrismLine(scratch.lineFill, frame, line, width, height, activeAlpha, Math.max(line.width, line.width * hotPathBoost), lineSegments, sampleScratch);
    }
    pushBatch('fill', scratch.lineFill);

    for (const particle of frame.particles || []) {
      const particleHue = (particle.toneIndex ?? 0) + (particle.index % 5);
      pushPoolCircle(
        scratch.particleCircles,
        particle.x,
        particle.y,
        Math.max(2.8, particle.size * 1.36),
        resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', particle.alpha * 0.30, particleHue + 3),
        0.58
      );
      pushPoolCircle(
        scratch.particleCircles,
        particle.x,
        particle.y,
        particle.size * 0.92,
        resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', particle.alpha * 0.88, particleHue + 4)
      );
      pushPoolCircle(
        scratch.particleCircles,
        particle.x,
        particle.y,
        Math.max(1.2, particle.size * 0.34),
        resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', particle.alpha * 0.54, particleHue + 6)
      );
    }
    pushBatch('circle', scratch.particleCircles);

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const core = node.core === true;
      const hotPathBoost = node.hotPathActive ? 1.34 : 1;
      pushPoolCircle(
        scratch.nodeCircles,
        node.x,
        node.y,
        (node.size + (core ? 1.9 : 1.2)) * hotPathBoost,
        core
          ? resolvePoolRenderToneColorInto(color, mixColor, frame, 'primary', node.hotPathActive ? 0.96 : 0.74, index)
          : resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', node.alpha * (node.hotPathActive ? 0.92 : 0.62), index),
        0.74
      );
      pushPoolCircle(
        scratch.nodeCircles,
        node.x,
        node.y,
        Math.max(2, node.size * (node.hotPathActive ? 0.40 : 0.28)),
        core
          ? resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', node.alpha * (node.hotPathActive ? 1 : 0.82), index + 3)
          : resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', node.alpha * (node.hotPathActive ? 0.78 : 0.54), index)
      );
    }
    pushBatch('circle', scratch.nodeCircles);
    return outputs;
  };
};
