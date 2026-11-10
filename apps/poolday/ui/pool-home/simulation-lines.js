/**
 * @fileoverview Simulation lines: route identities, transition lines between topologies, particle
 * progress and visibility along a line, line geometry and frame bounds.
 */
import { POOLDAY_FLOW_TUNING } from './constants.js';
import { buildSimulationLineSpecs } from './simulation-flow-specs.js';
import {
  clampRange,
  easeOutCubic,
  easeInOutCubic,
  easeInOutSine,
  resolveTransitionBlend,
  easeOutQuart,
  smoothStep
} from './simulation-easing.js';

export const resolveLineRouteId = (line) => (
  line?.toRouteId || line?.routeId || line?.fromRouteId || ''
);

const lineMatchesRoute = (line, routeId) => Boolean(routeId) && (
  line?.routeId === routeId
  || line?.toRouteId === routeId
  || line?.fromRouteId === routeId
);

export const findLineByRouteId = (lines, routeId) => {
  if (!routeId) return null;
  return lines.find((line) => lineMatchesRoute(line, routeId)) || null;
};

export const pickParticleLine = (particle, lines) => {
  if (!lines.length) return null;
  const routedLine = findLineByRouteId(lines, particle.routeId);
  if (routedLine) {
    const nextRouteId = resolveLineRouteId(routedLine);
    if (nextRouteId) particle.routeId = nextRouteId;
    return routedLine;
  }
  const nextLine = lines[particle.edgeIndex % lines.length] || lines[0];
  const nextRouteId = resolveLineRouteId(nextLine);
  if (particle.routeId && particle.routeId !== nextRouteId) {
    particle.routeBlend = 0;
  }
  particle.routeId = nextRouteId;
  return nextLine;
};

export const buildTransitionSimulationLines = ({ roles, participants, layout, time, projector }) => {
  const transition = layout.transition;
  if (!transition) {
    return projector.materializeLineSpecs({
      roles,
      participants,
      specs: layout.edgeSpecs || buildSimulationLineSpecs(layout.edgePreset),
      time
    });
  }
  const blend = resolveTransitionBlend(transition);
  if (!transition.linePairs?.length) {
    return projector.materializeLineSpecs({
      roles,
      participants,
      specs: buildSimulationLineSpecs(transition.toEdgePreset || layout.edgePreset),
      time
    });
  }
  return projector.materializeLinePairs({
    roles,
    participants,
    linePairs: transition.linePairs,
    time,
    blend
  });
};

export const resolveParticleProgress = (particle, line, participant, time, flowScale) => {
  const routeLength = line?.from && line?.to
    ? Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
    : 420;
  const lengthScale = clampRange(420 / Math.max(120, routeLength), 0.36, 1.20);
  return (
    particle.offset
    + (line?.flowPhase || 0) * 0.017
    + time * particle.speed * (line?.speed || 1) * (1.02 + participant.pulse * 0.18) * flowScale * lengthScale
  ) % 1;
};

export const resolveFlowVisibility = (progress) => (
  Math.pow(smoothStep(progress / 0.20) * smoothStep((1 - progress) / 0.20), 1.35)
);

const resolveLineGeometryScalarsInto = (target, line, width, height) => {
  const from = line.from;
  const to = line.to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const laneIndex = Number(line.laneIndex || 0);
  const laneCount = Math.max(1, Number(line.laneCount || 1));
  const laneOffsetUnits = Number.isFinite(Number(line.laneOffset))
    ? Number(line.laneOffset)
    : laneIndex - (laneCount - 1) / 2;
  const laneOffset = laneOffsetUnits * POOLDAY_FLOW_TUNING.laneGap;
  const signedCurve = Number.isFinite(Number(line.signedCurve))
    ? Number(line.signedCurve)
    : Number(line.curve || 0) * (Number.isFinite(Number(line.curveSign)) ? Number(line.curveSign) : 1);
  const curveOffset = Math.min(width, height) * signedCurve;
  target.startX = from.x + normalX * laneOffset;
  target.startY = from.y + normalY * laneOffset;
  target.endX = to.x + normalX * laneOffset;
  target.endY = to.y + normalY * laneOffset;
  target.controlX = (from.x + to.x) * 0.5 + normalX * (laneOffset + curveOffset);
  target.controlY = (from.y + to.y) * 0.5 + normalY * (laneOffset + curveOffset);
  return target;
};

const LINE_GEOMETRY_SCALARS = {};

export const resolveLineGeometryInto = (target, line, width, height) => {
  const geometry = resolveLineGeometryScalarsInto(LINE_GEOMETRY_SCALARS, line, width, height);
  const start = target.start || (target.start = { x: 0, y: 0 });
  const end = target.end || (target.end = { x: 0, y: 0 });
  const control = target.control || (target.control = { x: 0, y: 0 });
  start.x = geometry.startX;
  start.y = geometry.startY;
  end.x = geometry.endX;
  end.y = geometry.endY;
  control.x = geometry.controlX;
  control.y = geometry.controlY;
  return target;
};

export const resolveLineGeometry = (line, width, height) => (
  resolveLineGeometryInto({
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    control: { x: 0, y: 0 }
  }, line, width, height)
);

export const resolveLinePoint = (line, amount, width, height) => {
  return resolveLinePointInto({ x: 0, y: 0 }, line, amount, width, height);
};

const LINE_POINT_GEOMETRY = {};

export const resolveLinePointInto = (target, line, amount, width, height) => {
  const geometry = resolveLineGeometryScalarsInto(LINE_POINT_GEOMETRY, line, width, height);
  const ease = line.flowEase || 'sine';
  const t = ease === 'out'
    ? easeOutCubic(amount)
    : ease === 'quart'
      ? easeOutQuart(amount)
      : ease === 'cubic'
        ? easeInOutCubic(amount)
        : easeInOutSine(amount);
  const inv = 1 - t;
  target.x = inv * inv * geometry.startX + 2 * inv * t * geometry.controlX + t * t * geometry.endX;
  target.y = inv * inv * geometry.startY + 2 * inv * t * geometry.controlY + t * t * geometry.endY;
  return target;
};

export const resolveFrameBounds = (nodes = [], width = 1, height = 1) => {
  if (!nodes.length) {
    return {
      x: width * 0.5,
      y: height * 0.5,
      radius: Math.min(width, height) * 0.24
    };
  }
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  const x = (minX + maxX) * 0.5;
  const y = (minY + maxY) * 0.5;
  const radius = Math.max(60, Math.min(width, height) * 0.12, Math.hypot(maxX - minX, maxY - minY) * 0.56);
  return { x, y, radius };
};
