import { expect, it } from 'vitest';
import { publicPreparationProgress, createPreparationProgressObserver } from '../../packages/reploid/src/mesh/preparation-progress.js';

it('reports acquisition and GPU preparation while excluding paths, keys and invalid counts', () => {
  expect(publicPreparationProgress({ stage: 'acquiring', message: 'Downloading secret-path', path: 'secret-path', receivedBytes: 5, totalBytes: 10 }))
    .toEqual({ kind: 'downloading', receivedBytes: 5, totalBytes: 10 });
  expect(publicPreparationProgress({ stage: 'acquiring', message: 'Reusing cached-path' })).toEqual({ kind: 'cached' });
  expect(publicPreparationProgress({ stage: 'preparing', prepared: 2, total: 7, key: 'private-kernel' }))
    .toEqual({ kind: 'pipelines', prepared: 2, total: 7 });
  expect(publicPreparationProgress({ kind: 'downloading', receivedBytes: 100, totalBytes: 2 })).toEqual({ kind: 'downloading' });
  expect(publicPreparationProgress(null)).toBeNull();
});


it('keeps work counters monotonic, scopes new files separately and preserves pending cleanup', () => {
  const observe = createPreparationProgressObserver();
  const initial = observe({ kind: 'receiving', path: 'private-a', receivedBytes: 60, totalBytes: 100 });
  const late = observe({ kind: 'receiving', path: 'private-a', receivedBytes: 20, totalBytes: 100 });
  expect(late.workId).toBe(initial.workId); expect(late.receivedBytes).toBe(60);
  expect(late.sequence).toBeGreaterThan(initial.sequence);
  const nextFile = observe({ kind: 'receiving', path: 'private-b', receivedBytes: 1, totalBytes: 100 });
  expect(nextFile.workId).not.toBe(initial.workId); expect(nextFile.receivedBytes).toBe(1);
  expect(JSON.stringify(publicPreparationProgress(nextFile))).not.toContain('private-');
  const stopping = publicPreparationProgress(observe({ phase: 'pipelines', status: 'cancelling', prepared: 2, total: 5, outstanding: true }));
  expect(stopping).toMatchObject({ kind: 'pipelines', status: 'cancelling', prepared: 2, total: 5, outstanding: true });
});
