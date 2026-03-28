/**
 * @fileoverview Security configuration for runtime enforcement.
 * Central toggle for verification and approval gates.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../self/instance.js';

const STORAGE_KEY = 'REPLOID_SECURITY_MODE';
const DEFAULT_ENABLED = false;

const hasLocalStorage = () => !!getReploidStorage().raw;

const parseStoredValue = (value) => {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'off', 'disabled', 'no'].includes(normalized)) return false;
  if (['true', '1', 'on', 'enabled', 'yes'].includes(normalized)) return true;
  return null;
};

const readStoredMode = () => {
  if (!hasLocalStorage()) {
    return { enabled: DEFAULT_ENABLED, source: 'default' };
  }
  try {
    const raw = getReploidStorage().getItem(STORAGE_KEY);
    const parsed = parseStoredValue(raw);
    if (parsed == null) {
      return { enabled: DEFAULT_ENABLED, source: 'default' };
    }
    return { enabled: parsed, source: 'localStorage' };
  } catch (e) {
    return { enabled: DEFAULT_ENABLED, source: 'default' };
  }
};

let { enabled: runtimeEnabled, source: runtimeSource } = readStoredMode();

export function getSecurityState() {
  return { enabled: runtimeEnabled, source: runtimeSource };
}

export function isSecurityEnabled() {
  return runtimeEnabled;
}

export function setSecurityEnabled(enabled, options = {}) {
  const persist = options.persist !== false;
  runtimeEnabled = !!enabled;
  runtimeSource = persist ? 'localStorage' : 'runtime';

  if (persist && hasLocalStorage()) {
    try {
      getReploidStorage().setItem(STORAGE_KEY, runtimeEnabled ? 'on' : 'off');
    } catch (e) {
      runtimeSource = 'runtime';
    }
  }

  return { enabled: runtimeEnabled, source: runtimeSource };
}

export function syncSecurityFromStorage() {
  const state = readStoredMode();
  runtimeEnabled = state.enabled;
  runtimeSource = state.source;
  return state;
}
