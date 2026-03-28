/**
 * @fileoverview Capsule shell for the Reploid self.
 */

const CapsuleUI = {
  factory: (deps) => {
    const { runtime } = deps;

    let root = null;
    let unsubscribe = null;
    let latestSnapshot = null;
    let rotatingIdentity = false;

    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const getRunState = (snapshot = {}) => {
      if (snapshot.display?.runState) return snapshot.display.runState;
      if (snapshot.running) return 'RUNNING';
      if (snapshot.status === 'ERROR') return 'FAILED';
      if (snapshot.status === 'LIMIT') return 'HALTED_AT_CYCLE_LIMIT';
      if (snapshot.parked) return 'WAITING';
      if (snapshot.stopped) return 'PAUSED_BY_USER';
      if ((snapshot.cycle || 0) > 0 && snapshot.status === 'IDLE') return 'READY_TO_CONTINUE';
      return 'READY';
    };

    const getPolicy = (snapshot = {}) => {
      if (snapshot.display?.policy) return snapshot.display.policy;
      if (snapshot.parked && snapshot.wakeOn === 'provider-ready') return 'auto-resume on provider-ready';
      if (snapshot.status === 'ERROR') return 'manual restart required';
      if (snapshot.status === 'LIMIT') return 'cycle limit reached';
      if (snapshot.stopped) return 'manual resume required';
      if (snapshot.running || (((snapshot.cycle || 0) > 0) && snapshot.status === 'IDLE')) return 'auto-continue enabled';
      return 'manual start required';
    };

    const renderSnapshot = (snapshot = {}) => {
      if (!root) return;
      latestSnapshot = snapshot;

      const stopBtn = root.querySelector('#btn-toggle');
      const rotateBtn = root.querySelector('#btn-rotate-peer');
      const stream = root.querySelector('#history-container');
      const runState = getRunState(snapshot);

      if (stopBtn) {
        if (snapshot.running) {
          stopBtn.textContent = 'Stop';
          stopBtn.dataset.capsuleAction = 'stop';
          stopBtn.disabled = false;
        } else if (runState === 'PAUSED_BY_USER') {
          stopBtn.textContent = 'Resume';
          stopBtn.dataset.capsuleAction = 'resume';
          stopBtn.disabled = false;
        } else if (runState === 'READY_TO_CONTINUE') {
          stopBtn.textContent = 'Continue';
          stopBtn.dataset.capsuleAction = 'resume';
          stopBtn.disabled = false;
        } else if (snapshot.parked) {
          stopBtn.textContent = 'Retry';
          stopBtn.dataset.capsuleAction = 'resume';
          stopBtn.disabled = false;
        } else {
          stopBtn.textContent = 'Start';
          stopBtn.dataset.capsuleAction = 'resume';
          stopBtn.disabled = false;
        }
      }

      if (rotateBtn) {
        rotateBtn.disabled = snapshot.running === true || rotatingIdentity;
        rotateBtn.textContent = rotatingIdentity ? 'Rotating peer ID...' : 'Rotate peer ID';
      }

      if (stream) {
        const header = [
          `instance: ${snapshot.instanceId || snapshot.swarm?.instanceId || 'default'}`,
          `run: ${runState}`,
          `cycle: ${snapshot.cycle || 0}`,
          `tokens: ${snapshot.tokens?.used || 0}`,
          `brain: ${snapshot.model || '-'}`,
          `activity: ${snapshot.activity || 'Awaiting goal'}`,
          `policy: ${getPolicy(snapshot)}`,
          snapshot.swarm?.peerId
            ? `peer: ${snapshot.swarm.peerId}`
            : null,
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

    const handleClick = async (event) => {
      const action = event.target.closest('[data-capsule-action]')?.dataset.capsuleAction;
      event.preventDefault();
      if (action === 'stop') {
        runtime.stop();
        return;
      }
      if (action === 'resume' && latestSnapshot?.running !== true) {
        runtime.start();
        return;
      }
      if (action === 'rotate-peer' && latestSnapshot?.running !== true && rotatingIdentity !== true) {
        try {
          rotatingIdentity = true;
          renderSnapshot(latestSnapshot || {});
          await runtime.rotateIdentity?.();
        } catch (error) {
          if (typeof window.alert === 'function') {
            window.alert(`Failed to rotate peer ID: ${error?.message || error}`);
          }
        } finally {
          rotatingIdentity = false;
          renderSnapshot(latestSnapshot || {});
        }
      }
    };

    const mount = async (container) => {
      root = container;
      root.className = 'capsule-shell active';
      root.innerHTML = `
        <div class="capsule-toolbar">
          <button class="btn" id="btn-toggle" data-capsule-action="stop">Stop</button>
          <button class="btn btn-ghost" id="btn-rotate-peer" data-capsule-action="rotate-peer">Rotate peer ID</button>
        </div>
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
