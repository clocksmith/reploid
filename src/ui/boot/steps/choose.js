/**
 * @fileoverview Choose connection step renderer
 */

/**
 * Render CHOOSE step
 */
export function renderChooseStep(state) {
  const { detection, connectionType } = state;

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

  // Helper for border class - dotted when unselected, solid when selected
  const borderClass = (type) => connectionType === type ? '' : 'border-ghost';

  return `
    <div class="wizard-step wizard-choose">
      <h2 class="type-h1">How do you want to connect?</h2>

      <div class="connection-options">
        <button class="panel connection-option ${borderClass('browser')} ${!webgpuSupported ? 'disabled' : ''}"
                data-action="choose-browser"
                ${!webgpuSupported ? 'disabled' : ''}>
          <span class="type-h2">⎈ Browser</span>
          <span class="type-caption">${webgpuSupported
            ? 'Run models locally in your browser via WebGPU (Doppler)'
            : 'WebGPU not supported in this browser'}</span>
          <div class="option-capabilities">
            <span class="tag">★ Full substrate access</span>
            <span class="tag">★ Private</span>
            <span class="tag">△ Limited reasoning</span>
          </div>
        </button>

        <button class="panel connection-option ${borderClass('direct')}" data-action="choose-direct">
          <span class="type-h2">☁ Direct</span>
          <span class="type-caption">Call cloud APIs directly (Claude, GPT, Gemini)</span>
          <div class="option-capabilities">
            <span class="tag">★ High reasoning</span>
            <span class="tag">△ API key in browser</span>
          </div>
        </button>

        <button class="panel connection-option ${borderClass('proxy')}" data-action="choose-proxy">
          <span class="type-h2">☍ Proxy ${serverDetected ? '<span class="badge">Detected</span>' : ''}</span>
          <span class="type-caption">${serverDescription}</span>
          <div class="option-capabilities">
            <span class="tag">★ Cloud or local models</span>
            <span class="tag">★ Keys protected on server</span>
          </div>
          ${localBlocked ? '<span class="type-caption">△ Browser blocked auto-detect. Enter address manually.</span>' : ''}
        </button>
      </div>
    </div>
  `;
}
