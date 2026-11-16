/**
 * @fileoverview Flow pairing and interpolation for Reploid graph transitions.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const mixNumber = (from, to, amount) => from + (to - from) * amount;

const mixPointInto = (target, from, to, amount) => {
  target.x = mixNumber(from.x, to.x, amount);
  target.y = mixNumber(from.y, to.y, amount);
  return target;
};

const endpointGroup = (id = '') => {
  if (id.startsWith('runner')) return 'runner';
  if (id.startsWith('verifier')) return 'verifier';
  return id;
};

const lineValue = (line, key, fallback) => (
  Number.isFinite(Number(line?.[key])) ? Number(line[key]) : fallback
);

const semanticScore = (fromLine, toLine) => {
  if (fromLine.routeId === toLine.routeId) return -100;
  let score = 0;
  score += fromLine.flowFamily === toLine.flowFamily ? -32 : 22;
  score += fromLine.fromId === toLine.fromId ? -12 : endpointGroup(fromLine.fromId) === endpointGroup(toLine.fromId) ? -4 : 7;
  score += fromLine.toId === toLine.toId ? -12 : endpointGroup(fromLine.toId) === endpointGroup(toLine.toId) ? -4 : 7;
  score += Math.abs(lineValue(fromLine, 'laneOffset', 0) - lineValue(toLine, 'laneOffset', 0)) * 1.5;
  score += Math.abs(lineValue(fromLine, 'speed', 1) - lineValue(toLine, 'speed', 1)) * 3;
  score += Math.abs(lineValue(fromLine, 'width', 1) - lineValue(toLine, 'width', 1)) * 2;
  return score;
};

const fadedFlowLine = (line, direction) => ({
  ...line,
  alpha: 0,
  draw: direction === 'in' ? 0 : line.draw ?? 1,
  pulse: 0,
  width: Math.max(0.12, lineValue(line, 'width', 1) * 0.22),
  particleScale: 0.18,
  flowAlpha: 0,
  speed: lineValue(line, 'speed', 1) * 0.86
});

export const pairFlowTransitionLines = (fromLines, toLines) => {
  const pairs = [];
  const usedTo = new Set();
  const routeLookup = new Map();
  toLines.forEach((line, index) => {
    if (!routeLookup.has(line.routeId)) routeLookup.set(line.routeId, []);
    routeLookup.get(line.routeId).push(index);
  });

  for (const fromLine of fromLines) {
    const exact = routeLookup.get(fromLine.routeId)?.find((index) => !usedTo.has(index));
    if (Number.isInteger(exact)) {
      usedTo.add(exact);
      pairs.push({ from: fromLine, to: toLines[exact] });
      continue;
    }
    let bestIndex = -1;
    let bestScore = Infinity;
    for (let index = 0; index < toLines.length; index += 1) {
      if (usedTo.has(index)) continue;
      const score = semanticScore(fromLine, toLines[index]);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestScore <= 24) {
      usedTo.add(bestIndex);
      pairs.push({ from: fromLine, to: toLines[bestIndex] });
    } else {
      pairs.push({ from: fromLine, to: fadedFlowLine(fromLine, 'out') });
    }
  }

  for (let index = 0; index < toLines.length; index += 1) {
    if (!usedTo.has(index)) pairs.push({ from: fadedFlowLine(toLines[index], 'in'), to: toLines[index] });
  }
  return pairs;
};

export const morphFlowLinePair = (pair, amount, index, target = {}) => {
  const blend = clamp01(amount);
  const fromLine = pair.from;
  const toLine = pair.to;
  const fromRouteId = fromLine.routeId || `${index}:from`;
  const toRouteId = toLine.routeId || `${index}:to`;
  target.routeId = `transition:${index}:${fromRouteId}->${toRouteId}`;
  target.transitionId = target.routeId;
  target.fromRouteId = fromRouteId;
  target.toRouteId = toRouteId;
  target.fromId = fromLine.fromId;
  target.toId = fromLine.toId;
  target.targetFromId = toLine.fromId;
  target.targetToId = toLine.toId;
  target.flowFamily = fromLine.flowFamily || toLine.flowFamily || 'flow';
  target.targetFlowFamily = toLine.flowFamily || fromLine.flowFamily || 'flow';
  target.fromLine = fromLine;
  target.toLine = toLine;
  target.from = mixPointInto(target.from || {}, fromLine.from, toLine.from, blend);
  target.to = mixPointInto(target.to || {}, fromLine.to, toLine.to, blend);
  target.alpha = mixNumber(fromLine.alpha, toLine.alpha, blend);
  target.draw = mixNumber(fromLine.draw, toLine.draw, blend);
  target.pulse = mixNumber(fromLine.pulse, toLine.pulse, blend);
  target.tone = fromLine.tone;
  target.toneIndex = fromLine.toneIndex;
  target.toneTo = toLine.tone;
  target.toneToIndex = toLine.toneIndex;
  target.toneBlend = blend;
  target.laneIndex = mixNumber(lineValue(fromLine, 'laneIndex', 0), lineValue(toLine, 'laneIndex', 0), blend);
  target.laneCount = Math.max(1, mixNumber(lineValue(fromLine, 'laneCount', 1), lineValue(toLine, 'laneCount', 1), blend));
  target.laneOffset = mixNumber(lineValue(fromLine, 'laneOffset', 0), lineValue(toLine, 'laneOffset', 0), blend);
  target.laneSlot = mixNumber(lineValue(fromLine, 'laneSlot', 0), lineValue(toLine, 'laneSlot', 0), blend);
  target.curveSign = mixNumber(lineValue(fromLine, 'curveSign', 1), lineValue(toLine, 'curveSign', 1), blend);
  target.signedCurve = mixNumber(lineValue(fromLine, 'signedCurve', fromLine.curve || 0), lineValue(toLine, 'signedCurve', toLine.curve || 0), blend);
  target.curve = Math.abs(target.signedCurve);
  target.speed = mixNumber(fromLine.speed, toLine.speed, blend);
  target.baseSpeed = target.speed;
  target.width = mixNumber(fromLine.width, toLine.width, blend);
  target.baseWidth = target.width;
  target.basePulse = target.pulse;
  target.particleScale = mixNumber(lineValue(fromLine, 'particleScale', 1), lineValue(toLine, 'particleScale', 1), blend);
  target.flowAlpha = mixNumber(lineValue(fromLine, 'flowAlpha', 1), lineValue(toLine, 'flowAlpha', 1), blend);
  target.flowPhase = mixNumber(lineValue(fromLine, 'flowPhase', 0), lineValue(toLine, 'flowPhase', 0), blend);
  target.flowEase = fromLine.flowEase || toLine.flowEase || 'sine';
  return target;
};
