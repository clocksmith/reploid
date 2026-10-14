// @vitest-environment node
import { expect, it } from 'vitest';
import { residentPreparationProgress } from '../../packages/reploid/src/mesh/partitions/partition-preparation-progress.js';

const event = (status, fields = {}) => ({ phase: 'pipelines', status, prepared: 3, total: 22, key: 'rmsnorm_paired.wgsl#main',
  elapsedMs: 41.5, startedAt: 1760000000000, maxDurationMs: 1200000, outstanding: true, complete: true, ...fields });

it('maps Doppler pipeline preparation to contribution progress with ownership retained while compiling', () => {
  expect(residentPreparationProgress(event('preparing'))).toEqual({ stage: 'preparing', status: 'preparing', prepared: 3, total: 22,
    key: 'rmsnorm_paired.wgsl#main', elapsedMs: 41.5, startedAt: 1760000000000, maxDurationMs: 1200000, outstanding: true,
    message: 'Preparing GPU pipelines: 3 of 22' });
  expect(residentPreparationProgress(event('cancelling'))).toMatchObject({ status: 'cancelling', outstanding: true,
    message: 'Stopping after the current GPU pipeline finishes compiling' });
  expect(residentPreparationProgress(event('timed-out'))).toMatchObject({ status: 'timed-out', outstanding: true,
    message: 'Preparation time limit reached; waiting for the current GPU pipeline to finish compiling' });
  expect(residentPreparationProgress(event('timed-out', { outstanding: false })).message)
    .toBe('Preparation time limit reached: 3 of 22 GPU pipelines');
  expect(residentPreparationProgress(event('cancelled', { outstanding: false })).message).toBe('Stopped preparing GPU pipelines: 3 of 22');
  expect(residentPreparationProgress(event('failed', { outstanding: false })).message).toBe('GPU pipeline preparation failed: 3 of 22');
  expect(residentPreparationProgress(event('prepared', { prepared: 22, key: null, outstanding: false })))
    .toMatchObject({ status: 'prepared', key: null, message: 'Preparing GPU pipelines: 22 of 22' });
});

it('ignores byte acquisition and malformed events instead of inventing progress', () => {
  expect(residentPreparationProgress({ phase: 'artifact', artifactId: 'a', loadedBytes: 1, totalBytes: 2 })).toBeNull();
  for (const changed of [{ status: 'ready' }, { prepared: 23 }, { total: -1 }, { outstanding: 'yes' }, { elapsedMs: Number.NaN }]) {
    expect(residentPreparationProgress(event('preparing', changed))).toBeNull();
  }
  expect(residentPreparationProgress(null)).toBeNull();
});
