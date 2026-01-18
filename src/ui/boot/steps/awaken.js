/**
 * @fileoverview Awaken step renderer
 */

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

  const awakenBlocked = missingModules.length > 0;

  if (missingModules.length > 0) {
    tooltipText = `Awaken requires: ${missingModules.join(', ')}`;
  }

  const buttonText = isAwakening ? 'Awakening...' : 'Awaken Agent';

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
