# Infrastructure Directory

**Purpose**: Support services for the REPLOID system including rate limiting, security, and browser APIs.

## Contents

| File | Purpose |
|------|---------|
| `event-bus.js` | Pub/sub event system for module communication |
| `di-container.js` | Dependency injection container |
| `worker-pool.js` | Web Worker pool management |
| `backup-restore.js` | VFS backup and restore utilities |
| `browser-apis.js` | Browser Web API integration |
| `rate-limiter.js` | API rate limiting (token bucket, sliding window) |
| `audit-logger.js` | Security audit logging |
| `module-integrity.js` | Module signing and verification |

---

## Service Groups

### Communication
- `event-bus.js` - Decoupled module communication

### Architecture
- `di-container.js` - Dependency management
- `worker-pool.js` - Parallel execution

### Persistence
- `backup-restore.js` - Data safety

### Integration
- `browser-apis.js` - File System, Notifications, Storage APIs

### Security
- `rate-limiter.js` - API protection
- `audit-logger.js` - Activity logging
- `module-integrity.js` - Code verification

---

## See Also

- **[Core Modules](../core/README.md)** - VFS and state management
- **[Capabilities](../capabilities/README.md)** - Advanced features
