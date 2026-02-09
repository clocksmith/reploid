/**
 * @fileoverview Goal selection step renderer
 */

import { getGoalCategories } from '../goals.js';

const escapeText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const escapeAttr = (value) => escapeText(value).replace(/'/g, '&#39;');

const buildGoalTags = (goal) => {
  const tags = Array.isArray(goal.tags) ? goal.tags : [];
  return Array.from(new Set(tags)).slice(0, 5);
};

/**
 * Render GOAL step
 */
export function renderGoalStep(state) {
  const categories = getGoalCategories();
  const entries = Object.entries(categories);
  const selectedCategory = state.selectedGoalCategory || entries[0]?.[0] || null;
  const goalValue = state.goal || '';

  return `
    <div class="wizard-step wizard-goal">
      <h2 class="type-h1">What is the agent's goal?</h2>
      <div class="goal-intro type-caption">
        Choose an RSI prompt or enter a custom goal. You can edit the text before awakening.
      </div>

      <div class="accordion goal-accordion">
        ${entries.map(([category, goals]) => {
          const isSelected = category === selectedCategory;
          const unlockedCount = goals.filter(goal => !goal.locked).length;
          const metaText = `${unlockedCount}/${goals.length}`;
          return `
            <div class="accordion-item" data-category="${escapeAttr(category)}">
              <button class="accordion-header" data-action="toggle-goal-category" data-category="${escapeAttr(category)}" aria-expanded="${isSelected}">
                <span>${escapeText(category)}</span>
                <span class="accordion-meta">${escapeText(metaText)}</span>
              </button>
              <div class="accordion-content" aria-hidden="${!isSelected}">
                <div class="category-goals">
	                  ${goals.map((goal) => {
	                    const goalText = goal.text || goal.view || '';
                    const viewText = goal.view || goalText;
                    const tags = buildGoalTags(goal)
                      .map(tag => `<span class="goal-tag">${escapeText(tag)}</span>`)
                      .join('');
	                    const locked = goal.locked ? 'locked' : '';
	                    const isSelected = goalText === goalValue;
	                    const selected = isSelected ? 'selected' : '';

	                    return `
	                      <button class="goal-chip ${locked} ${selected}"
	                              data-action="select-goal"
	                              data-goal="${escapeAttr(goalText)}"
	                              title="${escapeAttr(goalText)}"
	                              aria-pressed="${isSelected ? 'true' : 'false'}"
	                              ${goal.locked ? 'disabled' : ''}>
                        <div class="goal-chip-header">
                          <span class="goal-view">${escapeText(viewText)}</span>
                          ${tags ? `<span class=\"goal-flags\">${tags}</span>` : ''}
                        </div>
                        <div class="goal-prompt">${escapeText(goalText)}</div>
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
        <label class="type-label" for="goal-input">Or describe your own goal:</label>
        <textarea id="goal-input"
                  class="goal-input"
                  maxlength="500"
                  rows="3">${escapeText(goalValue)}</textarea>
        <div class="type-caption" style="margin-top: var(--space-sm);">
          Keep it concise. The goal is passed verbatim to the agent.
        </div>
      </div>
    </div>
  `;
}
