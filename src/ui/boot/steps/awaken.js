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
  const securityEnabled = state.advancedConfig?.securityEnabled !== false;
  const hitlMode = state.advancedConfig?.hitlApprovalMode || 'autonomous';
  const hitlSteps = state.advancedConfig?.hitlEveryNSteps ?? 5;
  const showHitlCadence = hitlMode === 'every_n';
  const overrideCount = Object.keys(overrides).length;
  const hasOverrides = overrideCount > 0;

  const levelEntries = moduleConfig?.genesis?.levels
    ? Object.entries(moduleConfig.genesis.levels)
    : [];

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
  const blockedAttrs = blockedKey === 'modules'
    ? `data-blocked="${escapeAttr(blockedKey)}" data-blocked-reason="${escapeAttr(tooltipText)}"`
    : '';

  const buttonText = isAwakening ? 'Awakening...' : 'Awaken Agent';

  const levelOptions = levelEntries.length
    ? levelEntries.map(([key, level]) => {
      const label = `${level.name || key} - ${level.description || ''}`.trim();
      return `<option value="${escapeAttr(key)}" ${key === genesisLevel ? 'selected' : ''}>${escapeAttr(label)}</option>`;
    }).join('')
    : `<option value="${escapeAttr(genesisLevel)}">${escapeAttr(genesisLevel)}</option>`;

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

      <div class="advanced-panel" style="display:${advancedOpen ? '' : 'none'}">
        <div class="advanced-section">
          <div class="advanced-section-title">Runtime mode</div>

          <div class="advanced-setting">
            <label class="type-label" for="advanced-genesis-level">Genesis level</label>
            <select id="advanced-genesis-level">
              ${levelOptions}
            </select>
            <span class="type-caption">Sets which modules load at boot.</span>
          </div>

          <div class="advanced-setting">
            <div class="advanced-setting-inline">
              <span class="type-label">Module overrides</span>
              <span class="advanced-pill" data-advanced-override-count>${overrideCount} active</span>
              <button class="btn btn-ghost"
                      data-action="reset-module-overrides"
                      ${hasOverrides ? '' : 'disabled'}>
                Reset overrides
              </button>
            </div>
            <span class="type-caption">Overrides are saved locally and applied at boot.</span>
          </div>
        </div>

        <div class="advanced-section">
          <div class="advanced-section-title">Safety &amp; approval</div>

          <div class="advanced-setting">
            <label class="checkbox-label">
              <input type="checkbox"
                     id="advanced-security-enabled"
                     ${securityEnabled ? 'checked' : ''} />
              <span>Security enforcement</span>
            </label>
            <span class="type-caption">Disable to bypass verification, policy checks, and approval gates.</span>
          </div>

          <div class="advanced-setting">
            <label class="type-label" for="advanced-hitl-mode">HITL approval</label>
            <select id="advanced-hitl-mode">
              <option value="autonomous" ${hitlMode === 'autonomous' ? 'selected' : ''}>Autonomous</option>
              <option value="hitl" ${hitlMode === 'hitl' ? 'selected' : ''}>Always ask</option>
              <option value="every_n" ${hitlMode === 'every_n' ? 'selected' : ''}>Every N steps</option>
            </select>
            <span class="type-caption">Applies to critical tool and module actions.</span>
          </div>

          <div class="advanced-setting" data-advanced-hitl-cadence style="display:${showHitlCadence ? '' : 'none'}">
            <label class="type-label" for="advanced-hitl-steps">HITL cadence</label>
            <input type="number"
                   id="advanced-hitl-steps"
                   min="1"
                   max="100"
                   ${showHitlCadence ? '' : 'disabled'}
                   value="${escapeAttr(hitlSteps)}" />
            <span class="type-caption">Steps between approvals when using "Every N steps".</span>
          </div>
        </div>

        <div class="advanced-section">
          <div class="advanced-section-title">State persistence</div>

          <div class="advanced-setting">
            <label class="checkbox-label">
              <input type="checkbox"
                     id="advanced-preserve-vfs"
                     ${state.advancedConfig?.preserveOnBoot ? 'checked' : ''} />
              <span>Preserve VFS on boot</span>
            </label>
            <span class="type-caption">Keep existing VFS files when starting a new session.</span>
          </div>

          <div class="advanced-setting">
            <div class="advanced-setting-inline">
              <span class="type-label">Clear VFS cache</span>
              <button class="btn btn-ghost" data-action="advanced-clear-vfs">Clear now</button>
            </div>
            <span class="type-caption">Clears cached files and re-hydrates from the manifest.</span>
          </div>

          <div class="advanced-setting">
            <div class="advanced-setting-inline">
              <span class="type-label">Clear saved settings</span>
              <a class="btn btn-ghost" href="/reset.html">Open reset</a>
            </div>
            <span class="type-caption">Clears local storage, service workers, and caches.</span>
          </div>
        </div>
      </div>
    </div>
  `;
}
