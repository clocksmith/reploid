/**
 * @fileoverview Awaken step renderer
 */

import { VERIFY_STATE } from '../state.js';
import {
  applyModuleOverrides,
  AWAKEN_REQUIRED_MODULES,
  getMissingModules,
  resolveBaseModules
} from '../../../config/module-resolution.js';

/**
 * Render AWAKEN step
 */
export function renderAwakenStep(state) {
  const { connectionType, directConfig, proxyConfig, goal } = state;
  const genesisLevel = state.advancedConfig?.genesisLevel || 'full';
  const overrides = state.advancedConfig?.moduleOverrides || {};
  const moduleConfig = state.moduleConfig || {};
  const advancedOpen = !!state.advancedOpen;
  const isAwakening = !!state.isAwakening;

  let missingModules = [];
  let tooltipText = '';
  let resolvedModules = [];

  if (moduleConfig.genesis && moduleConfig.registry) {
    try {
      const baseModules = resolveBaseModules(genesisLevel, moduleConfig.genesis);
      const resolution = applyModuleOverrides(baseModules, moduleConfig.registry.modules || {}, overrides);
      resolvedModules = resolution.resolved || [];
      missingModules = getMissingModules(AWAKEN_REQUIRED_MODULES, resolvedModules);
    } catch (err) {
      tooltipText = `Module check failed: ${err.message}`;
    }
  } else if (genesisLevel === 'tabula') {
    missingModules = [...AWAKEN_REQUIRED_MODULES];
  }

  // Check if goal is set
  const hasGoal = !!(goal && goal.trim());
  const awakenBlocked = missingModules.length > 0 || !hasGoal;

  if (missingModules.length > 0) {
    tooltipText = `Awaken requires: ${missingModules.join(', ')}`;
  } else if (!hasGoal) {
    tooltipText = 'Select or enter a goal above to awaken the agent.';
  }

  // Get verify state based on connection type
  let verifyState = VERIFY_STATE.VERIFIED;
  if (connectionType === 'direct') {
    verifyState = directConfig.verifyState;
  } else if (connectionType === 'proxy') {
    verifyState = proxyConfig.verifyState;
  } else if (connectionType === 'browser') {
    verifyState = VERIFY_STATE.VERIFIED; // Local browser is always verified
  }

  const buttonText = isAwakening
    ? 'Awakening...'
    : `Awaken Agent${verifyState !== VERIFY_STATE.VERIFIED ? ' (unverified)' : ''}`;

  return `
    <div class="wizard-step wizard-awaken">
      <div class="wizard-actions-row">
        <button class="btn btn-secondary" data-action="advanced-settings">
          ${advancedOpen ? 'Hide advanced' : 'Advanced settings'}
        </button>
        <button class="btn btn-lg btn-prism${isAwakening ? ' loading' : ''}"
                data-action="awaken"
                ${awakenBlocked || isAwakening ? 'disabled' : ''}
                ${tooltipText ? `title="${tooltipText}"` : ''}
                aria-busy="${isAwakening}">
          ${buttonText}
        </button>
      </div>
    </div>
  `;
}
