/**
 * @fileoverview Detect step renderers
 */

/**
 * Render START step (resume saved config)
 */
export function renderStartStep(state) {
  const saved = state.savedConfig;

  if (!saved) return '';

  return `
    <div class="wizard-step wizard-start">
      <h1 class="intro-title">REPLOID</h1>
      <p class="intro-tagline"><a href="https://github.com/clocksmith/reploid" target="_blank" class="tagline-link">self-modifying AI agent in the browser</a></p>
      <div class="saved-config-summary">
        <div class="config-item">
          <span class="config-label">Provider</span>
          <span class="config-value">${saved.primaryProvider || 'Unknown'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">Model</span>
          <span class="config-value">${saved.primaryModel || 'Unknown'}</span>
        </div>
        <div class="config-item">
          <span class="config-label">Key</span>
          <span class="config-value">${saved.hasSavedKey ? 'Saved locally' : 'Not saved'}</span>
        </div>
      </div>

      ${saved.hasSavedKey ? `
        <div class="wizard-actions stacked">
          <button class="btn btn-primary" data-action="continue-saved">
            Continue with this setup
          </button>
          <button class="btn btn-secondary" data-action="reconfigure">
            Change configuration
          </button>
        </div>
      ` : `
        <form class="inline-key-entry" autocomplete="off" onsubmit="return false;">
          <input type="text" name="username" autocomplete="username" style="display:none" aria-hidden="true" />
          <input type="password" id="saved-api-key" placeholder="Enter API key" class="inline-input" autocomplete="new-password" />
          <button type="button" class="btn btn-primary" data-action="continue-with-key">
            Continue
          </button>
        </form>
        <div class="wizard-actions stacked">
          <button class="btn btn-secondary" data-action="reconfigure">
            Change configuration
          </button>
        </div>
      `}
    </div>
  `;
}

/**
 * Render DETECT step - unified intro/landing page
 */
export function renderDetectStep(state) {
  const { detection, savedConfig } = state;
  const isScanning = detection.scanning;

  // If not scanning yet, show intro/landing
  if (!isScanning && !detection.webgpu.checked) {
    return `
      <div class="wizard-step wizard-intro">
        <h1 class="intro-title">REPLOID</h1>
        <p class="intro-tagline"><a href="https://github.com/clocksmith/reploid" target="_blank" class="tagline-link">self-modifying AI agent in the browser</a></p>

        <div class="intro-actions">
          ${savedConfig ? `
            ${!savedConfig.hasSavedKey ? `
              <input type="password" id="saved-api-key" placeholder="API key" class="intro-key-input" />
            ` : ''}
            <button class="btn btn-primary" data-action="continue-saved">
              Continue
            </button>
            <button class="btn" data-action="start-scan">
              New session
            </button>
          ` : `
            <button class="btn btn-primary" data-action="start-scan">
              Begin
            </button>
          `}
        </div>
      </div>
    `;
  }

  // Scanning in progress
  return `
    <div class="wizard-step wizard-detect">
      <h2>Scanning</h2>

      <div class="detection-list">
        <div class="detection-item ${detection.webgpu.checked ? (detection.webgpu.supported ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.webgpu.checked ? (detection.webgpu.supported ? '★' : '☒') : '☍'}</span>
          <span class="detection-label">WebGPU</span>
          <span class="detection-status">
            ${detection.webgpu.checked ? (detection.webgpu.supported ? 'Available' : 'Not supported') : '...'}
          </span>
        </div>

        <div class="detection-item ${detection.doppler?.checked ? (detection.doppler?.supported ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.doppler?.checked ? (detection.doppler?.supported ? '★' : '☒') : '☍'}</span>
          <span class="detection-label">Doppler</span>
          <span class="detection-status">
            ${detection.doppler?.checked ? (detection.doppler?.supported ? 'Ready' : 'N/A') : '...'}
          </span>
        </div>

        <div class="detection-item ${detection.ollama?.checked ? (detection.ollama?.detected ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.ollama?.checked ? (detection.ollama?.detected ? '★' : detection.ollama?.blocked ? '△' : '☒') : '☍'}</span>
          <span class="detection-label">Ollama</span>
          <span class="detection-status">
            ${detection.ollama?.checked
              ? (detection.ollama?.detected
                ? `${detection.ollama.models?.length || 0} models`
                : detection.ollama?.blocked ? 'Blocked' : 'N/A')
              : '...'}
          </span>
        </div>

        <div class="detection-item ${detection.proxy?.checked ? (detection.proxy?.detected ? 'online' : 'offline') : 'checking'}">
          <span class="detection-icon">${detection.proxy?.checked ? (detection.proxy?.detected ? '★' : detection.proxy?.blocked ? '△' : '☒') : '☍'}</span>
          <span class="detection-label">Proxy</span>
          <span class="detection-status">
            ${detection.proxy?.checked
              ? (detection.proxy?.detected ? 'Found' : detection.proxy?.blocked ? 'Blocked' : 'N/A')
              : '...'}
          </span>
        </div>
      </div>

      <div class="wizard-actions centered">
        <button class="btn btn-tertiary" data-action="skip-detection">
          Skip
        </button>
      </div>
    </div>
  `;
}
