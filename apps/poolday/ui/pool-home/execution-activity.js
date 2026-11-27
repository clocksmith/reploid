import { projectExecutionRibbon } from './execution-ribbon.js';

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
export const supplyCaption = (view, supply) => view.execution?.privateDelegation && view.nodes.length
  ? (view.split ? 'split across ' : '') + view.nodes.map(node => node.label).join(' + ') : view.local || supply.answer === 'This device' ? 'This device'
  : supply.answer === 'Hosted' || view.attempt?.execution?.provider === 'hosted' ? 'Hosted'
  : supply.answer === 'Executor not verified' ? 'Executor not verified'
  : view.nodes.length || supply.answer === 'Mesh' || supply.answer?.startsWith('Mixed:') || view.attempt?.execution?.provider === 'peer' || view.attempt?.execution?.placement ? 'Shared computer' : '';

/** The recorded answer-level supply label, and this attempt's own when earlier attempts of the answer differ. */
export function projectSupplyLabel(attempt) {
  const provenance = attempt?.provenance?.schema === 'reploid.answer-provenance/v1' ? attempt.provenance : null;
  const answer = supplyLabel(provenance), own = supplyLabel(provenance?.execution);
  return { answer, attempt: answer && own && own !== answer ? own : null };
}
