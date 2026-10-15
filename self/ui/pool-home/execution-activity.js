import { projectExecutionRibbon } from './execution-ribbon.js';
import { escapeHtml as escape } from '../components/attachments.js';

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
  const nodes = view.executors.map((node, index) => {
    const timing = view.ordered ? node.timing : view.split ? metric(index === 0 ? 'localStepMs' : 'remoteStepMs') : null;
    return { ...node, timing, speed: timing?.total > 0 ? 1000 * timing.count / timing.total : null };
  });
  const total = nodes.length && nodes.every(node => node.timing?.total > 0)
    ? nodes.reduce((n, node) => n + node.timing.total, 0) : null;
  return { ...view, nodes: nodes.map(node => ({ ...node, share: total ? node.timing.total / total : null })) };
}

export function updateExecutionActivity(root, state) {
  const view = projectExecutionActivity(state);
  root.hidden = !view.attempt || !view.nodes.length;
  if (root.hidden) return;
  root.querySelector('summary').textContent = `${view.status === 'executing' ? 'Generating' : view.statusLabel} · ${view.nodes.length} computer${view.nodes.length === 1 ? '' : 's'}`;
  const measured = view.nodes.every(node => node.share !== null);
  const markup = (measured ? `<div class="chat-distribution pool-bar" role="img" aria-label="Recorded step time share: ${escape(view.nodes.map(node => `${node.label} ${Math.round(node.share * 100)}%`).join(', '))}">${view.nodes.map(node => `<span style="--pool-param-share: ${node.share}"></span>`).join('')}</div>` : '')
    + `<ul>${view.nodes.map(node => `<li><span>${escape(node.label)}</span><span>${measured ? `${Math.round(node.share * 100)}% · ` : ''}${node.speed === null ? escape(node.layers) : `${node.speed.toFixed(1)} tok/s`}</span></li>`).join('')}</ul>`
    + (measured ? '<small title="Includes runtime and transport overhead, not GPU-only speed or completion progress.">Step-time share · includes overhead</small>' : '<small>Timing pending</small>');
  const detail = root.querySelector('[data-activity-detail]');
  if (detail.dataset.projection !== markup) { detail.innerHTML = markup; detail.dataset.projection = markup; }
}
