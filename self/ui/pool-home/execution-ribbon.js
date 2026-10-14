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
  // A pending approval names the verified recipients this attempt would disclose to: a proposal
  // for review, never placement. The execution receipt replaces it once admitted.
  const proposal = !execution && attempt?.status === 'approval' && attempt.approval?.recipients?.length ? attempt.approval : null;
  const routeOf = value => value?.schema === 'reploid.partition-route/v1' && Array.isArray(value.stages) ? value : null;
  const executed = execution?.identity?.schema === 'reploid.partition-attempt/v2' ? routeOf(execution.identity.route) : null;
  const ordered = proposal ? routeOf(proposal.route) : executed;
  const requester = (proposal ? state.network?.consumer?.peerId : executed ? execution.identity.requesterId : execution?.requesterId)
    || state.participantId || 'This device';
  const local = execution?.placement === 'local-webgpu';
  const split = !!ordered || execution?.placement === 'two-device-layer-partition' || !!proposal?.participantA;
  // Selected/discovered models are not proof of placement. Use this attempt's receipt or reviewed approval only.
  const ids = proposal ? [...proposal.recipients] : ordered ? ordered.stages.map(stage => stage.participantId) : local ? [requester]
    : split ? [execution.participantA, execution.participantB].filter(Boolean) : execution?.peerId ? [execution.peerId] : [];
  const layer = Number.isSafeInteger(execution?.splitLayer) ? execution.splitLayer : null;
  const executors = ids.map((id, i) => ({ id, label: id === requester ? 'This device' : computerLabel(state, id),
    layers: ordered ? `Stage ${i + 1} of ${ids.length}` : split ? layer === null ? 'Not reported' : i === 0 ? `0–${layer - 1}` : `${layer} onward` : 'Whole model',
    contribution: ordered ? i === 0 ? 'Initial layers; relays output' : i === ids.length - 1 ? 'Final layers; produces output' : 'Intermediate layers'
      : split ? i === 0 ? 'Initial layers; relays output' : 'Final layers; produces output' : 'Whole-model execution',
    timing: ordered ? orderedTiming(execution, i) : null,
    duration: ordered ? orderedTiming(execution, i)?.total ?? null : split ? sum(execution?.steps, i === 0 ? 'localStepMs' : 'remoteStepMs') : null }));
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
  const labels = { idle: availability, queued: 'Queued', loading: 'Loading', executing: 'Executing', approval: 'Awaiting approval',
    completed: 'Complete', failed: 'Failed', cancelled: 'Stopped', cancelling: 'Stopping', interrupted: 'Interrupted', disconnected: 'Disconnected', recovering: 'Recovering' };
  const response = thread?.messages.find(message => message.id === attempt?.responseId)?.content || '';
  return { key: attempt ? `${thread.id}:${attempt.id}` : null, thread, attempt, execution, requester, local, split, ordered: !!ordered, executors,
    proposed: !!proposal,
    planId: ordered?.planId || execution?.planId,
    requesterExecutes: executors.some(node => node.id === requester),
    model: executors.length ? thread.model.name : null, status, statusLabel: labels[status] || status,
    response, active: !!active, totalMs: measured(attempt?.finishedAt) && measured(attempt?.createdAt) ? attempt.finishedAt - attempt.createdAt : null,
    transferMs: sum(execution?.steps, 'transferMs'), activationBytes: measured(execution?.activationBytes) ? execution.activationBytes : null };
}

export function renderExecutionRibbon() {
  return `<div class="execution-ribbon" data-execution-ribbon>
    <button class="execution-ribbon-trigger" type="button" aria-label="Inspect execution" aria-haspopup="dialog" data-ribbon-trigger>
      <span class="execution-ribbon-status" data-ribbon-status role="status"></span>
    </button>
  </div>`;
}

export function routeMarkup(view) {
  const nodeMarkup = (label, caption = '', pending = false) => `<span class="execution-ribbon-node${pending ? ' is-unassigned' : ''}"><span class="execution-ribbon-participant">${escape(label)}</span><small>${escape(caption)}</small></span>`;
  const requester = nodeMarkup('You', 'Request / output');
  // No invented route: only an admitted receipt or the reviewed recipients of a pending approval.
  if (!view.executors.length) return '';
  const wire = `<span class="execution-ribbon-wire${view.proposed ? ' is-unassigned' : ''}" aria-hidden="true"></span>`;
  const nodes = view.executors.map(node => nodeMarkup(node.label, node.id === view.requester ? 'Request / output' : '', view.proposed)).join(wire);
  const group = `<span class="execution-ribbon-executors"><small class="execution-ribbon-model">${escape(view.model)}</small><span class="execution-ribbon-machines">${nodes}</span></span>`;
  // In a split, output returns B → A → requester through the same participants.
  return view.requesterExecutes ? group : `${requester}${wire}${group}`;
}

export function detailMarkup(view) {
  const { attempt, execution, executors } = view;
  return `${attempt?.error ? `<p role="alert">${escape(attempt.error)}</p>` : ''}
    ${view.proposed ? '<p>Proposed for this request. Nothing from this conversation is sent until you approve.</p>' : ''}
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
  const stopPulse = () => { pulse?.cancel(); pulse = null; clearTimeout(timer); timer = null; ribbon.removeAttribute('data-output-observed'); };
  const drawPulse = () => {
    stopPulse(); ribbon.dataset.outputObserved = 'true';
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
      trigger.setAttribute('aria-label', `${view.statusLabel}. ${view.model ? view.model + (view.proposed ? ' proposed on ' : ' on ')
        + view.executors.map(node => node.label).join(' and ') : 'No executor assigned'}. Execution details`);
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
