// @vitest-environment node
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertPartitionMemorySettlement } from '../fixtures/partition-memory-settlement.js';

const retained = JSON.parse(readFileSync(new URL('../../artifacts/concurrent-memory-observation-20261012/bounded-result/accounting-control.json', import.meta.url)));
const snapshot = () => ({ device: structuredClone(retained.released.device),
  pool: { resources: structuredClone(retained.released.resources) }, gpuValidationErrors: [] });

it('accepts settled ownership with the exact retained reusable-weight accounting control', () => {
  const value = snapshot(), before = structuredClone(value);
  expect(value.device.categories.weights).toBe(256);
  expect(value.pool.resources.reusable.bytes).toBe(256);
  expect(() => assertPartitionMemorySettlement(value)).not.toThrow();
  expect(value).toEqual(before);
});

for (const owner of ['retainedModel', 'active', 'deferredCleanup']) {
  it(`rejects remaining ${owner} ownership`, () => {
    const value = snapshot(); value.pool.resources[owner] = { count: 1, bytes: 256 };
    expect(() => assertPartitionMemorySettlement(value)).toThrow();
  });
  it(`rejects inconsistent zero-count ${owner} byte ownership`, () => {
    const value = snapshot(); value.pool.resources[owner].bytes = 256;
    expect(() => assertPartitionMemorySettlement(value)).toThrow();
  });
}

it('rejects validation failures independently of resource release', () => {
  const value = snapshot(); value.gpuValidationErrors.push('invalid binding');
  expect(() => assertPartitionMemorySettlement(value)).toThrow();
});
