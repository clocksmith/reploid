import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;

describe('network canary custody', () => {
  it('pins every canary to an immutable revision, byte count, digest, and narrow claim boundary', async () => {
    const registry = JSON.parse(await fs.readFile('docs/artifact-custody/network-canaries-v1.json', 'utf8'));
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
    const adapterCanary = registry.artifacts.find((artifact) => artifact.runtimeManifest);
    expect(adapterCanary).toBeDefined();
    expect(adapterCanary.source.revision).toMatch(REVISION);
    expect(adapterCanary.runtimeManifest).toMatchObject({
      weightsSize: adapterCanary.sizeBytes,
      checksum: adapterCanary.sha256,
      checksumAlgorithm: 'sha256'
    });
    expect(adapterCanary.runtimeManifest.weightsPath).toContain(`/${adapterCanary.revision}/`);
  });
});
