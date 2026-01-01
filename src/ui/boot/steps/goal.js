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

  return `
    <div class="wizard-step wizard-goal">
      <h2>What do you want to do?</h2>

      <div class="goal-categories">
        ${Object.entries(filteredGoals).map(([category, goals]) => `
          <div class="goal-category">
            <div class="category-header">
              <span class="category-name">${category}</span>
              ${goals.some(g => g.locked) ? `
                <span class="category-lock">Some goals require different setup</span>
              ` : ''}
            </div>
            <div class="category-goals">
              ${goals.map(goal => `
                <button class="goal-chip ${goal.locked ? 'locked' : ''} ${goal.recommended ? 'recommended' : ''}"
                        data-action="select-goal"
                        data-goal="${goal.text}"
                        ${goal.locked ? 'disabled' : ''}>
                  ${goal.text}
                  ${goal.recommended ? '<span class="goal-tag recommended">Recommended</span>' : ''}
                  ${goal.locked ? `<span class="goal-tag locked">${goal.lockReason}</span>` : ''}
                </button>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="custom-goal">
        <label>Or describe your own goal:</label>
        <textarea id="custom-goal"
                  class="goal-input"
                  placeholder="What would you like the agent to do?"
                  rows="3">${state.goal || ''}</textarea>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-config">
          Back
        </button>
        <button class="btn btn-secondary" data-action="advanced-options">
          Advanced Options
        </button>
        <button class="btn btn-primary btn-awaken"
                data-action="awaken"
                ${!canAwaken() ? 'disabled' : ''}>
          Awaken Agent
        </button>
      </div>
    </div>
  `;
}
