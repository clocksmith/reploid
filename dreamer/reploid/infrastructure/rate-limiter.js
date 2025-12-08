/**
 * @fileoverview Token Bucket Rate Limiter
 */

const RateLimiter = {
  metadata: {
    id: 'RateLimiter',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
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
        this._pendingWait = null;  // Lock for concurrent access
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
        // If already waiting, chain onto existing wait to prevent race condition
        if (this._pendingWait) {
          await this._pendingWait;
          return this.waitForToken();
        }

        this._refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return true;
        }

        const needed = 1 - this.tokens;
        const waitMs = (needed / this.refillRate) * 1000;
        logger.debug(`[RateLimiter] Throttling for ${Math.ceil(waitMs)}ms`);

        // Create wait promise that concurrent calls can chain onto
        this._pendingWait = new Promise(r => setTimeout(r, waitMs));
        await this._pendingWait;
        this._pendingWait = null;

        this._refill();  // Refill after wait instead of hard reset
        if (this.tokens >= 1) {
          this.tokens -= 1;
        }
        return true;
      }
    }

    const createLimiter = (tpm = 60) => new TokenBucket(10, tpm / 60);

    return { createLimiter };
  }
};

export default RateLimiter;
