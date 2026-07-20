import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;

describe('network canary custody', () => {
  it('pins every canary to an immutable revision, byte count, digest, and narrow role', async () => {
    const registry = JSON.parse(await fs.readFile('docs/artifact-custody/network-canaries-v1.json', 'utf8'));
    expect(registry.schema).toBe('reploid.network-canary-custody/v2');
    expect(registry.artifacts.map((artifact) => artifact.role)).toEqual([
      'base_model_network_canary',
      'external_adapter_interoperability_canary',
      'adapter_transfer_stress_canary'
    ]);
    for (const artifact of registry.artifacts) {
      expect(artifact.repository).toMatch(/^clocksmith\/(rdrr|lora)$/);
      expect(artifact.revision).toMatch(REVISION);
      expect(artifact.sha256).toMatch(SHA256);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      expect(artifact.path).not.toContain('/main/');
      expect(artifact.claimBoundary).toMatch(/only|not /i);
      expect(artifact.verification.method).toBe('streamed_https_sha256');
      expect(Number.isFinite(Date.parse(artifact.verification.verifiedAt))).toBe(true);
    }
    const adapterCanary = registry.artifacts[1];
    expect(registry.artifacts[0].repository).toBe('clocksmith/rdrr');
    expect(adapterCanary.repository).toBe('clocksmith/lora');
    expect(registry.artifacts[2].repository).toBe('clocksmith/lora');
    expect(adapterCanary.source.revision).toMatch(REVISION);
    expect(adapterCanary.runtimeManifest).toMatchObject({
      id: 'qwen35-0-8b-ner-json-lora',
      baseModel: 'qwen-3-5-0-8b-q4k-ehaf16',
      rank: 16,
      alpha: 32,
      weightsSize: adapterCanary.sizeBytes,
      checksum: adapterCanary.sha256,
      checksumAlgorithm: 'sha256'
    });
    expect(adapterCanary.runtimeManifest.targetModules).toEqual(expect.arrayContaining([
      'in_proj_a',
      'in_proj_b',
      'in_proj_qkv',
      'in_proj_z',
      'out_proj'
    ]));
    expect(adapterCanary.runtimeManifest.weightsPath).toContain(`/${adapterCanary.revision}/`);
    expect(registry.artifacts[2].claimBoundary).toContain('not selected or promoted');
  });
});
