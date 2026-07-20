import { describe, expect, it } from 'vitest';

import {
  buildPoolSimulationFrame,
  clamp01,
  createPoolSimulationState,
  easeInOutCubic,
  resolveLinePoint,
  resizePoolCanvas,
  setPoolSimulationNetworkVisualState,
  setPoolSimulationRunVisualState
} from '../../self/ui/pool-home/simulation-core.js';
import { resolvePoolFrameDeltaMs } from '../../self/ui/pool-home/simulation-bind.js';
import { createPoolRenderBatchBuilder } from '../../self/ui/pool-home/simulation-batches.js';
import {
  SIMULATION_MAX_STEP_MS,
  SIMULATION_MAX_CANVAS_PIXELS,
  SIMULATION_GENTLE_SPEED,
  SIMULATION_MOTION_CLOCK_WRAP_SECONDS,
  POOLDAY_MORPH_TUNING,
  POOLDAY_FLOW_TUNING,
  POOLDAY_GRAPH_VIEW_CENTER_PULL,
  POOLDAY_GRAPH_VIEW_MARGIN_PX,
  POOLDAY_GRAPH_NODE_IDS,
  POOLDAY_GRAPH_TOPOLOGIES,
  POOLDAY_HOT_PATH_STEPS,
  POOLDAY_RENDERER_LINE_SEGMENTS,
  SIMULATION_TARGET_STEP_MS
} from '../../self/ui/pool-home/constants.js';
import { buildSimulationLineSpecs } from '../../self/ui/pool-home/simulation-flow-specs.js';
import {
  parsePoolRendererCssColor,
  resolvePoolRendererClearColor
} from '../../self/ui/pool-home/simulation-renderer.js';
import {
  rgbToHsl,
  hslToRgb,
  lerpHue
} from '../../self/ui/pool-home/simulation-frame-state.js';

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
const topologySymmetryTransforms = Object.freeze({
  'x-axis': ([x, y]) => [x, 1 - y],
  'y-axis': ([x, y]) => [1 - x, y],
  rotational: ([x, y]) => [1 - x, 1 - y]
});
const coordinateKey = ([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
const edgeCoordinateKey = (from, to) => [coordinateKey(from), coordinateKey(to)].sort().join('|');
const sortedMultiset = (values) => [...values].sort();

const maxFillAlpha = (batch) => {
  let maxAlpha = 0;
  for (let index = 5; index < batch.length; index += 6) {
    maxAlpha = Math.max(maxAlpha, batch.data[index]);
  }
  return maxAlpha;
};
const expectedCenteredCoordinate = (value, size) => (
  POOLDAY_GRAPH_VIEW_MARGIN_PX
  + (0.5 + (value - 0.5) * (1 - POOLDAY_GRAPH_VIEW_CENTER_PULL))
    * Math.max(0, size - POOLDAY_GRAPH_VIEW_MARGIN_PX * 2)
);

describe('pool home simulation performance contracts', () => {
  it('resolves renderer clear colors from CSS as an opaque page surface', () => {
    expect(parsePoolRendererCssColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parsePoolRendererCssColor('rgb(255 255 255 / 96%)')).toEqual({
      r: 1,
      g: 1,
      b: 1,
      a: 0.96
    });

    const home = {};
    const canvas = { closest: () => home };
    const clearColor = resolvePoolRendererClearColor(canvas, (element) => {
      if (element === canvas) return { backgroundColor: 'rgba(0, 0, 0, 0)' };
      if (element === home) return { backgroundColor: 'rgb(255 255 255)' };
      return null;
    });

    expect(clearColor).toEqual({ r: 1, g: 1, b: 1, a: 1 });

    const flattenedColor = resolvePoolRendererClearColor(canvas, () => ({
      backgroundColor: 'rgb(240 248 255 / 50%)'
    }));
    expect(flattenedColor.r).toBeCloseTo((240 / 255) * 0.5 + 0.5, 8);
    expect(flattenedColor.g).toBeCloseTo((248 / 255) * 0.5 + 0.5, 8);
    expect(flattenedColor.b).toBe(1);
    expect(flattenedColor.a).toBe(1);
  });

  it('resizes from cached CSS dimensions without reading layout', () => {
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect() {
        throw new Error('layout should stay cached during RAF');
      }
    };

    const result = resizePoolCanvas(canvas, { width: 1440, height: 900 });

    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.width * result.height).toBeLessThanOrEqual(SIMULATION_MAX_CANVAS_PIXELS);
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

  it('reuses render batch containers and typed array buffers across ticks', () => {
    const state = createPoolSimulationState();
    const buildBatches = createPoolRenderBatchBuilder();
    const firstFrame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    firstFrame.renderQuality = 1;
    const first = buildBatches(firstFrame, 960, 640);
    const batchRefs = first.map((batch) => batch);
    const batchBuffers = first.map((batch) => batch.data.buffer);
    const batchKinds = first.map((batch) => batch.kind);
    const secondFrame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    secondFrame.renderQuality = 1;
    const second = buildBatches(secondFrame, 960, 640);

    expect(second).toBe(first);
    expect(second.map((batch) => batch.kind)).toEqual(batchKinds);
    for (let index = 0; index < batchRefs.length; index += 1) {
      expect(second[index]).toBe(batchRefs[index]);
      expect(second[index].data.buffer).toBe(batchBuffers[index]);
    }
  });

  it('reduces nonessential render detail below full quality', () => {
    const state = createPoolSimulationState();
    const frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    // Force larger curves on test lines to guarantee segment count differences
    for (const line of frame.lines) {
      line.curve = 0.15;
      line.signedCurve = 0.15;
    }
    frame.renderQuality = 1;
    const fullBatches = createPoolRenderBatchBuilder()(frame, 960, 640);
    frame.renderQuality = 0.62;
    const lowBatches = createPoolRenderBatchBuilder()(frame, 960, 640);
    const fullFloats = fullBatches.reduce((sum, batch) => sum + batch.length, 0);
    const lowFloats = lowBatches.reduce((sum, batch) => sum + batch.length, 0);

    expect(lowFloats).toBeLessThan(fullFloats);
    expect(lowBatches.length).toBe(fullBatches.length);
  });

  it('keeps graph primitives to simple edges, compact nodes, and non-shimmer particles', () => {
    const state = createPoolSimulationState();
    const frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    frame.renderQuality = 1;
    frame.countdownProgress = 1;
    for (const line of frame.lines) line.pulse = 1;
    const batches = createPoolRenderBatchBuilder()(frame, 960, 640);
    const circleFloatCount = 6 * 9;
    const antialiasedLineFloatCount = 6 * 3 * 6;
    const activeParticles = frame.particles.filter((particle) => particle.alpha > 0 && particle.size > 0).length;

    expect(batches.map((batch) => batch.kind)).toEqual(['fill', 'circle']);
    expect(batches[0].length % antialiasedLineFloatCount).toBe(0);
    expect(batches[0].length).toBeLessThanOrEqual(frame.lines.length * POOLDAY_RENDERER_LINE_SEGMENTS * antialiasedLineFloatCount);
    expect(batches[0].length).toBeGreaterThanOrEqual(frame.lines.length * 4 * antialiasedLineFloatCount);
    expect(batches[1].length).toBe((activeParticles + frame.nodes.length) * circleFloatCount);
    expect(batches.reduce((sum, batch) => sum + batch.length, 0)).toBeLessThan(50_000);
  });

  it('crossfades real room participants through hybrid and live-only modes', () => {
    const state = createPoolSimulationState();
    setPoolSimulationNetworkVisualState(state, {
      mode: 'hybrid',
      peerCount: 2,
      providerCount: 1,
      messageCount: 3,
      liveParticipantCount: 2,
      participants: [
        { id: 'provider-a', provider: true },
        { id: 'peer-a', provider: false }
      ],
      recent: [{ type: 'provider-advert', fromPeerId: 'provider-a' }]
    });

    let frame;
    for (let index = 0; index < 60; index += 1) {
      frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    }
    const hybridParticipants = frame.nodes.filter((node) => !node.core);
    expect(frame.networkMode).toBe('hybrid');
    expect(hybridParticipants.slice(0, 2).every((node) => node.liveWeight === 1)).toBe(true);
    expect(hybridParticipants.slice(2).every((node) => node.liveWeight === 0)).toBe(true);
    expect(hybridParticipants[0]).toMatchObject({
      liveId: 'provider-a',
      liveProvider: true
    });
    expect(frame.labelAnchors.runner0.labelBody).toContain('Live contributor provider-a');

    setPoolSimulationNetworkVisualState(state, {
      mode: 'live',
      peerCount: 7,
      providerCount: 4,
      messageCount: 2,
      liveParticipantCount: 6,
      participants: Array.from({ length: 6 }, (_, index) => ({
        id: `live-${index}`,
        provider: index < 4
      })),
      recent: []
    });
    for (let index = 0; index < 80; index += 1) {
      frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    }
    const liveParticipants = frame.nodes.filter((node) => !node.core);
    const activeFlowParticles = frame.particles
      .slice(0, POOLDAY_FLOW_TUNING.particleCount)
      .filter((particle) => particle.alpha > 0 && particle.size > 0);
    expect(frame.networkMode).toBe('live');
    expect(frame.networkLiveMix).toBe(1);
    expect(liveParticipants.every((node) => node.liveWeight === 1)).toBe(true);
    expect(activeFlowParticles.length).toBeLessThanOrEqual(2);
  });

  it('keeps node anchors static without core breathing or participant drift', () => {
    const state = createPoolSimulationState();
    let frame = null;

    for (let index = 0; index < 180; index += 1) {
      frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
      for (const node of frame.nodes) {
        expect(node.offsetX).toBe(0);
        expect(node.offsetY).toBe(0);
        expect(node.x).toBe(node.baseX);
        expect(node.y).toBe(node.baseY);
        expect(node.halo).toBe(0);
        if (node.core) {
          expect(node.pulse).toBe(0);
        }
      }
    }
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
    expect(labelCounts.Prompt).toBe(1);
    expect(labelCounts.Policy).toBe(1);
    expect(labelCounts.Match).toBe(1);
    expect(labelCounts.Infer).toBeGreaterThanOrEqual(4);
    expect(labelCounts.Verify).toBeGreaterThanOrEqual(3);
    expect(labelCounts.Answer).toBeGreaterThanOrEqual(2);
    expect(labelCounts.Request || 0).toBe(0);
    expect(labelCounts.History || 0).toBe(0);
    expect(stages.size).toBe(6);
  });

  it('keeps the idle graph quiet and follows reported run phases', () => {
    const state = createPoolSimulationState();
    let frame = buildPoolSimulationFrame(state, 1200, 680, 1 / 60);

    expect(frame.hotPath.steps).toBe(POOLDAY_HOT_PATH_STEPS);
    expect(frame.hotPath.activeStepId).toBe('');
    expect(frame.hotPath.activeIds).toEqual([]);
    expect(frame.nodes.every((node) => !node.hotPathActive)).toBe(true);

    setPoolSimulationRunVisualState(state, { state: 'running', phase: 'prompt' });
    frame = buildPoolSimulationFrame(state, 1200, 680, 1 / 60);
    expect(frame.hotPath.activeStepId).toBe('prompt');
    expect(frame.hotPath.activeIds).toEqual(['requester']);
    expect(frame.nodes.find((node) => node.id === 'requester').hotPathActive).toBe(true);
    expect(frame.lines.some((line) => line.hotPathActive)).toBe(true);

    setPoolSimulationRunVisualState(state, { state: 'running', phase: 'infer' });
    frame = buildPoolSimulationFrame(state, 1200, 680, 1 / 60);
    expect(frame.hotPath.activeStepId).toBe('infer');
    expect(frame.hotPath.activeIds).toEqual(['runner0', 'runner1', 'runner2', 'runner3']);
    expect(frame.nodes.filter((node) => node.hotPathActive).map((node) => node.id).sort()).toEqual([
      'runner0',
      'runner1',
      'runner2',
      'runner3'
    ]);
  });

  it('renders active hot path edges with stronger line data', () => {
    const state = createPoolSimulationState();
    setPoolSimulationRunVisualState(state, { state: 'running', phase: 'prompt' });
    const frame = buildPoolSimulationFrame(state, 960, 640, 1 / 60);
    frame.renderQuality = 1;
    const activeBatches = createPoolRenderBatchBuilder()(frame, 960, 640);
    const activeLineAlpha = maxFillAlpha(activeBatches[0]);

    for (const line of frame.lines) line.hotPathActive = false;
    for (const node of frame.nodes) node.hotPathActive = false;
    const inactiveBatches = createPoolRenderBatchBuilder()(frame, 960, 640);
    const inactiveLineAlpha = maxFillAlpha(inactiveBatches[0]);

    expect(activeLineAlpha).toBeGreaterThan(inactiveLineAlpha);
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

  it('keeps every edge preset symmetric under its declared coordinate transform', () => {
    for (const topology of POOLDAY_GRAPH_TOPOLOGIES) {
      if (topology.symmetry === 'none') continue;
      const transform = topologySymmetryTransforms[topology.symmetry];
      expect(transform, `${topology.id} must declare a supported symmetry`).toBeTypeOf('function');

      const nodeCoordinates = sortedMultiset(Object.values(topology.points).map(coordinateKey));
      const transformedNodeCoordinates = sortedMultiset(
        Object.values(topology.points).map((point) => coordinateKey(transform(point)))
      );
      const lineSpecs = buildSimulationLineSpecs(topology.edgePreset);
      const edgeCoordinates = sortedMultiset(lineSpecs.map((spec) => edgeCoordinateKey(
        topology.points[spec.fromId],
        topology.points[spec.toId]
      )));
      const transformedEdgeCoordinates = sortedMultiset(lineSpecs.map((spec) => edgeCoordinateKey(
        transform(topology.points[spec.fromId]),
        transform(topology.points[spec.toId])
      )));

      expect(transformedNodeCoordinates, `${topology.id} node coordinates`).toEqual(nodeCoordinates);
      expect(transformedEdgeCoordinates, `${topology.id} edge coordinates and lane counts`).toEqual(edgeCoordinates);
      expect(
        Object.values(topology.points).some((point) => coordinateKey(transform(point)) !== coordinateKey(point)),
        `${topology.id} symmetry must move at least one node`
      ).toBe(true);
    }
  });

  it('keeps topology coordinates aligned to their named shapes', () => {
    const receiptTree = topologyById('receipt_tree');
    expectSameY(receiptTree, ['policy', 'assignment', 'agreement', 'settlement']);
    expectSameY(receiptTree, ['runner0', 'runner1', 'runner2', 'runner3', 'verifier0', 'verifier1']);
    expect(yOf(receiptTree, 'requester')).toBeLessThan(yOf(receiptTree, 'policy'));
    expect(yOf(receiptTree, 'policy')).toBeLessThan(yOf(receiptTree, 'runner0'));
    expect(yOf(receiptTree, 'runner0')).toBeLessThan(yOf(receiptTree, 'ledger'));

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
    expectSameY(hourglass, ['requester', 'policy', 'assignment', 'agreement', 'settlement', 'ledger'], 0.5);
    expect(yOf(hourglass, 'runner0')).toBeCloseTo(1 - yOf(hourglass, 'runner1'), 8);
    expect(yOf(hourglass, 'runner2')).toBeCloseTo(1 - yOf(hourglass, 'runner3'), 8);
    expect(yOf(hourglass, 'verifier0')).toBeCloseTo(1 - yOf(hourglass, 'verifier1'), 8);
    expect(xOf(hourglass, 'assignment')).toBeLessThan(xOf(hourglass, 'agreement'));
    expect(xOf(hourglass, 'assignment')).toBeGreaterThan(xOf(hourglass, 'runner1'));
    expect(xOf(hourglass, 'agreement')).toBeLessThan(xOf(hourglass, 'runner2'));

    const bowtie = topologyById('bowtie_exchange');
    expectSameY(bowtie, ['requester', 'policy', 'assignment', 'agreement', 'settlement', 'ledger'], 0.5);
    expectSameX(bowtie, ['runner0', 'runner1']);
    expectSameX(bowtie, ['runner2', 'runner3']);
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
    expectSameX(triangulation, ['policy', 'requester', 'settlement', 'ledger'], 0.5);
    expect(xOf(triangulation, 'assignment')).toBeLessThan(xOf(triangulation, 'policy'));
    expect(xOf(triangulation, 'agreement')).toBeGreaterThan(xOf(triangulation, 'policy'));
    expect(xOf(triangulation, 'assignment')).toBeCloseTo(1 - xOf(triangulation, 'agreement'), 8);
    expect(xOf(triangulation, 'runner0')).toBeCloseTo(1 - xOf(triangulation, 'runner3'), 8);
    expect(xOf(triangulation, 'runner1')).toBeCloseTo(1 - xOf(triangulation, 'runner2'), 8);
    expect(xOf(triangulation, 'verifier0')).toBeCloseTo(1 - xOf(triangulation, 'verifier1'), 8);
    expect(['runner0', 'runner1', 'runner2', 'runner3'].every((id) => yOf(triangulation, id) > yOf(triangulation, 'assignment'))).toBe(true);
    expect(['verifier0', 'verifier1'].every((id) => yOf(triangulation, id) > yOf(triangulation, 'runner1'))).toBe(true);
    expectIncreasingY(triangulation, ['policy', 'assignment', 'runner1', 'verifier0', 'settlement', 'ledger']);

    const honeycomb = topologyById('honeycomb');
    expectSameY(honeycomb, ['policy', 'assignment']);
    expectSameY(honeycomb, ['requester', 'runner0', 'runner1']);
    expectSameY(honeycomb, ['verifier0', 'verifier1'], 0.5);
    expectSameY(honeycomb, ['runner2', 'runner3', 'ledger']);
    expectSameY(honeycomb, ['agreement', 'settlement']);
    expectIncreasingX(honeycomb, ['policy', 'assignment']);
    expectIncreasingX(honeycomb, ['requester', 'runner0', 'runner1']);
    expectIncreasingX(honeycomb, ['runner2', 'runner3', 'ledger']);
    expectIncreasingX(honeycomb, ['agreement', 'settlement']);
    expect(xOf(honeycomb, 'requester')).toBeCloseTo(1 - xOf(honeycomb, 'ledger'), 8);
    expect(yOf(honeycomb, 'requester')).toBeCloseTo(1 - yOf(honeycomb, 'ledger'), 8);
    expect(xOf(honeycomb, 'policy')).toBeCloseTo(1 - xOf(honeycomb, 'settlement'), 8);
    expect(yOf(honeycomb, 'policy')).toBeCloseTo(1 - yOf(honeycomb, 'settlement'), 8);

    const dodecagon = topologyById('dodecagon');
    expect(xOf(dodecagon, 'runner3')).toBeCloseTo(0.10, 3);
    expect(xOf(dodecagon, 'requester')).toBeCloseTo(0.90, 3);
    expect(yOf(dodecagon, 'runner0')).toBeCloseTo(0.90, 3);
    expect(yOf(dodecagon, 'agreement')).toBeCloseTo(0.10, 3);
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
      const sourceXs = POOLDAY_GRAPH_NODE_IDS.map((id) => xOf(topology, id) * Math.max(0, width - POOLDAY_GRAPH_VIEW_MARGIN_PX * 2));
      const renderedXs = frame.nodes.map((node) => node.baseX);
      const sourceWidth = Math.max(...sourceXs) - Math.min(...sourceXs);
      const renderedWidth = Math.max(...renderedXs) - Math.min(...renderedXs);

      expect(POOLDAY_GRAPH_VIEW_CENTER_PULL).toBe(0.25);
      expect(renderedWidth).toBeCloseTo(sourceWidth * 0.75, 8);
    });
  });

  it('keeps every node center at least 64 pixels from each canvas edge', () => {
    for (const topology of POOLDAY_GRAPH_TOPOLOGIES) {
      withSimulationSearch(`?seed=margin-check&shape=${topology.id}`, () => {
        const state = createPoolSimulationState();
        const width = 1200;
        const height = 680;
        const frame = buildPoolSimulationFrame(state, width, height, 1 / 60);

        for (const node of frame.nodes) {
          expect(node.baseX).toBeGreaterThanOrEqual(POOLDAY_GRAPH_VIEW_MARGIN_PX);
          expect(node.baseX).toBeLessThanOrEqual(width - POOLDAY_GRAPH_VIEW_MARGIN_PX);
          expect(node.baseY).toBeGreaterThanOrEqual(POOLDAY_GRAPH_VIEW_MARGIN_PX);
          expect(node.baseY).toBeLessThanOrEqual(height - POOLDAY_GRAPH_VIEW_MARGIN_PX);
        }
      });
    }
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
      const topologyEase = easeInOutCubic(frame.topologyCue);
      for (const line of frame.lines) {
        const expectedSpeed = (line.baseSpeed || line.speed) * (1 + topologyEase * 0.16);
        const expectedWidth = (line.baseWidth || line.width) * (1 + topologyEase * 0.08);
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
  }, 15000);

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
      expect(frame.layoutMotionScale).toBeLessThanOrEqual(0.001);
      expect(maxHoldDelta).toBeLessThanOrEqual(1);

      let maxReleasedDelta = maxHoldDelta;
      for (let index = 0; index < 90; index += 1) {
        frame = buildPoolSimulationFrame(state, width, height, step);
        for (const node of frame.nodes) {
          const initial = initialNodes.get(node.id);
          maxReleasedDelta = Math.max(maxReleasedDelta, Math.hypot(node.x - initial.x, node.y - initial.y));
        }
      }

      expect(frame.layoutMotionScale).toBeGreaterThan(0);
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
      expect(handoffFrame.layoutMotionScale).toBeGreaterThan(0.95);
      expect(handoffMaxDelta).toBeLessThan(2.5);

      for (let frameIndex = 0; frameIndex < 120; frameIndex += 1) {
        handoffFrame = buildPoolSimulationFrame(state, width, height, step);
      }

      expect(handoffFrame.transitionRelease).toBeLessThan(0.05);
    });
  });

  it('carries cue progress into topology transitions without dropping ring effects', () => {
    withSimulationSearch('?seed=cue-check&shape=runner_reduce', () => {
      const state = createPoolSimulationState();
      const width = 1200;
      const height = 680;
      const step = 1 / 60;
      let previousFrame = null;
      let transitionStartFrame = null;
      let previousCountdown = 0;

      for (let frameIndex = 0; frameIndex < 1800; frameIndex += 1) {
        const frame = buildPoolSimulationFrame(state, width, height, step);
        if (previousFrame && !previousFrame.transitionActive && frame.transitionActive) {
          transitionStartFrame = frame;
          previousCountdown = previousFrame.countdownProgress;
          break;
        }
        previousFrame = { ...frame };
      }

      expect(transitionStartFrame).toBeTruthy();
      expect(previousCountdown).toBeGreaterThan(0.80);
      expect(transitionStartFrame.countdownProgress).toBeGreaterThan(0.80);
      expect(Math.abs(transitionStartFrame.countdownProgress - previousCountdown)).toBeLessThan(0.12);
      expect(transitionStartFrame.topologyCue).toBeGreaterThan(0.80);
    });
  });

  it('uses a faster visual topology transition while preserving the schedule interval', () => {
    withSimulationSearch('?seed=transition-speed&shape=runner_reduce', () => {
      const state = createPoolSimulationState();
      const step = 1 / 60;
      let transitionFrame = null;

      for (let frameIndex = 0; frameIndex < 1800; frameIndex += 1) {
        const frame = buildPoolSimulationFrame(state, 1200, 680, step);
        if (frame.transitionActive) {
          transitionFrame = frame;
          break;
        }
      }

      expect(transitionFrame).toBeTruthy();
      expect(state.layout.transition.span).toBeCloseTo(
        POOLDAY_MORPH_TUNING.floatSpan * POOLDAY_MORPH_TUNING.visualSpanScale,
        8
      );
      expect(state.layout.scheduleSpan).toBeGreaterThanOrEqual(
        (POOLDAY_MORPH_TUNING.floatSpan + POOLDAY_MORPH_TUNING.floatHold) * POOLDAY_MORPH_TUNING.scheduleSpanScale
      );
      expect(state.layout.scheduleSpan).toBeLessThanOrEqual(
        (
          POOLDAY_MORPH_TUNING.floatSpan
          + POOLDAY_MORPH_TUNING.floatHold
          + POOLDAY_MORPH_TUNING.holdJitter
        ) * POOLDAY_MORPH_TUNING.scheduleSpanScale
      );
    });
  });

  it('settles topology transitions to canonical edge presets without retaining faded lines', () => {
    withSimulationSearch('?seed=edge-settle-check&shape=runner_reduce', () => {
      const state = createPoolSimulationState();
      const width = 1200;
      const height = 680;
      const step = 1 / 60;
      let previousTransitionActive = false;
      let settledTransitions = 0;

      for (let frameIndex = 0; frameIndex < 5200 && settledTransitions < 4; frameIndex += 1) {
        const frame = buildPoolSimulationFrame(state, width, height, step);
        if (previousTransitionActive && !frame.transitionActive) {
          const expectedSpecs = buildSimulationLineSpecs(state.layout.edgePreset);
          expect(state.layout.edgeSpecs).toHaveLength(expectedSpecs.length);
          expect(state.layout.edgeSpecs.map((spec) => spec.routeId)).toEqual(expectedSpecs.map((spec) => spec.routeId));
          expect(state.layout.edgeSpecs.every((spec) => (spec.alpha ?? 1) > 0 && (spec.flowAlpha ?? 1) > 0)).toBe(true);
          settledTransitions += 1;
        }
        previousTransitionActive = frame.transitionActive;
      }

      expect(settledTransitions).toBe(4);
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

  it('correctly converts between RGB and HSL and interpolates hue smoothly', () => {
    // Roundtrip verification
    const colors = [
      [246, 82, 118],
      [105, 210, 153],
      [174, 122, 238]
    ];
    for (const [r, g, b] of colors) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [r2, g2, b2] = hslToRgb(h, s, l);
      expect(r2).toBeCloseTo(r, 0);
      expect(g2).toBeCloseTo(g, 0);
      expect(b2).toBeCloseTo(b, 0);
    }

    // Hue shortest path verification
    expect(lerpHue(10, 350, 0.5)).toBe(0); // Shortest path passes through 0/360: (10 + -20 * 0.5 + 360) % 360 = 0
    expect(lerpHue(350, 10, 0.5)).toBe(0);
    expect(lerpHue(100, 200, 0.5)).toBe(150);
  });
});
