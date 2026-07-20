/**
 * @fileoverview Declarative flow specs for the Reploid graph.
 */

import {
  POOLDAY_FLOW_TUNING,
  POOLDAY_PARTICIPANT_NODE_IDS,
  POOLDAY_RUNNER_NODE_IDS,
  POOLDAY_VERIFIER_NODE_IDS
} from './constants.js';
import { morphFlowLinePair } from './simulation-flow-transition.js';

const BASE_STYLES = Object.freeze({
  core: {
    alpha: 0.34,
    tone: 'primary',
    curve: 0.018,
    width: POOLDAY_FLOW_TUNING.coreLineWidth,
    speed: 1
  },
  peer: {
    alpha: 0.105,
    tone: 'peer',
    curve: 0.032,
    width: POOLDAY_FLOW_TUNING.peerLineWidth,
    speed: 0.9
  },
  pipe: {
    alpha: 0.19,
    tone: 'pipe',
    curve: POOLDAY_FLOW_TUNING.pipeCurveLift,
    width: POOLDAY_FLOW_TUNING.pipeLineWidth,
    speed: 1.06
  }
});

const isRunner = (id = '') => POOLDAY_RUNNER_NODE_IDS.includes(id);
const isVerifier = (id = '') => POOLDAY_VERIFIER_NODE_IDS.includes(id);

const inferFlowFamily = (fromId = '', toId = '') => {
  if (fromId === 'requester' || toId === 'requester') return 'request';
  if (fromId === 'policy' || toId === 'policy') return 'policy';
  if (fromId === 'ledger' || toId === 'ledger') return 'ledger';
  if (fromId === 'settlement' || toId === 'settlement') return 'settlement';
  if ((fromId === 'assignment' && isRunner(toId)) || (toId === 'assignment' && isRunner(fromId))) return 'assignment-runner';
  if ((isRunner(fromId) && isVerifier(toId)) || (isVerifier(fromId) && isRunner(toId))) return 'runner-verifier';
  if ((isVerifier(fromId) && toId === 'agreement') || (isVerifier(toId) && fromId === 'agreement')) return 'verification';
  if ((fromId === 'assignment' && toId === 'agreement') || (fromId === 'agreement' && toId === 'assignment')) return 'agreement';
  if (isRunner(fromId) && isRunner(toId)) return 'runner-mesh';
  if (isVerifier(fromId) && isVerifier(toId)) return 'verifier-quorum';
  return 'flow';
};

const edge = (fromId, toId, kind = 'peer', options = {}) => ({
  fromId,
  toId,
  kind,
  ...options
});

const runnerRing = (options = {}) => POOLDAY_RUNNER_NODE_IDS.map((runnerId, index) => edge(
  runnerId,
  POOLDAY_RUNNER_NODE_IDS[(index + 1) % POOLDAY_RUNNER_NODE_IDS.length],
  'peer',
  {
    alpha: 0.09,
    tone: 'accent',
    curve: 0.024,
    speed: 0.82,
    ...options
  }
));

const verifierPair = (options = {}) => [
  edge('verifier0', 'verifier1', 'peer', {
    alpha: 0.10,
    tone: 'evidence',
    curve: 0.018,
    speed: 0.84,
    ...options
  })
];

const corePath = (options = {}) => [
  edge('requester', 'policy', 'core', { pulsePhase: 0, speed: 0.98, ...options.ingress }),
  edge('policy', 'assignment', 'core', { pulsePhase: 0.5, speed: 0.98, ...options.policy }),
  edge('agreement', 'settlement', 'core', { tone: 'evidence', pulsePhase: 2, speed: 0.96, ...options.settle }),
  edge('settlement', 'ledger', 'core', { tone: 'evidence', pulsePhase: 2.4, speed: 0.94, ...options.ledger })
];

const runnerToVerifierEdges = (options = {}) => POOLDAY_RUNNER_NODE_IDS.map((runnerId, index) => edge(
  runnerId,
  POOLDAY_VERIFIER_NODE_IDS[index % POOLDAY_VERIFIER_NODE_IDS.length],
  'peer',
  {
    alpha: 0.12,
    tone: index % 2 ? 'accent' : 'pipe',
    curve: index % 2 ? -0.022 : 0.022,
    speed: 0.90,
    ...options
  }
));

const verifierToAgreementEdges = (options = {}) => POOLDAY_VERIFIER_NODE_IDS.map((verifierId, index) => edge(
  verifierId,
  'agreement',
  'peer',
  {
    alpha: 0.14,
    tone: index % 2 ? 'evidence' : 'accent',
    curve: index % 2 ? -0.018 : 0.018,
    speed: 0.92,
    ...options
  }
));

const expandEdgeSpec = (spec, specIndex) => {
  const defaults = BASE_STYLES[spec.kind] || BASE_STYLES.peer;
  const lanes = Math.max(1, Number(spec.lanes || 1));
  const toneSeed = Number(spec.toneIndex ?? specIndex * 3);
  const curveValue = Number(spec.curve ?? defaults.curve);
  const signedCurve = Number.isFinite(spec.signedCurve)
    ? Number(spec.signedCurve)
    : curveValue;
  return Array.from({ length: lanes }, (_, laneIndex) => {
    const flowFamily = spec.flowFamily || inferFlowFamily(spec.fromId, spec.toId);
    const laneOffset = spec.laneOffset ?? (laneIndex - (lanes - 1) / 2);
    const laneCurveSign = Number.isFinite(spec.curveSign)
      ? Number(spec.curveSign)
      : (signedCurve < 0 ? -1 : laneIndex % 2 === 0 ? 1 : -1);
    const curve = Math.abs(signedCurve);
    const routeBase = spec.routeId || `${flowFamily}:${spec.fromId}>${spec.toId}`;
    return Object.freeze({
      routeId: lanes > 1 ? `${routeBase}:${laneIndex}` : `${routeBase}:0`,
      fromId: spec.fromId,
      toId: spec.toId,
      flowFamily,
      alpha: (spec.alpha ?? defaults.alpha) * (lanes > 1 ? 0.82 : 1),
      draw: spec.draw ?? 1,
      pulsePhase: spec.pulsePhase,
      pulseScale: spec.pulseScale ?? 1,
      pulseOffset: laneIndex * 0.05,
      tone: spec.tone || defaults.tone,
      toneIndex: toneSeed + laneIndex,
      laneIndex,
      laneCount: lanes,
      laneOffset,
      laneSlot: spec.laneSlot ?? laneIndex,
      curve,
      curveSign: laneCurveSign,
      signedCurve: curve * laneCurveSign,
      speed: (spec.speed ?? defaults.speed) + laneIndex * 0.035,
      width: spec.width ?? defaults.width,
      particleScale: spec.particleScale ?? 1,
      flowAlpha: spec.flowAlpha ?? 1,
      flowPhase: spec.flowPhase ?? specIndex * 0.37 + laneIndex * 0.11,
      flowEase: spec.flowEase || 'sine'
    });
  });
};

const buildPresetEdges = (preset) => {
  if (preset === 'dodecagon') {
    const ids = [
      'requester',
      'policy',
      'assignment',
      'runner0',
      'runner1',
      'runner2',
      'runner3',
      'verifier0',
      'verifier1',
      'agreement',
      'settlement',
      'ledger'
    ];
    return ids.map((id, index) => edge(
      id,
      ids[(index + 1) % ids.length],
      'peer',
      { alpha: 0.12, tone: 'pipe', speed: 0.88, curve: 0.015 }
    ));
  }

  const isBraid = preset === 'braided_lanes';
  const isTri = preset === 'triangulation';
  const isHourglass = preset === 'hourglass';
  const isBowtie = preset === 'bowtie_exchange';
  const isReduce = preset === 'runner_reduce';
  const isStar = preset === 'star_rendezvous';

  return [
    edge('requester', 'policy', 'core', {
      pulsePhase: 0,
      speed: 0.98,
      curve: isBraid ? 0.035 : isTri ? 0.025 : 0.02,
      lanes: isReduce || isStar || isBowtie ? 2 : 1
    }),
    edge('policy', 'assignment', 'core', {
      pulsePhase: 0.5,
      speed: 0.98,
      curve: isTri ? 0.018 : 0.01
    }),
    edge('assignment', 'runner0', 'peer', {
      alpha: 0.12,
      tone: 'pipe',
      speed: 0.86,
      curve: isHourglass || isBowtie || isBraid ? 0.054 : isReduce ? 0.03 : isStar ? 0.04 : 0.024
    }),
    edge('assignment', 'runner1', 'peer', {
      alpha: 0.12,
      tone: 'pipe',
      speed: 0.86,
      curve: isHourglass || isBowtie || isBraid ? -0.054 : isReduce ? -0.03 : isStar ? -0.04 : -0.024
    }),
    edge('assignment', 'runner2', 'peer', {
      alpha: 0.12,
      tone: 'pipe',
      speed: 0.86,
      curve: isHourglass || isBowtie || isBraid ? 0.054 : isReduce ? 0.03 : isStar ? 0.04 : 0.024
    }),
    edge('assignment', 'runner3', 'peer', {
      alpha: 0.12,
      tone: 'pipe',
      speed: 0.86,
      curve: isHourglass || isBowtie || isBraid ? -0.054 : isReduce ? -0.03 : isStar ? -0.04 : -0.024
    }),
    edge('runner0', 'verifier0', 'peer', {
      alpha: 0.11,
      tone: 'accent',
      speed: 0.90,
      curve: isHourglass ? 0.048 : isBraid ? 0.045 : isReduce ? 0.03 : 0.024
    }),
    edge('runner1', 'verifier1', 'peer', {
      alpha: 0.11,
      tone: 'accent',
      speed: 0.90,
      curve: isHourglass ? -0.048 : isBraid ? -0.045 : isReduce ? -0.03 : -0.024
    }),
    edge('runner2', 'verifier0', 'peer', {
      alpha: 0.11,
      tone: 'pipe',
      speed: 0.90,
      curve: isHourglass ? 0.048 : isBraid ? 0.045 : isReduce ? 0.03 : 0.024
    }),
    edge('runner3', 'verifier1', 'peer', {
      alpha: 0.11,
      tone: 'pipe',
      speed: 0.90,
      curve: isHourglass ? -0.048 : isBraid ? -0.045 : isReduce ? -0.03 : -0.024
    }),
    edge('verifier0', 'agreement', 'peer', {
      alpha: 0.14,
      tone: 'evidence',
      speed: 0.88,
      curve: isBraid ? -0.04 : isReduce ? -0.03 : -0.024
    }),
    edge('verifier1', 'agreement', 'peer', {
      alpha: 0.14,
      tone: 'evidence',
      speed: 0.88,
      curve: isBraid ? 0.04 : isReduce ? 0.03 : 0.024
    }),
    edge('agreement', 'settlement', 'core', {
      tone: 'evidence',
      pulsePhase: 2,
      speed: 0.96,
      curve: isBraid ? 0.03 : 0.01
    }),
    edge('settlement', 'ledger', 'core', {
      tone: 'evidence',
      pulsePhase: 2.4,
      speed: 0.94,
      curve: isBraid ? 0.03 : 0.01,
      lanes: isReduce ? 2 : 1
    })
  ];
};;

const SPEC_CACHE = new Map();

export const buildSimulationLineSpecs = (preset) => {
  if (!SPEC_CACHE.has(preset)) {
    SPEC_CACHE.set(preset, Object.freeze(buildPresetEdges(preset).flatMap(expandEdgeSpec)));
  }
  return SPEC_CACHE.get(preset);
};

const resolvePulse = (spec, time) => {
  if (!Number.isFinite(spec.pulsePhase)) return spec.pulseOffset || 0;
  return (
    0.12
    + 0.22 * (Math.sin(time * 2.35 + spec.pulsePhase) * 0.5 + 0.5) * (spec.pulseScale || 1)
    + (spec.pulseOffset || 0)
  );
};

const assignLineSpec = (target, spec, nodes, time) => {
  const from = nodes[spec.fromId];
  const to = nodes[spec.toId];
  if (!from || !to) return null;
  target.routeId = spec.routeId;
  target.fromId = spec.fromId;
  target.toId = spec.toId;
  target.flowFamily = spec.flowFamily;
  target.alpha = spec.alpha;
  target.draw = spec.draw;
  target.pulsePhase = spec.pulsePhase;
  target.pulseScale = spec.pulseScale;
  target.pulseOffset = spec.pulseOffset;
  target.tone = spec.tone;
  target.toneIndex = spec.toneIndex;
  target.toneTo = null;
  target.toneToIndex = spec.toneIndex;
  target.toneBlend = 0;
  target.laneIndex = spec.laneIndex;
  target.laneCount = spec.laneCount;
  target.laneOffset = spec.laneOffset;
  target.laneSlot = spec.laneSlot;
  target.curve = spec.curve;
  target.curveSign = spec.curveSign;
  target.signedCurve = spec.signedCurve;
  target.speed = spec.speed;
  target.baseSpeed = spec.speed;
  target.width = spec.width;
  target.baseWidth = spec.width;
  target.particleScale = spec.particleScale;
  target.flowAlpha = spec.flowAlpha;
  target.flowPhase = spec.flowPhase;
  target.flowEase = spec.flowEase;
  target.from = from;
  target.to = to;
  target.fromLine = null;
  target.toLine = null;
  target.transitionId = null;
  target.pulse = resolvePulse(spec, time);
  target.basePulse = target.pulse;
  return target;
};

export const createSimulationLineProjector = () => {
  const nodeMap = {};
  const lineCache = [];
  const pairFromCache = [];
  const pairToCache = [];
  const transitionCache = [];
  const projected = [];

  const resetNodes = (roles, participants) => {
    for (const id of ['requester', 'policy', 'assignment', 'agreement', 'settlement', 'ledger']) {
      nodeMap[id] = roles[id];
    }
    for (const id of POOLDAY_PARTICIPANT_NODE_IDS) nodeMap[id] = null;
    for (const participant of participants) nodeMap[participant.id] = participant;
  };

  const materializeLineSpecs = ({ roles, participants, specs, time }) => {
    resetNodes(roles, participants);
    projected.length = 0;
    const resolvedSpecs = specs || [];
    for (let index = 0; index < resolvedSpecs.length; index += 1) {
      const line = assignLineSpec(lineCache[index] || (lineCache[index] = {}), resolvedSpecs[index], nodeMap, time);
      if (line) projected.push(line);
    }
    return projected;
  };

  const materializeLinePairs = ({ roles, participants, linePairs, time, blend }) => {
    resetNodes(roles, participants);
    projected.length = 0;
    for (let index = 0; index < linePairs.length; index += 1) {
      const pair = linePairs[index];
      const fromLine = assignLineSpec(pairFromCache[index] || (pairFromCache[index] = {}), pair.from, nodeMap, time);
      const toLine = assignLineSpec(pairToCache[index] || (pairToCache[index] = {}), pair.to, nodeMap, time);
      if (!fromLine || !toLine) continue;
      projected.push(morphFlowLinePair({ from: fromLine, to: toLine }, blend, index, transitionCache[index] || (transitionCache[index] = {})));
    }
    return projected;
  };

  return {
    materializeLineSpecs,
    materializeLinePairs
  };
};
