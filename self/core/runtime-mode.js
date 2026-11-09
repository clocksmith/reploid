import { getCurrentReploidStorage } from '../../shared/instance.js';

/** Resolve once per host composition; all consumers use the same validated mode. */
export function resolveRuntimeMode({ mode, win = globalThis.window, storage } = {}) {
  const valid = value => ['reploid', 'zero', 'x'].includes(value);
  if (mode !== undefined) {
    if (!valid(mode)) throw new TypeError('Unknown runtime mode');
    return mode;
  }
  const selected = win?.getReploidMode?.();
  if (valid(selected)) return selected;
  try {
    const stored = (storage || getCurrentReploidStorage()).getItem('REPLOID_MODE');
    if (valid(stored)) return stored;
  } catch { /* Unavailable storage does not manufacture a different surface. */ }
  return 'reploid';
}
