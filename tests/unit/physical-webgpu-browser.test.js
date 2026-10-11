import { describe, expect, it, vi } from 'vitest';
import { physicalWebGpuBrowserOptions, requirePhysicalMeshCrypto } from '../fixtures/physical-webgpu-browser.js';

describe('physical decision browser host', () => {
  it('uses Metal on macOS without forcing Vulkan', () => {
    const options = physicalWebGpuBrowserOptions('darwin');
    expect(options.args).toContain('--use-angle=metal');
    expect(options.args.some(arg => /vulkan/i.test(arg))).toBe(false);
  });
  it('preserves the qualified Linux backend and selected browser', () => {
    const options = physicalWebGpuBrowserOptions('linux', 'chromium');
    expect(options.channel).toBe('chromium');
    expect(options.args).toContain('--use-angle=vulkan');
  });
  it('rejects unsupported hosts instead of claiming software execution', () => {
    expect(() => physicalWebGpuBrowserOptions('unknown')).toThrow('Unsupported physical test host');
  });
  it('verifies an imported public key before admitting a physical mesh browser', async () => {
    await expect(requirePhysicalMeshCrypto()).resolves.toEqual({ algorithm: 'Ed25519', verified: true });
  });
  it('rejects older browsers at preflight instead of waiting for contributors', async () => {
    const unavailable = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError'));
    try {
      await expect(requirePhysicalMeshCrypto()).rejects.toThrow('cannot verify Ed25519 identities');
    } finally { unavailable.mockRestore(); }
  });
});
