import { describe, expect, it } from 'vitest';
import { physicalWebGpuBrowserOptions } from '../fixtures/physical-webgpu-browser.js';

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
});
