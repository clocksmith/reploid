import { describe, expect, it } from 'vitest';

import {
  buildModelArtifactUrls,
  verifyModelArtifactManifest
} from '../../self/pool/model-artifacts.js';
import { hashJson } from '../../self/pool/inference-receipt.js';

describe('pool model artifact helpers', () => {
  it('builds content-addressed artifact URLs from model identity', () => {
    expect(buildModelArtifactUrls({
      modelId: 'model-a',
      manifestHash: 'sha256:manifest'
    }, { baseUrl: 'https://models.example/root/' })).toEqual({
      root: 'https://models.example/root/model-a/sha256%3Amanifest',
      manifest: 'https://models.example/root/model-a/sha256%3Amanifest/manifest.json',
      tokenizer: 'https://models.example/root/model-a/sha256%3Amanifest/tokenizer.json',
      shards: 'https://models.example/root/model-a/sha256%3Amanifest/shards/'
    });
  });

  it('verifies manifest JSON hash and model identity', async () => {
    const manifest = {
      modelId: 'model-b',
      modelHash: 'sha256:model-b',
      shards: ['shard-0.bin']
    };
    const manifestHash = await hashJson(manifest);
    const result = await verifyModelArtifactManifest({
      model: {
        modelId: 'model-b',
        modelHash: 'sha256:model-b',
        manifestHash
      },
      baseUrl: 'https://models.example',
      fetchImpl: async () => ({
        ok: true,
        text: async () => JSON.stringify(manifest)
      })
    });

    expect(result.ok).toBe(true);
    expect(result.manifestHash).toBe(manifestHash);
    expect(result.urls.manifest).toContain('/model-b/');
  });

  it('rejects mismatched manifest identity', async () => {
    const manifest = {
      modelId: 'wrong-model',
      modelHash: 'sha256:model-c'
    };
    await expect(verifyModelArtifactManifest({
      model: {
        modelId: 'model-c',
        modelHash: 'sha256:model-c',
        manifestHash: await hashJson(manifest)
      },
      baseUrl: 'https://models.example',
      fetchImpl: async () => ({
        ok: true,
        text: async () => JSON.stringify(manifest)
      })
    })).rejects.toThrow('model manifest modelId mismatch');
  });
});
