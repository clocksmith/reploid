import config from '../../pool/pool-config.json' with { type: 'json' };
import { listPoolModels } from '../../pool/model-contract.js';
import { validateOperationModel } from '../../pool/operation-model.js';

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const models = () => listPoolModels({ enabledOnly: true }).filter(model => validateOperationModel(model).ok);

export const renderOperationSharing = () => [
  '<div class="pool-control-stack" data-operation-sharing>',
  '<div class="pool-control-group">',
  '<label class="pool-field" for="operation-model"><span>Executable capability</span>',
  '<select id="operation-model" data-operation-model aria-describedby="operation-model-help">',
  ...models().map(model => '<option value="' + escapeHtml(model.modelId) + '">' + escapeHtml(model.label || model.modelId)
    + ' / ' + escapeHtml(model.executablePack.requiredOperation) + '</option>'),
  '<option value="">Import an exact model descriptor</option></select></label>',
  '<p class="pool-control-help" id="operation-model-help">Only admitted catalog operations appear here. A language model is not available to peers just because it can run locally.</p></div>',
  '<div class="pool-control-group" data-operation-import hidden>',
  '<label class="pool-field"><span>Signed model descriptor (.json)</span>',
  '<input type="file" accept=".json" data-operation-settings aria-describedby="operation-import-help"></label>',
  '<p class="pool-control-help" id="operation-import-help">Supply the exact model, artifacts, runtime, and trusted publisher. Legacy document model settings remain supported.</p></div>',
  '<p class="pool-control-help">Declared limits: ' + config.operationParticipation.resources.concurrency + ' simultaneous job; '
    + (config.operationParticipation.resources.gpuBudgetBytes / 1073741824) + ' GiB GPU allowance; '
    + (config.operationParticipation.maxModelArtifactBytes / 1073741824) + ' GiB maximum model download.</p>',
  '<div class="pool-control-footer">',
  '<label class="pool-consent-row"><input type="checkbox" data-operation-approve>',
  '<span>I trust the selected publisher and allow this device to execute public inputs for this operation.</span></label>',
  '<div class="pool-control-actions">',
  '<button type="button" class="btn btn-primary" data-operation-toggle aria-pressed="false">Share this capability</button>',
  '<p class="pool-control-status" role="status" aria-live="polite" data-operation-status>Not sharing</p></div>',
  '<p class="pool-control-help">Weights may load on the first job. This does not expose private work or enable candidate adoption.</p>',
  '</div></div>'
].join('');

export function refreshOperationSharing(root, state) {
  const surface = root.querySelector('[data-operation-sharing]');
  if (!surface) return;
  const active = state.phase !== 'idle';
  surface.querySelector('[data-operation-status]').textContent = state.error || ({
    idle: 'Not sharing', starting: 'Preparing the operation offer',
    sharing: 'Offering ' + state.modelId + '. Jobs load the exact model when needed.',
    stopping: 'Stopping participation and releasing owned work'
  })[state.phase];
  for (const field of surface.querySelectorAll('input,select')) field.disabled = active;
  const button = surface.querySelector('[data-operation-toggle]');
  button.textContent = active ? 'Stop sharing' : 'Share this capability';
  button.setAttribute('aria-pressed', String(active));
  button.disabled = state.phase === 'stopping';
}

export function bindOperationSharing(root, participation) {
  const controller = new AbortController(), surface = root.querySelector('[data-operation-sharing]');
  if (!surface) return () => controller.abort();
  let pending = false, revision = 0;
  const error = cause => { if (!controller.signal.aborted) surface.querySelector('[data-operation-status]').textContent = cause.message; };
  const changed = () => {
    revision++;
    surface.querySelector('[data-operation-approve]').checked = false;
    surface.querySelector('[data-operation-import]').hidden = !!surface.querySelector('[data-operation-model]').value;
  };
  for (const selector of ['[data-operation-settings]', '[data-operation-model]']) {
    surface.querySelector(selector).addEventListener('change', changed, { signal: controller.signal });
  }
  surface.querySelector('[data-operation-toggle]').addEventListener('click', async () => {
    if (participation.getState().phase !== 'idle') {
      try { await participation.stop(); } catch (cause) { error(cause); }
      return;
    }
    if (pending) return;
    pending = true;
    try {
      const attempt = revision, modelId = surface.querySelector('[data-operation-model]').value;
      if (!surface.querySelector('[data-operation-approve]').checked) throw new Error('Approve the publisher and public-input execution first');
      let selection;
      if (modelId) {
        const model = models().find(item => item.modelId === modelId);
        if (!model) throw new Error('This capability is no longer admitted');
        selection = { model };
      } else {
        const file = surface.querySelector('[data-operation-settings]').files[0];
        if (!file || file.size > config.operationParticipation.maxConfigurationBytes) throw new Error('Choose a smaller model descriptor');
        const value = JSON.parse(await file.text());
        selection = value.schema === 'reploid.document-models/v1' ? { configuration: value } : { model: value };
      }
      if (controller.signal.aborted || attempt !== revision) return;
      if (!surface.querySelector('[data-operation-approve]').checked) throw new Error('Sharing approval was withdrawn');
      await participation.start({ ...selection, approved: true });
    } catch (cause) { error(cause); }
    finally { pending = false; }
  }, { signal: controller.signal });
  changed(); refreshOperationSharing(root, participation.getState());
  return () => { revision++; controller.abort(); };
}
