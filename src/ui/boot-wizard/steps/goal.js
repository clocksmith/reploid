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
  const goalValue = state.goal || '';
  const generatorStatus = state.goalGenerator?.status || 'idle';
  const generatorError = state.goalGenerator?.error || null;
  const generating = generatorStatus === 'generating';

  return `
    <div class="wizard-step wizard-goal">
      <div class="goal-header">
        <h2 class="type-h1">Set a goal</h2>
        <div class="goal-intro type-caption">
          Keep it concise. The text is passed verbatim to the agent.
        </div>
      </div>

      <div class="panel goal-generator-panel">
        <button class="btn btn-prism"
                data-action="generate-goal"
                ${generating ? 'disabled' : ''}>
          ${generating ? 'Generating...' : 'Have the brain generate its own RSI goal'}
        </button>
        ${generatorError ? `<div class="type-caption goal-generator-error">☒ ${escapeText(generatorError)}</div>` : ''}
        ${generatorStatus === 'ready' ? '<div class="type-caption goal-generator-ready">★ Generated with selected brain</div>' : ''}
      </div>

      <div class="custom-goal">
        <label class="type-label" for="goal-input">Goal</label>
        <textarea id="goal-input"
                  class="goal-input"
                  maxlength="500"
                  rows="3">${escapeText(goalValue)}</textarea>
      </div>

      <details class="goal-library">
        <summary class="goal-library-summary">Use a preset goal</summary>
        <div class="goal-library-body">
          ${entries.map(([category, goals]) => {
            const unlockedCount = goals.filter(goal => !goal.locked).length;
            return `
              <section class="goal-library-group">
                <div class="goal-library-group-header">
                  <h3 class="type-h2">${escapeText(category)}</h3>
                  <span class="accordion-meta">${escapeText(`${unlockedCount}/${goals.length}`)}</span>
                </div>
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
                          ${tags ? `<span class="goal-flags">${tags}</span>` : ''}
                        </div>
                        <div class="goal-prompt">${escapeText(goalText)}</div>
                      </button>
                    `;
                  }).join('')}
                </div>
              </section>
            `;
          }).join('')}
        </div>
      </details>

      <div class="type-caption goal-footnote">
        Presets stay collapsed by default. There are 15 prompts here: 3 each for L0, L1, L2, L3, and L4.
      </div>
    </div>
  `;
}
