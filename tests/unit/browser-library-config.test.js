import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

describe('browser library configuration import and credential boundaries', () => {
  it('loads the public configuration implementation and resolves its default profile', () => {
    expect(resolveConfig().value.schema).toBe('reploid.config/v1');
  });
  it('rejects credentials in model metadata and signaling URLs', () => {
    expect(() => resolveConfig({ overrides: { models: { contract: { apiKey: 'test-value' } } } }))
      .toThrow('credentials belong in host ports');
    for (const signalingUrl of ['wss://user:password@example.invalid', 'wss://example.invalid?token=test-value']) {
      expect(() => resolveConfig({ overrides: { webrtc: { signalingUrl } } })).toThrow('credential-free');
    }
    expect(resolveConfig({ overrides: { webrtc: { signalingUrl: 'wss://example.invalid/room' } } })
      .value.webrtc.signalingUrl).toBe('wss://example.invalid/room');
  });
});
