/**
 * @fileoverview Choose connection step renderer
 */

/**
 * Render CHOOSE step
 */
export function renderChooseStep(state) {
  const { detection, connectionType } = state;
  const escapeText = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const webgpuSupported = detection.webgpu.supported;
  const ollamaDetected = detection.ollama?.detected;
  const proxyDetected = detection.proxy?.detected;
  const serverDetected = proxyDetected || ollamaDetected;
  const localBlocked = detection.ollama?.blocked || detection.proxy?.blocked;
  const preflightItems = detection.preflight?.items || [];
  const items = preflightItems.length > 0
    ? preflightItems
    : [{ id: 'preflight', label: 'Preflight checks', status: 'pending', detail: 'Running checks' }];

  const counts = items.reduce((acc, item) => {
    const key = item.status || 'pending';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { ready: 0, pending: 0, warn: 0, error: 0 });

  const summaryParts = [
    counts.ready ? `${counts.ready} ready` : null,
    counts.pending ? `${counts.pending} pending` : null,
    counts.warn ? `${counts.warn} warnings` : null,
    counts.error ? `${counts.error} needs attention` : null
  ].filter(Boolean);
  const summary = summaryParts.length > 0 ? summaryParts.join(' | ') : 'Preflight checks pending';
  const statusLabel = (status) => ({
    ready: 'Ready',
    pending: 'Pending',
    warn: 'Check',
    error: 'Fix'
  }[status] || 'Check');

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

      <div class="panel preflight-panel">
        <div class="panel-header">Preflight readiness</div>
        <div class="panel-body">
          <div class="preflight-summary type-caption">${escapeText(summary)}</div>
          <div class="status-list">
            ${items.map(item => `
              <div class="status-row ${item.status}">
                <div class="status-meta">
                  <span class="status-label">${escapeText(item.label)}</span>
                  <span class="status-detail">${escapeText(item.detail || '')}</span>
                </div>
                <span class="status-badge ${item.status}">${statusLabel(item.status)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="connection-options">
        <button class="panel connection-option ${borderClass('browser')} ${!webgpuSupported ? 'disabled' : ''}"
                data-action="choose-browser"
                ${!webgpuSupported ? 'disabled' : ''}>
          <span class="type-h2">⎈ Browser</span>
          <span class="type-caption">${webgpuSupported
            ? 'Run models locally in your browser via WebGPU (Doppler)'
            : 'WebGPU not supported in this browser'}</span>
          <div class="option-capabilities">
            <span class="tag">★ Full model access</span>
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
