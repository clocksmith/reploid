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
      ${verifyState !== VERIFY_STATE.VERIFIED ? `
        <div class="awaken-warning">
          <h3>△ Connection not verified</h3>
          <p>Your connection hasn't been tested. The agent may fail to start.</p>
          <div class="warning-actions">
            <button class="btn btn-secondary" data-action="test-now">Test now</button>
            <button class="btn btn-tertiary" data-action="edit-config">Edit config</button>
            <button class="btn btn-primary" data-action="awaken-anyway">Continue anyway</button>
          </div>
        </div>
      ` : `
        <div class="awaken-progress">
          <h2>Awakening Agent</h2>
          <div class="progress-steps">
            <div class="progress-step" id="step-vfs">Initializing VFS...</div>
            <div class="progress-step" id="step-snapshot">Creating genesis snapshot...</div>
            <div class="progress-step" id="step-model">Connecting to model...</div>
            <div class="progress-step" id="step-memory">Loading memory systems...</div>
            <div class="progress-step" id="step-agent">Starting agent loop...</div>
          </div>
        </div>
      `}
    </div>
  `;
}
