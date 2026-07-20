import { describe, expect, it } from 'vitest';

import {
  buildModelArtifactUrls,
  validateDopplerExecutionManifestShape,
  validateModelArtifactManifestShape,
  verifyModelArtifactManifest
} from '../../self/pool/model-artifacts.js';
import { hashJson, sha256Hex } from '../../self/pool/inference-receipt.js';

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

  it('builds hosted model artifact URLs from a model-specific base policy', () => {
    expect(buildModelArtifactUrls({
      modelId: 'qwen-3-5-0-8b-q4k-ehaf16',
      manifestHash: 'sha256:manifest',
      artifactPolicy: {
        baseUrl: 'https://huggingface.co/clocksmith/rdrr/resolve/pinned/models/qwen-3-5-0-8b-q4k-ehaf16',
        pathTemplate: '',
        paths: {
          manifest: 'manifest.json',
          tokenizer: 'tokenizer.json',
          shards: ''
        }
      }
    })).toEqual({
      root: 'https://huggingface.co/clocksmith/rdrr/resolve/pinned/models/qwen-3-5-0-8b-q4k-ehaf16',
      manifest: 'https://huggingface.co/clocksmith/rdrr/resolve/pinned/models/qwen-3-5-0-8b-q4k-ehaf16/manifest.json',
      tokenizer: 'https://huggingface.co/clocksmith/rdrr/resolve/pinned/models/qwen-3-5-0-8b-q4k-ehaf16/tokenizer.json',
      shards: 'https://huggingface.co/clocksmith/rdrr/resolve/pinned/models/qwen-3-5-0-8b-q4k-ehaf16/'
    });
  });

  it('lets an explicit artifact root override a model-specific base policy', () => {
    expect(buildModelArtifactUrls({
      modelId: 'qwen-3-5-0-8b-q4k-ehaf16',
      manifestHash: 'sha256:manifest',
      artifactPolicy: {
        baseUrl: 'https://huggingface.co/clocksmith/rdrr/resolve/pinned/models/qwen-3-5-0-8b-q4k-ehaf16',
        pathTemplate: '',
        paths: {
          manifest: 'manifest.json',
          tokenizer: 'tokenizer.json',
          shards: ''
        }
      }
    }, { baseUrl: 'https://models.example/qwen-root/' })).toEqual({
      root: 'https://models.example/qwen-root',
      manifest: 'https://models.example/qwen-root/manifest.json',
      tokenizer: 'https://models.example/qwen-root/tokenizer.json',
      shards: 'https://models.example/qwen-root/'
    });
  });

  it('accepts Doppler manifest shape with artifact identity and filename shards', () => {
    const result = validateModelArtifactManifestShape({
      modelId: 'qwen-3-5-0-8b-q4k-ehaf16',
      artifactIdentity: {
        weightPackHash: 'sha256:weight-pack'
      },
      tokenizer: {
        file: 'tokenizer.json'
      },
      shards: [
        {
          filename: 'shard_00000.bin',
          hash: '4dd461bea0d6cc891f78a7fe4dc744c0d269ea685b5a5a5de74c07d5422e4a3e'
        }
      ]
    }, {
      tokenizerHash: 'sha256:tokenizer'
    });

    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('requires runtime-significant Doppler execution fields to be explicit', () => {
    const valid = validateDopplerExecutionManifestShape({
      inference: {
        schema: 'doppler.execution/v1',
        ffn: { branchMode: 'auto' },
        output: { embeddingScale: null, logitInputScale: 1 },
        layerPattern: { residualBranchScale: 1 },
        rope: {
          longropeShortFactor: null,
          longropeLongFactor: null,
          longropeOriginalMaxPos: null
        }
      }
    });
    const stale = validateDopplerExecutionManifestShape({
      inference: {
        schema: 'doppler.execution/v1',
        ffn: {},
        output: {},
        layerPattern: {},
        rope: {}
      }
    });

    expect(valid).toEqual({ ok: true, reasons: [] });
    expect(stale.ok).toBe(false);
    expect(stale.reasons).toEqual(expect.arrayContaining([
      'manifest.inference.ffn.branchMode must be explicit',
      'manifest.inference.output.embeddingScale must be explicit',
      'manifest.inference.output.logitInputScale must be explicit',
      'manifest.inference.layerPattern.residualBranchScale must be explicit',
      'manifest.inference.rope.longropeShortFactor must be explicit',
      'manifest.inference.rope.longropeLongFactor must be explicit',
      'manifest.inference.rope.longropeOriginalMaxPos must be explicit'
    ]));
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

  it('verifies manifest identity through artifactIdentity weightPackHash', async () => {
    const manifest = {
      modelId: 'model-identity',
      artifactIdentity: {
        weightPackHash: 'fab133e49d6dc67912fc3a087222ec44ca1941d9b7bc36c60cb1379863a6dd4f'
      },
      shards: [{ filename: 'shard_00000.bin', hash: 'abc123' }]
    };
    const manifestHash = await hashJson(manifest);
    const result = await verifyModelArtifactManifest({
      model: {
        modelId: 'model-identity',
        modelHash: 'sha256:fab133e49d6dc67912fc3a087222ec44ca1941d9b7bc36c60cb1379863a6dd4f',
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
  });

  it('verifies manifest identity through derived shard-set hash', async () => {
    const manifest = {
      modelId: 'model-shardset',
      tokenizer: {
        file: 'tokenizer.json',
        hash: 'sha256:tokenizer'
      },
      shards: [
        {
          filename: 'shard_00000.bin',
          size: 3,
          hash: 'abc123'
        }
      ]
    };
    const manifestHash = await hashJson(manifest);
    const shardSetHash = await sha256Hex('shard_00000.bin:3:abc123');
    const result = await verifyModelArtifactManifest({
      model: {
        modelId: 'model-shardset',
        modelHash: shardSetHash,
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

  it('attaches manifest URL and status to fetch failures', async () => {
    await expect(verifyModelArtifactManifest({
      model: {
        modelId: 'model-d',
        modelHash: 'sha256:model-d',
        manifestHash: 'sha256:missing'
      },
      baseUrl: 'https://models.example',
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      })
    })).rejects.toMatchObject({
      message: 'model manifest fetch failed: 404 Not Found',
      status: 404,
      urls: {
        manifest: 'https://models.example/model-d/sha256%3Amissing/manifest.json'
      },
      retryable: false
    });
  });

  it('attaches manifest URL when fetch rejects before a response', async () => {
    await expect(verifyModelArtifactManifest({
      model: {
        modelId: 'model-e',
        modelHash: 'sha256:model-e',
        manifestHash: 'sha256:missing'
      },
      baseUrl: 'https://models.example',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      }
    })).rejects.toMatchObject({
      message: 'model manifest fetch failed: Failed to fetch',
      urls: {
        manifest: 'https://models.example/model-e/sha256%3Amissing/manifest.json'
      },
      retryable: true
    });
  });
});
