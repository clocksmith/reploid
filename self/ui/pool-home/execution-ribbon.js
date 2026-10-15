import { computerLabel, withComputerLabels } from './computer-labels.js';
/** Selected-attempt presentation only. Discovery never establishes an execution path. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const measured = value => Number.isFinite(value) && value >= 0;
const ms = value => measured(value) ? `${Math.round(value)} ms` : 'Not reported';
const sum = (steps, key) => steps?.length && steps.every(step => measured(step[key])) ? steps.reduce((n, step) => n + step[key], 0) : null;
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const orderedTiming = (execution, index) => {
  const summary = execution?.stepSummary;
  if (summary) {
    const row = summary.stages?.find(stage => stage.partitionIndex === index);
    return Number.isSafeInteger(summary.count) && summary.count > 0 && row?.steps === summary.count
      && row.stepMs?.count === summary.count && measured(row.stepMs.total) ? row.stepMs : null;
  }
  const values = execution?.steps?.map(step => step.stages?.find(stage => stage.partitionIndex === index)?.elapsedMs);
  return values?.length && values.every(measured) ? { count: values.length, total: values.reduce((a, b) => a + b, 0) } : null;
};

export function projectExecutionRibbon(state) {
  const thread = state.activeThread, attempt = thread?.attempts.at(-1), execution = attempt?.execution;
  const ordered = execution?.identity?.schema === 'reploid.partition-attempt/v2'
    && execution.identity.route?.schema === 'reploid.partition-route/v1' && Array.isArray(execution.identity.route.stages)
    ? execution.identity.route : null;
  const requester = (ordered ? execution.identity.requesterId : execution?.requesterId) || state.participantId || 'This device';
  const local = execution?.placement === 'local-webgpu';
  const split = !!ordered || execution?.placement === 'two-device-layer-partition';
  // Selected/discovered models are not proof of placement. Use this attempt's receipt only.
  const ids = ordered ? ordered.stages.map(stage => stage.participantId) : local ? [requester] : split ? [execution.participantA, execution.participantB].filter(Boolean)
    : execution?.peerId ? [execution.peerId] : [];
  const layer = Number.isSafeInteger(execution?.splitLayer) ? execution.splitLayer : null;
  const executors = ids.map((id, i) => ({ id, label: id === requester ? 'This device' : computerLabel(state, id),
    layers: ordered ? `Stage ${i + 1} of ${ids.length}` : split ? layer === null ? 'Not reported' : i === 0 ? `0–${layer - 1}` : `${layer} onward` : 'Whole model',
    contribution: ordered ? i === 0 ? 'Initial layers; relays output' : i === ids.length - 1 ? 'Final layers; produces output' : 'Intermediate layers'
      : split ? i === 0 ? 'Initial layers; relays output' : 'Final layers; produces output' : 'Whole-model execution',
    timing: ordered ? orderedTiming(execution, i) : null,
    duration: ordered ? orderedTiming(execution, i)?.total ?? null : split ? sum(execution.steps, i === 0 ? 'localStepMs' : 'remoteStepMs') : null }));
  const active = attempt && !terminal.has(attempt.status);
  let status = attempt?.status || 'idle';
  // Discovery reports availability, never the health of an assigned execution channel.
  if (active && attempt.retryOf && ['queued', 'loading'].includes(status)) status = 'recovering';
  const ready = (state.models || []).filter(model => model.availability === 'ready');
  const downloading = state.localModel?.phase === 'loading';
  const progress = state.localModel?.progress?.progress;
  const preparing = downloading || (state.models || []).some(model => ['loading', 'preparing'].includes(model.availability))
    || (state.network?.partitionPeers || []).some(peer => peer.available && peer.description?.phase === 'loading'
      && (state.models || []).some(model => model.id === peer.description.offer?.id && model.identity === peer.description.offer?.identity));
  const availability = ready.length ? `${ready.length} model${ready.length === 1 ? '' : 's'} ready`
    : downloading ? 'Downloading model' + (measured(progress) ? ` ${Math.round(progress * 100)}%` : '')
    : preparing ? 'Preparing model' : state.network?.paused ? 'Disconnected' : state.network?.connecting || ['connecting', 'retrying'].includes(state.network?.consumer?.connectionState) ? 'Finding capacity' : 'No model ready';
  const labels = { idle: availability, queued: 'Queued', loading: 'Loading', executing: 'Executing', approval: 'Permission needed',
    completed: 'Complete', failed: 'Failed', cancelled: 'Stopped', cancelling: 'Stopping', interrupted: 'Interrupted', disconnected: 'Disconnected', recovering: 'Recovering' };
  const response = thread?.messages.find(message => message.id === attempt?.responseId)?.content || '';
  return { key: attempt ? `${thread.id}:${attempt.id}` : null, thread, attempt, execution, requester, local, split, ordered: !!ordered, executors,
    planId: ordered?.planId || execution?.planId,
    requesterExecutes: executors.some(node => node.id === requester),
    model: executors.length ? thread.model.name : null, status, statusLabel: labels[status] || status,
    response, active: !!active, totalMs: measured(attempt?.finishedAt) && measured(attempt?.createdAt) ? attempt.finishedAt - attempt.createdAt : null,
    transferMs: sum(execution?.steps, 'transferMs'), activationBytes: measured(execution?.activationBytes) ? execution.activationBytes : null };
}

export function renderExecutionRibbon() {
  return `<div class="execution-ribbon pool-activity-edge" data-execution-ribbon data-activity="idle">
    <button class="execution-ribbon-trigger pool-button btn-ghost" type="button" aria-label="Inspect execution" aria-haspopup="dialog" data-ribbon-trigger>
      <span class="execution-ribbon-status pool-caption pool-muted pool-dot" data-ribbon-status role="status"></span>
    </button>
  </div>`;
}

export function routeMarkup(view) {
  const nodeMarkup = (label, caption = '', pending = false) => `<span class="execution-ribbon-node${pending ? ' is-unassigned' : ''}"><span class="execution-ribbon-participant pool-dot${pending ? ' pool-dot-open' : ''}">${escape(label)}</span><small class="pool-caption pool-muted">${escape(caption)}</small></span>`;
  const requester = nodeMarkup('You', 'Request / output');
  if (!view.executors.length) return ''; // No invented route before admission.
  const nodes = view.executors.map(node => nodeMarkup(node.label, node.id === view.requester ? 'Request / output' : '')).join('<span class="execution-ribbon-wire pool-divider" aria-hidden="true"></span>');
  const group = `<span class="execution-ribbon-executors"><small class="execution-ribbon-model pool-caption pool-muted">${escape(view.model)}</small><span class="execution-ribbon-machines">${nodes}</span></span>`;
  // In a split, output returns B → A → requester through the same participants.
  return view.requesterExecutes ? group
    : `${requester}<span class="execution-ribbon-wire pool-divider" aria-hidden="true"></span>${group}`;
}

export function detailMarkup(view) {
  const { attempt, execution, executors } = view;
  return `${attempt?.error ? `<p role="alert">${escape(attempt.error)}</p>` : ''}
    <dl><dt>Requester / output recipient</dt><dd>${escape(view.requester)}</dd>
    <dt>Model</dt><dd>${escape(view.model || 'No executor assigned')}</dd>
    <dt>Attempt duration</dt><dd>${ms(view.totalMs)}${view.totalMs === null && view.active ? ' · in progress' : ''}</dd>
    <dt>Activation transfer</dt><dd>${view.activationBytes === null ? 'Not reported' : `${view.activationBytes.toLocaleString()} bytes`} · ${ms(view.transferMs)}</dd></dl>
    ${executors.length ? `<ul>${executors.map(node => `<li><strong>${escape(node.label)}</strong><code>${escape(node.id)}</code><dl>
      <dt>Assigned layers</dt><dd>${escape(node.layers)}</dd><dt>Contribution</dt><dd>${escape(node.contribution)}</dd>
      <dt>${view.split ? 'Recorded step time' : 'Compute time'}</dt><dd>${ms(node.duration)}</dd></dl></li>`).join('')}</ul>` : '<p>No executing participant has been assigned to this attempt.</p>'}
    ${view.split ? '<p>Output returns through the first executor. Step times include runtime and transport overhead; they are not GPU-only measurements.</p>' : ''}
    ${!view.requesterExecutes && executors.length ? '<p>Receiving the answer does not require model weights on this device.</p>' : ''}
    ${view.planId ? `<p>Plan <code>${escape(view.planId)}</code></p>` : ''}`;
}

export function bindExecutionRibbon(root, { onInspect = () => {}, labelSession = root } = {}) {
  const ribbon = root.querySelector('[data-execution-ribbon]');
  const find = selector => ribbon.querySelector(selector);
  const trigger = find('[data-ribbon-trigger]');
  const controller = new AbortController(), options = { signal: controller.signal };
  let key = null, lastResponse = '', pulse = null, timer = null;
  trigger.addEventListener('click', () => onInspect('conversation', trigger), options);
  const stopPulse = () => { pulse?.cancel(); pulse = null; clearTimeout(timer); timer = null; ribbon.removeAttribute('data-output-observed'); ribbon.dataset.activity = 'idle'; };
  const drawPulse = () => {
    stopPulse(); ribbon.dataset.outputObserved = 'true'; ribbon.dataset.activity = 'ready';
    const path = find('[data-ribbon-status]');
    if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && typeof path.animate === 'function') {
      // One restrained acknowledgement of observed output, never an idle loop.
      pulse = path.animate([{ opacity: 0.7 }, { opacity: 1 }], { duration: 480, easing: 'ease-out' });
    }
    timer = setTimeout(stopPulse, 500);
  };
  return {
    update(state) {
      const view = projectExecutionRibbon(withComputerLabels(state, labelSession)), changed = view.key !== key;
      if (changed) { key = view.key; lastResponse = view.response; stopPulse(); }
      find('[data-ribbon-status]').textContent = view.statusLabel;
      trigger.setAttribute('aria-label', `${view.statusLabel}. ${view.model ? view.model + ' on ' + view.executors.map(node => node.label).join(' and ') : 'No executor assigned'}. Execution details`);
      ribbon.dataset.state = view.status;
      if (!changed && view.active && view.response.length > lastResponse.length && view.response.startsWith(lastResponse)) {
        drawPulse();
      }
      if (!view.active || ['disconnected', 'recovering'].includes(view.status)) stopPulse();
      lastResponse = view.response;

    },
    dispose() { stopPulse(); controller.abort(); }
  };
}
