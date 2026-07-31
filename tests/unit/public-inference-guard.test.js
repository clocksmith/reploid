import { describe, expect, it } from 'vitest';
import {
  createPublicInferenceConfig,
  createPublicInferenceGuard
} from '../../server/public-inference-guard.js';

const createConfig = (overrides = {}) => createPublicInferenceConfig({
  REPLOID_PUBLIC_INFERENCE_ENABLED: 'true',
  REPLOID_PUBLIC_INFERENCE_MODEL_POLICIES: JSON.stringify({
    gemini: {
      'gemini-safe': {
        maxInputTokens: 100,
        maxOutputTokens: 20,
        maxEstimatedCostUsd: 0.01,
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 2,
        maxDailyCostUsd: 0.02
      }
    }
  }),
  REPLOID_PUBLIC_INFERENCE_MAX_INPUT_CHARS: '400',
  REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_MINUTE: '2',
  REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_DAY: '3',
  REPLOID_PUBLIC_INFERENCE_MAX_CONCURRENT_REQUESTS: '1',
  ...overrides
});

const request = (overrides = {}) => ({
  ip: '203.0.113.7',
  body: {
    provider: 'gemini',
    model: 'gemini-safe',
    messages: [{ role: 'user', content: 'hello' }],
    max_tokens: 10
  },
  ...overrides
});

describe('anonymous public inference admission', () => {
  it('fails closed until anonymous inference is explicitly enabled', () => {
    const guard = createPublicInferenceGuard({
      config: createPublicInferenceConfig({})
    });

    expect(guard.admit(request())).toMatchObject({
      ok: false,
      status: 503
    });
  });

  it('rejects providers and models absent from the explicit allowlist', () => {
    const guard = createPublicInferenceGuard({ config: createConfig() });

    expect(guard.admit(request({
      body: { ...request().body, model: 'unbounded-model' }
    }))).toMatchObject({
      ok: false,
      status: 403
    });
  });

  it('enforces input and output token budgets before reserving a provider call', () => {
    const guard = createPublicInferenceGuard({ config: createConfig() });

    expect(guard.admit(request({
      body: { ...request().body, messages: [{ role: 'user', content: 'x'.repeat(401) }] }
    }))).toMatchObject({ ok: false, status: 413, error: 'Input is too large' });
    expect(guard.admit(request({
      body: { ...request().body, max_tokens: 21 }
    }))).toMatchObject({ ok: false, status: 413, error: 'Output token budget exceeded' });
  });

  it('uses the server-observed client address and bounds concurrent, minute, and daily use', () => {
    let now = 1_000;
    const guard = createPublicInferenceGuard({
      config: createConfig(),
      now: () => now
    });
    const first = guard.admit(request({
      body: { ...request().body, max_tokens: 1 },
      headers: { 'x-reploid-client-id': 'attacker-controlled' }
    }));
    expect(first.ok).toBe(true);
    expect(first.clientKey).toBe('203.0.113.7');
    expect(guard.admit(request({
      body: { ...request().body, max_tokens: 1 },
      headers: { 'x-reploid-client-id': 'rotated-id' }
    }))).toMatchObject({
      ok: false,
      status: 429,
      error: 'Per-client concurrent request quota exceeded'
    });
    first.release();
    const second = guard.admit(request({ body: { ...request().body, max_tokens: 1 } }));
    expect(second.ok).toBe(true);
    second.release();
    expect(guard.admit(request({ body: { ...request().body, max_tokens: 1 } }))).toMatchObject({
      ok: false,
      status: 429,
      error: 'Per-client request rate exceeded'
    });

    now += 60_000;
    const afterMinute = guard.admit(request({ body: { ...request().body, max_tokens: 1 } }));
    expect(afterMinute.ok).toBe(true);
    afterMinute.release();
    now += 60_000;
    expect(guard.admit(request({ body: { ...request().body, max_tokens: 1 } }))).toMatchObject({
      ok: false,
      status: 429,
      error: 'Per-client daily request quota exceeded'
    });
  });

  it('reserves a per-client daily cost budget from the requested maximum output', () => {
    const guard = createPublicInferenceGuard({
      config: createConfig({
        REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_MINUTE: '20',
        REPLOID_PUBLIC_INFERENCE_REQUESTS_PER_DAY: '20',
        REPLOID_PUBLIC_INFERENCE_MAX_CONCURRENT_REQUESTS: '20',
        REPLOID_PUBLIC_INFERENCE_MODEL_POLICIES: JSON.stringify({
          gemini: {
            'gemini-safe': {
              maxInputTokens: 100,
              maxOutputTokens: 20,
              maxEstimatedCostUsd: 0.01,
              inputUsdPerMillionTokens: 1,
              outputUsdPerMillionTokens: 2,
              maxDailyCostUsd: 0.00005
            }
          }
        })
      })
    });
    const expensive = request({ body: { ...request().body, max_tokens: 20 } });
    const first = guard.admit(expensive);
    expect(first.ok).toBe(true);
    first.release();
    expect(guard.admit(expensive)).toMatchObject({
      ok: false,
      status: 429,
      error: 'Per-client daily cost cap exceeded'
    });
  });
});
