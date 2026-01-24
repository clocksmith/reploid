/**
 * @fileoverview Proxy configuration step renderer
 */

import { VERIFY_STATE } from '../state.js';
import { CLOUD_MODELS } from './direct.js';

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
  const detected = proxyDetected || ollamaDetected;

  return `
    <div class="wizard-step wizard-proxy-config">
      <h2 class="type-h1">Proxy Configuration</h2>
      ${!detected ? '<p class="type-caption">Connect to a local or remote server</p>' : ''}

      <div class="config-form">
        <div class="form-row">
          <label class="type-label">Server URL</label>
          <div class="input-row">
            <input type="text"
                   id="proxy-url"
                   placeholder="http://localhost:8000"
                   value="${proxyConfig.url || defaultUrl}" />
            <button class="btn" data-action="test-proxy">
              ${proxyConfig.verifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </div>
          ${proxyConfig.verifyState === VERIFY_STATE.VERIFIED ? `
            <span class="type-caption">★ ${serverTypeLabel} connected</span>
          ` : ''}
          ${proxyConfig.verifyState === VERIFY_STATE.FAILED ? `
            <span class="type-caption">☒ ${proxyConfig.verifyError || 'Connection failed'}</span>
          ` : ''}
          ${!detected ? '<span class="type-caption">Default ports: 8000 (Reploid proxy), 11434 (Ollama)</span>' : ''}
        </div>

        ${proxyProviders.length > 0 ? `
          <div class="form-row">
            <label class="type-label">Provider</label>
            <select id="proxy-provider">
              ${proxyProviders.map((p, i) => `
                <option value="${p}" ${proxyConfig.provider === p || (!proxyConfig.provider && i === 0) ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>
              `).join('')}
            </select>
            <span class="type-caption">Providers configured on the proxy server</span>
          </div>
        ` : ''}

        <div class="form-row">
          <label class="type-label">Model</label>
          <div class="input-row">
            ${ollamaModels.length > 0 && serverType === 'ollama' ? `
              <select id="proxy-model">
                <option value="">Select model...</option>
                ${ollamaModels.map(m => `
                  <option value="${m.id}" ${proxyConfig.model === m.id ? 'selected' : ''}>${m.name}</option>
                `).join('')}
              </select>
            ` : serverType === 'reploid' && proxyConfig.provider && CLOUD_MODELS[proxyConfig.provider] ? `
              <select id="proxy-model">
                ${CLOUD_MODELS[proxyConfig.provider].map((m, i) => `
                  <option value="${m.id}" ${proxyConfig.model === m.id || (!proxyConfig.model && i === 0) ? 'selected' : ''}>${m.name}</option>
                `).join('')}
              </select>
            ` : `
              <input type="text"
                     id="proxy-model"
                     placeholder="${serverType === 'ollama' ? 'e.g., llama3:8b' : 'e.g., gemini-2.0-flash'}"
                     value="${proxyConfig.model || ''}" />
            `}
            <button class="btn" data-action="test-proxy-model"
                    ${!proxyConfig.model ? 'disabled' : ''}>
              ${proxyConfig.modelVerifyState === VERIFY_STATE.TESTING ? 'Testing...' : 'Test'}
            </button>
          </div>
          ${proxyConfig.modelVerifyState === VERIFY_STATE.VERIFIED ? `
            <span class="type-caption">★ Model responded</span>
          ` : ''}
          ${proxyConfig.modelVerifyState === VERIFY_STATE.FAILED ? `
            <span class="type-caption">☒ ${proxyConfig.modelVerifyError || 'Model test failed'}</span>
          ` : ''}
        </div>
      </div>

    </div>
  `;
}
