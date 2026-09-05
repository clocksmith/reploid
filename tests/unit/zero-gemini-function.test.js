import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GEMINI_MODEL, zeroGeminiPolicy } from '../../functions/zero-gemini-policy.js';
import { ZERO_GEMINI_MODEL } from '../../self/config/zero-inference.js';

describe('Zero Gemini admission policy', () => {
  const originalAllowedModels = process.env.ZERO_GEMINI_ALLOWED_MODELS;
  const originalMaximumBuckets = process.env.ZERO_GEMINI_MAX_RATE_BUCKETS;
  const originalModel = process.env.GEMINI_MODEL;

  beforeEach(() => {
    zeroGeminiPolicy.rateBuckets.clear();
    delete process.env.ZERO_GEMINI_ALLOWED_MODELS;
    delete process.env.ZERO_GEMINI_MAX_RATE_BUCKETS;
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    zeroGeminiPolicy.rateBuckets.clear();
    if (originalAllowedModels === undefined) delete process.env.ZERO_GEMINI_ALLOWED_MODELS;
    else process.env.ZERO_GEMINI_ALLOWED_MODELS = originalAllowedModels;
    if (originalMaximumBuckets === undefined) delete process.env.ZERO_GEMINI_MAX_RATE_BUCKETS;
    else process.env.ZERO_GEMINI_MAX_RATE_BUCKETS = originalMaximumBuckets;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
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

  it('keeps the browser default and hosted default allowlist on Gemini 3.8 Flash', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(ZERO_GEMINI_MODEL).toBe(DEFAULT_GEMINI_MODEL);
    expect([...zeroGeminiPolicy.getAllowedModels()]).toEqual([DEFAULT_GEMINI_MODEL]);
    process.env.GEMINI_MODEL = 'custom-deployment-model';
    expect([...zeroGeminiPolicy.getAllowedModels()]).toEqual(['custom-deployment-model']);
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
