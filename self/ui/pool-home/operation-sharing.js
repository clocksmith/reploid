import config from '../../pool/pool-config.json' with { type: 'json' };

export const renderOperationSharing = () => `
  <details class="pool-advanced" data-operation-sharing>
    <summary>Share an answer model</summary>
    <p class="type-caption">Help with public tasks using your answer model.</p>
    <label class="pool-field"><span>Document model settings (.json)</span>
      <input type="file" accept=".json" data-operation-settings></label>
    <label class="pool-consent-row"><input type="checkbox" data-operation-approve>
      <span>I trust these publishers and agree to run public tasks.</span></label>
    <p class="type-caption" role="status" aria-live="polite" data-operation-status>Not sharing</p>
    <button type="button" class="btn btn-primary" data-operation-toggle aria-pressed="false">Share answer model</button>
  </details>`;

export function refreshOperationSharing(root, state) {
  const surface = root.querySelector('[data-operation-sharing]');
  if (!surface) return;
  const active = state.phase !== 'idle';
  surface.querySelector('[data-operation-status]').textContent = state.error || ({ idle: 'Not sharing',
    starting: 'Preparing to share', sharing: `Sharing ${state.modelId}`, stopping: 'Stopping current work' })[state.phase];
  surface.querySelector('[data-operation-settings]').disabled = active;
  surface.querySelector('[data-operation-approve]').disabled = active;
  const button = surface.querySelector('[data-operation-toggle]');
  button.textContent = active ? 'Stop sharing answer model' : 'Share answer model';
  button.setAttribute('aria-pressed', String(active));
  button.disabled = state.phase === 'stopping';
}

export function bindOperationSharing(root, participation) {
  const controller = new AbortController();
  const surface = root.querySelector('[data-operation-sharing]');
  if (!surface) return () => controller.abort();
  let pending = false, revision = 0;
  const error = cause => { if (!controller.signal.aborted) surface.querySelector('[data-operation-status]').textContent = cause.message; };
  surface.querySelector('[data-operation-settings]').addEventListener('change', () => {
    revision++; surface.querySelector('[data-operation-approve]').checked = false;
  }, { signal: controller.signal });
  surface.querySelector('[data-operation-toggle]').addEventListener('click', async () => {
    if (participation.getState().phase !== 'idle') {
      try { await participation.stop(); } catch (cause) { error(cause); }
      return;
    }
    if (pending) return;
    pending = true;
    try {
      const attempt = revision, file = surface.querySelector('[data-operation-settings]').files[0];
      if (!file || file.size > config.operationParticipation.maxConfigurationBytes) throw new Error('Choose a smaller model settings file');
      if (!surface.querySelector('[data-operation-approve]').checked) throw new Error('Confirm publisher trust and sharing first');
      const configuration = JSON.parse(await file.text());
      if (controller.signal.aborted || revision !== attempt) return;
      if (!surface.querySelector('[data-operation-approve]').checked) throw new Error('Sharing approval was withdrawn');
      await participation.start({ configuration, approved: true });
    } catch (cause) { error(cause); }
    finally { pending = false; }
  }, { signal: controller.signal });
  refreshOperationSharing(root, participation.getState());
  return () => { revision++; controller.abort(); };
}
