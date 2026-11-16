import { describe, it, expect } from 'vitest';
import schema from '../../packages/reploid/src/config/schema.json' with { type: 'json' };
import { validateSchema } from '../../packages/reploid/src/config/validate-schema.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

describe('browser library configuration import and credential boundaries', () => {
  it('loads the public configuration implementation and resolves its default profile', () => {
    expect(resolveConfig().value.schema).toBe('reploid.config/v1');
  });
  it('executes the published structural schema and rejects unsupported new constraints', () => {
    const value = structuredClone(resolveConfig().value);
    const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
    value.webrtc.rtcConfig.iceTransportPolicy = 42;
    expect(() => validateSchema(value, schema, fail)).toThrow('webrtc.rtcConfig.iceTransportPolicy: expected string');
    expect(() => validateSchema({}, { type: 'object', minProperties: 1 }, fail))
      .toThrow('Unsupported configuration schema keyword: minProperties');
    expect(() => validateSchema({ count: 0 }, { type: 'object', required: ['count'],
      properties: { count: { type: 'integer', minimum: 1 } } }, fail)).toThrow('minimum is 1');
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
