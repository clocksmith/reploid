/**
 * @fileoverview DOM binding for the Reploid graph simulation.
 */

import { createPoolSimulationRenderer } from './simulation-renderer.js';
import { drawPoolSimulation2D } from './simulation-2d.js';
import { createPoolRenderBatchBuilder } from './simulation-batches.js';
import {
  buildPoolSimulationFrame,
  clampRange,
  createPoolSimulationState,
  resizePoolCanvas
} from './simulation-core.js';
import { SIMULATION_MAX_STEP_MS, SIMULATION_RESUME_GAP_MS, SIMULATION_TARGET_STEP_MS } from './constants.js';

const LABEL_STYLE_EPSILON_PERCENT = 0.025;

export const resolvePoolFrameDeltaMs = (rawDeltaMs, forceReset = false) => {
  if (
    forceReset
    || !Number.isFinite(rawDeltaMs)
    || rawDeltaMs <= 0
    || rawDeltaMs > SIMULATION_RESUME_GAP_MS
  ) {
    return SIMULATION_TARGET_STEP_MS;
  }
  return Math.min(SIMULATION_MAX_STEP_MS, rawDeltaMs);
};

export const bindHomeSimulation = async (mount) => {
  let canvas = mount.querySelector('[data-pool-simulation]');
  if (!canvas) return;
  if (window.REPLOID_POOL_SIMULATION_STOP) {
    window.REPLOID_POOL_SIMULATION_STOP();
    window.REPLOID_POOL_SIMULATION_STOP = null;
  }
  const state = createPoolSimulationState();
  const buildPoolRenderBatches = createPoolRenderBatchBuilder();
  let active = true;
  let frameId = null;
  let renderer = null;
  let removeCanvasListeners = () => {};
  let canvasRect = null;
  let canvasCssSize = { width: 0, height: 0 };
  let layoutFrameId = null;
  let resizeObserver = null;
  let resetFrameClock = true;
  const flowLabels = [...mount.querySelectorAll('[data-pool-flow-label]')];
  const simulationShell = mount.querySelector('.pool-simulation-shell') || mount;
  const tooltip = mount.querySelector('[data-pool-tooltip]');
  const tooltipTitle = tooltip?.querySelector('[data-pool-tooltip-title]');
  const tooltipBody = tooltip?.querySelector('[data-pool-tooltip-body]');
  let activeTooltipLabel = null;
  const labelPositions = new Map();
  let labelCanvasSize = null;
  let tooltipMetrics = null;
  const refreshTooltipMetrics = () => {
    const shellBox = simulationShell.getBoundingClientRect();
    const tooltipBox = tooltip?.getBoundingClientRect();
    tooltipMetrics = {
      shellWidth: shellBox.width,
      shellHeight: shellBox.height,
      tooltipWidth: tooltipBox?.width || 280,
      tooltipHeight: tooltipBox?.height || 112
    };
  };
  const updateTooltipPosition = (refresh = false) => {
    if (!tooltip || !activeTooltipLabel) return;
    if (refresh || !tooltipMetrics) refreshTooltipMetrics();
    const metrics = tooltipMetrics || {
      shellWidth: simulationShell.clientWidth || 1,
      shellHeight: simulationShell.clientHeight || 1,
      tooltipWidth: 280,
      tooltipHeight: 112
    };
    const padding = 16;
    const labelPosition = labelPositions.get(activeTooltipLabel.dataset.poolFlowLabel);
    const anchorX = labelPosition
      ? (labelPosition.x / 100) * metrics.shellWidth
      : metrics.shellWidth * 0.5;
    const anchorY = labelPosition
      ? (labelPosition.y / 100) * metrics.shellHeight
      : metrics.shellHeight * 0.5;
    const hasRoomAbove = anchorY > metrics.tooltipHeight + padding * 2;
    const placement = hasRoomAbove ? 'above' : 'below';
    const rawTop = placement === 'above'
      ? anchorY - 13
      : anchorY + 13;
    tooltip.dataset.placement = placement;
    tooltip.style.setProperty('--tooltip-x', `${clampRange(anchorX, metrics.tooltipWidth / 2 + padding, Math.max(metrics.tooltipWidth / 2 + padding, metrics.shellWidth - metrics.tooltipWidth / 2 - padding))}px`);
    tooltip.style.setProperty('--tooltip-y', `${clampRange(rawTop, padding, Math.max(padding, metrics.shellHeight - padding))}px`);
  };
  const showTooltip = (label) => {
    if (!tooltip || !tooltipTitle || !tooltipBody) return;
    activeTooltipLabel?.classList.remove('is-tooltip-active');
    activeTooltipLabel = label;
    tooltipTitle.textContent = label.dataset.tooltipTitle || label.textContent?.trim() || '';
    tooltipBody.textContent = label.dataset.tooltipBody || '';
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');
    label.classList.add('is-tooltip-active');
    updateTooltipPosition(true);
  };
  const hideTooltip = (label) => {
    if (!tooltip) return;
    if (label && activeTooltipLabel !== label) return;
    activeTooltipLabel?.classList.remove('is-tooltip-active');
    activeTooltipLabel = null;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
  };
  const refreshCanvasRect = () => {
    canvasRect = canvas.getBoundingClientRect();
    canvasCssSize = {
      width: Math.max(1, canvasRect.width),
      height: Math.max(1, canvasRect.height)
    };
    return canvasRect;
  };
  const getCanvasCssSize = () => {
    if (canvasCssSize.width > 0 && canvasCssSize.height > 0) return canvasCssSize;
    refreshCanvasRect();
    return canvasCssSize;
  };
  const handleLayoutChange = () => {
    if (layoutFrameId) return;
    layoutFrameId = window.requestAnimationFrame(() => {
      layoutFrameId = null;
      canvasRect = null;
      tooltipMetrics = null;
      refreshCanvasRect();
      if (activeTooltipLabel) updateTooltipPosition(true);
    });
  };
  const handleVisibilityChange = () => {
    resetFrameClock = true;
    state.lastFrameMs = performance.now();
  };
  window.addEventListener('resize', handleLayoutChange);
  window.addEventListener('scroll', handleLayoutChange, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  for (const label of flowLabels) {
    label.addEventListener('pointerenter', () => showTooltip(label));
    label.addEventListener('pointermove', () => {
      if (activeTooltipLabel === label) updateTooltipPosition();
    });
    label.addEventListener('pointerleave', () => hideTooltip(label));
    label.addEventListener('focus', () => showTooltip(label));
    label.addEventListener('blur', () => hideTooltip(label));
  }
  const syncFlowLabels = (anchors = {}, width = 1, height = 1, deltaSeconds = SIMULATION_TARGET_STEP_MS / 1000) => {
    if (!labelCanvasSize || Math.abs(labelCanvasSize.width - width) > 1 || Math.abs(labelCanvasSize.height - height) > 1) {
      labelPositions.clear();
      labelCanvasSize = { width, height };
      tooltipMetrics = null;
    }
    const deltaFrames = Math.max(0, Math.min(4, deltaSeconds / (SIMULATION_TARGET_STEP_MS / 1000)));
    const labelBlend = 1 - Math.pow(1 - 0.18, deltaFrames);
    for (const label of flowLabels) {
      const anchor = anchors[label.dataset.poolFlowLabel];
      if (!anchor) continue;
      const key = label.dataset.poolFlowLabel;
      const targetX = (anchor.x / Math.max(1, width)) * 100;
      const targetY = (anchor.y / Math.max(1, height)) * 100;
      const labelText = anchor.label || key;
      const labelBody = anchor.labelBody || '';
      if (label.dataset.currentLabel !== labelText || label.dataset.currentBody !== labelBody) {
        label.dataset.currentLabel = labelText;
        label.dataset.currentBody = labelBody;
        label.dataset.tooltipTitle = labelText;
        label.dataset.tooltipBody = labelBody;
        label.setAttribute('aria-label', labelBody ? `${labelText}: ${labelBody}` : labelText);
        const labelTextEl = label.querySelector('b');
        if (labelTextEl) labelTextEl.textContent = labelText;
        if (activeTooltipLabel === label && tooltipTitle && tooltipBody) {
          tooltipTitle.textContent = labelText;
          tooltipBody.textContent = labelBody;
        }
      }
      let current = labelPositions.get(key);
      if (!current) {
        current = {
          x: targetX,
          y: targetY,
          styleX: NaN,
          styleY: NaN
        };
        labelPositions.set(key, current);
      } else {
        current.x += (targetX - current.x) * labelBlend;
        current.y += (targetY - current.y) * labelBlend;
      }
      if (
        !Number.isFinite(current.styleX)
        || Math.abs(current.styleX - current.x) >= LABEL_STYLE_EPSILON_PERCENT
        || Math.abs(current.styleY - current.y) >= LABEL_STYLE_EPSILON_PERCENT
      ) {
        current.styleX = current.x;
        current.styleY = current.y;
        label.style.setProperty('--x', `${current.x}%`);
        label.style.setProperty('--y', `${current.y}%`);
      }
    }
  };
  window.REPLOID_POOL_SIMULATION_STOP = () => {
    active = false;
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    if (layoutFrameId !== null) window.cancelAnimationFrame(layoutFrameId);
    frameId = null;
    layoutFrameId = null;
    hideTooltip();
    removeCanvasListeners();
    resizeObserver?.disconnect();
    window.removeEventListener('resize', handleLayoutChange);
    window.removeEventListener('scroll', handleLayoutChange, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    renderer?.dispose();
  };
  try {
    renderer = await createPoolSimulationRenderer(canvas, {
      buildBatches: buildPoolRenderBatches,
      draw2D: drawPoolSimulation2D
    });
  } catch (error) {
    console.error('Reploid graph renderer failed to initialize.', error);
    active = false;
    return;
  }
  if (!active) {
    renderer.dispose();
    return;
  }
  canvas = renderer.canvas;
  refreshCanvasRect();
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(handleLayoutChange);
    resizeObserver.observe(canvas);
    if (simulationShell !== canvas) resizeObserver.observe(simulationShell);
  }
  canvas.dataset.poolRenderer = renderer.backend;
  window.REPLOID_POOL_RENDERER_BACKEND = renderer.backend;
  const draw = (timestamp = performance.now()) => {
    if (!active) return;
    frameId = null;
    const rawDeltaMs = Math.max(0, timestamp - state.lastFrameMs);
    state.lastFrameMs = timestamp;
    if (document.visibilityState === 'hidden') {
      resetFrameClock = true;
      frameId = window.requestAnimationFrame(draw);
      return;
    }
    const deltaMs = resolvePoolFrameDeltaMs(rawDeltaMs, resetFrameClock);
    resetFrameClock = false;
    const { width, height } = resizePoolCanvas(canvas, getCanvasCssSize());
    const frame = buildPoolSimulationFrame(state, width, height, deltaMs / 1000);
    renderer.render(frame, width, height);
    syncFlowLabels(frame.labelAnchors, width, height, deltaMs / 1000);
    if (activeTooltipLabel) updateTooltipPosition(false);
    frameId = window.requestAnimationFrame(draw);
  };
  const syncPointerPosition = (event) => {
    const box = canvasRect || refreshCanvasRect();
    const nextX = clampRange((event.clientX - box.left) / Math.max(1, box.width), 0, 1);
    const nextY = clampRange((event.clientY - box.top) / Math.max(1, box.height), 0, 1);
    const deltaPixels = Math.hypot(
      (nextX - state.pointer.targetX) * box.width,
      (nextY - state.pointer.targetY) * box.height
    );
    state.pointer.targetX = nextX;
    state.pointer.targetY = nextY;
    state.pointer.inside = event.clientX >= box.left
      && event.clientX <= box.right
      && event.clientY >= box.top
      && event.clientY <= box.bottom;
    if (state.pointer.holding) {
      state.pointer.moveEnergy = Math.min(1.8, (state.pointer.moveEnergy || 0) + deltaPixels / 76);
    }
  };
  const leavePointer = () => {
    state.pointer.inside = false;
  };
  const holdPointer = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    syncPointerPosition(event);
    state.pointer.holding = true;
    state.pointer.pointerId = event.pointerId;
    state.pointer.shotBurst = Math.max(state.pointer.shotBurst || 0, 6);
    state.pointer.moveEnergy = Math.max(state.pointer.moveEnergy || 0, 0.45);
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      state.pointer.pointerId = event.pointerId;
    }
    event.preventDefault();
  };
  const movePointer = (event) => {
    syncPointerPosition(event);
    if (state.pointer.holding) event.preventDefault();
  };
  const releasePointer = (event) => {
    if (state.pointer.pointerId !== null && event?.pointerId !== state.pointer.pointerId) return;
    try {
      if (event?.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore stale capture handles from browser-level pointer cancellation.
    }
    state.pointer.holding = false;
    state.pointer.pointerId = null;
  };
  const losePointerCapture = (event) => {
    if (state.pointer.pointerId !== null && event.pointerId !== state.pointer.pointerId) return;
    state.pointer.holding = false;
    state.pointer.pointerId = null;
  };
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerdown', holdPointer);
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', leavePointer);
  canvas.addEventListener('lostpointercapture', losePointerCapture);
  removeCanvasListeners = () => {
    canvas.removeEventListener('pointermove', movePointer);
    canvas.removeEventListener('pointerdown', holdPointer);
    canvas.removeEventListener('pointerup', releasePointer);
    canvas.removeEventListener('pointercancel', releasePointer);
    canvas.removeEventListener('pointerleave', leavePointer);
    canvas.removeEventListener('lostpointercapture', losePointerCapture);
  };
  state.lastFrameMs = performance.now();
  frameId = window.requestAnimationFrame(draw);
};
