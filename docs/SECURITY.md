# REPLOID Security Model

> Security architecture for safe recursive self-improvement research.

> **Paused research.** Zero and X are a separate research track, paused under the current
> validation boundary ([GOALS.md](../GOALS.md#separate-research-track-zero-and-x)). This page
> describes that work; it is not a product commitment.

**Foundational thesis:** Constraints aren't limitations; they're the engine that makes browser-native RSI work. The browser sandbox, VFS containment, and graduated gates create stable pressure toward compact, efficient self-modifications.

This document provides a high-level overview of REPLOID's security model. For coordinator, WebSocket signaling, UDP/TURN relay, and serving-computer wire visibility across live inference routes, see [Wire Visibility: Who Can Read What](./wire-visibility.md). For detailed implementation specifications, see the referenced blueprints.

Current defaults are intentionally permissive for experimentation: `REPLOID_SECURITY_MODE` defaults to `'off'` and `REPLOID_ARENA_GATING` defaults to `'false'`. Enable them explicitly for substrate-modification experiments.

---

## RSI Level Policy

The levels are defined in [RSI-LEVELS.md](./RSI-LEVELS.md). This section covers only their gates:

| Level | Mode | Gate |
|-------|------|------|
| **L0** | AUTONOMOUS | Verification Worker sandbox |
| **L1** | AUTONOMOUS | Verification Worker sandbox (VFSSandbox + VerificationManager) |
| **L2** | AUTONOMOUS | Verification Worker sandbox + GenesisSnapshot rollback |
| **L3** | GOVERNED | Signed improvement episode + protected evaluator + paired evaluation + generation rollback + explicit promotion |
| **L4** | N/A | N/A |

Gating is enforced via automated verification and rollback:
- The Verification Worker sandbox for L1 changes: the candidate is applied to a
  disposable `VFSSandbox` snapshot and checked by `VerificationManager` in an
  isolated Worker
- The same Verification Worker sandbox plus GenesisSnapshot rollback for L2
  changes
- Signed `rsi.improvement-episode/v1` evidence, protected evaluator authority,
  paired raw observations, explicit promotion, and generation rollback for L3
  claims
- Circuit breakers prevent runaway failures

The sandbox gate fails closed. A missing verifier or sandbox, a thrown error, a
timeout, a skipped result, or any result other than an explicit pass blocks the
write or load. A blocked core write is audited as `CORE_WRITE_BLOCKED`, and a
core write is recorded as verified only after an explicit pass. `REPLOID_ARENA_GATING` is the switch that requires this
sandbox gate for `/core/` and `/infrastructure/` writes and, with
`REPLOID_SECURITY_MODE` on, for critical-path module loads.
Despite its name it does not run Arena competitions. `WriteFile`'s VFS write
policy currently refuses `/core/` and `/infrastructure/` paths before this gate.

Arena scoring ([Arena Harness](../self/blueprints/0x000066-arena-harness.md)) ranks
candidates and grants no activation or adoption permission. Arena success,
mutation logs, telemetry, saved reflection, or a rising fitness number does not
establish L3 improvement. See
[RSI improvement episodes](./rsi-improvement-episodes.md).

---

## Overview

REPLOID studies RSI (recursive self-improvement) without giving agents access to the underlying operating system. All execution happens in a browser sandbox with multiple containment layers.

---

## 9-Layer Containment Stack

| Layer | Blueprint | Description |
|-------|-----------|-------------|
| 1 | [VFS (0x000011)](../self/blueprints/0x000011-advanced-storage-backend-indexeddb.md) | All I/O virtualized via IndexedDB |
| 2 | [Application Orchestration (0x000002)](../self/blueprints/0x000002-application-orchestration.md) | ES module boot and VFS hydration |
| 3 | [Genesis Snapshots (0x00003C)](../self/blueprints/0x00003C-genesis-snapshot-system.md) | Instant rollback to pristine state |
| 4 | [Verification Manager (0x000040)](../self/blueprints/0x000040-verification-manager.md) | Pre-flight checks in isolated Web Worker |
| 5 | [Arena Harness (0x000066)](../self/blueprints/0x000066-arena-harness.md) | Multi-model comparison and scoring; grants no activation |
| 6 | VFSSandbox | Test changes in a disposable clone before commit |
| 7 | [Circuit Breakers (0x00005C)](../self/blueprints/0x00005C-circuit-breaker-pattern.md) | Prevent runaway failures |
| 8 | [HITL Controller (0x000049)](../self/blueprints/0x000049-hitl-controller.md) | Optional approval gates |
| 9 | [Improvement Episode Ledger](./rsi-improvement-episodes.md) | Signed causal record, evaluator separation, metric threshold, generation ancestry, and promotion replay |

---

## Quick Reference

### What Agents CAN Do
- Read/write VFS files (IndexedDB)
- Create and execute tools in VFS
- Modify their own substrate (with gates)
- Spawn sub-workers with restricted permissions
- Call LLM APIs (rate-limited)

### What Agents CANNOT Do
- Access the underlying filesystem
- Execute operating-system binaries
- Make arbitrary network requests
- Access browser APIs directly
- Escape browser sandbox
- Modify Service Worker directly
- Access unrelated browser tabs/origins directly outside swarm transport

---

## Sponsored Inference (proposed, not implemented)

[Blueprint 0x00007E](../self/blueprints/0x00007E-sponsor-peer-protocol.md) proposes a peer-to-peer
free tier: a shared demo Gemini key split across small custody committees, released to one
executor per request after quorum, with per-peer quotas. It is not built. The blueprint is
`In-Progress` and its planned modules (`community-key.js`, `gemini-relay.js`,
`peer-identity.js`) do not exist, so no peer can request or serve sponsored inference and no
agent has a network exception for it. The blueprint holds the proposed trust model, scaling
rules, quotas and limitations.

The access-window mechanism in `self/cloud-access.js` is separate; it ships with no windows.

---

## Threat Mitigations

| Category | Threats | Mitigation Blueprint |
|----------|---------|----------------------|
| Prompt Injection | Malicious user input | [0x000001](../self/blueprints/0x000001-system-prompt-architecture.md) |
| Code Injection | `eval()`, dynamic imports | [0x000040](../self/blueprints/0x000040-verification-manager.md) |
| Resource Exhaustion | Infinite loops, API flooding | [0x00005C](../self/blueprints/0x00005C-circuit-breaker-pattern.md), [0x000029](../self/blueprints/0x000029-rate-limiting-strategies.md) |
| Data Exfiltration | Arbitrary fetch | VFS containment, no network access |

---

## Configuration

### Recommended Settings for RSI Experiments

```javascript
localStorage.REPLOID_ARENA_GATING = 'true';      // Require the Verification Worker sandbox for core writes
localStorage.REPLOID_MAX_ITERATIONS = '50';      // Cap iterations
```

### For Production Use

```javascript
localStorage.REPLOID_ARENA_GATING = 'true';      // Require the Verification Worker sandbox for core writes
localStorage.REPLOID_SECURITY_MODE = 'on';       // Enable security enforcement
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

- **[0x000040: Verification Manager](../self/blueprints/0x000040-verification-manager.md)** - Complete security integration section
- **[0x000049: HITL Controller](../self/blueprints/0x000049-hitl-controller.md)** - Human oversight modes
- **[0x00005C: Circuit Breaker](../self/blueprints/0x00005C-circuit-breaker-pattern.md)** - Failure isolation
- **[0x00003C: Genesis Snapshots](../self/blueprints/0x00003C-genesis-snapshot-system.md)** - Rollback system
- **[0x00007E: Sponsor-Peer Protocol](../self/blueprints/0x00007E-sponsor-peer-protocol.md)** - Proposed P2P free tier (not implemented)

---

*Last updated: November 2026*
