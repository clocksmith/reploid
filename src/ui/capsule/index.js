/**
 * @fileoverview Capsule shell for the Reploid self.
 */

const CapsuleUI = {
  factory: (deps) => {
    const { runtime } = deps;

    let root = null;
    let unsubscribe = null;
    let latestSnapshot = null;

    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const renderSnapshot = (snapshot = {}) => {
      if (!root) return;
      latestSnapshot = snapshot;

      const stopBtn = root.querySelector('#btn-toggle');
      const stream = root.querySelector('#history-container');

      if (stopBtn) {
        if (snapshot.running) {
          stopBtn.textContent = 'Stop';
          stopBtn.dataset.capsuleAction = 'stop';
          stopBtn.disabled = false;
        } else if (snapshot.parked || (snapshot.cycle > 0 && snapshot.status === 'IDLE')) {
          stopBtn.textContent = 'Resume';
          stopBtn.dataset.capsuleAction = 'resume';
          stopBtn.disabled = false;
        } else {
          stopBtn.textContent = 'Start';
          stopBtn.dataset.capsuleAction = 'resume';
          stopBtn.disabled = false;
        }
      }

      if (stream) {
        const header = [
          `state: ${snapshot.status || 'IDLE'}`,
          `cycle: ${snapshot.cycle || 0}`,
          `tokens: ${snapshot.tokens?.used || 0}`,
          `brain: ${snapshot.model || '-'}`,
          `activity: ${snapshot.activity || 'Awaiting goal'}`,
          snapshot.swarm?.enabled
            ? `swarm: ${snapshot.swarm.role || 'unknown'} · peers ${snapshot.swarm.peerCount || 0}/${snapshot.swarm.providerCount || 0} providers · ${snapshot.swarm.transport || 'none'} · ${snapshot.swarm.connectionState || 'disconnected'}`
            : null
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
      event.preventDefault();
      if (action === 'stop') {
        runtime.stop();
        return;
      }
      if (action === 'resume' && latestSnapshot?.running !== true) {
        runtime.start();
      }
    };

    const mount = async (container) => {
      root = container;
      root.className = 'capsule-shell active';
      root.innerHTML = `
        <button class="btn" id="btn-toggle" data-capsule-action="stop">Stop</button>
        <div id="history-container" class="capsule-stream"></div>
      `;

      root.addEventListener('click', handleClick);
      unsubscribe = runtime.subscribe(renderSnapshot);
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
