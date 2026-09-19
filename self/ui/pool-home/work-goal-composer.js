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
      <header class="pool-work-hero">
        <h1 class="pool-work-hero-title">What do you want to get done?</h1>
        <p class="pool-work-promise">Give Reploid a task. It can work with your files and produce a result for you to review.</p>
      </header>
      <form class="pool-work-composer" data-work-form>
        <div class="pool-work-field">
          <label for="work-goal" class="pool-work-label">Your task</label>
          <textarea id="work-goal" data-work-goal rows="4" maxlength="${policy.maxGoalCharacters}" required
            placeholder="For example: find the problem in this code and draft a patch."></textarea>
        </div>
        <div class="pool-goal-presets" aria-label="Example tasks">
          <button type="button" class="pool-preset-btn" data-goal-preset="patch">Draft a patch</button>
          <button type="button" class="pool-preset-btn" data-goal-preset="json">Check JSON</button>
          <button type="button" class="pool-preset-btn" data-goal-preset="summary">Summarize a file</button>
        </div>
        <details class="pool-work-attachments" data-work-attachments>
          <summary>Add files <span class="type-caption" data-work-file-count>optional</span></summary>
          <div class="pool-work-drawer-body">
            <label for="work-files">Text or source files</label>
            <input id="work-files" type="file" multiple accept=".txt,.md,.csv,.json,.js,.ts,.html,.css,.wgsl,.xml,.yaml,.yml,.log" data-work-files>
            <p class="type-caption">Up to ${policy.files.maxInputs} files, ${policy.files.maxInputBytes / 1024} KiB total. The selected model can read these files.</p>
            <ul data-work-input-list></ul>
            <button class="btn btn-ghost" type="button" data-work-clear-inputs hidden>Remove files</button>
          </div>
        </details>
        <div class="pool-work-model-row">
          <label for="work-model">Model</label>
          <select id="work-model" data-work-model aria-describedby="work-execution-location">
            ${models.map(model => `<option value="${escapeHtml(model.id)}"${model.id === defaultModel.id ? ' selected' : ''}>${escapeHtml(model.name)} · ${model.provider === 'gemini' ? 'Cloud' : 'On this device'}</option>`).join('')}
          </select>
        </div>
        <p id="work-execution-location" class="pool-control-help" data-work-location></p>
        <div data-work-revision hidden>
          <label for="work-feedback">What should change?</label>
          <textarea id="work-feedback" data-work-feedback rows="2" maxlength="${policy.maxFeedbackCharacters}"></textarea>
        </div>
        <div class="pool-work-actions">
          <button class="btn btn-primary" type="submit" data-work-start>Start work</button>
          <button class="btn btn-ghost" type="button" data-work-cancel hidden>Stop work</button>
        </div>
        <p class="pool-work-status" role="status" aria-live="polite" data-work-start-status hidden></p>
        <details class="pool-work-settings">
          <summary>Success criteria &amp; permissions</summary>
          <div class="pool-work-drawer-body">
            <label for="work-criteria">A useful result must... <span class="type-caption">optional</span></label>
            <textarea id="work-criteria" data-work-criteria rows="2" maxlength="${policy.maxCriteriaCharacters}"
              placeholder="Name the result and checks that matter. Otherwise Reploid will propose them."></textarea>
            <label class="pool-consent-row"><input type="checkbox" data-work-peers><span>Allow peer assistance requests. Ask me before sending any task data.</span></label>
            <label class="pool-consent-row"><input type="checkbox" data-work-recall><span>Use earlier results I accepted on this device.</span></label>
          </div>
        </details>
      </form>
      <p class="pool-work-network-hint">Need another device's help? <a href="/network" data-pool-route-link="/network">Network</a> lets you find peers or share compute. Participation is optional.</p>
    </div>`;
}
