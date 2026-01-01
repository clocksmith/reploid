/**
 * @fileoverview Iframe Bridge
 * Handles parent/child iframe communication for embedded REPLOID instances.
 */

/**
 * Iframe bridge state.
 */
const state = {
  isIframeChild: false,
  pendingParentGoal: null,
  systemReadyCallback: null
};

/**
 * Initialize iframe bridge if running as child.
 * @param {Object} logger - Logger instance
 * @returns {Object} Bridge state
 */
export function initIframeBridge(logger) {
  state.isIframeChild = window.parent !== window;

  if (!state.isIframeChild) {
    return state;
  }

  logger.info('[Boot] Running as iframe child, setting up parent communication');

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'PARENT_GOAL') {
      state.pendingParentGoal = event.data.goal;
      logger.info('[Boot] Received goal from parent:', state.pendingParentGoal?.slice(0, 50));

      // If system already ready, trigger awaken immediately
      if (state.systemReadyCallback) {
        state.systemReadyCallback();
      }
    }
  });

  // Notify parent we're ready
  const targetOrigin = window.location.origin || '*';
  window.parent.postMessage({ type: 'CHILD_READY' }, targetOrigin);

  return state;
}

/**
 * Set callback for when system is ready.
 * @param {Function} callback - Callback to invoke
 */
export function setSystemReadyCallback(callback) {
  state.systemReadyCallback = callback;

  // If goal already received, trigger immediately
  if (state.pendingParentGoal && state.isIframeChild) {
    callback();
  }
}

/**
 * Get pending goal from parent iframe.
 * @returns {string|null} Goal string or null
 */
export function getPendingGoal() {
  return state.pendingParentGoal;
}

/**
 * Check if running as iframe child.
 * @returns {boolean} True if iframe child
 */
export function isIframeChild() {
  return state.isIframeChild;
}
