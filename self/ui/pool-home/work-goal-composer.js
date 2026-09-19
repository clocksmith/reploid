/**
 * Goal composer component for the Work interface.
 * Centered single-column input with product promise, material attachments,
 * optional criteria drawer, model/permission settings, and execution boundaries.
 */
import policy from '../../config/work-profile.json' with { type: 'json' };
import { DEFAULT_WORK_MODELS } from '../../host/work-session.js';
import { selectWorkModel } from '../../providers/work-provider.js';

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderGoalComposer({ models = DEFAULT_WORK_MODELS, defaultModelId = policy.defaultModelId } = {}) {
  const defaultModel = selectWorkModel({ models, defaultModelId });

  return [
    '<div class="pool-work-composer-shell">',
    '  <header class="pool-work-hero">',
    '    <div class="pool-work-brand">',
    '      <svg class="pool-work-mark" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">',
    '        <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke-linejoin="round" />',
    '        <line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="1 2" />',
    '        <line x1="2" y1="8" x2="22" y2="16" stroke-opacity="0.6" />',
    '        <line x1="2" y1="16" x2="22" y2="8" stroke-opacity="0.6" />',
    '      </svg>',
    '      <div class="pool-work-brand-text">',
    '        <h1 class="pool-work-hero-title">Reploid Compute Pool</h1>',
    '        <p class="pool-work-promise">Reploid connects browser nodes to share local AI compute, verify signed results, and run agent tasks peer-to-peer.</p>',
    '      </div>',
    '    </div>',
    '    <div class="pool-hero-stats" role="status" aria-label="Compute node status">',
    '      <div class="pool-hero-badge"><span class="pool-badge-dot pool-badge-dot--active">&#9679;</span> Mesh Node: <strong>Active</strong></div>',
    '      <div class="pool-hero-badge"><span class="pool-badge-dot pool-badge-dot--ready">&#9889;</span> Provider: <strong>Ready</strong></div>',
    '      <div class="pool-hero-badge"><span class="pool-badge-dot pool-badge-dot--room">&#9890;</span> Room: <strong>default</strong></div>',
    '    </div>',
    '  </header>',
    '  <form class="pool-work-composer" data-work-form>',
    '    <div class="pool-model-bar" role="group" aria-label="Model Selection">',
    '      <span class="pool-model-bar-label">Inference Model:</span>',
    '      <div class="pool-model-pills" data-work-model-pills>',
    ...models.map(model =>
      '        <button type="button" class="pool-model-pill' + (model.id === defaultModel.id ? ' is-active' : '') + '" data-work-model-select="' + escapeHtml(model.id) + '">' +
      '<span class="pool-model-pill-icon">' + (model.provider === 'gemini' ? '&#9889;' : '&#9096;') + '</span> ' +
      '<span class="pool-model-pill-name">' + escapeHtml(model.name) + '</span> ' +
      '<span class="pool-model-pill-badge">' + (model.provider === 'gemini' ? 'Cloud' : 'Local') + '</span>' +
      '</button>'
    ),
    '      </div>',
    '    </div>',
    '    <div class="pool-goal-presets" aria-label="Quick start goal presets">',
    '      <span class="pool-presets-label">Quick goals:</span>',
    '      <button type="button" class="pool-preset-btn" data-goal-preset="patch"><span class="pool-preset-icon">&#10022;</span> Draft Patch</button>',
    '      <button type="button" class="pool-preset-btn" data-goal-preset="json"><span class="pool-preset-icon">&#10022;</span> Validate JSON</button>',
    '      <button type="button" class="pool-preset-btn" data-goal-preset="benchmark"><span class="pool-preset-icon">&#10022;</span> Benchmark Model</button>',
    '    </div>',
    '    <div class="pool-work-field">',
    '      <label for="work-goal" class="pool-work-label">Goal</label>',
    '      <textarea id="work-goal" data-work-goal rows="4" maxlength="' + policy.maxGoalCharacters + '" required placeholder="What do you want accomplished?"></textarea>',
    '    </div>',
    '    <div class="pool-work-inputs">',
    '      <label for="work-files">Working material <span class="type-caption">optional, stays on device</span></label>',
    '      <input id="work-files" type="file" multiple accept=".txt,.md,.csv,.json,.js,.ts,.html,.css,.wgsl,.xml,.yaml,.yml,.log" data-work-files>',
    '      <p class="type-caption">UTF-8 text or source files. Up to ' + policy.files.maxInputs + ' files, ' + (policy.files.maxInputBytes / 1024) + ' KiB total.</p>',
    '      <ul data-work-input-list></ul>',
    '      <button class="btn btn-ghost" type="button" data-work-clear-inputs hidden>Remove files</button>',
    '    </div>',
    '    <details class="pool-work-criteria-drawer" open>',
    '      <summary>Criteria &amp; constraints (optional)</summary>',
    '      <div class="pool-work-drawer-body">',
    '        <label for="work-criteria" class="type-caption">A useful result must...</label>',
    '        <textarea id="work-criteria" data-work-criteria rows="2" maxlength="' + policy.maxCriteriaCharacters + '" placeholder="Name the deliverable, constraints, and checks that matter (inferred if left blank)."></textarea>',
    '      </div>',
    '    </details>',
    '    <div data-work-revision hidden>',
    '      <label for="work-feedback">What should change from the earlier attempt?</label>',
    '      <textarea id="work-feedback" data-work-feedback rows="2" maxlength="' + policy.maxFeedbackCharacters + '"></textarea>',
    '      <p class="type-caption">The earlier outcome and your feedback become context for a new attempt.</p>',
    '    </div>',
    '    <details class="pool-work-settings">',
    '      <summary>Advanced permissions &amp; fallback</summary>',
    '      <div class="pool-work-drawer-body">',
    '        <label for="work-model" class="pool-work-model-select-label">Model select fallback',
    '          <select id="work-model" data-work-model>',
    ...models.map(model => '            <option value="' + escapeHtml(model.id) + '"' + (model.id === defaultModel.id ? ' selected' : '') + '>' + escapeHtml(model.name) + ' (' + (model.provider === 'gemini' ? 'Gemini Cloud' : 'Doppler Local') + ')</option>'),
    '          </select>',
    '        </label>',
    '        <label class="pool-consent-row"><input type="checkbox" data-work-peers><span>Let the agent propose peer assistance. Ask before sending.</span></label>',
    '        <label class="pool-consent-row"><input type="checkbox" data-work-recall><span>Allow recall of earlier results accepted on this device.</span></label>',
    '      </div>',
    '    </details>',
    '    <div class="pool-work-execution-indicator">',
    '      <span class="pool-work-indicator-dot">&#9679;</span>',
    '      <span>Model: <strong data-work-active-model-name>' + escapeHtml(defaultModel.name) + '</strong></span>',
    '      <span>&bull;</span>',
    '      <span>Browser sandbox isolation</span>',
    '      <span>&bull;</span>',
    '      <span>No unapproved network/code execution</span>',
    '    </div>',
    '    <div class="pool-work-actions">',
    '      <button class="btn btn-primary" type="submit" data-work-start>Start work</button>',
    '      <button class="btn btn-ghost" type="button" data-work-cancel hidden>Stop work</button>',
    '      <button class="btn btn-ghost" type="button" data-work-new>New task</button>',
    '    </div>',
    '  </form>',
    '</div>'
  ].join('\n');
}
