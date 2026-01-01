/**
 * @fileoverview Choose connection step renderer
 */

/**
 * Render CHOOSE step
 */
export function renderChooseStep(state) {
  const { detection } = state;

  const webgpuSupported = detection.webgpu.supported;
  const ollamaDetected = detection.ollama?.detected;
  const proxyDetected = detection.proxy?.detected;
  const serverDetected = proxyDetected || ollamaDetected;
  const localBlocked = detection.ollama?.blocked || detection.proxy?.blocked;

  // Build server description
  let serverDescription = 'Connect to a local or remote server';
  if (proxyDetected && ollamaDetected) {
    serverDescription = `Reploid proxy at ${detection.proxy.url}, Ollama with ${detection.ollama.models?.length || 0} models`;
  } else if (proxyDetected) {
    serverDescription = `Reploid proxy at ${detection.proxy.url}`;
  } else if (ollamaDetected) {
    serverDescription = `Ollama at ${detection.ollama.url} (${detection.ollama.models?.length || 0} models)`;
  }

  return `
    <div class="wizard-step wizard-choose">
      <h2>How do you want to connect?</h2>

      <div class="connection-options">
        <button class="connection-option ${!webgpuSupported ? 'disabled' : ''}"
                data-action="choose-browser"
                ${!webgpuSupported ? 'disabled' : ''}>
          <div class="option-header">
            <span class="option-icon">☖</span>
            <span class="option-title">Browser</span>
            ${webgpuSupported ? '<span class="option-badge recommended">Recommended</span>' : ''}
          </div>
          <div class="option-description">
            ${webgpuSupported
              ? 'Run models locally in your browser via WebGPU (Doppler)'
              : 'WebGPU not supported in this browser'}
          </div>
          <div class="option-capabilities">
            <span class="cap-tag cap-substrate">★ Full substrate access</span>
            <span class="cap-tag cap-privacy">★ Private</span>
            <span class="cap-tag cap-warn">☡ Limited reasoning</span>
          </div>
        </button>

        <button class="connection-option" data-action="choose-direct">
          <div class="option-header">
            <span class="option-icon">☁</span>
            <span class="option-title">Direct</span>
          </div>
          <div class="option-description">
            Call cloud APIs directly (Claude, GPT-4, Gemini)
          </div>
          <div class="option-capabilities">
            <span class="cap-tag cap-reasoning">★ High reasoning</span>
            <span class="cap-tag cap-warn">☡ API key in browser</span>
          </div>
        </button>

        <button class="connection-option" data-action="choose-proxy">
          <div class="option-header">
            <span class="option-icon">☍</span>
            <span class="option-title">Proxy</span>
            ${serverDetected ? '<span class="option-badge detected">Detected</span>' : ''}
          </div>
          <div class="option-description">
            ${serverDescription}
          </div>
          <div class="option-capabilities">
            <span class="cap-tag cap-reasoning">★ Cloud or local models</span>
            <span class="cap-tag cap-privacy">★ Keys protected on server</span>
          </div>
          ${localBlocked ? `
            <div class="option-warning">
              Browser blocked auto-detect. Enter address manually.
            </div>
          ` : ''}
        </button>

        <button class="connection-option tertiary" data-action="explore-docs">
          <div class="option-header">
            <span class="option-icon">☐</span>
            <span class="option-title">Explore docs only</span>
          </div>
          <div class="option-description">
            Browse documentation without an agent
          </div>
        </button>
      </div>
    </div>
  `;
}
