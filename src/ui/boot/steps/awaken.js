/**
 * @fileoverview Awaken step renderer
 */

import {
  applyModuleOverrides,
  AWAKEN_REQUIRED_MODULES,
  getMissingModules,
  resolveBaseModules
} from '../../../config/module-resolution.js';

const escapeAttr = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/**
 * Render AWAKEN step
 */
export function renderAwakenStep(state) {
  const genesisLevel = state.advancedConfig?.genesisLevel || 'full';
  const overrides = state.advancedConfig?.moduleOverrides || {};
  const moduleConfig = state.moduleConfig || {};
  const advancedOpen = !!state.advancedOpen;
  const isAwakening = !!state.isAwakening;
  const goalMissing = !(state.goal && state.goal.trim());

  let missingModules = [];
  let tooltipText = '';
  let blockedKey = '';
  let resolvedModules = [];

  if (moduleConfig.genesis && moduleConfig.registry) {
    try {
      const baseModules = resolveBaseModules(genesisLevel, moduleConfig.genesis);
      const resolution = applyModuleOverrides(baseModules, moduleConfig.registry.modules || {}, overrides);
      resolvedModules = resolution.resolved || [];
      missingModules = getMissingModules(AWAKEN_REQUIRED_MODULES, resolvedModules);
    } catch (err) {
      tooltipText = `Module check failed: ${err.message}`;
      blockedKey = 'modules';
    }
  } else if (genesisLevel === 'tabula') {
    missingModules = [...AWAKEN_REQUIRED_MODULES];
  }

  if (!blockedKey && missingModules.length > 0) {
    tooltipText = `Awaken requires: ${missingModules.join(', ')}`;
    blockedKey = 'modules';
  }

  if (!blockedKey && goalMissing) {
    tooltipText = 'Set a goal to awaken';
    blockedKey = 'goal';
  }

  const awakenBlocked = !!blockedKey;
  const blockedAttrs = blockedKey
    ? `data-blocked="${escapeAttr(blockedKey)}" data-blocked-reason="${escapeAttr(tooltipText)}"`
    : '';

  const buttonText = isAwakening ? 'Awakening...' : 'Awaken Agent';

  return `
    <div class="wizard-step wizard-awaken">
      <div class="wizard-actions-row">
        <button class="btn btn-secondary" data-action="advanced-settings">
          ${advancedOpen ? 'Hide advanced' : 'Advanced settings'}
        </button>
        <button class="btn btn-lg btn-prism${isAwakening ? ' loading' : ''}"
                data-action="awaken"
                id="awaken-btn"
                ${blockedAttrs}
                ${awakenBlocked || isAwakening ? 'disabled' : ''}
                ${tooltipText ? `title="${escapeAttr(tooltipText)}"` : ''}
                aria-busy="${isAwakening}">
          ${buttonText}
        </button>
      </div>
    </div>
  `;
}
