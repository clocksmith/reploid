/**
 * @fileoverview Goal selection step renderer
 */

import { canAwaken, getCapabilityLevel } from '../state.js';
import {
  GOAL_CATEGORIES,
  buildGoalCriteria,
  filterGoalsByCapability,
  findGoalMeta,
  parseCriteriaText
} from '../goals.js';
import {
  applyModuleOverrides,
  GENESIS_LEVEL_ORDER,
  resolveBaseModules,
  serializeModuleOverrides
} from '../../../config/module-resolution.js';

/**
 * Render GOAL step
 */
export function renderGoalStep(state) {
  const capabilities = getCapabilityLevel();
  const filteredGoals = filterGoalsByCapability(GOAL_CATEGORIES, capabilities);
  const advancedOpen = !!state.advancedOpen;
  const preserveOnBoot = !!state.advancedConfig?.preserveOnBoot;
  const genesisLevel = state.advancedConfig?.genesisLevel || 'full';
  const moduleOverrides = state.advancedConfig?.moduleOverrides || {};
  const moduleConfig = state.moduleConfig || {};
  const moduleSearchValue = (state.moduleOverrideSearch || '').trim();
  const moduleSearch = moduleSearchValue.toLowerCase();
  const moduleFilter = state.moduleOverrideFilter || 'all';
  const escapeText = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const goalValue = state.goal || '';
  const goalMeta = findGoalMeta(goalValue);
  const criteriaText = state.goalCriteria || '';
  const criteriaList = parseCriteriaText(criteriaText);
  const criteriaCountLabel = criteriaList.length > 0 ? `${criteriaList.length} criteria` : 'No criteria yet';
  const criteriaSuggestions = buildGoalCriteria(goalValue, goalMeta);
  const goalTitle = goalMeta?.view || (goalValue ? 'Custom goal' : 'No goal selected');
  const goalDescription = goalMeta?.text || goalValue || 'Pick a goal to see details.';
  const metaTags = [];
  if (goalMeta?.level) metaTags.push(goalMeta.level);
  if (goalMeta?.requires?.doppler) metaTags.push('Doppler');
  if (goalMeta?.requires?.model) metaTags.push('Model access');
  if (goalMeta?.requires?.reasoning) metaTags.push(`Reasoning ${goalMeta.requires.reasoning}`);
  if (goalMeta?.recommended) metaTags.push('Recommended');
  if (Array.isArray(goalMeta?.tags)) metaTags.push(...goalMeta.tags);
  const uniqueTags = Array.from(new Set(metaTags)).slice(0, 10);
  const metaTagsMarkup = uniqueTags.length > 0
    ? uniqueTags.map(tag => `<span class="tag">${escapeText(tag)}</span>`).join('')
    : '<span class="type-caption">No signals yet.</span>';
  const criteriaSuggestionsMarkup = criteriaSuggestions.length > 0
    ? criteriaSuggestions.map((item, index) => `
        <li class="criteria-item">
          <span class="criteria-index">${index + 1}</span>
          <span class="criteria-text">${escapeText(item)}</span>
        </li>
      `).join('')
    : '<li class="criteria-item criteria-empty type-caption">No suggestions yet.</li>';
  const vfsRuntimeNote = preserveOnBoot
    ? 'Runtime: VFS preserves module and shared files on boot. Missing paths hydrate from src.'
    : 'Runtime: VFS refreshes from src on awaken. Advanced settings can preserve VFS files on boot.';

  const renderModuleOverrides = () => {
    if (moduleConfig.loading) {
      return `<div class="module-overrides-note">Loading module registry...</div>`;
    }

    if (moduleConfig.error) {
      return `<div class="module-overrides-note">Module registry unavailable: ${escapeText(moduleConfig.error)}</div>`;
    }

    if (!moduleConfig.genesis || !moduleConfig.registry) {
      return `<div class="module-overrides-note">Module registry not loaded.</div>`;
    }

    const registryModules = moduleConfig.registry.modules || {};
    let baseModules = [];
    try {
      baseModules = resolveBaseModules(genesisLevel, moduleConfig.genesis);
    } catch (err) {
      return `<div class="module-overrides-note">Failed to resolve genesis modules: ${escapeText(err.message)}</div>`;
    }
    const baseSet = new Set(baseModules);
    const resolution = applyModuleOverrides(baseModules, registryModules, moduleOverrides);
    const resolvedSet = new Set(resolution.resolved || []);
    const missingDeps = resolution.missingDeps || {};
    const orderMap = new Map(GENESIS_LEVEL_ORDER.map((level, index) => [level, index]));

    const entries = Object.entries(registryModules).map(([id, meta]) => ({
      id,
      introduced: meta?.introduced || 'unknown',
      dependencies: Array.isArray(meta?.dependencies) ? meta.dependencies : []
    }));

    entries.sort((a, b) => {
      const aOrder = orderMap.has(a.introduced) ? orderMap.get(a.introduced) : 99;
      const bOrder = orderMap.has(b.introduced) ? orderMap.get(b.introduced) : 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.id.localeCompare(b.id);
    });

    const filtered = entries.filter(entry => {
      const override = moduleOverrides[entry.id];
      const status = override ? `forced-${override}` : 'inherited';
      if (moduleFilter === 'forced-on' && status !== 'forced-on') return false;
      if (moduleFilter === 'forced-off' && status !== 'forced-off') return false;
      if (moduleFilter === 'inherited' && status !== 'inherited') return false;

      if (!moduleSearch) return true;
      const depsText = entry.dependencies.map(dep => dep?.id || '').join(' ').toLowerCase();
      return entry.id.toLowerCase().includes(moduleSearch) || depsText.includes(moduleSearch);
    });

    const rows = filtered.map(entry => {
      const override = moduleOverrides[entry.id];
      const statusLabel = override === 'on'
        ? 'Forced On'
        : override === 'off'
          ? 'Forced Off'
          : 'Inherited';
      const baseLabel = baseSet.has(entry.id) ? 'Base: on' : 'Base: off';
      const deps = entry.dependencies.length > 0
        ? entry.dependencies.map(dep => `${dep.id}${dep.optional ? '?' : ''}`).join(', ')
        : 'none';
      const missing = missingDeps[entry.id] || [];
      const missingText = missing.length > 0 ? `Missing deps: ${missing.join(', ')}` : '';
      const isBlocked = override === 'on' && missing.length > 0;
      const isActive = (value) => (override ? override === value : value === 'inherit');

      return `
        <div class="module-override-row ${isBlocked ? 'blocked' : ''}">
          <div class="module-override-info">
            <div class="module-override-title">
              <span class="module-override-name">${entry.id}</span>
              <span class="module-override-badge">${entry.introduced}</span>
              <span class="module-override-status">${statusLabel}</span>
            </div>
            <div class="module-override-meta">
              <span class="module-override-base">${baseLabel}</span>
              <span class="module-override-deps">Deps: ${deps}</span>
            </div>
            ${missingText ? `<div class="module-override-warning">${missingText}</div>` : ''}
            ${override === 'on' && !resolvedSet.has(entry.id) && !missingText
              ? `<div class="module-override-warning">Not resolved by current overrides.</div>`
              : ''}
          </div>
          <div class="tri-toggle" role="group" aria-label="Override ${entry.id}">
            <button class="tri-toggle-btn ${isActive('inherit') ? 'active' : ''}"
                    data-action="module-override"
                    data-module="${entry.id}"
                    data-value="inherit"
                    aria-pressed="${isActive('inherit')}">Inherit</button>
            <button class="tri-toggle-btn ${isActive('on') ? 'active' : ''}"
                    data-action="module-override"
                    data-module="${entry.id}"
                    data-value="on"
                    aria-pressed="${isActive('on')}">On</button>
            <button class="tri-toggle-btn ${isActive('off') ? 'active' : ''}"
                    data-action="module-override"
                    data-module="${entry.id}"
                    data-value="off"
                    aria-pressed="${isActive('off')}">Off</button>
          </div>
        </div>
      `;
    }).join('');

    const overridesCode = serializeModuleOverrides(moduleOverrides);

    return `
      <div class="module-overrides-summary">
        <span>Base: ${baseModules.length}</span>
        <span>Added: ${resolution.added.length}</span>
        <span>Removed: ${resolution.removed.length}</span>
        <span>Resolved: ${resolution.resolved.length}</span>
      </div>
      <div class="module-overrides-note">Dependencies are required unless marked with ?.</div>
      <div class="module-overrides-controls">
        <input id="module-override-search" class="module-overrides-search" placeholder="Search modules or deps" value="${escapeText(moduleSearchValue)}" />
        <select id="module-override-filter" class="module-overrides-filter">
          <option value="all" ${moduleFilter === 'all' ? 'selected' : ''}>All</option>
          <option value="inherited" ${moduleFilter === 'inherited' ? 'selected' : ''}>Inherited</option>
          <option value="forced-on" ${moduleFilter === 'forced-on' ? 'selected' : ''}>Forced On</option>
          <option value="forced-off" ${moduleFilter === 'forced-off' ? 'selected' : ''}>Forced Off</option>
        </select>
        <button class="btn btn-secondary" data-action="reset-module-overrides">Reset overrides</button>
      </div>
      <div class="module-overrides-list">
        ${rows || '<div class="module-overrides-note">No modules match this filter.</div>'}
      </div>
      <div class="advanced-code">
        <span class="type-caption">localStorage</span>
        <code>REPLOID_MODULE_OVERRIDES = '${overridesCode}'</code>
      </div>
    `;
  };

  // Get selected category from state, default to first available
  const categoryEntries = Object.entries(filteredGoals).filter(([category, goals]) => {
    const isDopplerCategory = goals.length > 0 && goals.every(goal => goal.requires?.doppler);
    return !(isDopplerCategory && !capabilities.canDoDopplerEvolution);
  });
  const selectedCategory = state.selectedGoalCategory || (categoryEntries[0]?.[0] || null);

  return `
    <div class="wizard-step wizard-goal">
      <h2 class="type-h1">What is the agent's goal?</h2>
      <div class="goal-intro type-caption">
        <div>${vfsRuntimeNote}</div>
        <div>Prompts use short view labels with full instructions. Doppler evolution appears when a Doppler model is active.</div>
      </div>

      <div class="accordion goal-accordion">
        ${categoryEntries.map(([category, goals]) => {
          const isDopplerCategory = goals.length > 0 && goals.every(goal => goal.requires?.doppler);
          const isSelected = category === selectedCategory;
          const unlockedCount = goals.filter(g => !g.locked).length;
          const hasRecommended = goals.some(g => g.recommended && !g.locked);

          const headerMeta = [
            `${unlockedCount}/${goals.length}`,
            hasRecommended ? '\u2605' : '',
            isDopplerCategory ? 'Doppler' : ''
          ].filter(Boolean).join(' ');

          return `
            <div class="accordion-item ${isDopplerCategory ? 'doppler' : ''}">
              <button class="accordion-header"
                      data-action="toggle-goal-category"
                      data-category="${category}"
                      aria-expanded="${isSelected}">
                <span>${category}</span>
                <span class="accordion-meta">${headerMeta}</span>
              </button>
              <div class="accordion-content" aria-hidden="${!isSelected}">
                <div class="category-goals">
                  ${goals.map(goal => {
                    const goalValue = goal.text || goal.view || '';
                    const viewText = goal.view || goalValue;
                    const promptText = goal.text || goalValue;
                    const showPrompt = viewText !== promptText;
                    const flags = [
                      goal.recommended ? '<span class="goal-tag recommended">Recommended</span>' : '',
                      goal.locked ? `<span class="goal-tag locked">${goal.lockReason}</span>` : ''
                    ].filter(Boolean).join('');
                    const tags = (goal.tags || []).map(tag => `<span class="goal-tag">${tag}</span>`).join('');
                    return `
                      <button class="goal-chip ${goal.locked ? 'locked' : ''} ${goal.recommended ? 'recommended' : ''}"
                              data-action="select-goal"
                              data-goal="${goalValue}"
                              title="${goalValue}"
                              ${goal.locked ? 'disabled' : ''}>
                        <div class="goal-chip-header">
                          <span class="goal-view">${viewText}</span>
                          ${flags ? `<span class="goal-flags">${flags}</span>` : ''}
                        </div>
                        ${showPrompt ? `<div class="goal-prompt"><span class="goal-prompt-label">Prompt</span>${promptText}</div>` : ''}
                        ${tags ? `<div class="goal-meta">${tags}</div>` : ''}
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="custom-goal" style="margin-top: calc(var(--space-xl) * 2);">
        <label class="type-label">Or describe your own goal:</label>
        <textarea id="custom-goal"
                  class="goal-input"
                  placeholder="What would you like the agent to do?"
                  rows="3">${state.goal || ''}</textarea>
      </div>

      <div class="panel goal-builder">
        <div class="panel-header">Goal builder</div>
        <div class="panel-body goal-builder-grid">
          <div class="goal-builder-main">
            <div class="goal-builder-row">
              <label class="type-label" for="goal-criteria">Success criteria</label>
              <span class="type-caption goal-criteria-count" data-goal-criteria-count>${criteriaCountLabel}</span>
            </div>
            <textarea id="goal-criteria"
                      class="goal-criteria-input"
                      placeholder="One criterion per line"
                      rows="6">${escapeText(criteriaText)}</textarea>
            <div class="goal-builder-actions">
              <button class="btn btn-secondary"
                      data-action="apply-goal-suggestions"
                      ${criteriaSuggestions.length > 0 ? '' : 'disabled'}>
                Use suggested criteria
              </button>
              <button class="btn btn-ghost"
                      data-action="clear-goal-criteria"
                      ${criteriaText.trim() ? '' : 'disabled'}>
                Clear
              </button>
            </div>
            <div class="type-caption">Criteria are appended to the goal before awaken.</div>
          </div>
          <div class="goal-builder-side">
            <div class="card">
              <div class="card-header">Selected goal</div>
              <div class="card-body">
                <div class="goal-meta-title type-h2" data-goal-meta-title>${escapeText(goalTitle)}</div>
                <div class="goal-meta-text type-caption" data-goal-meta-text>${escapeText(goalDescription)}</div>
              </div>
            </div>
            <div class="card">
              <div class="card-header">Signals</div>
              <div class="card-body">
                <div class="goal-meta-tags" data-goal-meta-tags>
                  ${metaTagsMarkup}
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-header">Suggested criteria</div>
              <div class="card-body">
                <ul class="criteria-list" data-goal-suggestions>
                  ${criteriaSuggestionsMarkup}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      ${advancedOpen ? `
        <div class="advanced-panel">
          <div class="advanced-header">
            <span class="type-label">Advanced options</span>
            <span class="type-caption">Stored in localStorage</span>
          </div>
          <div class="advanced-setting">
            <label class="checkbox-label">
              <input type="checkbox"
                     id="preserve-on-boot"
                     ${preserveOnBoot ? 'checked' : ''} />
              <span>Preserve VFS module and shared files on boot</span>
            </label>
            <span class="type-caption">Keeps RSI edits across reloads. Missing files still hydrate from src.</span>
            <div class="advanced-code">
              <span class="type-caption">localStorage</span>
              <code>REPLOID_PRESERVE_ON_BOOT = '${preserveOnBoot ? 'true' : 'false'}'</code>
            </div>
          </div>
          <div class="advanced-setting">
            <label class="type-label" for="advanced-genesis-level">Genesis level</label>
            <select id="advanced-genesis-level">
              <option value="tabula" ${genesisLevel === 'tabula' ? 'selected' : ''}>Tabula</option>
              <option value="spark" ${genesisLevel === 'spark' ? 'selected' : ''}>Spark</option>
              <option value="reflection" ${genesisLevel === 'reflection' ? 'selected' : ''}>Reflection</option>
              <option value="cognition" ${genesisLevel === 'cognition' ? 'selected' : ''}>Cognition</option>
              <option value="substrate" ${genesisLevel === 'substrate' ? 'selected' : ''}>Substrate</option>
              <option value="full" ${genesisLevel === 'full' ? 'selected' : ''}>Full</option>
            </select>
            <span class="type-caption">Each level is a strict superset of the previous one.</span>
            <div class="advanced-code">
              <span class="type-caption">localStorage</span>
              <code>REPLOID_GENESIS_LEVEL = '${genesisLevel}'</code>
            </div>
          </div>
          <div class="advanced-setting">
            <div class="module-overrides-panel">
              <div class="advanced-header">
                <span class="type-label">Module overrides</span>
                <span class="type-caption">Override the selected genesis level</span>
              </div>
              ${renderModuleOverrides()}
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
