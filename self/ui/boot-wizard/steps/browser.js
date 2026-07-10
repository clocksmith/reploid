/**
 * @fileoverview Doppler configuration step renderer
 */

import { LOCAL_DOPPLER_MODELS } from '../../../config/doppler-local-models.js';

/**
 * Render DOPPLER_CONFIG step
 */
export function renderBrowserConfigStep(state) {
  const { dopplerConfig, detection } = state;
  const models = detection.doppler?.models || [];
  const downloadableModels = LOCAL_DOPPLER_MODELS;

  return `
    <div class="wizard-step wizard-doppler-config">
      <h2 class="type-h1">Optional local Doppler</h2>
      <p class="type-caption">Select a browser-local model only when you want Zero to run without the server proxy.</p>

      <div class="model-options">
	        ${downloadableModels.map(m => {
	          const cached = models.some(cm => cm.id === m.id);
	          const selected = dopplerConfig.model === m.id;
            const status = cached
              ? '★ Cached'
              : selected
                ? 'Downloads on awaken'
                : 'Select for first run';
	          return `
	            <button class="model-option ${selected ? 'selected' : ''} ${cached ? 'cached' : ''}"
	                    data-action="select-doppler-model"
	                    data-model="${m.id}"
	                    aria-pressed="${selected ? 'true' : 'false'}">
	              <div class="model-info">
	                <span class="model-name">${m.name}</span>
	                ${m.recommended ? '<span class="model-badge">Recommended</span>' : ''}
	              </div>
              <div class="model-meta">
                <span class="model-size">${m.size}</span>
                <span class="model-status">${status}</span>
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
    </div>
  `;
}
