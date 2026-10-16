/** Compact projection of measured answer tokens and recorded executors, never discovered peers. */
import { projectExecutionRibbon } from './execution-ribbon.js';
import { withComputerLabels } from './computer-labels.js';
const count = value => Number.isSafeInteger(value) && value >= 0;

export function projectThreadContext(thread, models = []) {
  const completion = thread?.attempts.at(-1)?.execution?.completion;
  const model = models.find(model => model.id === thread?.model.id && model.identity === thread?.model.identity);
  const limit = model?.contextLength;
  const known = count(completion?.promptTokenCount) && count(completion?.generatedTokenCount) && count(limit) && limit > 0;
  const tokens = known ? completion.promptTokenCount + completion.generatedTokenCount : null;
  const percent = known ? tokens / limit * 100 : null;
  const text = percent === null ? '—' : percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
  const usage = known ? `Last answer used ${tokens.toLocaleString()} tokens (${completion.promptTokenCount.toLocaleString()} input, ${completion.generatedTokenCount.toLocaleString()} output) of the model’s ${limit.toLocaleString()}-token advertised context window. Unsent draft is not counted; the execution limit may be smaller.`
    : 'Context usage has not been reported for this answer.';
  return { text, percent, usage };
}

/** A measured fraction, not execution progress. Unknown values have no ring. */
export function renderContextRing() {
  return '<svg class="pool-meter" data-context-ring viewBox="0 0 32 32" fill="none" stroke-width="1" aria-hidden="true" hidden><circle class="pool-meter-track" cx="16" cy="16" r="14"/><circle class="pool-meter-value" data-context-ring-value cx="16" cy="16" r="14" pathLength="100" transform="rotate(-90 16 16)"/></svg>';
}

export function updateContextRing(root, percent) {
  const ring = root.querySelector('[data-context-ring]');
  ring.toggleAttribute('hidden', percent === null);
  const filled = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  ring.querySelector('[data-context-ring-value]').setAttribute('stroke-dasharray', `${filled} ${100 - filled}`);
}

export function projectContextIndicator(state, labelSession = state) {
  const view = projectExecutionRibbon(withComputerLabels(state, labelSession));
  const { text, percent, usage } = projectThreadContext(view.thread, state.models);
  const peers = [...new Map(view.executors.map(node => [node.id, node])).values()];
  const placement = peers.length ? `${view.active ? 'Executing on' : 'Last execution on'} ${peers.map(node => node.label).join(', ')}.` : 'No execution placement reported.';
  return { text, percent, peers, title: `${usage}\n${placement}\nWorking KV-cache residency is not reported.`, active: view.active };
}

export function renderContextIndicator() {
  return `<button class="chat-context-indicator pool-button btn-ghost pool-caption pool-muted" type="button" data-context-indicator aria-label="Context and execution details">${renderContextRing()}<span data-context-percent>—</span><svg data-context-peers height="12" aria-hidden="true" hidden></svg></button>`;
}

export function updateContextIndicator(root, state, labelSession) {
  const value = projectContextIndicator(state, labelSession);
  const button = root.querySelector('[data-context-indicator]');
  if (!button) return;
  button.title = value.title;
  button.setAttribute('aria-label', `${value.text === '—' ? 'Context usage unavailable' : value.text + ' of model context'}. ${value.title}`);
  root.querySelector('[data-context-percent]').textContent = value.text;
  updateContextRing(button, value.percent);
  const graph = root.querySelector('[data-context-peers]');
  const nodes = value.peers.slice(0, 4), width = nodes.length * 16;
  graph.toggleAttribute('hidden', !nodes.length);
  graph.setAttribute('viewBox', `0 0 ${width || 16} 12`); graph.setAttribute('width', String(width));
  const markup = nodes.map((node, index) => `${index ? `<path d="M${index * 16 - 4} 6h8"/>` : ''}${node.label === 'This device' ? `<rect x="${index * 16 + 4}" y="2" width="8" height="8" rx="1"/>` : `<circle cx="${index * 16 + 8}" cy="6" r="4"/>`}`).join('');
  if (graph.innerHTML !== markup) graph.innerHTML = markup;
  const detail = root.querySelector('[data-context-detail]');
  if (detail) detail.textContent = value.title;
}
