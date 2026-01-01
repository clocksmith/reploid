/**
 * @fileoverview Direct API configuration step renderer
 */

import { VERIFY_STATE } from '../state.js';

// Cloud provider model lists
export const CLOUD_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
    { id: 'claude-opus-4-5-20251101', name: 'Claude 4.5 Opus' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' }
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
  ]
};

/**
 * Render DIRECT_CONFIG step - Direct cloud API with keys in browser
 */
export function renderDirectConfigStep(state) {
  const { directConfig, detection, enableDopplerSubstrate, dopplerConfig } = state;
  const isOther = directConfig.provider === 'other';
  const models = directConfig.provider && !isOther ? (CLOUD_MODELS[directConfig.provider] || []) : [];

  return `
    <div class="wizard-step wizard-direct-config">
      <h2>Direct API Configuration</h2>
      <p class="wizard-subtitle">API keys are stored in your browser</p>

      <div class="config-form">
        <div class="form-row">
          <label>Provider</label>
          <select id="direct-provider" class="config-select">
            <option value="">Select provider...</option>
            <option value="anthropic" ${directConfig.provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
            <option value="openai" ${directConfig.provider === 'openai' ? 'selected' : ''}>OpenAI (GPT-4)</option>
            <option value="gemini" ${directConfig.provider === 'gemini' ? 'selected' : ''}>Google (Gemini)</option>
            <option value="other" ${directConfig.provider === 'other' ? 'selected' : ''}>Other (OpenAI-compatible)</option>
          </select>
        </div>

        ${isOther ? `
          <div class="form-row">
            <label>Base URL</label>
            <input type="text"
                   id="direct-base-url"
                   class="config-input"
                   placeholder="https://api.example.com/v1"
                   value="${directConfig.baseUrl || ''}" />
            <div class="form-note">OpenAI-compatible API base URL</div>
          </div>
        ` : ''}

        <div class="form-row">
          <label>API Key</label>
          <form class="input-with-action" autocomplete="off" onsubmit="return false;">
            <input type="text" name="username" autocomplete="username" style="display:none" aria-hidden="true" />
            <input type="password"
                   id="direct-key"
                   class="config-input"
                   placeholder="Enter your API key"
                   autocomplete="new-password"
                   value="${directConfig.apiKey || ''}" />
            <button type="button"
                    class="btn btn-secondary"
                    data-action="test-direct-key"
                    ${isOther && !directConfig.baseUrl ? 'disabled' : ''}>
              ${directConfig.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </form>
          ${directConfig.verifyState === VERIFY_STATE.VERIFIED ? `
            <div class="form-success">★ Connection verified</div>
          ` : ''}
          ${directConfig.verifyState === VERIFY_STATE.FAILED ? `
            <div class="form-error">☒ ${directConfig.verifyError || 'Connection failed'}</div>
          ` : ''}
          ${directConfig.provider === 'anthropic' ? `
            <div class="form-note">Test sends minimal request (~10 tokens, ~$0.00001)</div>
          ` : ''}
        </div>

        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox"
                   id="remember-key"
                   ${directConfig.rememberKey ? 'checked' : ''} />
            <span>Remember this key locally</span>
          </label>
          <div class="form-note warning">Key stored unencrypted in browser</div>
        </div>

        <div class="form-row">
          <label>Model</label>
          ${isOther ? `
            <input type="text"
                   id="direct-model"
                   class="config-input"
                   placeholder="Enter model name (e.g., gpt-4)"
                   value="${directConfig.model || ''}" />
          ` : `
            <select id="direct-model" class="config-select" ${!directConfig.provider ? 'disabled' : ''}>
              <option value="">Select model...</option>
              ${models.map(m => `
                <option value="${m.id}" ${directConfig.model === m.id ? 'selected' : ''}>${m.name}</option>
              `).join('')}
            </select>
          `}
        </div>

        ${detection.webgpu.supported ? `
          <div class="form-row substrate-option">
            <label class="checkbox-label">
              <input type="checkbox"
                     id="enable-doppler"
                     ${enableDopplerSubstrate ? 'checked' : ''} />
              <span>Also enable Doppler for substrate access</span>
            </label>
            <div class="form-note">Enables LoRA, activation steering, weight inspection</div>
          </div>
          ${enableDopplerSubstrate ? `
            <div class="form-row doppler-model-inline">
              <label>Doppler Model</label>
              <select id="doppler-model-inline" class="config-select">
                <option value="smollm2-360m" ${dopplerConfig?.model === 'smollm2-360m' ? 'selected' : ''}>SmolLM2 360M (Recommended)</option>
                <option value="gemma-2b" ${dopplerConfig?.model === 'gemma-2b' ? 'selected' : ''}>Gemma 2B</option>
                <option value="qwen-0.5b" ${dopplerConfig?.model === 'qwen-0.5b' ? 'selected' : ''}>Qwen 0.5B</option>
              </select>
            </div>
          ` : ''}
        ` : ''}
      </div>

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-choose">
          Back
        </button>
        <button class="btn btn-primary"
                data-action="continue-to-goal"
                ${!directConfig.provider || !directConfig.model ? 'disabled' : ''}>
          Continue ${directConfig.verifyState !== VERIFY_STATE.VERIFIED ? '(unverified)' : ''}
        </button>
      </div>
    </div>
  `;
}
