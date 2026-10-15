import { expect, it } from 'vitest';
import { publicPreparationProgress } from '../../packages/reploid/src/mesh/preparation-progress.js';

it('reports acquisition and GPU preparation while excluding paths, keys and invalid counts', () => {
  expect(publicPreparationProgress({ stage: 'acquiring', message: 'Downloading secret-path', path: 'secret-path', receivedBytes: 5, totalBytes: 10 }))
    .toEqual({ kind: 'downloading', receivedBytes: 5, totalBytes: 10 });
  expect(publicPreparationProgress({ stage: 'acquiring', message: 'Reusing cached-path' })).toEqual({ kind: 'cached' });
  expect(publicPreparationProgress({ stage: 'preparing', prepared: 2, total: 7, key: 'private-kernel' }))
    .toEqual({ kind: 'pipelines', prepared: 2, total: 7 });
  expect(publicPreparationProgress({ kind: 'downloading', receivedBytes: 100, totalBytes: 2 })).toEqual({ kind: 'downloading' });
  expect(publicPreparationProgress(null)).toBeNull();
});
