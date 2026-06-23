import { describe, expect, it } from 'vitest';

import {
  buildPoolSimulationFrame,
  createPoolSimulationState,
  resizePoolCanvas
} from '../../self/ui/pool-home/simulation-core.js';

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

  it('labels a 12 node staged graph with duplicated peer roles', () => {
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
    expect(labelCounts.Consumer).toBeGreaterThanOrEqual(2);
    expect(labelCounts.Producer).toBeGreaterThanOrEqual(2);
    expect(labelCounts.Provider).toBeGreaterThanOrEqual(2);
    expect(labelCounts.Verifier).toBeGreaterThanOrEqual(2);
    expect(stages.size).toBeGreaterThanOrEqual(4);
  });
});
