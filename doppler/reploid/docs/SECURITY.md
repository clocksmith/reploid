# REPLOID Security Model

> Security architecture for safe recursive self-improvement research.

This document provides a high-level overview of REPLOID's security model. For detailed implementation specifications, see the referenced blueprints.

---

## Overview

REPLOID studies RSI (recursive self-improvement) without giving agents access to the host operating system. All execution happens in a browser sandbox with multiple containment layers.

---

## 8-Layer Safety Stack

| Layer | Blueprint | Description |
|-------|-----------|-------------|
| 1 | [VFS (0x000011)](../blueprints/0x000011-advanced-storage-backend-indexeddb.md) | All I/O virtualized via IndexedDB |
| 2 | [Application Orchestration (0x000002)](../blueprints/0x000002-application-orchestration.md) | ES6 imports intercepted, served from VFS |
| 3 | [Genesis Snapshots (0x000043)](../blueprints/0x000043-genesis-snapshot-system.md) | Instant rollback to pristine state |
| 4 | [Verification Manager (0x000047)](../blueprints/0x000047-verification-manager.md) | Pre-flight checks in isolated Web Worker |
| 5 | [Arena Gating (0x000075-77)](../blueprints/0x000075-arena-competitor.md) | Multi-model consensus for high-risk changes |
| 6 | [VFSSandbox](../blueprints/0x000075-arena-competitor.md) | Test changes in disposable clone |
| 7 | [Circuit Breakers (0x000067)](../blueprints/0x000067-circuit-breaker-pattern.md) | Prevent runaway failures |
| 8 | [HITL Controller (0x000051)](../blueprints/0x000051-hitl-controller.md) | Human approval gates |

---

## Quick Reference

### What Agents CAN Do
- Read/write VFS files (IndexedDB)
- Create and execute tools in VFS
- Modify their own substrate (with safety gates)
- Spawn sub-workers with restricted permissions
- Call LLM APIs (rate-limited)

### What Agents CANNOT Do
- Access host filesystem
- Execute host binaries
- Make arbitrary network requests
- Access browser APIs directly
- Escape browser sandbox
- Modify Service Worker directly
- Access other browser tabs/origins

---

## Threat Mitigations

| Category | Threats | Mitigation Blueprint |
|----------|---------|----------------------|
| Prompt Injection | Malicious user input | [0x000001](../blueprints/0x000001-system-prompt-architecture.md) |
| Code Injection | `eval()`, dynamic imports | [0x000047](../blueprints/0x000047-verification-manager.md) |
| Resource Exhaustion | Infinite loops, API flooding | [0x000067](../blueprints/0x000067-circuit-breaker-pattern.md), [0x00002C](../blueprints/0x00002C-rate-limiting-strategies.md) |
| Data Exfiltration | Arbitrary fetch | VFS containment, no network access |

---

## Configuration

### Recommended Settings for RSI Experiments

```javascript
localStorage.REPLOID_ARENA_GATING = 'true';      // Require consensus
localStorage.REPLOID_HITL_MODE = 'EVERY_N';      // Periodic checkpoints
localStorage.REPLOID_HITL_N = '5';               // Every 5 steps
localStorage.REPLOID_MAX_ITERATIONS = '50';      // Cap iterations
```

### For Production Use

```javascript
localStorage.REPLOID_HITL_MODE = 'HITL';         // Approve everything
localStorage.REPLOID_ARENA_GATING = 'true';      // Multi-model consensus
localStorage.REPLOID_VERIFICATION = 'strict';    // Block all unsafe patterns
```

---

## Incident Response

1. **Stop agent**: Press Escape or click Stop button
2. **Review audit log**: Check `/.logs/audit/` for recent actions
3. **Restore genesis**: Click "Restore to Genesis" in Snapshots tab
4. **Export session**: Save for analysis before clearing
5. **Clear VFS**: If needed, clear IndexedDB entirely

---

## Detailed Documentation

For implementation details, see:

- **[0x000047: Verification Manager](../blueprints/0x000047-verification-manager.md)** - Complete security integration section
- **[0x000051: HITL Controller](../blueprints/0x000051-hitl-controller.md)** - Human oversight modes
- **[0x000067: Circuit Breaker](../blueprints/0x000067-circuit-breaker-pattern.md)** - Failure isolation
- **[0x000043: Genesis Snapshots](../blueprints/0x000043-genesis-snapshot-system.md)** - Rollback system

---

*Last updated: December 2025*
