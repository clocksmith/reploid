import { describe, expect, it } from 'vitest';

import {
  buildPoolSimulationFrame,
  clamp01,
  createPoolSimulationState,
  easeInOutCubic,
  resolveLinePoint,
  resizePoolCanvas
} from '../../self/ui/pool-home/simulation-core.js';
import { resolvePoolFrameDeltaMs } from '../../self/ui/pool-home/simulation-bind.js';
import {
  SIMULATION_MAX_STEP_MS,
  SIMULATION_GENTLE_SPEED,
  SIMULATION_MOTION_CLOCK_WRAP_SECONDS,
  POOLDAY_MORPH_TUNING,
  POOLDAY_FLOW_TUNING,
  POOLDAY_GRAPH_VIEW_CENTER_PULL,
  POOLDAY_GRAPH_NODE_IDS,
  POOLDAY_GRAPH_TOPOLOGIES,
  SIMULATION_TARGET_STEP_MS
} from '../../self/ui/pool-home/constants.js';

const withSimulationSearch = (search, callback) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    value: { search },
    configurable: true
  });
  try {
    return callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'location', descriptor);
    } else {
      delete globalThis.location;
    }
  }
};

const topologyById = (id) => POOLDAY_GRAPH_TOPOLOGIES.find((topology) => topology.id === id);
const pointOf = (topology, id) => topology.points[id];
const xOf = (topology, id) => pointOf(topology, id)[0];
const yOf = (topology, id) => pointOf(topology, id)[1];
const expectSameX = (topology, ids, value = xOf(topology, ids[0])) => {
  for (const id of ids) expect(xOf(topology, id)).toBeCloseTo(value, 8);
};
const expectSameY = (topology, ids, value = yOf(topology, ids[0])) => {
  for (const id of ids) expect(yOf(topology, id)).toBeCloseTo(value, 8);
};
const expectIncreasingX = (topology, ids) => {
  for (let index = 1; index < ids.length; index += 1) {
    expect(xOf(topology, ids[index])).toBeGreaterThan(xOf(topology, ids[index - 1]));
  }
};
const expectIncreasingY = (topology, ids) => {
  for (let index = 1; index < ids.length; index += 1) {
    expect(yOf(topology, ids[index])).toBeGreaterThan(yOf(topology, ids[index - 1]));
  }
};
const expectedCenteredCoordinate = (value, size) => (
  (0.5 + (value - 0.5) * (1 - POOLDAY_GRAPH_VIEW_CENTER_PULL)) * size
);

describe('pool home simulation performance contracts', () => {
  it('resizes from cached CSS dimensions without reading layout', () => {
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect() {
        throw new Error('layout should stay cached during RAF');
      }
    };

    const result = resizePoolCanvas(canvas, { width: 800, height: 600 });

    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(canvas.width).toBe(result.width);
    expect(canvas.height).toBe(result.height);
  });

  it('reuses the frame, node, and particle containers across ticks', () => {
    const state = createPoolSimulationState();
    const first = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    const firstNodes = first.nodes;
    const firstParticles = first.particles;
    const firstNode = first.nodes[0];
    const firstParticle = first.particles[0];
    const second = buildPoolSimulationFrame(state, 960, 640, 1 / 60);

    expect(second).toBe(first);
    expect(second.nodes).toBe(firstNodes);
    expect(second.particles).toBe(firstParticles);
    expect(second.nodes[0]).toBe(firstNode);
    expect(second.particles[0]).toBe(firstParticle);
    expect(second.lines.length).toBeGreaterThan(0);
  });

  it('labels a 12 node staged graph with duplicated flow roles', () => {
    const state = createPoolSimulationState();
    const frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    const nodeIds = frame.nodes.map((node) => node.id).sort();
    const anchorIds = Object.keys(frame.labelAnchors).sort();
    const anchors = Object.values(frame.labelAnchors);
    const labels = anchors.map((anchor) => anchor.label);
    const stages = new Set(anchors.map((anchor) => anchor.labelStage));
    const labelCounts = labels.reduce((counts, label) => {
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {});

    expect(frame.nodes).toHaveLength(12);
    expect(anchorIds).toEqual(nodeIds);
    expect(labels.every(Boolean)).toBe(true);
    expect(labelCounts.Request).toBe(1);
    expect(labelCounts.Policy).toBe(1);
    expect(labelCounts.Match).toBe(1);
    expect(labelCounts.Infer).toBeGreaterThanOrEqual(4);
    expect(labelCounts.Verify).toBeGreaterThanOrEqual(3);
    expect(labelCounts.History).toBeGreaterThanOrEqual(2);
    expect(stages.size).toBe(6);
  });

  it('defines complete normalized topology points for every graph node', () => {
    for (const topology of POOLDAY_GRAPH_TOPOLOGIES) {
      expect(Object.keys(topology.points).sort()).toEqual([...POOLDAY_GRAPH_NODE_IDS].sort());
      for (const id of POOLDAY_GRAPH_NODE_IDS) {
        const point = topology.points[id];
        expect(point).toHaveLength(2);
        expect(point[0]).toBeGreaterThanOrEqual(0);
        expect(point[0]).toBeLessThanOrEqual(1);
        expect(point[1]).toBeGreaterThanOrEqual(0);
        expect(point[1]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps topology coordinates aligned to their named shapes', () => {
    const receiptTree = topologyById('receipt_tree');
    expectSameX(receiptTree, ['requester', 'policy', 'assignment', 'agreement', 'settlement', 'ledger'], 0.5);
    expectIncreasingY(receiptTree, ['requester', 'policy', 'assignment', 'runner0', 'verifier0', 'agreement', 'settlement', 'ledger']);
    expectSameY(receiptTree, ['runner0', 'runner1', 'runner2', 'runner3']);
    expectSameY(receiptTree, ['verifier0', 'verifier1']);

    const runnerReduce = topologyById('runner_reduce');
    expectIncreasingX(runnerReduce, ['requester', 'policy', 'assignment', 'runner0', 'verifier0', 'agreement', 'settlement', 'ledger']);
    expectSameX(runnerReduce, ['runner0', 'runner1', 'runner2', 'runner3']);
    expectSameX(runnerReduce, ['verifier0', 'verifier1']);
    expectSameY(runnerReduce, ['requester', 'policy', 'assignment', 'agreement', 'settlement', 'ledger'], 0.5);

    const star = topologyById('star_rendezvous');
    expect(pointOf(star, 'assignment')).toEqual([0.5, 0.5]);
    expect(['runner0', 'runner1', 'runner2', 'runner3'].every((id) => xOf(star, id) < xOf(star, 'assignment'))).toBe(true);
    expect(yOf(star, 'runner0')).toBeLessThan(yOf(star, 'assignment'));
    expect(yOf(star, 'runner3')).toBeGreaterThan(yOf(star, 'assignment'));
    expectIncreasingX(star, ['assignment', 'verifier0', 'agreement', 'settlement', 'ledger']);

    const hourglass = topologyById('hourglass');
    expectSameX(hourglass, ['runner0', 'runner1']);
    expectSameX(hourglass, ['runner2', 'runner3']);
    expectSameY(hourglass, ['assignment', 'agreement'], 0.5);
    expect(xOf(hourglass, 'assignment')).toBeLessThan(xOf(hourglass, 'agreement'));
    expect(xOf(hourglass, 'assignment')).toBeGreaterThan(xOf(hourglass, 'runner1'));
    expect(xOf(hourglass, 'agreement')).toBeLessThan(xOf(hourglass, 'runner2'));

    const bowtie = topologyById('bowtie_exchange');
    expectSameY(bowtie, ['requester', 'policy', 'assignment', 'agreement', 'settlement', 'ledger'], 0.5);
    expectSameX(bowtie, ['runner0', 'runner1']);
    expectSameX(bowtie, ['verifier0', 'verifier1']);
    expect(yOf(bowtie, 'runner0')).toBeLessThan(yOf(bowtie, 'policy'));
    expect(yOf(bowtie, 'runner1')).toBeGreaterThan(yOf(bowtie, 'policy'));
    expect(yOf(bowtie, 'verifier0')).toBeLessThan(yOf(bowtie, 'settlement'));
    expect(yOf(bowtie, 'verifier1')).toBeGreaterThan(yOf(bowtie, 'settlement'));
    expectIncreasingX(bowtie, ['requester', 'policy', 'assignment', 'agreement', 'settlement', 'ledger']);

    const braid = topologyById('braided_lanes');
    expectIncreasingX(braid, ['requester', 'policy', 'runner0', 'assignment', 'runner2', 'verifier0', 'agreement', 'settlement', 'ledger']);
    expectSameX(braid, ['runner0', 'runner1']);
    expectSameX(braid, ['runner2', 'runner3']);
    expectSameX(braid, ['verifier0', 'verifier1']);
    expect(yOf(braid, 'runner0')).toBeLessThan(yOf(braid, 'runner1'));
    expect(yOf(braid, 'runner2')).toBeGreaterThan(yOf(braid, 'runner3'));
    expect(yOf(braid, 'verifier0')).toBeLessThan(yOf(braid, 'verifier1'));

    const triangulation = topologyById('triangulation');
    expect(yOf(triangulation, 'policy')).toBeLessThan(yOf(triangulation, 'requester'));
    expect(xOf(triangulation, 'assignment')).toBeLessThan(xOf(triangulation, 'policy'));
    expect(xOf(triangulation, 'agreement')).toBeGreaterThan(xOf(triangulation, 'policy'));
    expect(['runner0', 'runner1', 'runner2', 'runner3'].every((id) => yOf(triangulation, id) > yOf(triangulation, 'assignment'))).toBe(true);
    expect(['verifier0', 'verifier1'].every((id) => yOf(triangulation, id) > yOf(triangulation, 'runner1'))).toBe(true);
    expectIncreasingY(triangulation, ['policy', 'assignment', 'runner1', 'verifier0', 'settlement', 'ledger']);

    const honeycomb = topologyById('honeycomb');
    expectSameY(honeycomb, ['policy', 'assignment']);
    expectSameY(honeycomb, ['requester', 'runner0', 'runner1']);
    expectSameY(honeycomb, ['runner2', 'verifier0', 'runner3']);
    expectSameY(honeycomb, ['verifier1', 'agreement', 'settlement']);
    expectIncreasingX(honeycomb, ['policy', 'assignment']);
    expectIncreasingX(honeycomb, ['requester', 'runner0', 'runner1']);
    expectIncreasingX(honeycomb, ['runner2', 'verifier0', 'runner3']);
    expectIncreasingX(honeycomb, ['verifier1', 'agreement', 'settlement']);
    expect(yOf(honeycomb, 'ledger')).toBeGreaterThan(yOf(honeycomb, 'settlement'));
  });

  it('renders initial node centers from active topology coordinates with a centered view transform', () => {
    withSimulationSearch('?seed=layout-check&shape=runner_reduce', () => {
      const state = createPoolSimulationState();
      const width = 1200;
      const height = 680;
      const frame = buildPoolSimulationFrame(state, width, height, 1 / 60);
      const topology = topologyById('runner_reduce');

      for (const id of POOLDAY_GRAPH_NODE_IDS) {
        const node = frame.nodes.find((item) => item.id === id);
        const [x, y] = topology.points[id];
        expect(node.baseX).toBeCloseTo(expectedCenteredCoordinate(x, width), 8);
        expect(node.baseY).toBeCloseTo(expectedCenteredCoordinate(y, height), 8);
        expect(node.x).toBeCloseTo(expectedCenteredCoordinate(x, width), 8);
        expect(node.y).toBeCloseTo(expectedCenteredCoordinate(y, height), 8);
      }
    });
  });

  it('keeps the rendered graph content 25 percent closer to canvas center', () => {
    withSimulationSearch('?seed=centered-view&shape=runner_reduce', () => {
      const state = createPoolSimulationState();
      const width = 1200;
      const height = 680;
      const frame = buildPoolSimulationFrame(state, width, height, 1 / 60);
      const topology = topologyById('runner_reduce');
      const sourceXs = POOLDAY_GRAPH_NODE_IDS.map((id) => xOf(topology, id) * width);
      const renderedXs = frame.nodes.map((node) => node.baseX);
      const sourceWidth = Math.max(...sourceXs) - Math.min(...sourceXs);
      const renderedWidth = Math.max(...renderedXs) - Math.min(...renderedXs);

      expect(POOLDAY_GRAPH_VIEW_CENTER_PULL).toBe(0.25);
      expect(renderedWidth).toBeCloseTo(sourceWidth * 0.75, 8);
    });
  });

  it('keeps pointer shooter particles inactive until the canvas is held', () => {
    const state = createPoolSimulationState();
    const frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    const shooterParticles = frame.particles.slice(POOLDAY_FLOW_TUNING.particleCount);

    expect(shooterParticles.length).toBeGreaterThan(0);
    expect(shooterParticles.every((particle) => particle.alpha === 0 && particle.size === 0)).toBe(true);
    expect(state.pointerShots.every((shot) => shot.active === false)).toBe(true);
  });

  it('does not use pointer input to move or resize graph nodes', () => {
    withSimulationSearch('?seed=pointer-static&shape=runner_reduce', () => {
      const idleState = createPoolSimulationState();
      const heldState = createPoolSimulationState();
      heldState.pointer.targetX = 0.08;
      heldState.pointer.targetY = 0.90;
      heldState.pointer.holding = true;
      heldState.pointer.shotBurst = 6;
      heldState.pointer.moveEnergy = 1;

      const idleFrame = buildPoolSimulationFrame(idleState, 960, 640, 1 / 60);
      const heldFrame = buildPoolSimulationFrame(heldState, 960, 640, 1 / 60);

      for (let index = 0; index < idleFrame.nodes.length; index += 1) {
        expect(heldFrame.nodes[index].x).toBeCloseTo(idleFrame.nodes[index].x, 8);
        expect(heldFrame.nodes[index].y).toBeCloseTo(idleFrame.nodes[index].y, 8);
        expect(heldFrame.nodes[index].size).toBeCloseTo(idleFrame.nodes[index].size, 8);
      }
    });
  });

  it('shoots held pointer particles onto existing rendered edges', () => {
    withSimulationSearch('?seed=pointer-shooter&shape=runner_reduce', () => {
      const state = createPoolSimulationState();
      state.pointer.targetX = 0.18;
      state.pointer.targetY = 0.52;
      state.pointer.holding = true;
      state.pointer.shotBurst = 6;
      state.pointer.moveEnergy = 0.75;
      const width = 960;
      const height = 640;
      const step = 1 / 60;
      let frame = null;

      for (let index = 0; index < 18; index += 1) {
        frame = buildPoolSimulationFrame(state, width, height, step);
      }

      const shot = state.pointerShots.find((candidate) => candidate.active && candidate.age > 0.20);
      expect(shot).toBeTruthy();
      const particle = frame.particles[POOLDAY_FLOW_TUNING.particleCount + shot.index];
      const line = frame.lines[shot.lineIndex % frame.lines.length];
      const flowScale = 0.72 + frame.flowEnergy * 0.42;
      const edgeProgress = clamp01(
        shot.start + shot.direction * shot.age * shot.speed * (line.speed || 1) * flowScale * 0.38
      );
      const edgePoint = resolveLinePoint(line, edgeProgress, width, height);

      expect(particle.alpha).toBeGreaterThan(0);
      expect(Math.hypot(particle.x - edgePoint.x, particle.y - edgePoint.y)).toBeLessThan(4);
    });
  });

  it('resets frame delta after resume gaps', () => {
    expect(resolvePoolFrameDeltaMs(SIMULATION_TARGET_STEP_MS, false)).toBe(SIMULATION_TARGET_STEP_MS);
    expect(resolvePoolFrameDeltaMs(SIMULATION_MAX_STEP_MS * 2, false)).toBe(SIMULATION_MAX_STEP_MS);
    expect(resolvePoolFrameDeltaMs(SIMULATION_MAX_STEP_MS * 8, false)).toBe(SIMULATION_TARGET_STEP_MS);
    expect(resolvePoolFrameDeltaMs(SIMULATION_TARGET_STEP_MS, true)).toBe(SIMULATION_TARGET_STEP_MS);
  });

  it('clamps large simulation steps instead of catching up elapsed wall time', () => {
    const state = createPoolSimulationState();

    buildPoolSimulationFrame(state, 960, 640, 60 * 60);

    expect(state.time).toBeLessThan(0.1);
  });

  it('keeps flow speed and width bounded across repeated frames', () => {
    const state = createPoolSimulationState();
    let maxSpeed = 0;
    let maxWidth = 0;
    let maxExpectedSpeed = 0;
    let maxExpectedWidth = 0;

    for (let index = 0; index < 2400; index += 1) {
      const frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
      const orbitCue = easeInOutCubic(frame.topologyCue);
      for (const line of frame.lines) {
        const expectedSpeed = (line.baseSpeed || line.speed) * (1 + orbitCue * 0.16);
        const expectedWidth = (line.baseWidth || line.width) * (1 + orbitCue * 0.08);
        maxSpeed = Math.max(maxSpeed, line.speed || 0);
        maxWidth = Math.max(maxWidth, line.width || 0);
        maxExpectedSpeed = Math.max(maxExpectedSpeed, expectedSpeed);
        maxExpectedWidth = Math.max(maxExpectedWidth, expectedWidth);
        expect(line.speed).toBeCloseTo(expectedSpeed, 8);
        expect(line.width).toBeCloseTo(expectedWidth, 8);
      }
    }

    expect(maxSpeed).toBeCloseTo(maxExpectedSpeed, 8);
    expect(maxWidth).toBeCloseTo(maxExpectedWidth, 8);
  });

  it('keeps topology node centers still through the opening hold plateau', () => {
    withSimulationSearch('?seed=layout-check&shape=receipt_tree', () => {
      const state = createPoolSimulationState();
      const width = 1200;
      const height = 680;
      const step = 1 / 60;
      const sampleFrames = Math.floor((POOLDAY_MORPH_TUNING.stableHoldSpan / SIMULATION_GENTLE_SPEED) / step);
      const firstFrame = buildPoolSimulationFrame(state, width, height, step);
      const initialNodes = new Map(firstFrame.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
      let frame = firstFrame;
      let maxHoldDelta = 0;

      for (let index = 1; index < sampleFrames; index += 1) {
        frame = buildPoolSimulationFrame(state, width, height, step);
        for (const node of frame.nodes) {
          const initial = initialNodes.get(node.id);
          maxHoldDelta = Math.max(maxHoldDelta, Math.hypot(node.x - initial.x, node.y - initial.y));
        }
      }

      expect(frame.transitionActive).toBe(false);
      expect(frame.anticipation).toBeLessThanOrEqual(0.001);
      expect(frame.anchorMotionScale).toBeLessThanOrEqual(0.001);
      expect(maxHoldDelta).toBeLessThanOrEqual(1);

      let maxReleasedDelta = maxHoldDelta;
      for (let index = 0; index < 90; index += 1) {
        frame = buildPoolSimulationFrame(state, width, height, step);
        for (const node of frame.nodes) {
          const initial = initialNodes.get(node.id);
          maxReleasedDelta = Math.max(maxReleasedDelta, Math.hypot(node.x - initial.x, node.y - initial.y));
        }
      }

      expect(frame.anchorMotionScale).toBeGreaterThan(0);
      expect(maxReleasedDelta).toBeGreaterThan(2);
    });
  });

  it('does not snap node centers when a topology transition settles', () => {
    withSimulationSearch('?seed=snap-check&shape=runner_reduce', () => {
      const state = createPoolSimulationState();
      const width = 1200;
      const height = 680;
      const step = 1 / 60;
      let previousNodes = null;
      let previousTransitionActive = false;
      let handoffFrame = null;
      let handoffMaxDelta = 0;

      for (let frameIndex = 0; frameIndex < 1800; frameIndex += 1) {
        const frame = buildPoolSimulationFrame(state, width, height, step);
        if (previousNodes && previousTransitionActive && !frame.transitionActive) {
          handoffFrame = frame;
          for (const node of frame.nodes) {
            const previous = previousNodes.get(node.id);
            handoffMaxDelta = Math.max(
              handoffMaxDelta,
              Math.hypot(node.x - previous.x, node.y - previous.y)
            );
          }
          break;
        }
        previousNodes = new Map(frame.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
        previousTransitionActive = frame.transitionActive;
      }

      expect(handoffFrame).toBeTruthy();
      expect(handoffFrame.transitionActive).toBe(false);
      expect(handoffFrame.transitionRelease).toBeCloseTo(1, 8);
      expect(handoffFrame.anchorMotionScale).toBeGreaterThan(0.95);
      expect(handoffMaxDelta).toBeLessThan(2.5);

      for (let frameIndex = 0; frameIndex < 120; frameIndex += 1) {
        handoffFrame = buildPoolSimulationFrame(state, width, height, step);
      }

      expect(handoffFrame.transitionRelease).toBeLessThan(0.05);
    });
  });

  it('wraps visual motion time while preserving topology schedule time', () => {
    const state = createPoolSimulationState();
    state.motionTime = SIMULATION_MOTION_CLOCK_WRAP_SECONDS - 0.01;
    state.time = 120;

    buildPoolSimulationFrame(state, 960, 640, 1);

    expect(state.motionTime).toBeGreaterThanOrEqual(0);
    expect(state.motionTime).toBeLessThan(SIMULATION_MOTION_CLOCK_WRAP_SECONDS);
    expect(state.time).toBeGreaterThan(120);
  });
});
