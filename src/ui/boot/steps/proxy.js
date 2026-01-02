/**
 * @fileoverview Proxy configuration step renderer
 */

import { VERIFY_STATE } from '../state.js';

/**
 * Render PROXY_CONFIG step - unified proxy/server configuration
 */
export function renderProxyConfigStep(state) {
  const { proxyConfig, detection } = state;

  // Determine best default URL based on detection
  const proxyDetected = detection.proxy?.detected;
  const ollamaDetected = detection.ollama?.detected;
  let defaultUrl = 'http://localhost:8000';
  if (proxyDetected) {
    defaultUrl = detection.proxy.url;
  } else if (ollamaDetected) {
    defaultUrl = detection.ollama.url;
  }

  // Get available models from detection
  const ollamaModels = detection.ollama?.models || [];
  const proxyProviders = detection.proxy?.configuredProviders || [];

  // Determine server type for display
  const serverType = proxyConfig.serverType || (proxyDetected ? 'reploid' : ollamaDetected ? 'ollama' : null);
  const serverTypeLabel = serverType === 'reploid' ? 'Reploid Proxy' : serverType === 'ollama' ? 'Ollama' : 'Server';

  return `
    <div class="wizard-step wizard-proxy-config">
      <h2>Proxy Configuration</h2>
      <p class="wizard-subtitle">Connect to a local or remote server</p>

      <div class="config-form">
        <div class="form-row">
          <label>Server URL</label>
          <div class="input-with-action">
            <input type="text"
                   id="proxy-url"
                                      placeholder="http://localhost:8000"
                   value="${proxyConfig.url || defaultUrl}" />
            <button class="btn btn-secondary" data-action="test-proxy">
              ${proxyConfig.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </div>
          ${proxyConfig.verifyState === VERIFY_STATE.VERIFIED ? `
            <div class="form-success">★ ${serverTypeLabel} connected</div>
          ` : ''}
          ${proxyConfig.verifyState === VERIFY_STATE.FAILED ? `
            <div class="form-error">☒ ${proxyConfig.verifyError || 'Connection failed'}</div>
          ` : ''}
          <div class="form-note">
            Default ports: 8000 (Reploid proxy), 11434 (Ollama)
          </div>
        </div>

        ${proxyProviders.length > 0 ? `
          <div class="form-row">
            <label>Provider</label>
            <select id="proxy-provider" class="config-select">
              <option value="">Select provider...</option>
              ${proxyProviders.map(p => `
                <option value="${p}" ${proxyConfig.provider === p ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>
              `).join('')}
            </select>
            <div class="form-note">Providers configured on the proxy server</div>
          </div>
        ` : ''}

        <div class="form-row">
          <label>Model</label>
          ${ollamaModels.length > 0 && serverType === 'ollama' ? `
            <select id="proxy-model" class="config-select">
              <option value="">Select model...</option>
              ${ollamaModels.map(m => `
                <option value="${m.id}" ${proxyConfig.model === m.id ? 'selected' : ''}>${m.name}</option>
              `).join('')}
            </select>
          ` : `
            <input type="text"
                   id="proxy-model"
                                      placeholder="${serverType === 'ollama' ? 'e.g., llama3:8b' : 'e.g., gemini-2.0-flash'}"
                   value="${proxyConfig.model || ''}" />
          `}
        </div>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-tertiary" data-action="back-to-choose">
          Back
        </button>
        <button class="btn btn-primary"
                data-action="continue-to-goal"
                ${!proxyConfig.url || !proxyConfig.model ? 'disabled' : ''}>
          Continue ${proxyConfig.verifyState !== VERIFY_STATE.VERIFIED ? '(unverified)' : ''}
        </button>
      </div>
    </div>
  `;
}
