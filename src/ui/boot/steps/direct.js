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
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
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
      <h2 class="type-h1">Direct API Configuration</h2>
      <p class="type-caption">API keys are stored in your browser</p>

      <div class="config-form">
        <div class="form-row">
          <label class="type-label">Provider</label>
          <select id="direct-provider">
            <option value="">Select provider...</option>
            <option value="anthropic" ${directConfig.provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
            <option value="openai" ${directConfig.provider === 'openai' ? 'selected' : ''}>OpenAI (GPT)</option>
            <option value="gemini" ${directConfig.provider === 'gemini' ? 'selected' : ''}>Google (Gemini)</option>
            <option value="other" ${directConfig.provider === 'other' ? 'selected' : ''}>Other (OpenAI-compatible)</option>
          </select>
        </div>

        ${isOther ? `
          <div class="form-row">
            <label class="type-label">Base URL</label>
            <input type="text"
                   id="direct-base-url"
                   placeholder="https://api.example.com/v1"
                   value="${directConfig.baseUrl || ''}" />
            <span class="type-caption">OpenAI-compatible API base URL</span>
          </div>
        ` : ''}

        <div class="form-row">
          <label class="type-label">API Key</label>
          <form class="input-row" autocomplete="off" onsubmit="return false;">
            <input type="text" name="username" autocomplete="username" style="display:none" aria-hidden="true" />
            <input type="password"
                   id="direct-key"
                   placeholder="Enter your API key"
                   autocomplete="new-password"
                   value="${directConfig.apiKey || ''}" />
            <button type="button"
                    class="btn"
                    data-action="test-direct-key"
                    ${isOther && !directConfig.baseUrl ? 'disabled' : ''}>
              ${directConfig.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </form>
          ${directConfig.verifyState === VERIFY_STATE.VERIFIED ? `
            <span class="type-caption">★ Connection verified</span>
          ` : ''}
          ${directConfig.verifyState === VERIFY_STATE.FAILED ? `
            <span class="type-caption">☒ ${directConfig.verifyError || 'Connection failed'}</span>
          ` : ''}
          ${directConfig.provider === 'anthropic' ? `
            <span class="type-caption">Test sends minimal request (~10 tokens, ~$0.00001)</span>
          ` : ''}
        </div>

        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox"
                   id="remember-key"
                   ${directConfig.rememberKey ? 'checked' : ''} />
            <span>Remember this key locally</span>
          </label>
          <span class="type-caption">△ Key stored unencrypted in browser</span>
        </div>

        <div class="form-row">
          <label class="type-label">Model</label>
          <div class="input-row">
            ${isOther ? `
              <input type="text"
                     id="direct-model"
                     placeholder="Enter model name (e.g., gpt-4)"
                     value="${directConfig.model || ''}" />
            ` : `
              <select id="direct-model" ${!directConfig.provider ? 'disabled' : ''}>
                <option value="">Select model...</option>
                ${models.map(m => `
                  <option value="${m.id}" ${directConfig.model === m.id ? 'selected' : ''}>${m.name}</option>
                `).join('')}
              </select>
            `}
            <button class="btn" data-action="test-direct-model"
                    ${!directConfig.model || !directConfig.apiKey ? 'disabled' : ''}>
              ${directConfig.modelVerifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </div>
          ${directConfig.modelVerifyState === VERIFY_STATE.VERIFIED ? `
            <span class="type-caption">★ Model responded</span>
          ` : ''}
          ${directConfig.modelVerifyState === VERIFY_STATE.FAILED ? `
            <span class="type-caption">☒ ${directConfig.modelVerifyError || 'Model test failed'}</span>
          ` : ''}
        </div>

        ${detection.webgpu.supported ? `
          <div class="form-row substrate-option">
            <label class="checkbox-label">
              <input type="checkbox"
                     id="enable-doppler"
                     ${enableDopplerSubstrate ? 'checked' : ''} />
              <span>Also enable Doppler for substrate access</span>
            </label>
            <span class="type-caption">Enables LoRA, activation steering, weight inspection</span>
          </div>
          ${enableDopplerSubstrate ? `
            <div class="form-row doppler-model-inline">
              <label class="type-label">Doppler Model</label>
              <select id="doppler-model-inline">
                <option value="smollm2-360m" ${dopplerConfig?.model === 'smollm2-360m' ? 'selected' : ''}>SmolLM2 360M (Recommended)</option>
                <option value="gemma-2b" ${dopplerConfig?.model === 'gemma-2b' ? 'selected' : ''}>Gemma 2B</option>
                <option value="qwen-0.5b" ${dopplerConfig?.model === 'qwen-0.5b' ? 'selected' : ''}>Qwen 0.5B</option>
              </select>
            </div>
          ` : ''}
        ` : ''}
      </div>

    </div>
  `;
}
