/**
 * @fileoverview Awaken step renderer
 */

import { VERIFY_STATE } from '../state.js';

/**
 * Render AWAKEN step
 */
export function renderAwakenStep(state) {
  const { connectionType, directConfig, proxyConfig } = state;

  // Get verify state based on connection type
  let verifyState = VERIFY_STATE.VERIFIED;
  if (connectionType === 'direct') {
    verifyState = directConfig.verifyState;
  } else if (connectionType === 'proxy') {
    verifyState = proxyConfig.verifyState;
  } else if (connectionType === 'browser') {
    verifyState = VERIFY_STATE.VERIFIED; // Local browser is always verified
  }

  return `
    <div class="wizard-step wizard-awaken">
      <div class="wizard-actions">
        <button class="btn btn-prism" data-action="awaken">
          Awaken Agent ${verifyState !== VERIFY_STATE.VERIFIED ? '(unverified)' : ''}
        </button>
      </div>
    </div>
  `;
}
