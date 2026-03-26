/**
 * @fileoverview Text-first runtime shell for Absolute Zero.
 */

const CapsuleUI = {
  factory: (deps) => {
    const { CapsuleRuntime } = deps;

    let root = null;
    let unsubscribe = null;

    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const renderSnapshot = (snapshot = {}) => {
      if (!root) return;

      const stopBtn = root.querySelector('#btn-toggle');
      const stream = root.querySelector('#history-container');

      if (stopBtn) {
        stopBtn.textContent = snapshot.running ? 'Stop' : 'Stopped';
        stopBtn.disabled = !snapshot.running;
      }

      if (stream) {
        const header = [
          `state: ${snapshot.status || 'IDLE'}`,
          `cycle: ${snapshot.cycle || 0}`,
          `tokens: ${snapshot.tokens?.used || 0}`,
          `brain: ${snapshot.model || '-'}`,
          `activity: ${snapshot.activity || 'Awaiting goal'}`
        ].join('\n');
        const blocks = [header, ...(Array.isArray(snapshot.renderedBlocks) ? snapshot.renderedBlocks : [])]
          .filter((block) => String(block || '').trim());
        stream.innerHTML = blocks.map((block, index) => `
          <pre class="capsule-block${index === 0 ? ' capsule-block-header' : ''}">${escapeHtml(block)}</pre>
        `).join('');
      }
    };

    const handleClick = (event) => {
      const action = event.target.closest('[data-capsule-action]')?.dataset.capsuleAction;
      if (action !== 'stop') return;
      event.preventDefault();
      CapsuleRuntime.stop();
    };

    const mount = async (container) => {
      root = container;
      root.className = 'capsule-shell active';
      root.innerHTML = `
        <button class="btn" id="btn-toggle" data-capsule-action="stop">Stop</button>
        <div id="history-container" class="capsule-stream"></div>
      `;

      root.addEventListener('click', handleClick);
      unsubscribe = CapsuleRuntime.subscribe(renderSnapshot);
    };

    const cleanup = () => {
      if (unsubscribe) unsubscribe();
      if (root) {
        root.removeEventListener('click', handleClick);
      }
      unsubscribe = null;
    };

    return {
      mount,
      cleanup
    };
  }
};

export default CapsuleUI;
