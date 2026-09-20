// @vitest-environment node
import { it, expect } from 'vitest';
import { bayesianPeerJobFixture } from '../fixtures/bayesian-peer-job.js';

it('signs and independently replays Bayesian placement under the host policy', async () => {
  const result = await bayesianPeerJobFixture();
  expect(result.selectedProviderId).toBe(result.target);
  expect(result.selectedProviderId).not.toBe(result.initialProviderId);
  expect(result.plan.historyProjectionDigest).toMatch(/^sha256:/);
  expect(result.observations).toHaveLength(3);
  expect(result.errors.map(row => row.change)).toEqual(['tamper', 'ungranted']);
  expect(result.errors[0].error).toMatch(/deterministic provider plan/);
  expect(result.errors[1].error).toMatch(/policy differs/);
});
