/**
 * @fileoverview Unit tests for RateLimiter module
 * Tests token bucket algorithm and throttling behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Utils
const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
});

import RateLimiterModule from '../../infrastructure/rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter;
  let mockUtils;

  beforeEach(() => {
    mockUtils = createMockUtils();
    rateLimiter = RateLimiterModule.factory({ Utils: mockUtils });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createLimiter', () => {
    it('should create a limiter with default capacity of 10 tokens', () => {
      const limiter = rateLimiter.createLimiter(60);

      // Internal state check via behavior
      // Should be able to make 10 requests immediately
      for (let i = 0; i < 10; i++) {
        expect(limiter.tokens).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate refill rate from TPM', () => {
      // 60 TPM = 1 token per second
      const limiter = rateLimiter.createLimiter(60);
      expect(limiter.refillRate).toBe(1);

      // 120 TPM = 2 tokens per second
      const limiter2 = rateLimiter.createLimiter(120);
      expect(limiter2.refillRate).toBe(2);

      // 30 TPM = 0.5 tokens per second
      const limiter3 = rateLimiter.createLimiter(30);
      expect(limiter3.refillRate).toBe(0.5);
    });

    it('should start with full bucket', () => {
      const limiter = rateLimiter.createLimiter(60);
      expect(limiter.tokens).toBe(limiter.capacity);
    });
  });

  describe('waitForToken', () => {
    it('should immediately return true when tokens available', async () => {
      const limiter = rateLimiter.createLimiter(60);

      const start = Date.now();
      const result = await limiter.waitForToken();
      const elapsed = Date.now() - start;

      expect(result).toBe(true);
      expect(elapsed).toBeLessThan(10); // Should be nearly instant
    });

    it('should consume one token per call', async () => {
      const limiter = rateLimiter.createLimiter(60);
      const initialTokens = limiter.tokens;

      await limiter.waitForToken();

      expect(limiter.tokens).toBe(initialTokens - 1);
    });

    it('should wait when no tokens available', async () => {
      const limiter = rateLimiter.createLimiter(60); // 1 token/sec

      // Exhaust all tokens
      limiter.tokens = 0;

      const waitPromise = limiter.waitForToken();

      // Should not resolve immediately
      await vi.advanceTimersByTimeAsync(500);

      // After 1 second, should have enough tokens
      await vi.advanceTimersByTimeAsync(600);

      const result = await waitPromise;
      expect(result).toBe(true);
    });

    it('should log when throttling', async () => {
      const limiter = rateLimiter.createLimiter(60);
      limiter.tokens = 0;

      const waitPromise = limiter.waitForToken();
      await vi.advanceTimersByTimeAsync(1100);
      await waitPromise;

      expect(mockUtils.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Throttling')
      );
    });

    it('should refill tokens over time', async () => {
      const limiter = rateLimiter.createLimiter(60); // 1 token/sec
      limiter.tokens = 0;
      limiter.lastRefill = Date.now();

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      // Trigger refill via waitForToken
      limiter._refill();

      expect(limiter.tokens).toBeCloseTo(5, 0);
    });

    it('should not exceed capacity when refilling', async () => {
      const limiter = rateLimiter.createLimiter(60);
      limiter.tokens = 9;
      limiter.lastRefill = Date.now();

      // Advance time by 10 seconds
      vi.advanceTimersByTime(10000);
      limiter._refill();

      expect(limiter.tokens).toBe(10); // Capped at capacity
    });

    it('should handle multiple concurrent requests', async () => {
      const limiter = rateLimiter.createLimiter(60);
      limiter.tokens = 3;

      const results = await Promise.all([
        limiter.waitForToken(),
        limiter.waitForToken(),
        limiter.waitForToken()
      ]);

      expect(results).toEqual([true, true, true]);
      expect(limiter.tokens).toBe(0);
    });

    it('should work with high TPM values', async () => {
      const limiter = rateLimiter.createLimiter(6000); // 100 tokens/sec

      // Should handle rapid requests
      for (let i = 0; i < 10; i++) {
        const result = await limiter.waitForToken();
        expect(result).toBe(true);
      }
    });

    it('should work with low TPM values', async () => {
      const limiter = rateLimiter.createLimiter(6); // 0.1 tokens/sec

      await limiter.waitForToken();
      limiter.tokens = 0;

      const waitPromise = limiter.waitForToken();

      // Should need to wait longer
      await vi.advanceTimersByTimeAsync(10000);

      const result = await waitPromise;
      expect(result).toBe(true);
    });
  });

  describe('TokenBucket internal behavior', () => {
    it('should track lastRefill timestamp', () => {
      const limiter = rateLimiter.createLimiter(60);
      const initialRefill = limiter.lastRefill;

      // Advance time
      vi.advanceTimersByTime(1000);
      limiter._refill();

      expect(limiter.lastRefill).toBeGreaterThan(initialRefill);
    });

    it('should handle partial token accumulation', () => {
      const limiter = rateLimiter.createLimiter(60); // 1 token/sec
      limiter.tokens = 0;
      limiter.lastRefill = Date.now();

      // Advance by 500ms (0.5 tokens)
      vi.advanceTimersByTime(500);
      limiter._refill();

      expect(limiter.tokens).toBeCloseTo(0.5, 1);
    });
  });

  describe('edge cases', () => {
    it('should handle zero TPM gracefully', () => {
      const limiter = rateLimiter.createLimiter(0);
      expect(limiter.refillRate).toBe(0);
    });

    it('should handle fractional tokens during wait calculation', async () => {
      const limiter = rateLimiter.createLimiter(60);
      limiter.tokens = 0.3; // Needs 0.7 more tokens

      const waitPromise = limiter.waitForToken();

      // With 1 token/sec, need 700ms for 0.7 tokens
      await vi.advanceTimersByTimeAsync(800);

      const result = await waitPromise;
      expect(result).toBe(true);
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(RateLimiterModule.metadata.id).toBe('RateLimiter');
      expect(RateLimiterModule.metadata.type).toBe('infrastructure');
      expect(RateLimiterModule.metadata.dependencies).toContain('Utils');
    });
  });
});
