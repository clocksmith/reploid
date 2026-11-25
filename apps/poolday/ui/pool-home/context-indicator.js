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

export function projectContextIndicator(state, labelSession = state) {
  const view = projectExecutionRibbon(withComputerLabels(state, labelSession));
  const { text, percent, usage } = projectThreadContext(view.thread, state.models);
  const peers = [...new Map(view.executors.map(node => [node.id, node])).values()];
  const placement = peers.length ? `${view.active ? 'Executing on' : 'Last execution on'} ${peers.map(node => node.label).join(', ')}.` : 'No execution placement reported.';
  return { text, percent, peers, title: `${usage}\n${placement}\nWorking KV-cache residency is not reported.`, active: view.active };
}
