import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zeroGeminiPolicy } from '../../functions/index.js';

describe('Zero Gemini admission policy', () => {
  const originalAllowedModels = process.env.ZERO_GEMINI_ALLOWED_MODELS;
  const originalMaximumBuckets = process.env.ZERO_GEMINI_MAX_RATE_BUCKETS;

  beforeEach(() => {
    zeroGeminiPolicy.rateBuckets.clear();
    delete process.env.ZERO_GEMINI_ALLOWED_MODELS;
    delete process.env.ZERO_GEMINI_MAX_RATE_BUCKETS;
  });

  afterEach(() => {
    zeroGeminiPolicy.rateBuckets.clear();
    if (originalAllowedModels === undefined) delete process.env.ZERO_GEMINI_ALLOWED_MODELS;
    else process.env.ZERO_GEMINI_ALLOWED_MODELS = originalAllowedModels;
    if (originalMaximumBuckets === undefined) delete process.env.ZERO_GEMINI_MAX_RATE_BUCKETS;
    else process.env.ZERO_GEMINI_MAX_RATE_BUCKETS = originalMaximumBuckets;
  });

  it('treats Origin as a browser policy, not as the access credential', () => {
    expect(zeroGeminiPolicy.isAllowedOrigin('')).toBe(true);
    expect(zeroGeminiPolicy.isAllowedOrigin('https://reploid.web.app')).toBe(true);
    expect(zeroGeminiPolicy.isAllowedOrigin('https://attacker.example')).toBe(false);
  });

  it('pins Zero to its configured model allowlist', () => {
    process.env.ZERO_GEMINI_ALLOWED_MODELS = 'gemini-3.1-flash-lite';
    const allowed = zeroGeminiPolicy.getAllowedModels();
    expect(allowed.has('gemini-3.1-flash-lite')).toBe(true);
    expect(allowed.has('gemini-3.1-pro')).toBe(false);
  });

  it('removes expired rate buckets and bounds active identities', () => {
    const now = Date.now();
    process.env.ZERO_GEMINI_MAX_RATE_BUCKETS = '2';
    zeroGeminiPolicy.rateBuckets.set('expired', [now - 61000]);
    zeroGeminiPolicy.rateBuckets.set('one', [now]);
    zeroGeminiPolicy.rateBuckets.set('two', [now]);
    zeroGeminiPolicy.rateBuckets.set('three', [now]);

    zeroGeminiPolicy.pruneRateBuckets(now);

    expect(zeroGeminiPolicy.rateBuckets.has('expired')).toBe(false);
    expect(zeroGeminiPolicy.rateBuckets.size).toBeLessThanOrEqual(2);
  });
});
