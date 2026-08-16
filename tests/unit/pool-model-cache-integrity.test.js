import { describe, expect, it, vi } from 'vitest';

import {
  MODEL_CACHE_INTEGRITY_SCHEMA,
  verifyDopplerPersistentModelCache
} from '../../self/pool/model-cache-integrity.js';
import { sha256Hex } from '../../self/pool/inference-receipt.js';

const bytes = (value) => new TextEncoder().encode(value);

const buildFixture = async ({ corruptShard = false, deleteResult = true } = {}) => {
  const shard = bytes('frozen-shard');
  const tokenizer = bytes('{"tokens":["A","C"]}');
  const shardHash = await sha256Hex(shard);
  const tokenizerHash = await sha256Hex(tokenizer);
  const manifest = {
    modelId: 'protein-model',
    modelHash: 'sha256:model-contract',
    hashAlgorithm: 'sha256',
    tokenizer: { file: 'tokenizer.json' },
    shards: [{
      filename: 'shard_00000.bin',
      size: shard.byteLength,
      hash: shardHash
    }]
  };
  const manifestText = JSON.stringify(manifest);
  const model = {
    modelId: manifest.modelId,
    modelHash: manifest.modelHash,
    manifestHash: await sha256Hex(manifestText),
    tokenizerHash
  };
  const storedShard = corruptShard ? bytes('frozen-sharc') : shard;
  const files = new Map([
    ['shard_00000.bin', storedShard.buffer],
    ['tokenizer.json', tokenizer.buffer]
  ]);
  const storage = {
    listModels: vi.fn(async () => [model.modelId]),
    openModelStore: vi.fn(async () => null),
    loadManifestFromStore: vi.fn(async () => manifestText),
    loadFileFromStore: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error('not found');
      return files.get(path);
    }),
    computeHash: vi.fn(async (payload, algorithm) => {
      expect(algorithm).toBe('sha256');
      return (await sha256Hex(payload)).replace(/^sha256:/, '');
    }),
    deleteModel: vi.fn(async () => deleteResult)
  };
  return { model, storage };
};

describe('Poolday persistent model cache integrity', () => {
  it('hashes every stored shard and tokenizer before accepting an OPFS hit', async () => {
    const { model, storage } = await buildFixture();

    await expect(verifyDopplerPersistentModelCache({
      model,
      storage,
      checkedAt: '2026-08-15T00:00:00.000Z'
    })).resolves.toMatchObject({
      schema: MODEL_CACHE_INTEGRITY_SCHEMA,
      checkedAt: '2026-08-15T00:00:00.000Z',
      modelId: model.modelId,
      status: 'verified',
      valid: true,
      invalidated: false,
      files: [
        { kind: 'shard', path: 'shard_00000.bin', valid: true },
        { kind: 'tokenizer', path: 'tokenizer.json', valid: true }
      ],
      reasons: []
    });
    expect(storage.deleteModel).not.toHaveBeenCalled();
  });

  it('invalidates a same-size corrupt shard instead of trusting cache presence', async () => {
    const { model, storage } = await buildFixture({ corruptShard: true });

    await expect(verifyDopplerPersistentModelCache({ model, storage })).resolves.toMatchObject({
      status: 'invalidated',
      valid: false,
      invalidated: true,
      files: [
        { kind: 'shard', path: 'shard_00000.bin', valid: false },
        { kind: 'tokenizer', path: 'tokenizer.json', valid: true }
      ],
      reasons: ['shard_00000.bin: stored hash does not match the manifest']
    });
    expect(storage.deleteModel).toHaveBeenCalledWith(model.modelId);
  });

  it('fails closed when a corrupt cache cannot be deleted', async () => {
    const { model, storage } = await buildFixture({ corruptShard: true, deleteResult: false });

    await expect(verifyDopplerPersistentModelCache({ model, storage }))
      .rejects.toThrow(`Corrupt persistent model cache could not be invalidated for "${model.modelId}".`);
  });

  it('does not create or open a store when the exact model is not cached', async () => {
    const { model, storage } = await buildFixture();
    storage.listModels.mockResolvedValue([]);

    await expect(verifyDopplerPersistentModelCache({ model, storage })).resolves.toMatchObject({
      status: 'not_cached',
      valid: null,
      invalidated: false,
      files: []
    });
    expect(storage.openModelStore).not.toHaveBeenCalled();
  });
});
