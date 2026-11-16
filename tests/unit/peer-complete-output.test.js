// @vitest-environment node
import { expect, it } from 'vitest';
import { inspectCompleteOutput } from '../fixtures/peers/pooled/complete-output.js';
import { COMPLETE_REQUEST_TIMING_SCOPE } from '../fixtures/complete-request-timing.js';
const workload = { promptIds: [1], stopIds: [9], maxNew: 2 };
const common = { inputIds: [1], text: 'text', timingScope: COMPLETE_REQUEST_TIMING_SCOPE, requestWallMs: 5, generationWallMs: 4 };
it('compares exact public IDs while preserving terminal and lookahead sampling differences', () => {
  const native = { ...common, sampledIds: [5, 9], emissions: [{ token: 5 }, { token: 9 }],
    generationEvidence: { stats: { reusedPrefixTokens: 0, stopReason: 'stop-token', stopTokenId: 9 } } };
  const peer = { ...common, ids: [5], rawSampledIds: [5, 9, 8], emissions: [{ token: 5 }],
    reason: 'stop', reused: 0, resumed: 0, prefilled: 1 };
  expect(inspectCompleteOutput(native, workload, 'native')).toEqual(inspectCompleteOutput(peer, workload, 'peer'));
  expect(native.sampledIds).toEqual([5, 9]); expect(peer.rawSampledIds).toEqual([5, 9, 8]);
  peer.rawSampledIds[0] = 7;
  expect(() => inspectCompleteOutput(peer, workload, 'peer')).toThrow('sampler');
});
it('permits immediate stop but rejects changed reasons, terminal IDs and narrowed token counts', () => {
  const row = { ...common, ids: [], rawSampledIds: [9], emissions: [], reason: 'stop', reused: 0, resumed: 0, prefilled: 1 };
  expect(inspectCompleteOutput(row, workload, 'peer').completionIds).toEqual([]);
  for (const change of [{ reason: 'max' }, { rawSampledIds: [8] }, { resumed: 1 }]) {
    expect(() => inspectCompleteOutput({ ...row, ...change }, workload, 'peer')).toThrow();
  }
});
