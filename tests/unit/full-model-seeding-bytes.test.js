import { it, expect } from 'vitest';
import { fullModelSeedingBytes } from '../../self/host/work-model-files.js';

const model = { source: { files: [{ path: 'manifest.json', sizeBytes: 222286 }, { path: 'tokenizer.json', sizeBytes: 9088480 }] },
  capsule: { artifacts: [{ role: 'weight-shard', sizeBytes: 67108864 }, { role: 'weight-shard', sizeBytes: 1000 }, { role: 'wgsl-source', sizeBytes: 5 }] },
  adapters: [{ artifact: { sizeBytes: 300 } }] };

it('sums pinned files, signed weight shards and adapters, and nothing else', () => {
  expect(fullModelSeedingBytes(model)).toBe(222286 + 9088480 + 67108864 + 1000 + 300);
});
it('is unknown when the catalog does not declare the shards or a size is invalid', () => {
  expect(fullModelSeedingBytes({ source: model.source })).toBeNull();
  expect(fullModelSeedingBytes({ ...model, adapters: [{ artifact: { sizeBytes: -1 } }] })).toBeNull();
});
