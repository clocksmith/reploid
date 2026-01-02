/**
 * @fileoverview Goal selection step renderer
 */

import { canAwaken, getCapabilityLevel } from '../state.js';
import { GOAL_CATEGORIES, filterGoalsByCapability } from '../goals.js';

/**
 * Render GOAL step
 */
export function renderGoalStep(state) {
  const capabilities = getCapabilityLevel();
  const filteredGoals = filterGoalsByCapability(GOAL_CATEGORIES, capabilities);
  const advancedOpen = !!state.advancedOpen;
  const preserveOnBoot = !!state.advancedConfig?.preserveOnBoot;
  const genesisLevel = state.advancedConfig?.genesisLevel || 'full';
  const vfsRuntimeNote = preserveOnBoot
    ? 'Runtime: VFS preserves module and shared files on boot. Missing paths hydrate from src.'
    : 'Runtime: VFS refreshes from src on awaken. Advanced settings can preserve VFS files on boot.';

  return `
    <div class="wizard-step wizard-goal">
      <h2 class="type-h1">What is the agent's goal?</h2>
      <div class="goal-intro type-caption">
        <div>${vfsRuntimeNote}</div>
        <div>Prompts use short view labels with full instructions. Doppler evolution appears when a Doppler model is active.</div>
      </div>

      <div class="goal-categories">
        ${Object.entries(filteredGoals).map(([category, goals]) => {
          const isDopplerCategory = goals.length > 0 && goals.every(goal => goal.requires?.doppler);
          if (isDopplerCategory && !capabilities.canDoDopplerEvolution) {
            return '';
          }

          const meta = [
            isDopplerCategory ? '<span class="category-note">Doppler active</span>' : '',
            goals.some(g => g.locked) ? '<span class="type-caption">Some goals require different setup</span>' : ''
          ].filter(Boolean).join('');

          return `
            <div class="goal-category ${isDopplerCategory ? 'doppler' : ''}">
              <div class="category-header">
                <span class="category-name type-label">${category}</span>
                ${meta ? `<div class="category-meta">${meta}</div>` : ''}
              </div>
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
          `;
        }).join('')}
      </div>

      <div class="custom-goal">
        <label class="type-label">Or describe your own goal:</label>
        <textarea id="custom-goal"
                  class="goal-input"
                  placeholder="What would you like the agent to do?"
                  rows="3">${state.goal || ''}</textarea>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-secondary" data-action="advanced-settings">
          ${advancedOpen ? 'Hide advanced settings' : 'Advanced settings'}
        </button>
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
              <option value="seed" ${genesisLevel === 'seed' ? 'selected' : ''}>Seed</option>
              <option value="tabula" ${genesisLevel === 'tabula' ? 'selected' : ''}>Tabula</option>
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
        </div>
      ` : ''}
    </div>
  `;
}
