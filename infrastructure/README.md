# Infrastructure Directory

**Purpose**: Support services for the REPLOID system.

## Contents

| File | Purpose |
|------|---------|
| `event-bus.js` | Pub/sub event system for module communication |
| `di-container.js` | Dependency injection container |
| `browser-apis.js` | Browser Web API integration |
| `rate-limiter.js` | API rate limiting |
| `audit-logger.js` | Security audit logging |

---

## Integration

Infrastructure modules are the first to be loaded by `boot.js` (Level 1: Foundation).
