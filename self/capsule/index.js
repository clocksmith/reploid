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

    const renderMetric = (label, value) => `
      <span class="capsule-metric">
        <span class="capsule-metric-label">${escapeHtml(label)}</span>
        <span class="capsule-metric-value">${escapeHtml(value === 0 ? '0' : (value || '-'))}</span>
      </span>
    `;

    const getGateLabel = (state) => {
      if (state === 'pending-anchors') return 'pending';
      if (state === 'passed') return 'passed';
      if (state === 'rejected') return 'rejected';
      if (state === 'blocked') return 'blocked';
      return state || 'anchor';
    };

    const getVisibleBlocks = (snapshot = {}) => (
      Array.isArray(snapshot.renderedBlocks) ? snapshot.renderedBlocks : []
    ).filter((block) => !String(block || '').startsWith('[BOOT]'));

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
        const rgr = snapshot.rgr || {};
        const swarm = snapshot.swarm || {};
        const gate = rgr.gate || {};
        const counters = rgr.counters || {};
        const archive = rgr.archive || {};
        const latestArchive = archive.latest || null;
        const peersEnabled = !!(swarm.enabled || rgr.topology === 'peer-assisted');
        const peerSummary = peersEnabled
          ? `${swarm.peerCount || 0} peers · ${swarm.providerCount || 0} hosts · ${swarm.consumerCount || 0} consumers`
          : 'off';
        const gateSummary = gate.state
          ? `${getGateLabel(gate.state)} ${Number(gate.anchors || 0)}/${Number(gate.required || 0)}`
          : 'anchor';
        const ecosystem = [
          'browser',
          'VFS',
          'OPFS',
          peersEnabled ? 'peer ring' : null
        ].filter(Boolean).join(' + ');
        const slots = Array.isArray(rgr.slots) ? rgr.slots : [];
        const instances = Array.isArray(rgr.instances) ? rgr.instances : [];
        const slotRows = slots.map((slot) => `
          <span class="capsule-slot-row">
            <span class="capsule-slot-id">${escapeHtml(slot.id)}</span>
            <span class="capsule-slot-placement">${escapeHtml(slot.placement)}</span>
            <span class="capsule-slot-state">${escapeHtml(slot.state)}</span>
          </span>
        `).join('');
        const instanceRows = instances.map((instance) => `
          <span class="capsule-instance-row">
            <span class="capsule-slot-id">${escapeHtml(instance.kind || instance.id)}</span>
            <span class="capsule-slot-placement">${escapeHtml(instance.mode || 'shadow')}</span>
            <span class="capsule-slot-state">${escapeHtml(instance.state || 'manifested')}</span>
          </span>
        `).join('');
        const counterSummary = [
          `tokens ${Number(counters.tokens || snapshot.tokens?.used || 0).toLocaleString()}`,
          `tools ${Number(counters.toolCalls || 0).toLocaleString()}`,
          `candidates ${Number(counters.candidates || 0).toLocaleString()}`,
          `archive ${Number(counters.archive || 0).toLocaleString()}`,
          `receipts ${Number(counters.receipts || 0).toLocaleString()}`,
          `errors ${Number(counters.errors || 0).toLocaleString()}`
        ].join(' | ');
        const latestScore = latestArchive?.score || {};
        const latestReceiptHtml = latestArchive ? `
          <div class="capsule-rgr-receipt" aria-label="Latest Shadow receipt">
            <div class="capsule-receipt-title">
              <span>Shadow receipt</span>
              <span>${escapeHtml(latestArchive.kind || 'shadow-candidate')}</span>
            </div>
            <div class="capsule-receipt-score">
              ${renderMetric('Use', latestScore.usefulness)}
              ${renderMetric('Safe', latestScore.safety)}
              ${renderMetric('Rev', latestScore.reversibility)}
              ${renderMetric('Evidence', latestScore.evidence)}
              ${renderMetric('Anchor', latestScore.qAnchor)}
              ${renderMetric('Eff', latestScore.efficiency)}
            </div>
            <div class="capsule-receipt-note">
              ${escapeHtml((latestArchive.gate?.reasons || []).join(' | ') || 'anchor gate passed')}
            </div>
            ${latestArchive.receiptPath ? `
              <div class="capsule-receipt-note">receipt stored</div>
            ` : ''}
          </div>
        ` : '';
        const statusHtml = `
          <section class="capsule-rgr-panel" aria-label="Ecosystem status">
            <div class="capsule-status-grid">
              ${renderMetric('Mode', rgr.mode || 'seed')}
              ${renderMetric('Topology', rgr.topology || 'local')}
              ${renderMetric('Cycle', String(snapshot.cycle || 0))}
              ${renderMetric('Gate', gateSummary)}
              ${renderMetric('Role', rgr.role || swarm.role || 'unknown')}
              ${renderMetric('Host', rgr.hostStatus || 'none')}
              ${renderMetric('Peers', peerSummary)}
              ${renderMetric('Transport', swarm.transport || rgr.transport || 'none')}
              ${renderMetric('Ecosystem', ecosystem)}
              ${renderMetric('Instances', instances.length ? instances.map((instance) => instance.kind || instance.id).join(', ') : 'none')}
              ${renderMetric('Archive', `${Number(archive.count || 0).toLocaleString()}/${Number(archive.limit || 0).toLocaleString()}`)}
              ${renderMetric('Anchors', latestScore.qAnchor ?? 0)}
            </div>
            <div class="capsule-slot-table" aria-label="Ring slots">
              ${slotRows}
            </div>
            ${instanceRows ? `
              <div class="capsule-slot-table capsule-instance-table" aria-label="Manifested browser instances">
                ${instanceRows}
              </div>
            ` : ''}
            ${latestReceiptHtml}
            <div class="capsule-counter-row">${escapeHtml(counterSummary)}</div>
          </section>
        `;
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
        const blocks = [header, ...getVisibleBlocks(snapshot)]
          .filter((block) => String(block || '').trim());
        stream.innerHTML = statusHtml + blocks.map((block, index) => `
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
