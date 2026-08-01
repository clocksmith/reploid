# Blueprint 0x00016e: pool rtc config

**Objective:** Fetch, normalize, cache, and safely refresh authenticated Poolday TURN configuration.

**Target Upgrade:** pool/rtc-config.js

**Affected Artifacts:** /pool/rtc-config.js

---

### 1. Intent
Provide browser peer transports with expiring ICE configuration while preventing stale TURN credentials from being reused.

### 2. Architecture
The service calls the Pool SDK `rtcConfig()` route, validates a future expiry, normalizes the RTC shape through the transport contract, and caches it until thirty seconds before expiry. Relay-only callers receive a normalized copy with `iceTransportPolicy: relay`.

### 3. Implementation Notes
Authenticated coordinator access remains outside this module in the SDK. An absent SDK method, invalid expiry, or expired response fails closed. Tests and session teardown can clear the module cache explicitly.

### 4. Verification Checklist
- [x] Fresh configuration is cached before the refresh skew
- [x] Expired or invalid payloads fail closed
- [x] Relay forcing does not mutate the cached base configuration
- [x] Cache reset and refresh behavior have unit coverage

*Last updated: August 2026*
