/**
 * @fileoverview Shared render-batch generation for GPU graph renderers.
 */

import {
  POOLDAY_GRAPH_PALETTES,
  POOLDAY_RAINBOW_COLORS,
  POOLDAY_RENDERER_LINE_SEGMENTS
} from './constants.js';
import {
  clamp01,
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
  }
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

export const createPoolRenderBatchBuilder = () => {
  const outputPool = [];
  const outputs = [];
  const scratch = {
    lineFill: createFloatList(32768),
    circles: createFloatList(4096)
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
    const lineSegments = Math.max(4, Math.round(POOLDAY_RENDERER_LINE_SEGMENTS * renderQuality));
    const color = sampleScratch.color;
    const mixColor = sampleScratch.mixColor;
    const nodes = frame.nodes || [];
    const flowEnergy = Number(frame.flowEnergy || 1);
    for (const line of frame.lines || []) {
      const hotPathBoost = line.hotPathActive ? 1.62 : 1;
      const activeAlpha = line.alpha * (1.05 + flowEnergy * 0.50) * hotPathBoost;
      pushPoolPrismLine(scratch.lineFill, frame, line, width, height, activeAlpha, Math.max(line.width, line.width * hotPathBoost), lineSegments, sampleScratch);
    }
    pushBatch('fill', scratch.lineFill);

    for (const particle of frame.particles || []) {
      if (!(particle.alpha > 0) || !(particle.size > 0)) continue;
      const particleHue = (particle.toneIndex ?? 0) + (particle.index % 5);
      pushPoolCircle(
        scratch.circles,
        particle.x,
        particle.y,
        Math.max(1.8, particle.size * 0.86),
        resolvePoolRenderToneColorInto(color, mixColor, frame, 'rainbow', particle.alpha * 0.82, particleHue + 4)
      );
    }

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const core = node.core === true;
      const hotPathBoost = node.hotPathActive ? 1.34 : 1;
      const liveWeight = clamp01(node.liveWeight || 0);
      pushPoolCircle(
        scratch.circles,
        node.x,
        node.y,
        (node.size + (core ? 1.6 : 1)) * hotPathBoost,
        core
          ? resolvePoolRenderToneColorInto(color, mixColor, frame, 'primary', node.hotPathActive ? 0.96 : 0.82, index)
          : resolvePoolRenderToneColorInto(
            color,
            mixColor,
            frame,
            'rainbow',
            node.alpha * (node.hotPathActive ? 0.90 : 0.68),
            index,
            node.liveProvider ? 'pipe' : 'evidence',
            index,
            liveWeight
          ),
        core ? 0.48 : 0.58
      );
    }
    pushBatch('circle', scratch.circles);
    return outputs;
  };
};
