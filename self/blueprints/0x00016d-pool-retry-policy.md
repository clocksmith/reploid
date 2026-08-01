# Blueprint 0x00016d: pool retry policy

**Objective:** Keep Poolday browser transport retries bounded while respecting coordinator retry guidance.

**Target Upgrade:** pool/retry-policy.js

**Affected Artifacts:** /pool/retry-policy.js

---

### 1. Intent
Normalize retry delay hints from errors and calculate bounded exponential backoff for consecutive transport failures.

### 2. Architecture
The pure helper converts milliseconds or seconds into a non-negative delay, clamps every value to the caller's maximum, and chooses the greater of exponential backoff and server guidance. A zero-failure state returns no delay unless the server asks for one.

### 3. Implementation Notes
Invalid, negative, or non-finite inputs become zero. Base and maximum delays remain at least one millisecond. The policy owns delay calculation only; callers own attempt limits, cancellation, and parked/resumable state.

### 4. Verification Checklist
- [x] Explicit retry hints are bounded
- [x] Consecutive failures use bounded exponential backoff
- [x] Invalid numeric inputs fail to safe finite values
- [x] Unit tests cover delay precedence and bounds

*Last updated: August 2026*
