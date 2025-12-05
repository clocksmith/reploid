/**
 * @fileoverview Token Bucket Rate Limiter
 */

const RateLimiter = {
  metadata: {
    id: 'RateLimiter',
    version: '1.0.0',
    dependencies: ['Utils'],
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;

    class TokenBucket {
      constructor(capacity, refillRate) {
        this.capacity = capacity;
        this.tokens = capacity;
        this.refillRate = refillRate; // tokens per second
        this.lastRefill = Date.now();
      }

      _refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        if (elapsed > 0) {
          const added = elapsed * this.refillRate;
          this.tokens = Math.min(this.capacity, this.tokens + added);
          this.lastRefill = now;
        }
      }

      async waitForToken() {
        this._refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return true;
        }

        const needed = 1 - this.tokens;
        const waitMs = (needed / this.refillRate) * 1000;
        logger.debug(`[RateLimiter] Throttling for ${Math.ceil(waitMs)}ms`);
        await new Promise(r => setTimeout(r, waitMs));

        this.tokens = 0;
        this.lastRefill = Date.now();
        return true;
      }
    }

    const createLimiter = (tpm = 60) => new TokenBucket(10, tpm / 60);

    return { createLimiter };
  }
};

export default RateLimiter;
