# Blueprint 0x000029: Rate Limiting Strategies

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/infrastructure/rate-limiter.js`, `/tests/unit/rate-limiter.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `infrastructure/rate-limiter.js`

**Former Blueprint Paths:** `self/blueprints/0x000029-rate-limiting-strategies.md`
**Objective:** Throttle outgoing model requests from one page with a token bucket, so a looping agent cannot exceed a configured requests-per-minute rate.

**Prerequisites:** [0x000003](0x000003-core-utilities-and-error-handling.md) (Utils)

**Affected Artifacts:** `self/infrastructure/rate-limiter.js`, `self/core/llm-client.js` ([0x000007](0x000007-api-client-and-communication.md))

---

### 1. Module

`RateLimiter` (`self/infrastructure/rate-limiter.js`), `genesis: { introduced: 'reflection' }`, dependency `Utils`. `factory` returns one function:

```javascript
createLimiter(tpm = 60) // => new TokenBucket(10, tpm / 60)
```

The bucket holds at most 10 tokens and refills at `tpm / 60` tokens per second. There is no sliding-window limiter, no per-provider registry, no reset control and no persistence.

### 2. `waitForToken()`

1. If another caller is already waiting, wait for that wait to finish and try again, so concurrent callers queue behind one timer.
2. Refill by elapsed time, capped at capacity. If at least one token is available, take it and return `true`.
3. Otherwise wait `(1 - tokens) / refillRate` seconds, refill, take a token if one is available, and return `true`.

It always resolves `true`; it delays, it never rejects. Because step 3 returns even if rounding left less than one token, the rate is approximate, not a hard cap. A `tpm` of 0 gives a refill rate of 0, so the computed wait is not finite; do not configure it.

### 3. Use

`LLMClient` creates one limiter, `RateLimiter.createLimiter(60)`, when `RateLimiter` is registered, and awaits `waitForToken()` before every `chat` call. Without the module it uses a no-op limiter. Below the `reflection` genesis level requests are therefore not throttled.

The limiter is in-memory and per page: tabs, workers and peers do not share it, and it does not replace provider-side limits. The product's server-side limits (`tests/unit/pool-memory-rate-limit.test.js`, `tests/unit/pool-firestore-rate-limit.test.js`) are separate code.

### 4. Verification

`tests/unit/rate-limiter.test.js` covers capacity, refill rate, token consumption, waiting, capacity cap, concurrent callers, fractional tokens and construction with zero TPM.
