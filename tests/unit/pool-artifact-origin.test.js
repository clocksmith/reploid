import { describe, expect, it, vi } from 'vitest';

import {
  artifactOriginIdentity,
  buildImmutableArtifactOriginUrl,
  resolveArtifactDelivery,
  validateArtifactOrigin
} from '../../self/pool/artifact-origin.js';
import { createGcsAdapterOriginSigner } from '../../server/pool/adapter-origin-signer.js';

describe('immutable Poolday artifact origins', () => {
  it('builds commit-pinned Hugging Face and generation-pinned GCS identities', () => {
    const huggingFace = {
      provider: 'huggingface',
      repoId: 'Clocksmith/lora-qwen',
      revision: 'a'.repeat(40),
      path: 'adapters/unit/adapter_model.safetensors'
    };
    const gcs = {
      provider: 'gcs',
      bucket: 'clocksmith-adapters-private',
      object: 'v1/adapters/qwen/unit/adapter_model.safetensors',
      generation: '1720000000000000'
    };
    expect(validateArtifactOrigin(huggingFace)).toMatchObject({ ok: true });
    expect(validateArtifactOrigin(gcs)).toMatchObject({ ok: true });
    expect(buildImmutableArtifactOriginUrl(huggingFace)).toContain(`/resolve/${'a'.repeat(40)}/`);
    expect(buildImmutableArtifactOriginUrl(gcs)).toContain('generation=1720000000000000');
    expect(validateArtifactOrigin({ ...gcs, generation: 'latest' })).toMatchObject({ ok: false });
    expect(validateArtifactOrigin({ ...gcs, object: 'adapter.bin?generation=latest' }))
      .toMatchObject({ ok: false });
    expect(validateArtifactOrigin({ ...huggingFace, path: 'adapter.bin#mutable' }))
      .toMatchObject({ ok: false });
  });

  it('resolves private GCS delivery without changing or embedding its signed URL in identity', async () => {
    const origin = {
      provider: 'gcs',
      bucket: 'clocksmith-adapters-private',
      object: 'v1/adapters/qwen/unit/adapter_model.safetensors',
      generation: '1720000000000000'
    };
    const delivery = await resolveArtifactDelivery(origin, {
      visibility: 'private',
      resolvePrivateOrigin: vi.fn().mockResolvedValue({
        url: 'https://storage.googleapis.com/private/signed?X-Goog-Signature=secret'
      })
    });
    expect(delivery.identity).toEqual(artifactOriginIdentity(origin));
    expect(delivery.privateDelivery).toBe(true);
    expect(delivery.identity).not.toHaveProperty('url');
  });

  it('signs the exact GCS object generation with a bounded V4 URL', async () => {
    const getSignedUrl = vi.fn().mockResolvedValue([
      'https://storage.googleapis.com/private/signed?X-Goog-Signature=secret'
    ]);
    const file = vi.fn().mockReturnValue({ getSignedUrl });
    const bucket = vi.fn().mockReturnValue({ file });
    const signer = createGcsAdapterOriginSigner({
      storage: { bucket },
      expiresMs: 300000,
      now: () => 1720000000000
    });
    const origin = {
      provider: 'gcs',
      bucket: 'clocksmith-adapters-private',
      object: 'v1/adapters/qwen/unit/adapter_model.safetensors',
      generation: '1720000000000000'
    };
    const result = await signer({ origin });
    expect(bucket).toHaveBeenCalledWith(origin.bucket);
    expect(file).toHaveBeenCalledWith(origin.object, { generation: origin.generation });
    expect(getSignedUrl).toHaveBeenCalledWith({
      version: 'v4',
      action: 'read',
      expires: 1720000300000
    });
    expect(result.origin).toEqual(origin);
  });
});
