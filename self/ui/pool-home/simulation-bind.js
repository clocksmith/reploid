/**
 * @fileoverview DOM binding for the Reploid graph simulation.
 */

import { createPoolSimulationRenderer } from './simulation-renderer.js';
import { createPoolRenderBatchBuilder } from './simulation-batches.js';
import {
  buildPoolSimulationFrame,
  clampRange,
  createPoolSimulationState,
  resizePoolCanvas,
  setPoolSimulationNetworkVisualState
} from './simulation-core.js';
import {
  POOLDAY_NETWORK_VISUAL_EVENT,
  SIMULATION_MAX_STEP_MS,
  SIMULATION_RESUME_GAP_MS,
  SIMULATION_TARGET_STEP_MS
} from './constants.js';

const LABEL_STYLE_EPSILON_PERCENT = 0.025;
const POOL_SIMULATION_MIN_RENDER_QUALITY = 0.62;
const POOL_SIMULATION_TARGET_COST_MS = 1;
const POOL_SIMULATION_QUALITY_DOWN_COST = POOL_SIMULATION_TARGET_COST_MS;
const POOL_SIMULATION_QUALITY_UP_COST = POOL_SIMULATION_TARGET_COST_MS * 0.70;
const POOL_SIMULATION_STATS_BLEND = 0.08;
const POOL_SIMULATION_LABEL_SYNC_INTERVAL_MS = 50;

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
  const handleNetworkVisualState = (event) => {
    setPoolSimulationNetworkVisualState(state, event?.detail || {});
  };
  window.addEventListener(POOLDAY_NETWORK_VISUAL_EVENT, handleNetworkVisualState);
  setPoolSimulationNetworkVisualState(state, window.REPLOID_POOL_NETWORK_VISUAL_STATE || {});
  const buildPoolRenderBatches = createPoolRenderBatchBuilder();
  let active = true;
  let frameId = null;
  let renderer = null;
  let drawFrame = null;
  let removeCanvasListeners = () => {};
  const removeLabelListeners = [];
  let canvasRect = null;
  let canvasCssSize = { width: 0, height: 0 };
  let layoutFrameId = null;
  let resizeObserver = null;
  let viewportObserver = null;
  let resetFrameClock = true;
  let simulationInViewport = true;
  let renderQuality = 1;
  let lastLabelSyncMs = -Infinity;
  const simulationStats = {
    active: true,
    suspended: false,
    backend: 'pending',
    frameCount: 0,
    lastFrameCostMs: 0,
    averageFrameCostMs: 0,
    theoreticalFps: 0,
    networkMode: 'simulation',
    renderQuality
  };
  window.REPLOID_POOL_SIMULATION_STATS = simulationStats;
  const flowLabels = [...mount.querySelectorAll('[data-pool-flow-label]')];
  const simulationShell = mount.querySelector('.pool-simulation-shell') || mount;
  const tooltip = mount.querySelector('[data-pool-tooltip]');
  const tooltipTitle = tooltip?.querySelector('[data-pool-tooltip-title]');
  const tooltipBody = tooltip?.querySelector('[data-pool-tooltip-body]');
  let activeTooltipLabel = null;
  const labelPositions = new Map();
  const labelMetrics = new Map();
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
      ? ((labelPosition.displayX ?? labelPosition.x) / 100) * metrics.shellWidth
      : metrics.shellWidth * 0.5;
    const anchorY = labelPosition
      ? ((labelPosition.displayY ?? labelPosition.y) / 100) * metrics.shellHeight
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
    for (const label of flowLabels) {
      const box = label.getBoundingClientRect();
      labelMetrics.set(label.dataset.poolFlowLabel, {
        width: Math.max(48, box.width || 0),
        height: Math.max(24, box.height || 0)
      });
    }
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
  const cancelFrame = () => {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
  };
  const isAnimationRunnable = () => (
    active
    && renderer
    && document.visibilityState !== 'hidden'
    && simulationInViewport
  );
  const syncSuspendedStats = () => {
    simulationStats.suspended = !isAnimationRunnable();
  };
  const scheduleFrame = () => {
    syncSuspendedStats();
    if (!isAnimationRunnable() || frameId !== null || typeof drawFrame !== 'function') return;
    frameId = window.requestAnimationFrame(drawFrame);
  };
  const handleVisibilityChange = () => {
    resetFrameClock = true;
    state.lastFrameMs = performance.now();
    if (document.visibilityState === 'hidden') {
      cancelFrame();
      syncSuspendedStats();
      return;
    }
    scheduleFrame();
  };
  window.addEventListener('resize', handleLayoutChange);
  window.addEventListener('scroll', handleLayoutChange, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  for (const label of flowLabels) {
    const pointerEnter = () => showTooltip(label);
    const pointerMove = () => {
      if (activeTooltipLabel === label) updateTooltipPosition();
    };
    const pointerLeave = () => hideTooltip(label);
    const focus = () => showTooltip(label);
    const blur = () => hideTooltip(label);
    label.addEventListener('pointerenter', pointerEnter);
    label.addEventListener('pointermove', pointerMove);
    label.addEventListener('pointerleave', pointerLeave);
    label.addEventListener('focus', focus);
    label.addEventListener('blur', blur);
    removeLabelListeners.push(() => {
      label.removeEventListener('pointerenter', pointerEnter);
      label.removeEventListener('pointermove', pointerMove);
      label.removeEventListener('pointerleave', pointerLeave);
      label.removeEventListener('focus', focus);
      label.removeEventListener('blur', blur);
    });
  }
  const syncFlowLabels = (anchors = {}, width = 1, height = 1, deltaSeconds = SIMULATION_TARGET_STEP_MS / 1000) => {
    if (!labelCanvasSize || Math.abs(labelCanvasSize.width - width) > 1 || Math.abs(labelCanvasSize.height - height) > 1) {
      labelPositions.clear();
      labelCanvasSize = { width, height };
      tooltipMetrics = null;
    }
    const deltaFrames = Math.max(0, Math.min(4, deltaSeconds / (SIMULATION_TARGET_STEP_MS / 1000)));
    const labelBlend = 1 - Math.pow(1 - 0.18, deltaFrames);
    const positioned = [];
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
          displayX: targetX,
          displayY: targetY,
          styleX: NaN,
          styleY: NaN
        };
        labelPositions.set(key, current);
      } else {
        current.x += (targetX - current.x) * labelBlend;
        current.y += (targetY - current.y) * labelBlend;
      }
      positioned.push({ key, label, current });
    }

    const cssWidth = Math.max(1, canvasCssSize.width || width);
    const cssHeight = Math.max(1, canvasCssSize.height || height);
    const resolved = [];
    for (let index = 0; index < positioned.length; index += 1) {
      const entry = positioned[index];
      const metrics = labelMetrics.get(entry.key) || { width: 64, height: 26 };
      let displayX = entry.current.x;
      let displayY = entry.current.y;
      for (const previous of resolved) {
        const minX = ((metrics.width + previous.metrics.width) * 0.5 + 6) / cssWidth * 100;
        const minY = ((metrics.height + previous.metrics.height) * 0.5 + 4) / cssHeight * 100;
        if (Math.abs(displayX - previous.x) >= minX || Math.abs(displayY - previous.y) >= minY) continue;
        const direction = displayX > previous.x || (displayX === previous.x && index % 2 === 0) ? 1 : -1;
        displayX = previous.x + direction * minX;
      }
      const halfWidth = (metrics.width * 0.5 + 4) / cssWidth * 100;
      const halfHeight = (metrics.height * 0.5 + 4) / cssHeight * 100;
      displayX = clampRange(displayX, halfWidth, Math.max(halfWidth, 100 - halfWidth));
      displayY = clampRange(displayY, halfHeight, Math.max(halfHeight, 100 - halfHeight));
      entry.current.displayX = displayX;
      entry.current.displayY = displayY;
      resolved.push({ x: displayX, y: displayY, metrics });
      if (
        !Number.isFinite(entry.current.styleX)
        || Math.abs(entry.current.styleX - displayX) >= LABEL_STYLE_EPSILON_PERCENT
        || Math.abs(entry.current.styleY - displayY) >= LABEL_STYLE_EPSILON_PERCENT
      ) {
        entry.current.styleX = displayX;
        entry.current.styleY = displayY;
        entry.label.style.setProperty('--x', `${displayX}%`);
        entry.label.style.setProperty('--y', `${displayY}%`);
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
    while (removeLabelListeners.length > 0) {
      removeLabelListeners.pop()?.();
    }
    removeCanvasListeners();
    resizeObserver?.disconnect();
    viewportObserver?.disconnect();
    window.removeEventListener('resize', handleLayoutChange);
    window.removeEventListener('scroll', handleLayoutChange, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener(POOLDAY_NETWORK_VISUAL_EVENT, handleNetworkVisualState);
    renderer?.dispose();
    simulationStats.active = false;
    simulationStats.suspended = true;
  };
  try {
    renderer = await createPoolSimulationRenderer(canvas, {
      buildBatches: buildPoolRenderBatches
    });
  } catch (error) {
    console.error('Reploid graph renderer failed to initialize.', error);
    window.REPLOID_POOL_SIMULATION_STOP?.();
    window.REPLOID_POOL_SIMULATION_STOP = null;
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
  simulationStats.backend = renderer.backend;
  if (typeof IntersectionObserver === 'function') {
    viewportObserver = new IntersectionObserver((entries) => {
      const nextInViewport = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0);
      if (nextInViewport === simulationInViewport) return;
      simulationInViewport = nextInViewport;
      resetFrameClock = true;
      state.lastFrameMs = performance.now();
      if (simulationInViewport) scheduleFrame();
      else {
        cancelFrame();
        syncSuspendedStats();
      }
    });
    viewportObserver.observe(simulationShell);
  }
  drawFrame = (timestamp = performance.now()) => {
    if (!active) return;
    frameId = null;
    if (!isAnimationRunnable()) {
      resetFrameClock = true;
      syncSuspendedStats();
      return;
    }
    const frameStart = performance.now();
    const rawDeltaMs = Math.max(0, timestamp - state.lastFrameMs);
    state.lastFrameMs = timestamp;
    const deltaMs = resolvePoolFrameDeltaMs(rawDeltaMs, resetFrameClock);
    resetFrameClock = false;
    const { width, height } = resizePoolCanvas(canvas, getCanvasCssSize());
    const frame = buildPoolSimulationFrame(state, width, height, deltaMs / 1000);
    frame.renderQuality = renderQuality;
    renderer.render(frame, width, height);
    if (timestamp - lastLabelSyncMs >= POOL_SIMULATION_LABEL_SYNC_INTERVAL_MS) {
      const labelDeltaSeconds = Number.isFinite(lastLabelSyncMs)
        ? (timestamp - lastLabelSyncMs) / 1000
        : deltaMs / 1000;
      lastLabelSyncMs = timestamp;
      syncFlowLabels(frame.labelAnchors, width, height, labelDeltaSeconds);
      if (activeTooltipLabel) updateTooltipPosition(false);
    }
    const frameCostMs = Math.max(0, performance.now() - frameStart);
    simulationStats.frameCount += 1;
    simulationStats.lastFrameCostMs = frameCostMs;
    simulationStats.averageFrameCostMs = simulationStats.averageFrameCostMs === 0
      ? frameCostMs
      : simulationStats.averageFrameCostMs + (frameCostMs - simulationStats.averageFrameCostMs) * POOL_SIMULATION_STATS_BLEND;
    simulationStats.theoreticalFps = simulationStats.averageFrameCostMs > 0
      ? 1000 / simulationStats.averageFrameCostMs
      : 0;
    if (simulationStats.averageFrameCostMs > POOL_SIMULATION_QUALITY_DOWN_COST) {
      renderQuality = Math.max(POOL_SIMULATION_MIN_RENDER_QUALITY, renderQuality - 0.035);
    } else if (simulationStats.averageFrameCostMs < POOL_SIMULATION_QUALITY_UP_COST) {
      renderQuality = Math.min(1, renderQuality + 0.018);
    }
    simulationStats.renderQuality = renderQuality;
    simulationStats.networkMode = frame.networkMode;
    simulationShell.dataset.networkMode = frame.networkMode;
    scheduleFrame();
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
  scheduleFrame();
};
