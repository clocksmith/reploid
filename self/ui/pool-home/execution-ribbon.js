/** Selected-attempt presentation only. Discovery never establishes an execution path. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const measured = value => Number.isFinite(value) && value >= 0;
const ms = value => measured(value) ? `${Math.round(value)} ms` : 'Not reported';
const sum = (steps, key) => steps?.length && steps.every(step => measured(step[key])) ? steps.reduce((n, step) => n + step[key], 0) : null;
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export function projectExecutionRibbon(state) {
  const thread = state.activeThread, attempt = thread?.attempts.at(-1), execution = attempt?.execution;
  const requester = execution?.requesterId || state.participantId || 'This device';
  const local = execution?.placement === 'local-webgpu';
  const split = execution?.placement === 'two-device-layer-partition';
  // Selected/discovered models are not proof of placement. Use this attempt's receipt only.
  const ids = local ? [requester] : split ? [execution.participantA, execution.participantB].filter(Boolean)
    : execution?.peerId ? [execution.peerId] : [];
  const layer = Number.isSafeInteger(execution?.splitLayer) ? execution.splitLayer : null;
  const executors = ids.map((id, i) => ({ id, label: id === requester ? 'This device' : split ? `Peer ${i === 0 ? 'A' : 'B'}` : `Peer ${id.slice(0, 6)}`,
    layers: split ? layer === null ? 'Not reported' : i === 0 ? `0–${layer - 1}` : `${layer} onward` : 'Whole model',
    contribution: split ? i === 0 ? 'Initial layers; relays output' : 'Final layers; produces output' : 'Whole-model execution',
    duration: split ? sum(execution.steps, i === 0 ? 'localStepMs' : 'remoteStepMs') : null }));
  const connection = state.network?.consumer?.connectionState;
  const active = attempt && !terminal.has(attempt.status);
  let status = attempt?.status || 'idle';
  if (active && !local && (state.network?.paused || ['disconnected', 'closed'].includes(connection))) status = 'disconnected';
  else if (active && !local && connection === 'retrying') status = 'recovering';
  else if (active && attempt.retryOf && ['queued', 'loading'].includes(status)) status = 'recovering';
  const labels = { idle: 'No active request', queued: 'Queued', loading: 'Loading', executing: 'Executing', approval: 'Awaiting approval',
    completed: 'Complete', failed: 'Failed', cancelled: 'Stopped', cancelling: 'Stopping', interrupted: 'Interrupted', disconnected: 'Disconnected', recovering: 'Recovering' };
  const response = thread?.messages.find(message => message.id === attempt?.responseId)?.content || '';
  return { key: attempt ? `${thread.id}:${attempt.id}` : null, thread, attempt, execution, requester, local, split, executors,
    requesterExecutes: executors.some(node => node.id === requester),
    model: executors.length ? thread.model.name : null, status, statusLabel: labels[status] || status,
    response, active: !!active, totalMs: measured(attempt?.finishedAt) && measured(attempt?.createdAt) ? attempt.finishedAt - attempt.createdAt : null,
    transferMs: sum(execution?.steps, 'transferMs'), activationBytes: measured(execution?.activationBytes) ? execution.activationBytes : null };
}

export function renderExecutionRibbon() {
  return `<div class="execution-ribbon" data-execution-ribbon>
    <button class="execution-ribbon-trigger" type="button" aria-label="Execution path and details" aria-expanded="false" aria-controls="execution-ribbon-details" data-ribbon-trigger>
      <span class="execution-ribbon-route" data-ribbon-route></span><span class="execution-ribbon-status" data-ribbon-status></span>
    </button>
    <section class="execution-ribbon-details pool-surface" id="execution-ribbon-details" aria-label="Execution details" data-ribbon-details hidden>
      <header><strong>Execution details</strong><button class="pool-button" type="button" data-ribbon-close>Close</button></header>
      <div data-ribbon-facts></div>
      <details><summary>Timeline</summary><ol data-ribbon-timeline></ol></details>
    </section>
  </div>`;
}

function routeMarkup(view) {
  const nodeMarkup = (label, caption = '', pending = false) => `<span class="execution-ribbon-node${pending ? ' is-unassigned' : ''}"><span class="execution-ribbon-participant">${escape(label)}</span><small>${escape(caption)}</small></span>`;
  const requester = nodeMarkup('You', 'Request / output');
  if (!view.executors.length) return `${requester}<span class="execution-ribbon-wire is-unassigned" aria-hidden="true"></span>${nodeMarkup('Unassigned', '', true)}`;
  const nodes = view.executors.map(node => nodeMarkup(node.label, node.id === view.requester ? 'Request / output' : '')).join('<span class="execution-ribbon-wire" aria-hidden="true"></span>');
  const group = `<span class="execution-ribbon-executors"><small class="execution-ribbon-model">${escape(view.model)}</small><span class="execution-ribbon-machines">${nodes}</span></span>`;
  // In a split, output returns B → A → requester through the same participants.
  return view.requesterExecutes ? group
    : `${requester}<span class="execution-ribbon-wire" aria-hidden="true"></span>${group}`;
}

function detailMarkup(view) {
  const { attempt, execution, executors } = view;
  return `<p>${escape(view.statusLabel)}${attempt?.error ? ': ' + escape(attempt.error) : ''}</p>
    <dl><dt>Requester / output recipient</dt><dd>${escape(view.requester)}</dd>
    <dt>Model</dt><dd>${escape(view.model || 'No executor assigned')}</dd>
    <dt>Attempt duration</dt><dd>${ms(view.totalMs)}${view.totalMs === null && view.active ? ' · in progress' : ''}</dd>
    <dt>Activation transfer</dt><dd>${view.activationBytes === null ? 'Not reported' : `${view.activationBytes.toLocaleString()} bytes`} · ${ms(view.transferMs)}</dd></dl>
    ${executors.length ? `<ul>${executors.map(node => `<li><strong>${escape(node.label)}</strong><code>${escape(node.id)}</code><dl>
      <dt>Assigned layers</dt><dd>${escape(node.layers)}</dd><dt>Contribution</dt><dd>${escape(node.contribution)}</dd>
      <dt>${view.split ? 'Recorded step time' : 'Compute time'}</dt><dd>${ms(node.duration)}</dd></dl></li>`).join('')}</ul>` : '<p>No executing participant has been assigned to this attempt.</p>'}
    ${view.split ? '<p>Output returns through the first executor. Step times include runtime and transport overhead; they are not GPU-only measurements.</p>' : ''}
    ${!view.requesterExecutes && executors.length ? '<p>Receiving the answer does not require model weights on this device.</p>' : ''}
    ${execution?.planId ? `<p>Plan <code>${escape(execution.planId)}</code></p>` : ''}`;
}

export function bindExecutionRibbon(root, { clock = () => Date.now() } = {}) {
  const ribbon = root.querySelector('[data-execution-ribbon]');
  const find = selector => ribbon.querySelector(selector);
  const trigger = find('[data-ribbon-trigger]'), panel = find('[data-ribbon-details]');
  const controller = new AbortController(), options = { signal: controller.signal };
  let key = null, lastResponse = '', routeKey = '', detailKey = '', pulse = null, timer = null, suppressFocus = false;
  let firstObservedOutput = null;
  const show = () => { if (suppressFocus) return; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); };
  const hide = () => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  const close = () => { hide(); suppressFocus = true; trigger.focus(); suppressFocus = false; };
  trigger.addEventListener('focus', show, options);
  trigger.addEventListener('click', show, options);
  find('[data-ribbon-close]').addEventListener('click', close, options);
  ribbon.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }, options);
  ribbon.ownerDocument.addEventListener('pointerdown', event => { if (!ribbon.contains(event.target)) hide(); }, options);
  const stopPulse = () => { pulse?.cancel(); pulse = null; clearTimeout(timer); timer = null; ribbon.removeAttribute('data-output-observed'); };
  const drawPulse = () => {
    stopPulse(); ribbon.dataset.outputObserved = 'true';
    const path = find('[data-ribbon-route]');
    if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && typeof path.animate === 'function') {
      // One finite return sweep per observed response update, never an idle or executing loop.
      pulse = path.animate([{ backgroundPosition: '0% 100%' }, { backgroundPosition: '100% 100%' }], { duration: 480, easing: 'ease-out' });
    }
    timer = setTimeout(stopPulse, 500);
  };
  return {
    update(state) {
      const view = projectExecutionRibbon(state), changed = view.key !== key;
      if (changed) { key = view.key; lastResponse = view.response; firstObservedOutput = null; stopPulse(); hide(); }
      const markup = routeMarkup(view);
      if (markup !== routeKey) { routeKey = markup; find('[data-ribbon-route]').innerHTML = markup; }
      find('[data-ribbon-status]').textContent = view.statusLabel;
      trigger.setAttribute('aria-label', `${view.statusLabel}. ${view.model ? view.model + ' on ' + view.executors.map(node => node.label).join(' and ') : 'No executor assigned'}. Execution details`);
      ribbon.dataset.state = view.status;
      if (!changed && view.active && view.response.length > lastResponse.length && view.response.startsWith(lastResponse)) {
        firstObservedOutput ??= clock(); drawPulse();
      }
      if (!view.active || ['disconnected', 'recovering'].includes(view.status)) stopPulse();
      lastResponse = view.response;
      const detail = detailMarkup(view);
      if (detail !== detailKey) { detailKey = detail; find('[data-ribbon-facts]').innerHTML = detail; }
      const events = [];
      if (measured(view.attempt?.createdAt)) events.push([view.attempt.createdAt, 'Request created']);
      if (firstObservedOutput !== null) events.push([firstObservedOutput, 'First output observed in this view']);
      if (measured(view.attempt?.finishedAt)) events.push([view.attempt.finishedAt, view.statusLabel]);
      find('[data-ribbon-timeline]').innerHTML = events.length ? events.map(([time, label]) => `<li><time>${escape(new Date(time).toLocaleTimeString())}</time> ${escape(label)}</li>`).join('') : '<li>No recorded events.</li>';
    },
    dispose() { stopPulse(); controller.abort(); }
  };
}
