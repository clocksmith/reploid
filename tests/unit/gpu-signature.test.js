import { it, expect, vi } from 'vitest';
import { captureGpuSignature, compareGpuSignatures } from '../../packages/reploid/src/mesh/gpu-signature.js';
import policy from '../../packages/reploid/src/mesh/gpu-signature.policy.json' with { type: 'json' };

const fixture = (reverse = false) => ({ schema: policy.schema, profile: policy.profile, status: 'measured',
  workgroups: policy.workgroups, trials: policy.trials, samples: policy.seeds.map((seed, workload) => ({ seed, workload,
    orders: Array.from({ length: policy.trials }, () => Array.from({ length: policy.workgroups }, (_, i) => reverse ? policy.workgroups - 1 - i : i)) })) });

it('does not touch GPU APIs without consent and distinguishes unavailable hardware', async () => {
  const gpu = { requestAdapter: vi.fn(async () => null) };
  await expect(captureGpuSignature(null, { gpu })).rejects.toThrow('explicit consent');
  expect(gpu.requestAdapter).not.toHaveBeenCalled();
  expect(await captureGpuSignature(null, { consent: true, gpu })).toEqual({ status: 'unavailable', reason: 'adapter-unavailable' });
});

it('reports descriptive distance without inventing a recognition threshold', () => {
  expect(compareGpuSignatures(fixture(), fixture())).toMatchObject({ status: 'uncertain', distance: 0, reason: 'calibration-required' });
  expect(compareGpuSignatures(null, fixture())).toMatchObject({ status: 'unmeasured' });
  const thresholds = { calibrationId: 'fixture-only', consistentMax: 0.01, changedMin: 0.2 };
  expect(compareGpuSignatures(fixture(), fixture(), thresholds).status).toBe('consistent');
  expect(compareGpuSignatures(fixture(), fixture(true), thresholds).status).toBe('changed');
  expect(() => compareGpuSignatures(fixture(), fixture(), { ...thresholds, calibrationId: '' })).toThrow('calibrated');
});

it('rejects missing, nonfinite, duplicated and incompatible samples instead of matching them', () => {
  const a = fixture(), b = fixture();
  b.profile = 'different';
  expect(compareGpuSignatures(a, b)).toMatchObject({ status: 'uncertain', reason: 'incompatible-profiles' });
  for (const broken of [[], Array(policy.workgroups).fill(0), [NaN]]) {
    const bad = fixture(); bad.samples[0].orders[0] = broken;
    expect(() => compareGpuSignatures(a, bad)).toThrow('Invalid GPU signature samples');
  }
});

it('cancels device acquisition and destroys a device that arrives after cancellation', async () => {
  const controller = new AbortController(), destroy = vi.fn(); let resolveDevice;
  const gpu = { requestAdapter: async () => ({ requestDevice: () => new Promise(resolve => { resolveDevice = resolve; }) }) };
  const pending = captureGpuSignature(null, { consent: true, gpu, signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow('stop');
  await vi.waitFor(() => expect(resolveDevice).toBeTypeOf('function'));
  controller.abort(new Error('stop')); await rejected;
  resolveDevice({ destroy });
  await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
});
