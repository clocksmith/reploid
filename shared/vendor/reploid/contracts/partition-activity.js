import { canonicalRouteAttemptBinding, sameRouteAttemptIdentity } from './partition.js';

/** Bounded completed-token observations measured on the coordinator clock.
 * These describe execution only; they are never text or publication records. */
export function partitionActivity(value, identity, previous = null, coalesced = false) {
  const fail = () => { throw new Error('Invalid or out-of-order partition activity'); };
  const expected = canonicalRouteAttemptBinding(identity);
  if (!value || value.schema !== 'reploid.partition-activity/v1'
    || !sameRouteAttemptIdentity(value.identity, expected)
    || (coalesced ? value.sequence < (previous ? previous.sequence + 1 : 0)
      : value.sequence !== (previous ? previous.sequence + 1 : 0))) fail();
  const summary = value.stepSummary;
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !Number.isSafeInteger(summary?.count) || summary.count !== value.sequence + 1 || !Array.isArray(summary.stages)
    || summary.stages.length !== expected.route.stages.length) fail();
  let measuredTotal = 0;
  const stages = summary.stages.map((row, index) => {
    if (row.partitionIndex !== index || row.steps !== summary.count
      || row.stepMs?.count !== summary.count || !Number.isFinite(row.stepMs.total) || row.stepMs.total < 0
      || previous && row.stepMs.total < previous.stepSummary.stages[index].stepMs.total) fail();
    measuredTotal += row.stepMs.total;
    if (!Number.isFinite(measuredTotal)) fail();
    return { partitionIndex: index, steps: row.steps, stepMs: { count: row.stepMs.count, total: row.stepMs.total } };
  });
  return { schema: 'reploid.partition-activity/v1', identity: expected, sequence: value.sequence,
    stepSummary: { count: summary.count, stages } };
}
