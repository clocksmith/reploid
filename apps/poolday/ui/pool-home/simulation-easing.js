/**
 * @fileoverview Clamping, easing and frame-rate-independent interpolation for the graph simulation.
 */
import { SIMULATION_MAX_STEP_MS, SIMULATION_TARGET_STEP_MS } from './constants.js';

export const clamp01 = (value) => Math.max(0, Math.min(1, value));
export const clampRange = (value, min, max) => Math.max(min, Math.min(max, value));

export const easeOutCubic = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - bounded, 3);
};

export const easeInOutCubic = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded < 0.5
    ? 4 * bounded * bounded * bounded
    : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
};

export const easeInOutSine = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return -(Math.cos(Math.PI * bounded) - 1) / 2;
};

export const resolveTransitionBlend = (transition) => {
  const bounded = clamp01(transition?.progress || 0);
  return easeInOutSine(bounded);
};

export const easeOutQuart = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - bounded, 4);
};

export const lerpToward = (current, target, rate, deltaSeconds) => {
  const deltaMs = Math.max(0, Math.min(SIMULATION_MAX_STEP_MS, deltaSeconds * 1000));
  const deltaScale = deltaMs / SIMULATION_TARGET_STEP_MS;
  const blend = 1 - Math.pow(1 - rate, deltaScale);
  return current + (target - current) * blend;
};

export const lerpTowardSnapped = (current, target, rate, deltaSeconds, epsilon = 0.001) => {
  const next = lerpToward(current, target, rate, deltaSeconds);
  return Math.abs(next - target) <= epsilon ? target : next;
};

export const smoothStep = (value) => {
  const bounded = clamp01(value);
  return bounded * bounded * (3 - 2 * bounded);
};
