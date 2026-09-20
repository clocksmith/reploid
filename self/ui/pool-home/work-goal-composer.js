/** Task-first input. Provider choice and disclosure remain explicit host decisions. */
import policy from '../../config/work-profile.json' with { type: 'json' };
import { DEFAULT_WORK_MODELS } from '../../host/work-session.js';
import { selectWorkModel } from '../../providers/work-provider.js';

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderGoalComposer({ models = DEFAULT_WORK_MODELS, defaultModelId = policy.defaultModelId } = {}) {
  const defaultModel = selectWorkModel({ models, defaultModelId });
  return `
    <div class="pool-work-composer-shell">
      <form class="pool-work-composer" data-work-form>
        <div class="pool-work-field">
          <label for="work-goal" class="pool-work-label">Objective</label>
          <textarea id="work-goal" data-work-goal rows="3" maxlength="${policy.maxGoalCharacters}" required
            placeholder="Describe the result you want..."></textarea>
        </div>
        <div class="pool-work-launch-row">
          <div class="pool-work-model-group">
            <div class="pool-work-model-row">
              <label for="work-model">Models</label>
              <select id="work-model" data-work-model aria-describedby="work-execution-location">
                ${models.map(model => `<option value="${escapeHtml(model.id)}"${model.id === defaultModel.id ? ' selected' : ''}>${escapeHtml(model.name)} · ${model.provider === 'gemini' ? 'Cloud' : 'On this device'}</option>`).join('')}
              </select>
            </div>
            <p id="work-execution-location" class="pool-control-help" data-work-location></p>
          </div>
          <div class="pool-work-actions">
            <button class="btn btn-primary" type="submit" data-work-start>Start work</button>
            <button class="btn btn-ghost" type="button" data-work-cancel hidden>Stop</button>
          </div>
        </div>
        <p class="pool-work-status" role="status" aria-live="polite" data-work-start-status hidden></p>
            <fieldset class="pool-work-capabilities"><legend>Agents</legend>
              <label><input type="checkbox" data-work-helpers> Use helpers</label>
              <label><input type="checkbox" data-work-peers> Ask peers</label>
            </fieldset>
        <details class="pool-work-options pool-work-attachments pool-work-settings" data-work-attachments>
          <summary>Task settings <span class="type-caption" data-work-file-count></span></summary>
          <div class="pool-work-drawer-body">
            <label for="work-files">Text or source files</label>
            <input id="work-files" type="file" multiple accept=".txt,.md,.csv,.json,.js,.ts,.html,.css,.wgsl,.xml,.yaml,.yml,.log" data-work-files>
            <ul data-work-input-list></ul>
            <button class="btn btn-ghost" type="button" data-work-clear-inputs hidden>Remove files</button>

            <label for="work-criteria">A useful result must... <span class="type-caption">optional</span></label>
            <textarea id="work-criteria" data-work-criteria rows="2" maxlength="${policy.maxCriteriaCharacters}"
              placeholder="Add checks that matter, or let Reploid propose them."></textarea>
            <label class="pool-consent-row"><input type="checkbox" data-work-recall><span>Use earlier results I accepted on this device.</span></label>
            <label class="pool-consent-row"><input type="checkbox" data-work-improvement><span>Test tool improvements. Adoption requires separate approval.</span></label>
          </div>
        </details>
        <div data-work-revision hidden>
          <label for="work-feedback">What should change?</label>
          <textarea id="work-feedback" data-work-feedback rows="2" maxlength="${policy.maxFeedbackCharacters}"></textarea>
        </div>
      </form>
    </div>`;
}
