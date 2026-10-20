import { projectExecutionRibbon } from './execution-ribbon.js';
import { escapeHtml as escape } from '../components/attachments.js';
import { interfaceIcon } from '../components/interface-icons.js';

/** Observed attempt data only. Token deltas are not assumed to be single tokens. */
export function projectExecutionActivity(state) {
  const view = projectExecutionRibbon(state);
  const metric = key => {
    const aggregate = view.execution?.stepSummary?.metrics?.[key];
    if (aggregate && Number.isSafeInteger(aggregate.count) && aggregate.count > 0 && Number.isFinite(aggregate.total) && aggregate.total > 0) return aggregate;
    const values = view.execution?.steps?.map(step => step[key]);
    return values?.length && values.every(value => Number.isFinite(value) && value >= 0)
      ? { count: values.length, total: values.reduce((a, b) => a + b, 0) } : null;
  };
  const generation = view.execution?.timing;
  const wholeTiming = generation && Number.isSafeInteger(generation.generatedTokenCount)
    && generation.generatedTokenCount >= 0 && Number.isFinite(generation.totalMs) && generation.totalMs > 0
    ? { count: generation.generatedTokenCount, total: generation.totalMs } : null;
  const nodes = view.executors.map((node, index) => {
    const timing = view.ordered ? node.timing : view.split ? metric(index === 0 ? 'localStepMs' : 'remoteStepMs') : wholeTiming;
    return { ...node, timing, speed: timing?.total > 0 ? 1000 * timing.count / timing.total : null };
  });
  const total = nodes.length && nodes.every(node => node.timing?.total > 0)
    ? nodes.reduce((n, node) => n + node.timing.total, 0) : null;
  return { ...view, computerCount: new Set(nodes.map(node => node.id)).size,
    averageSpeed: wholeTiming ? 1000 * wholeTiming.count / wholeTiming.total : null,
    nodes: nodes.map(node => ({ ...node, share: total ? node.timing.total / total : null })) };
}

// Provisional labels for the attempt's recorded supply provenance (reploid.answer-provenance/v1).
const SUPPLY_LABELS = { local: 'This device', mesh: 'Mesh', hosted: 'Hosted', unknown: 'Executor not verified' };
const supplyLabel = part => part?.supply === 'mixed' ? `Mixed: ${part.classes.map(name => SUPPLY_LABELS[name]).join(' + ')}`
  : SUPPLY_LABELS[part?.supply] ?? null;

/** The recorded answer-level supply label, and this attempt's own when earlier attempts of the answer differ. */
export function projectSupplyLabel(attempt) {
  const provenance = attempt?.provenance?.schema === 'reploid.answer-provenance/v1' ? attempt.provenance : null;
  const answer = supplyLabel(provenance), own = supplyLabel(provenance?.execution);
  return { answer, attempt: answer && own && own !== answer ? own : null };
}

export function updateExecutionActivity(root, state) {
  const view = projectExecutionActivity(state), supply = projectSupplyLabel(view.attempt);
  const retrieval = view.attempt?.retrieval, progress = retrieval?.progress;
  const toolStatus = view.active && retrieval?.outcome === 'pending'
    ? progress?.stage === 'extraction'
      ? `Reading search results · ${progress.completed} of ${progress.total} pages`
      : progress?.stage === 'context' ? 'Preparing search results…' : 'Searching the web…'
    : '';
  const tool = root.querySelector('[data-tool-status]');
  if (tool) { tool.hidden = !toolStatus; tool.textContent = toolStatus; }
  root.hidden = !view.attempt || !toolStatus && !view.nodes.length && !supply.answer && !view.attempt.error;
  if (root.hidden) return;
  const summary = [toolStatus || (view.status === 'executing' ? 'Generating' : view.statusLabel),
    ...(view.nodes.length ? [`${view.computerCount} computer${view.computerCount === 1 ? '' : 's'}`] : []),
    ...(view.split ? ['Partitioned'] : []), ...(supply.answer ? [supply.answer] : [])].join(' · ');
  const trigger = root.querySelector('[data-execution-trigger]');
  trigger.setAttribute('aria-label', summary + '. Execution details');
  trigger.title = summary + (view.nodes.length ? '\n' + view.nodes.map(node => node.label).join(' → ') : '')
    + (view.attempt.error ? '\n' + view.attempt.error : '') + '\nClick to inspect';
  const icon = interfaceIcon(toolStatus ? 'search' : view.local ? 'device' : view.nodes.length ? 'peers' : 'activity')
    + (view.computerCount ? `<span>${view.computerCount}</span>` : '')
    + `<span class="chat-visually-hidden">${escape(summary)}</span>`;
  if (trigger.dataset.markup !== icon) { trigger.innerHTML = icon; trigger.dataset.markup = icon; }
  const measured = view.nodes.length > 0 && view.nodes.every(node => node.share !== null);
  const duration = value => `${(value / 1000).toFixed(2)} s`;
  const timings = view.execution?.timing;
  const facts = [
    ['First token', timings?.firstTokenMs], ['Prompt processing', timings?.prefillMs],
    ['Decode', timings?.decodeMs], ['Generation total', timings?.totalMs],
    ['Admission wait', view.execution?.admission?.queuedMs], ['Attempt total', view.totalMs]
  ].filter(([, value]) => Number.isFinite(value) && value >= 0).map(([label, value]) => [label, duration(value)]);
  const phases = view.execution?.stepSummary?.phases;
  const stageTotal = (stages, read) => view.ordered && stages?.length === view.nodes.length
    && view.nodes.every((_, index) => stages.filter(stage => stage.partitionIndex === index).length === 1)
    && stages.every(stage => Number.isFinite(read(stage)) && read(stage) >= 0)
    ? stages.reduce((total, stage) => total + read(stage), 0) : null;
  const promptMs = stageTotal(phases?.prompt?.stages, stage => stage.elapsedMs);
  const decodeMs = stageTotal(phases?.decode?.stages, stage => phases.decode.steps > 0
    && stage.elapsedMs?.count === phases.decode.steps ? stage.elapsedMs.total : null);
  if (promptMs !== null) facts.push(['Recorded prompt-stage time', duration(promptMs)]);
  if (decodeMs !== null) facts.push(['Recorded decode-stage time', duration(decodeMs)]);
  const inputTokens = view.execution?.completion?.promptTokenCount ?? phases?.prompt?.inputTokens;
  if (Number.isSafeInteger(inputTokens) && inputTokens >= 0) facts.push(['Prompt tokens', inputTokens.toLocaleString()]);
  const transfer = view.execution?.stepSummary?.metrics?.transferMs;
  const transferMs = view.transferMs ?? (transfer?.count > 0 && transfer.count === view.execution.stepSummary.count ? transfer.total : null);
  if (Number.isFinite(transferMs) && transferMs >= 0) facts.push(['Activation transfer time', duration(transferMs)]);
  if (Number.isSafeInteger(view.activationBytes) && view.activationBytes >= 0) facts.push(['Activation data', `${view.activationBytes.toLocaleString()} bytes`]);
  // A hosted or unreported executor has no computers to list; only its supply label is shown.
  const markup = `<p>${escape(summary)}</p>` + (!view.nodes.length ? '' : (measured && view.split ? `<div class="chat-distribution pool-bar" role="img" aria-label="Recorded step time share: ${escape(view.nodes.map(node => `${node.label} ${Math.round(node.share * 100)}%`).join(', '))}">${view.nodes.map(node => `<span style="--pool-param-share: ${node.share}"></span>`).join('')}</div>` : '')
    + `<ul>${view.nodes.map(node => `<li><span>${escape(node.label)}${view.split ? ` · ${escape(node.layers)}` : ''}</span><span>${measured && view.split ? `${Math.round(node.share * 100)}% · ` : ''}${node.speed === null ? view.split ? 'Timing not recorded' : escape(node.layers) : `${node.speed.toFixed(1)} ${view.split ? 'steps/s' : 'tok/s'}`}</span></li>`).join('')}</ul>`
    + (measured && !view.split ? '<small>Generation average · includes prompt processing</small>' : measured ? '<small title="Includes runtime and transport overhead, not GPU-only speed or completion progress.">Step-time share · includes overhead</small>' : `<small>${view.active ? 'Timing pending' : 'Timing not recorded'}</small>`))
    + (supply.attempt ? `<small data-attempt-supply>This attempt: ${escape(supply.attempt)}</small>` : '')
    + (facts.length ? `<dl class="chat-execution-facts">${facts.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` : '')
    + (view.attempt.error ? `<pre>${escape(view.attempt.error)}</pre><button class="pool-button btn-ghost pool-icon" type="button" data-copy-error="${escape(view.attempt.id)}" title="Copy error" aria-label="Copy error">${interfaceIcon('copy')}</button>` : '');
  const detail = root.querySelector('[data-activity-detail]');
  if (detail.dataset.projection !== markup) { detail.innerHTML = markup; detail.dataset.projection = markup; }
}
