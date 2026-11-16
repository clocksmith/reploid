// Preserve raw outputs while accounting for the public APIs' terminal-token rule.
import assert from 'node:assert/strict';
import { COMPLETE_REQUEST_TIMING_SCOPE } from '../../complete-request-timing.js';

export function inspectCompleteOutput(row, workload, kind) {
  assert.deepEqual(row.inputIds, workload.promptIds, 'Complete input IDs differ');
  assert.equal(row.timingScope, COMPLETE_REQUEST_TIMING_SCOPE, 'Complete-request clock scope differs');
  assert(typeof row.text === 'string' && Number.isFinite(row.requestWallMs) && row.requestWallMs >= 0
    && Number.isFinite(row.generationWallMs) && row.generationWallMs >= 0, 'Incomplete public request output');
  const stop = new Set(workload.stopIds);
  let ids, reason, terminalStopId = null;
  if (kind === 'native') {
    const stats = row.generationEvidence.stats;
    assert.equal(stats.reusedPrefixTokens, 0, 'Native prefix reuse changes the request');
    ids = [...row.sampledIds];
    assert.deepEqual(row.emissions.map(event => event.token), ids, 'Native token events differ');
    if (stats.stopReason === 'stop-token') {
      terminalStopId = ids.pop();
      assert(stop.has(terminalStopId) && terminalStopId === stats.stopTokenId, 'Native terminal token differs');
      reason = 'stop';
    } else {
      assert.equal(stats.stopReason, 'max-tokens', 'Native request did not complete'); reason = 'max';
    }
  } else {
    assert.equal(kind, 'peer'); ids = [...row.ids]; reason = row.reason;
    assert(row.reused === 0 && row.resumed === 0 && row.prefilled === workload.promptIds.length,
      'Peer request reused, resumed or changed input');
    assert.deepEqual(row.emissions.map(event => event.token), ids, 'Peer token events differ');
    assert.deepEqual(row.rawSampledIds.slice(0, ids.length), ids, 'Peer sampler differs from emitted prefix');
    if (reason === 'stop') {
      terminalStopId = row.rawSampledIds[ids.length];
      assert(stop.has(terminalStopId), 'Peer sampler did not expose its terminal stop candidate');
    } else assert.equal(reason, 'max', 'Peer request did not complete');
  }
  assert(ids.length <= workload.maxNew && ids.every(id => Number.isSafeInteger(id) && id >= 0 && !stop.has(id)),
    'Completion IDs violate the frozen token policy');
  if (reason === 'max') assert.equal(ids.length, workload.maxNew, 'Requested token count was narrowed');
  return { completionIds: ids, reason, terminalStopId, text: row.text,
    tokenContract: 'Exact public completion IDs; native terminal stop removed only with recorded matching stop reason/ID; raw tokens retained' };
}
