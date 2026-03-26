/**
 * @fileoverview Choose boot mode and connection step renderer
 */

import { BOOT_MODE_ORDER, getBootModeConfig } from '../../../config/boot-modes.js';

/**
 * Render CHOOSE step
 */
export function renderChooseStep(state) {
  const { detection, connectionType } = state;
  const selectedMode = state.mode || 'zero';
  const activeMode = getBootModeConfig(selectedMode);
  const webgpuSupported = detection.webgpu.supported;
  const webgpuChecked = detection.webgpu.checked;
  const ollamaDetected = detection.ollama?.detected;
  const proxyDetected = detection.proxy?.detected;
  const serverDetected = proxyDetected || ollamaDetected;
  const localBlocked = detection.ollama?.blocked || detection.proxy?.blocked;
  const browserRecommended = selectedMode === 'awakened_zero';

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

  const browserCaption = browserRecommended
    ? (webgpuSupported
      ? 'Run a mutable local brain in-browser via WebGPU'
      : 'Awakened Zero needs WebGPU before the local brain can come online')
    : (webgpuSupported
      ? 'Run models locally in your browser via WebGPU (Doppler)'
      : 'WebGPU not supported in this browser');

  const getModeTags = (modeId) => {
    if (modeId === 'zero') return ['Default', 'Minimal'];
    if (modeId === 'awakened_zero') return ['Local brain', 'Mutable'];
    return ['Prebuilt', 'Full stack'];
  };

  return `
    <div class="wizard-step wizard-choose">
      <div class="wizard-mode-shell panel">
        <div class="wizard-mode-copy">
          <div class="type-caption wizard-kicker">Mode</div>
          <h1 class="type-display wizard-mode-title">${activeMode.label}</h1>
          <p class="type-caption wizard-mode-description">${activeMode.description}. ${activeMode.detail}</p>
        </div>

        <div class="boot-mode-rail" role="tablist" aria-label="Product mode">
          ${BOOT_MODE_ORDER.map((modeId) => {
            const mode = getBootModeConfig(modeId);
            const selected = selectedMode === modeId;
            const blocked = mode.requiresBrowserBrain && webgpuChecked && !webgpuSupported;
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

      <div class="mode-focus panel">
        <div class="option-capabilities mode-focus-tags">
          ${getModeTags(selectedMode).map((tag) => `<span class="tag">${tag}</span>`).join('')}
        </div>
        <div class="type-caption mode-focus-copy">
          ${selectedMode === 'zero'
            ? 'Start with the smallest visible surface. Zero builds upward from files, tools, and observed results.'
            : selectedMode === 'awakened_zero'
              ? 'Keep the same minimal surface, but give the agent a mutable browser-local brain.'
              : 'Boot the mature prebuilt stack with the broader capability surface already assembled.'}
        </div>
      </div>

      <div class="wizard-section-divider wizard-section-divider-tight">
        <h2 class="type-h1">Choose a brain</h2>
        <p class="type-caption">Pick where reasoning runs and how model access is reached.</p>
      </div>

      <div class="connection-options connection-options-compact">
        <button class="panel connection-option ${connectionBorderClass('browser')} ${!webgpuSupported ? 'disabled' : ''}"
                data-action="choose-browser"
                aria-pressed="${connectionPressed('browser')}"
                ${!webgpuSupported ? 'disabled' : ''}>
          <span class="type-h2">⎈ Browser ${browserRecommended && webgpuSupported ? '<span class="badge">Recommended</span>' : ''}</span>
          <span class="type-caption">${browserCaption}</span>
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
          ${localBlocked ? '<span class="type-caption">△ Browser blocked auto-detect. Enter address manually.</span>' : ''}
        </button>
      </div>
    </div>
  `;
}
