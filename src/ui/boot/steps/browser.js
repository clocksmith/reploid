/**
 * @fileoverview Browser/Doppler configuration step renderer
 */

/**
 * Render DOPPLER_CONFIG step
 */
export function renderBrowserConfigStep(state) {
  const { dopplerConfig, detection } = state;
  const models = detection.doppler?.models || [];

  // Available Doppler models to download
  const downloadableModels = [
    { id: 'smollm2-360m', name: 'SmolLM2 360M', size: '200MB', recommended: true },
    { id: 'gemma-2b', name: 'Gemma 2B', size: '1.2GB' },
    { id: 'qwen-0.5b', name: 'Qwen 0.5B', size: '300MB' }
  ];

  return `
    <div class="wizard-step wizard-doppler-config">
      <h2>Browser Model Setup</h2>
      <p class="wizard-subtitle">Select a model to run locally via WebGPU</p>

      <div class="model-options">
        ${downloadableModels.map(m => {
          const cached = models.some(cm => cm.id === m.id);
          return `
            <button class="model-option ${dopplerConfig.model === m.id ? 'selected' : ''} ${cached ? 'cached' : ''}"
                    data-action="select-doppler-model"
                    data-model="${m.id}">
              <div class="model-info">
                <span class="model-name">${m.name}</span>
                ${m.recommended ? '<span class="model-badge">Recommended</span>' : ''}
              </div>
              <div class="model-meta">
                <span class="model-size">${m.size}</span>
                <span class="model-status">${cached ? '★ Cached' : 'Download required'}</span>
              </div>
            </button>
          `;
        }).join('')}
      </div>

      ${dopplerConfig.downloadProgress !== null ? `
        <div class="download-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${dopplerConfig.downloadProgress}%"></div>
          </div>
          <span class="progress-text">${dopplerConfig.downloadProgress}%</span>
        </div>
      ` : ''}

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-choose">
          Back
        </button>
        <button class="btn btn-primary"
                data-action="continue-to-goal"
                ${!dopplerConfig.model ? 'disabled' : ''}>
          Continue
        </button>
      </div>
    </div>
  `;
}
