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

    const renderMetricGrid = (metrics, className = 'capsule-metric-grid') => `
      <div class="${escapeHtml(className)}">
        ${metrics.map(([label, value]) => renderMetric(label, value)).join('')}
      </div>
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

    const compactText = (value, limit = 140) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (text.length <= limit) return text;
      return `${text.slice(0, limit - 1)}...`;
    };

    const getBlockLines = (block) => String(block || '').split(/\r?\n/);

    const getFirstPayloadLine = (block) => getBlockLines(block)
      .map((line) => line.trim())
      .filter((line) => line && !/^\[[A-Z ]+\]$/.test(line) && line !== 'REPLOID/0')[0] || '';

    const extractLineValue = (block, label) => {
      const pattern = new RegExp(`^${label}:\\s*(.+)$`, 'im');
      return String(block || '').match(pattern)?.[1]?.trim() || '';
    };

    const extractJsonPath = (block) => {
      const quoted = String(block || '').match(/"path"\s*:\s*"([^"]+)"/);
      if (quoted) return quoted[1];
      return extractLineValue(block, 'path');
    };

    const getLatestSystemError = (blocks = []) => [...blocks]
      .reverse()
      .find((block) => String(block || '').startsWith('[SYSTEM ERROR]')) || '';

    const summarizeModelBlock = (block) => {
      const toolNames = [...String(block || '').matchAll(/^TOOL:\s*(.+)$/gim)]
        .map((match) => match[1].trim())
        .filter(Boolean);
      if (toolNames.length) {
        return `${toolNames.length} tool request${toolNames.length === 1 ? '' : 's'}: ${toolNames.slice(0, 4).join(', ')}${toolNames.length > 4 ? ', ...' : ''}`;
      }
      const milestone = extractLineValue(block, 'MILESTONE') || extractLineValue(block, 'DONE');
      if (milestone) return `Milestone: ${compactText(milestone)}`;
      const idle = extractLineValue(block, 'IDLE') || extractLineValue(block, 'PARK');
      if (idle) return `Waiting: ${compactText(idle)}`;
      if (/^PLAN:/im.test(String(block || ''))) return 'Planned tool batch';
      return compactText(getFirstPayloadLine(block) || 'Model output');
    };

    const summarizeToolBatch = (block) => {
      const count = extractLineValue(block, 'count') || '0';
      const errors = extractLineValue(block, 'errors') || '0';
      const mode = extractLineValue(block, 'mode') || 'ordered';
      const tools = compactText(extractLineValue(block, 'tools'), 90);
      return `${count} tool${count === '1' ? '' : 's'} · ${errors} error${errors === '1' ? '' : 's'} · ${mode}${tools ? ` · ${tools}` : ''}`;
    };

    const summarizeToolResult = (block, toolName, isError) => {
      const path = extractJsonPath(block);
      if (isError) return compactText(getFirstPayloadLine(block) || `${toolName} failed`);
      return path ? `${toolName} · ${path}` : compactText(getFirstPayloadLine(block) || `${toolName} result`);
    };

    const classifyBlock = (block = '') => {
      const text = String(block || '');
      if (text.startsWith('[SYSTEM ERROR]')) {
        return {
          kind: 'error',
          label: 'Error',
          summary: compactText(getFirstPayloadLine(text) || 'System error')
        };
      }
      if (text.startsWith('[SYSTEM]')) {
        return {
          kind: 'system',
          label: 'System',
          summary: compactText(getFirstPayloadLine(text) || 'System notice')
        };
      }
      if (text.startsWith('[MODEL]')) {
        return {
          kind: 'model',
          label: 'LLM',
          summary: summarizeModelBlock(text)
        };
      }
      if (text.startsWith('[TOOL BATCH RESULT]')) {
        return {
          kind: 'tool',
          label: 'Tools',
          summary: summarizeToolBatch(text)
        };
      }
      const toolMatch = text.match(/^\[TOOL\s+([^\]]+?)\s+(RESULT|ERROR)\]/);
      if (toolMatch) {
        const toolName = toolMatch[1].trim();
        const isError = toolMatch[2] === 'ERROR';
        return {
          kind: isError ? 'error' : 'tool',
          label: toolName,
          summary: summarizeToolResult(text, toolName, isError)
        };
      }
      return {
        kind: 'log',
        label: 'Log',
        summary: compactText(getFirstPayloadLine(text) || 'Runtime event')
      };
    };

    const renderTimelineRow = (block, index, total) => {
      const entry = classifyBlock(block);
      const open = entry.kind === 'error' ? ' open' : '';
      return `
        <details class="capsule-log-row capsule-log-${escapeHtml(entry.kind)}"${open}>
          <summary class="capsule-log-summary">
            <span class="capsule-log-index">${escapeHtml(String(total - index))}</span>
            <span class="capsule-log-label">${escapeHtml(entry.label)}</span>
            <span class="capsule-log-title">${escapeHtml(entry.summary)}</span>
          </summary>
          <pre class="capsule-block">${escapeHtml(block)}</pre>
        </details>
      `;
    };

    const getProgressStage = ({ snapshot, latestArchive, gate, visibleBlocks }) => {
      if (snapshot.parked) {
        if (snapshot.wakeOn === 'generation-retry') return 'Blocked: provider retry';
        if (snapshot.wakeOn === 'provider-ready') return 'Blocked: peer host';
        return 'Waiting';
      }
      if (snapshot.status === 'ERROR') return 'Blocked: runtime error';
      if (snapshot.running) {
        const latestEvent = classifyBlock(visibleBlocks[0] || '');
        if (latestEvent.kind === 'model' && latestEvent.summary.includes('tool request')) return 'Candidate';
        if (latestEvent.kind === 'tool') return latestArchive ? 'Evaluate' : 'Observe';
        if (latestEvent.kind === 'error') return 'Repair';
        return 'Running';
      }
      if (latestArchive) {
        if (latestArchive.gate?.state === 'passed') return 'Gate: passed';
        if (Number(latestArchive.summary?.errors || 0) > 0) return 'Repair needed';
        if (gate.state === 'pending-anchors') return 'Gate: anchor pending';
        if (gate.state === 'rejected') return 'Gate: rejected';
        return 'Receipt archived';
      }
      if ((snapshot.cycle || 0) > 0) return 'Observe';
      return 'Ready';
    };

    const getLastMeaningfulStep = (visibleBlocks) => {
      const block = visibleBlocks.find(Boolean);
      if (!block) return 'No runtime events yet.';
      return classifyBlock(block).summary;
    };

    const getEvidenceLine = ({ snapshot, counters, gate, latestArchive }) => {
      const latestSummary = latestArchive?.summary || {};
      const latestChanges = Number(latestSummary.ordered || 0) + Number(latestSummary.exclusive || 0);
      const parts = [
        `tools ${Number(counters.toolCalls || 0).toLocaleString()}`,
        `candidates ${Number(counters.candidates || 0).toLocaleString()}`,
        `receipts ${Number(counters.receipts || 0).toLocaleString()}`,
        `anchors ${Number(gate.anchors || 0)}/${Number(gate.required || 0)}`,
        `errors ${Number(counters.errors || 0).toLocaleString()}`
      ];
      if (latestSummary.readOnly !== undefined) {
        parts.push(`latest reads ${Number(latestSummary.readOnly || 0).toLocaleString()}`);
      }
      if (latestChanges > 0) {
        parts.push(`latest changes ${latestChanges.toLocaleString()}`);
      }
      if (snapshot.tokens?.used !== undefined) {
        parts.push(`tokens ${Number(snapshot.tokens.used || 0).toLocaleString()}`);
      }
      return parts.join(' · ');
    };

    const getNextMove = ({ snapshot, runState, gate, latestArchive }) => {
      if (snapshot.parked) {
        if (snapshot.wakeOn === 'generation-retry') return 'Resume when the provider retry window opens.';
        if (snapshot.wakeOn === 'provider-ready') return 'Wait for a peer host or configure local inference.';
        return 'Resume when new work is available.';
      }
      if (snapshot.status === 'ERROR') return 'Inspect the latest error, repair, then restart.';
      if (snapshot.running) return 'Continue the current Shadow cycle.';
      if (latestArchive?.gate?.state === 'passed') return 'Promotion remains explicit; review anchored evidence before Promote.';
      if (gate.state === 'pending-anchors') return 'Collect independent anchor receipts or continue Shadow evaluation.';
      if (gate.state === 'rejected') return 'Repair the failed candidate or produce stronger evidence.';
      if (runState === 'READY_TO_CONTINUE') return 'Continue the Shadow loop from the last receipt.';
      return 'Start the objective.';
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
        const visibleBlocks = getVisibleBlocks(snapshot);
        const latestError = getLatestSystemError(visibleBlocks);
        const activeBlocker = snapshot.status === 'ERROR'
          ? compactText(getFirstPayloadLine(latestError) || snapshot.activity || 'Generation failed', 220)
          : snapshot.parked
            ? compactText(snapshot.activity || 'Waiting', 220)
            : compactText((gate.reasons || [])[0] || snapshot.activity || 'Awaiting goal', 220);
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
          <div class="capsule-rgr-receipt">
            <div class="capsule-receipt-title">
              <span>Shadow receipt</span>
              <span>${escapeHtml(latestArchive.kind || 'shadow-candidate')}</span>
            </div>
            ${renderMetricGrid([
              ['Use', latestScore.usefulness],
              ['Safe', latestScore.safety],
              ['Rev', latestScore.reversibility],
              ['Evidence', latestScore.evidence],
              ['Anchor', latestScore.qAnchor],
              ['Eff', latestScore.efficiency]
            ], 'capsule-receipt-score')}
            <div class="capsule-receipt-note">
              ${escapeHtml((latestArchive.gate?.reasons || []).join(' | ') || 'anchor gate passed')}
            </div>
            ${latestArchive.receiptPath ? `
              <div class="capsule-receipt-note">receipt stored</div>
            ` : ''}
          </div>
        ` : '';
        const rsiProgressHtml = `
          <section class="capsule-rsi-panel capsule-panel" aria-label="RSI progress">
            <div class="capsule-section-heading">
              <span>RSI Progress</span>
              <span>${escapeHtml(runState)}</span>
            </div>
            <div class="capsule-rsi-line">
              <span>Objective</span>
              <span>${escapeHtml(compactText(snapshot.goal || 'No objective set.', 260))}</span>
            </div>
            ${renderMetricGrid([
              ['Stage', getProgressStage({ snapshot, latestArchive, gate, visibleBlocks })],
              ['Cycle', String(snapshot.cycle || 0)],
              ['Gate', gateSummary],
              ['Policy', getPolicy(snapshot)]
            ])}
            <div class="capsule-rsi-line">
              <span>Last step</span>
              <span>${escapeHtml(getLastMeaningfulStep(visibleBlocks))}</span>
            </div>
            <div class="capsule-rsi-line">
              <span>Evidence</span>
              <span>${escapeHtml(getEvidenceLine({ snapshot, counters, gate, latestArchive }))}</span>
            </div>
            <div class="capsule-rsi-line">
              <span>Next</span>
              <span>${escapeHtml(getNextMove({ snapshot, runState, gate, latestArchive }))}</span>
            </div>
            ${activeBlocker ? `
              <div class="capsule-rsi-line">
                <span>Status</span>
                <span>${escapeHtml(activeBlocker)}</span>
              </div>
            ` : ''}
          </section>
        `;
        const statusHtml = `
          <section class="capsule-rgr-panel capsule-panel" aria-label="Ring status">
            <div class="capsule-section-heading">
              <span>Ring</span>
              <span>${escapeHtml(`${rgr.mode || 'seed'} · ${gateSummary}`)}</span>
            </div>
            ${renderMetricGrid([
              ['Mode', rgr.mode || 'seed'],
              ['Topology', rgr.topology || 'local'],
              ['Gate', gateSummary],
              ['Role', rgr.role || swarm.role || 'unknown'],
              ['Host', rgr.hostStatus || 'none'],
              ['Peers', peerSummary],
              ['Archive', `${Number(archive.count || 0).toLocaleString()}/${Number(archive.limit || 0).toLocaleString()}`],
              ['Anchors', latestScore.qAnchor ?? 0],
              ['Model', snapshot.model || '-']
            ])}
            <div class="capsule-meta-line">
              <span>${escapeHtml(ecosystem)}</span>
              <span>${escapeHtml(swarm.transport || rgr.transport || 'none')}</span>
            </div>
            <details class="capsule-fold">
              <summary>Ring slots</summary>
              <div class="capsule-slot-table" aria-label="Ring slots">
                ${slotRows}
              </div>
            </details>
            ${instanceRows ? `
              <details class="capsule-fold">
                <summary>Instances</summary>
                <div class="capsule-slot-table capsule-instance-table" aria-label="Manifested browser instances">
                  ${instanceRows}
                </div>
              </details>
            ` : ''}
            ${latestReceiptHtml ? `
              <details class="capsule-fold">
                <summary>Latest Shadow receipt</summary>
                ${latestReceiptHtml}
              </details>
            ` : ''}
            <div class="capsule-counter-row">${escapeHtml(counterSummary)}</div>
          </section>
        `;
        const transcriptHtml = `
          <section class="capsule-transcript" aria-label="Runtime transcript">
            <div class="capsule-section-heading">
              <span>Transcript</span>
              <span>${escapeHtml(`${visibleBlocks.length} event${visibleBlocks.length === 1 ? '' : 's'}`)}</span>
            </div>
            ${visibleBlocks.length
              ? visibleBlocks.map((block, index) => renderTimelineRow(block, index, visibleBlocks.length)).join('')
              : '<div class="capsule-empty-row">No runtime events yet.</div>'}
          </section>
        `;
        stream.innerHTML = rsiProgressHtml + statusHtml + transcriptHtml;
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
