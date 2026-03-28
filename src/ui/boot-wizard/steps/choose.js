/**
 * @fileoverview Choose boot mode and connection step renderer
 */

import { BOOT_MODE_ORDER, getBootModeConfig } from '../../../config/boot-modes.js';

const buildProviderCopy = (state) => {
  const { detection, connectionType } = state;
  const selectedMode = state.mode || 'reploid';
  const webgpuSupported = detection.webgpu.supported;
  const webgpuChecked = detection.webgpu.checked;
  const ollamaDetected = detection.ollama?.detected;
  const proxyDetected = detection.proxy?.detected;
  const serverDetected = proxyDetected || ollamaDetected;
  const localBlocked = detection.ollama?.blocked || detection.proxy?.blocked;
  const browserRecommended = selectedMode === 'zero';

  let serverDescription = 'Connect to a local or remote server';
  if (proxyDetected && ollamaDetected) {
    serverDescription = `Reploid proxy at ${detection.proxy.url}, Ollama with ${detection.ollama.models?.length || 0} models`;
  } else if (proxyDetected) {
    serverDescription = `Reploid proxy at ${detection.proxy.url}`;
  } else if (ollamaDetected) {
    serverDescription = `Ollama at ${detection.ollama.url} (${detection.ollama.models?.length || 0} models)`;
  }

  const connectionBorderClass = (type) => connectionType === type ? '' : 'border-ghost';
  const connectionPressed = (type) => connectionType === type ? 'true' : 'false';

  const dopplerCaption = browserRecommended
    ? (webgpuSupported
      ? 'Run a mutable local brain in-browser via WebGPU'
      : 'Zero needs WebGPU before the local brain can come online')
    : (webgpuSupported
      ? 'Run Doppler locally in-browser via WebGPU'
      : 'WebGPU not supported in this browser');

  return {
    browserRecommended,
    connectionBorderClass,
    connectionPressed,
    dopplerCaption,
    localBlocked,
    serverDescription,
    serverDetected,
    webgpuSupported,
    webgpuChecked
  };
};

export function renderConnectionProviderOptions(
  state,
  {
    standalone = false,
    title = 'Choose inference provider',
    caption = 'Pick where reasoning runs.'
  } = {}
) {
  const {
    browserRecommended,
    connectionBorderClass,
    connectionPressed,
    dopplerCaption,
    localBlocked,
    serverDescription,
    serverDetected,
    webgpuSupported
  } = buildProviderCopy(state);

  const header = standalone
    ? `
      <div class="goal-header">
        <h2 class="type-h1">${title}</h2>
        <p class="type-caption">${caption}</p>
      </div>
    `
    : `
      <div class="wizard-section-divider wizard-section-divider-tight">
        <h2 class="type-h1">${title}</h2>
        <p class="type-caption">${caption}</p>
      </div>
    `;

  return `
    ${header}

    <div class="connection-options connection-options-compact">
      <button class="panel connection-option ${connectionBorderClass('browser')} ${!webgpuSupported ? 'disabled' : ''}"
              data-action="choose-browser"
              aria-pressed="${connectionPressed('browser')}"
              ${!webgpuSupported ? 'disabled' : ''}>
        <span class="type-h2">⎈ Doppler ${browserRecommended && webgpuSupported ? '<span class="badge">Recommended</span>' : ''}</span>
        <span class="type-caption">${dopplerCaption}</span>
        <div class="option-capabilities">
          <span class="tag">Model access</span>
          <span class="tag">Private</span>
          <span class="tag">${browserRecommended ? 'Brain-mutable' : 'WebGPU local'}</span>
        </div>
      </button>

      <button class="panel connection-option ${connectionBorderClass('direct')}"
              data-action="choose-direct"
              aria-pressed="${connectionPressed('direct')}">
        <span class="type-h2">☁ Direct</span>
        <span class="type-caption">Call cloud APIs directly from the browser</span>
        <div class="option-capabilities">
          <span class="tag">High reasoning</span>
          <span class="tag">Key in browser</span>
        </div>
      </button>

      <button class="panel connection-option ${connectionBorderClass('proxy')}"
              data-action="choose-proxy"
              aria-pressed="${connectionPressed('proxy')}">
        <span class="type-h2">☍ Proxy ${serverDetected ? '<span class="badge">Detected</span>' : ''}</span>
        <span class="type-caption">${serverDescription}</span>
        <div class="option-capabilities">
          <span class="tag">Cloud or local</span>
          <span class="tag">Keys on server</span>
        </div>
        ${localBlocked ? '<span class="type-caption">△ Local auto-detect blocked. Enter address manually.</span>' : ''}
      </button>
    </div>
  `;
}

/**
 * Render CHOOSE step
 */
export function renderChooseStep(state) {
  const selectedMode = state.mode || 'reploid';
  const routeLockedMode = state.routeLockedMode || null;
  const showModeSelector = !routeLockedMode;

  return `
    <div class="wizard-step wizard-choose">
      ${showModeSelector ? `
        <div class="wizard-mode-shell">
          <div class="wizard-mode-copy">
            <h2 class="type-h1">Choose runtime mode</h2>
            <p class="type-caption wizard-mode-description">Select the substrate depth and available behavior before configuring inference.</p>
          </div>

          <div class="boot-mode-row">
            <div class="type-caption boot-mode-caption">Mode</div>
            <div class="boot-mode-rail" role="tablist" aria-label="Product mode">
              ${BOOT_MODE_ORDER.map((modeId) => {
                const mode = getBootModeConfig(modeId);
                const selected = selectedMode === modeId;
                const blocked = mode.requiresBrowserBrain && state.detection.webgpu.checked && !state.detection.webgpu.supported;
                const pressed = selected ? 'true' : 'false';
                return `
                  <button class="boot-mode-btn ${selected ? 'selected' : 'border-ghost'}"
                          data-action="choose-mode"
                          data-mode="${modeId}"
                          aria-pressed="${pressed}"
                          ${blocked ? 'disabled' : ''}>
                    <span class="boot-mode-label">${mode.label}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      ` : ''}

      ${renderConnectionProviderOptions(state, {
        standalone: !showModeSelector
      })}
    </div>
  `;
}
