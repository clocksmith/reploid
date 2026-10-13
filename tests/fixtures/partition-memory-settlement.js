import assert from 'node:assert/strict';

/** Validate resident ownership after a confirmed queue barrier; preserve the raw counters. */
export function assertPartitionMemorySettlement(snapshot) {
  assert.equal(snapshot.pool.resources.retainedModel.count, 0, 'Closed resident still owns weights');
  assert.equal(snapshot.pool.resources.active.count, 0, 'Closed resident still owns active buffers');
  assert.equal(snapshot.pool.resources.deferredCleanup.count, 0, 'Retired buffers did not settle');
  // Device categories label allocations until destruction. Released weights may
  // remain reusable in the pool; only these three owners must be empty.
  for (const owner of ['retainedModel', 'active', 'deferredCleanup']) {
    assert.equal(snapshot.pool.resources[owner].bytes, 0, `Closed resident retains ${owner} bytes`);
  }
  assert.deepEqual(snapshot.gpuValidationErrors, [], 'Cleanup produced WebGPU errors');
}
