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
  if (preset === 'runner_reduce') {
    return [
      ...corePath({
        ingress: { lanes: 2 },
        ledger: { lanes: 2 }
      }),
      ...POOLDAY_RUNNER_NODE_IDS.map((runnerId, index) => edge('assignment', runnerId, 'peer', {
        alpha: 0.13,
        tone: 'pipe',
        curve: index === 1 || index === 2 ? 0.008 : 0.022,
        speed: 0.93
      })),
      ...runnerToVerifierEdges({ alpha: 0.13 }),
      ...verifierToAgreementEdges({ alpha: 0.15 }),
      edge('assignment', 'agreement', 'pipe', { lanes: 5, alpha: 0.18, pulsePhase: 1, pulseScale: 1.35, speed: 1.10 })
    ];
  }
  if (preset === 'star_rendezvous') {
    return [
      ...corePath({ ingress: { lanes: 2 } }),
      ...POOLDAY_RUNNER_NODE_IDS.map((runnerId) => edge('assignment', runnerId, 'peer', { tone: 'pipe', alpha: 0.12, speed: 0.94 })),
      ...runnerToVerifierEdges({ alpha: 0.11, curve: 0.018 }),
      ...verifierToAgreementEdges({ alpha: 0.14 }),
      edge('assignment', 'agreement', 'pipe', { lanes: 4, pulsePhase: 1, speed: 1.08 })
    ];
  }
  if (preset === 'hourglass') {
    return [
      ...corePath(),
      ...POOLDAY_RUNNER_NODE_IDS.map((runnerId, index) => edge('assignment', runnerId, 'peer', {
        alpha: 0.12,
        tone: index < 2 ? 'pipe' : 'accent',
        curve: index % 2 ? -0.034 : 0.034,
        speed: 0.86
      })),
      ...runnerToVerifierEdges({ alpha: 0.12, curve: 0.026 }),
      ...verifierToAgreementEdges({ alpha: 0.13 }),
      edge('assignment', 'agreement', 'pipe', { lanes: 3, pulsePhase: 1, speed: 1.04 })
    ];
  }
  if (preset === 'float') {
    return [
      ...corePath(),
      edge('assignment', 'agreement', 'pipe', { lanes: 2, pulsePhase: 1, speed: 1.02 }),
      ...runnerRing({ alpha: 0.08, tone: 'pipe' }),
      ...verifierPair({ alpha: 0.08 }),
      edge('assignment', 'runner0', 'peer', { alpha: 0.09, tone: 'pipe', speed: 0.8 }),
      edge('assignment', 'runner2', 'peer', { alpha: 0.09, tone: 'pipe', speed: 0.8 }),
      ...runnerToVerifierEdges({ alpha: 0.09 }),
      ...verifierToAgreementEdges({ alpha: 0.10 })
    ];
  }
  if (preset === 'braided_lanes') {
    return [
      edge('requester', 'policy', 'core', { alpha: 0.27, curve: 0.035, pulsePhase: 0, speed: 0.92 }),
      edge('policy', 'runner0', 'peer', { alpha: 0.15, tone: 'pipe', curve: 0.065, pulsePhase: 0.7, speed: 0.90 }),
      edge('policy', 'runner1', 'peer', { alpha: 0.15, tone: 'accent', curve: -0.065, pulsePhase: 0.9, speed: 0.92 }),
      edge('runner0', 'assignment', 'core', { alpha: 0.22, curve: -0.052, pulsePhase: 1, speed: 0.96 }),
      edge('runner1', 'assignment', 'core', { alpha: 0.22, curve: 0.052, pulsePhase: 1.4, speed: 0.97 }),
      edge('assignment', 'runner2', 'pipe', { alpha: 0.18, curve: -0.062, speed: 1.03 }),
      edge('assignment', 'runner3', 'pipe', { alpha: 0.18, curve: 0.062, speed: 1.04 }),
      edge('runner2', 'verifier0', 'core', { alpha: 0.20, tone: 'evidence', curve: 0.054, pulsePhase: 2, speed: 0.98 }),
      edge('runner3', 'verifier1', 'core', { alpha: 0.20, tone: 'evidence', curve: -0.054, pulsePhase: 2.5, speed: 0.98 }),
      edge('verifier0', 'agreement', 'peer', { alpha: 0.14, tone: 'pipe', curve: -0.04, speed: 0.88 }),
      edge('verifier1', 'agreement', 'peer', { alpha: 0.14, tone: 'accent', curve: 0.04, speed: 0.88 }),
      edge('agreement', 'settlement', 'core', { tone: 'evidence', pulsePhase: 2.8, speed: 0.94 }),
      edge('settlement', 'ledger', 'core', { tone: 'evidence', pulsePhase: 3.2, speed: 0.92 })
    ];
  }
  if (preset === 'receipt_tree') {
    return [
      ...corePath({
        ingress: { curve: 0.01 },
        policy: { curve: 0.01 },
        settle: { curve: 0.01 },
        ledger: { curve: 0.01 }
      }),
      ...POOLDAY_RUNNER_NODE_IDS.map((runnerId) => edge('assignment', runnerId, 'peer', { alpha: 0.10, tone: 'pipe', speed: 0.86 })),
      ...runnerToVerifierEdges({ alpha: 0.09, tone: 'accent', speed: 0.86 }),
      ...verifierToAgreementEdges({ alpha: 0.12, tone: 'evidence', speed: 0.86 })
    ];
  }
  if (preset === 'bowtie_exchange') {
    return [
      edge('requester', 'policy', 'core', { lanes: 2, pulsePhase: 0, curve: 0.01 }),
      edge('policy', 'runner0', 'peer', { alpha: 0.15, tone: 'pipe', curve: 0.055, speed: 0.86 }),
      edge('policy', 'runner1', 'peer', { alpha: 0.15, tone: 'accent', curve: -0.055, speed: 0.86 }),
      edge('runner0', 'assignment', 'peer', { alpha: 0.16, tone: 'pipe', curve: 0.055, speed: 0.86 }),
      edge('runner1', 'assignment', 'peer', { alpha: 0.16, tone: 'accent', curve: -0.055, speed: 0.86 }),
      edge('runner2', 'assignment', 'pipe', { alpha: 0.17, curve: 0.026, pulsePhase: 1.2, speed: 0.96 }),
      edge('assignment', 'agreement', 'core', { lanes: 3, alpha: 0.24, tone: 'primary', pulsePhase: 1.6, curve: 0.004, speed: 1.08 }),
      edge('agreement', 'verifier0', 'pipe', { alpha: 0.17, curve: -0.026, pulsePhase: 2, speed: 0.96 }),
      edge('agreement', 'verifier1', 'peer', { alpha: 0.16, tone: 'pipe', curve: -0.055, speed: 0.86 }),
      edge('runner3', 'verifier1', 'peer', { alpha: 0.16, tone: 'accent', curve: 0.055, speed: 0.86 }),
      edge('verifier0', 'settlement', 'core', { alpha: 0.20, tone: 'evidence', curve: 0.035, speed: 0.92 }),
      edge('verifier1', 'settlement', 'core', { alpha: 0.20, tone: 'evidence', curve: -0.035, speed: 0.92 }),
      edge('settlement', 'ledger', 'core', { alpha: 0.22, tone: 'evidence', curve: 0.02, speed: 0.92 })
    ];
  }
  if (preset === 'triangulation') {
    return [
      edge('requester', 'policy', 'core', { alpha: 0.27, pulsePhase: 0, curve: 0.025, speed: 0.94 }),
      edge('policy', 'assignment', 'core', { alpha: 0.25, pulsePhase: 0.5, curve: 0.018, speed: 0.96 }),
      edge('policy', 'agreement', 'pipe', { alpha: 0.16, pulsePhase: 0.8, curve: -0.018, speed: 0.98 }),
      edge('requester', 'runner0', 'peer', { alpha: 0.12, tone: 'pipe', curve: 0.045, speed: 0.86 }),
      edge('assignment', 'runner0', 'peer', { alpha: 0.12, tone: 'pipe', curve: -0.024, speed: 0.88 }),
      edge('assignment', 'runner1', 'peer', { alpha: 0.12, tone: 'peer', curve: 0.018, speed: 0.90 }),
      edge('assignment', 'runner2', 'peer', { alpha: 0.12, tone: 'peer', curve: -0.018, speed: 0.90 }),
      edge('agreement', 'runner3', 'peer', { alpha: 0.12, tone: 'accent', curve: -0.045, speed: 0.86 }),
      edge('runner0', 'verifier0', 'peer', { alpha: 0.11, tone: 'accent', curve: 0.022, speed: 0.88 }),
      edge('runner1', 'verifier0', 'peer', { alpha: 0.11, tone: 'pipe', curve: -0.014, speed: 0.90 }),
      edge('runner2', 'verifier1', 'peer', { alpha: 0.11, tone: 'pipe', curve: 0.014, speed: 0.90 }),
      edge('runner3', 'verifier1', 'peer', { alpha: 0.11, tone: 'accent', curve: -0.022, speed: 0.88 }),
      ...verifierToAgreementEdges({ alpha: 0.12, tone: 'evidence' }),
      edge('verifier0', 'settlement', 'pipe', { alpha: 0.12, tone: 'evidence', curve: 0.018, speed: 0.88 }),
      edge('verifier1', 'settlement', 'pipe', { alpha: 0.12, tone: 'evidence', curve: -0.018, speed: 0.88 }),
      edge('settlement', 'ledger', 'core', { tone: 'evidence', pulsePhase: 2.8, curve: 0.01, speed: 0.94 })
    ];
  }
  if (preset === 'honeycomb') {
    return [
      edge('requester', 'policy', 'core', { alpha: 0.26, pulsePhase: 0, curve: 0.014, speed: 0.92 }),
      edge('policy', 'assignment', 'core', { alpha: 0.25, pulsePhase: 0.6, curve: 0.008, speed: 0.94 }),
      edge('policy', 'runner0', 'peer', { alpha: 0.11, tone: 'pipe', curve: -0.018, speed: 0.84 }),
      edge('assignment', 'runner0', 'peer', { alpha: 0.10, tone: 'peer', curve: 0.018, speed: 0.84 }),
      edge('assignment', 'runner1', 'peer', { alpha: 0.12, tone: 'pipe', curve: -0.022, speed: 0.84 }),
      edge('requester', 'runner2', 'peer', { alpha: 0.10, tone: 'peer', curve: 0.028, speed: 0.82 }),
      edge('runner0', 'runner2', 'peer', { alpha: 0.09, tone: 'accent', curve: 0.018, speed: 0.78 }),
      edge('runner0', 'verifier0', 'pipe', { alpha: 0.12, tone: 'pipe', curve: -0.014, speed: 0.88 }),
      edge('runner1', 'verifier0', 'pipe', { alpha: 0.12, tone: 'pipe', curve: 0.014, speed: 0.88 }),
      edge('runner1', 'runner3', 'peer', { alpha: 0.09, tone: 'accent', curve: -0.018, speed: 0.78 }),
      edge('runner2', 'verifier0', 'peer', { alpha: 0.10, tone: 'accent', curve: 0.016, speed: 0.84 }),
      edge('verifier0', 'runner3', 'peer', { alpha: 0.10, tone: 'accent', curve: -0.016, speed: 0.84 }),
      edge('verifier0', 'verifier1', 'peer', { alpha: 0.11, tone: 'evidence', curve: 0.01, speed: 0.86 }),
      edge('verifier0', 'agreement', 'pipe', { alpha: 0.12, tone: 'evidence', curve: -0.018, speed: 0.88 }),
      edge('runner3', 'agreement', 'peer', { alpha: 0.10, tone: 'pipe', curve: 0.018, speed: 0.84 }),
      edge('verifier1', 'settlement', 'core', { alpha: 0.18, tone: 'evidence', curve: 0.018, pulsePhase: 2, speed: 0.90 }),
      edge('agreement', 'settlement', 'core', { alpha: 0.20, tone: 'evidence', curve: -0.018, pulsePhase: 2.3, speed: 0.92 }),
      edge('settlement', 'ledger', 'core', { alpha: 0.23, tone: 'evidence', curve: 0.01, pulsePhase: 2.7, speed: 0.92 })
    ];
  }
  return [
    ...corePath(),
    edge('assignment', 'agreement', 'core', { pulsePhase: 1 }),
    ...POOLDAY_RUNNER_NODE_IDS.flatMap((runnerId, index) => [
      edge('assignment', runnerId, 'peer', { alpha: 0.10, speed: 0.84, tone: index % 2 ? 'pipe' : 'peer' }),
      edge(runnerId, POOLDAY_VERIFIER_NODE_IDS[index % POOLDAY_VERIFIER_NODE_IDS.length], 'peer', { alpha: 0.09, tone: 'accent', speed: 0.82 })
    ]),
    ...verifierToAgreementEdges()
  ];
};

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

  const materializeLines = ({ roles, participants, preset, time }) => materializeLineSpecs({
    roles,
    participants,
    specs: buildSimulationLineSpecs(preset),
    time
  });

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
    materializeLines,
    materializeLinePairs
  };
};
