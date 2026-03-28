# REPLOID Security Model

> Security architecture for safe recursive self-improvement research.

**Foundational thesis:** Constraints aren't limitations; they're the engine that makes browser-native RSI work. The browser sandbox, VFS containment, and graduated gates create stable pressure toward compact, efficient self-modifications.

This document provides a high-level overview of REPLOID's security model. For detailed implementation specifications, see the referenced blueprints.

Current defaults are intentionally permissive for experimentation: `REPLOID_SECURITY_MODE` defaults to `'off'` and `REPLOID_ARENA_GATING` defaults to `'false'`. Enable them explicitly for substrate-modification experiments.

---

## RSI Level Policy

Graduated operation with automated gates:

| Level | Scope | Mode | Gate |
|-------|-------|------|------|
| **L0** | Basic Functions (CreateTool, Web APIs, new tools) | AUTONOMOUS | Verification Worker sandbox |
| **L1** | Meta Tooling (modify tool-writer, improve CreateTool) | AUTONOMOUS | Arena consensus |
| **L2** | Self-Modification (Substrate) (edit core modules, runtime patches) | AUTONOMOUS | Arena + GenesisSnapshot rollback |
| **L3** | Weak RSI (Iterative) (bounded feedback loops, self-improvement) | AUTONOMOUS | Arena + GenesisSnapshot rollback + iteration caps |
| **L4** | Weak AGI (broad autonomous planning, system-building, self-directed experimentation) | N/A | N/A |

Gating is enforced via automated verification and rollback:
- Arena consensus for L1 changes
- Arena + GenesisSnapshot rollback for L2 changes
- Arena + GenesisSnapshot rollback + iteration caps for L3 changes
- Circuit breakers prevent runaway failures

---

## Overview

REPLOID studies RSI (recursive self-improvement) without giving agents access to the underlying operating system. All execution happens in a browser sandbox with multiple containment layers.

---

## 8-Layer Containment Stack

| Layer | Blueprint | Description |
|-------|-----------|-------------|
| 1 | [VFS (0x000011)](../src/blueprints/0x000011-advanced-storage-backend-indexeddb.md) | All I/O virtualized via IndexedDB |
| 2 | [Application Orchestration (0x000002)](../src/blueprints/0x000002-application-orchestration.md) | ES module boot and VFS hydration |
| 3 | [Genesis Snapshots (0x00003C)](../src/blueprints/0x00003C-genesis-snapshot-system.md) | Instant rollback to pristine state |
| 4 | [Verification Manager (0x000040)](../src/blueprints/0x000040-verification-manager.md) | Pre-flight checks in isolated Web Worker |
| 5 | [Arena Harness (0x000066)](../src/blueprints/0x000066-arena-harness.md) | Multi-model consensus for high-risk changes |
| 6 | VFSSandbox | Test changes in a disposable clone before commit |
| 7 | [Circuit Breakers (0x00005C)](../src/blueprints/0x00005C-circuit-breaker-pattern.md) | Prevent runaway failures |
| 8 | [HITL Controller (0x000049)](../src/blueprints/0x000049-hitl-controller.md) | Optional approval gates |

---

## Quick Reference

### What Agents CAN Do
- Read/write VFS files (IndexedDB)
- Create and execute tools in VFS
- Modify their own substrate (with gates)
- Spawn sub-workers with restricted permissions
- Call LLM APIs (rate-limited)
- Request sponsored inference from swarm sponsor peers (free tier)

### What Agents CANNOT Do
- Access the underlying filesystem
- Execute operating-system binaries
- Make arbitrary network requests (except scoped Gemini calls by sponsor peers)
- Access browser APIs directly
- Escape browser sandbox
- Modify Service Worker directly
- Access unrelated browser tabs/origins directly outside swarm transport

---

## Sponsored Inference (Free Tier)

Reploid supports a pure P2P free tier where opted-in peers form small custody committees for one or more shared demo Gemini keys. This enables zero-install, zero-config demo usage without backend key custody.

See [Blueprint 0x0000e1: Sponsor-Peer Protocol](../src/blueprints/0x0000e1-sponsor-peer-protocol.md) for the canonical specification. The blueprint is the source of truth for topology, routing, quotas, and scaling. This section summarizes policy only.

### Trust Model

This is a flat swarm with dynamic sponsor roles, not a permanent privileged class:

| Role | Holds Full Key At Rest | Holds Shares | Makes API Calls |
|------|------------------------|--------------|-----------------|
| **Requester** | No | No | No |
| **Custodian** | No | Yes | No |
| **Executor** | No | Optional | Yes (scoped to Gemini) |

- Shared keys are split into shares and distributed across small committees
- No peer stores the full Gemini key at rest
- Requesters never see the full key
- Executors reconstruct a key in memory only after quorum, then zeroize
- Quotas are enforced per peer identity and per key bucket
- Peers hold a persistent ECDSA P-256 identity keypair (Web Crypto API, stored in IndexedDB)
- Peer ID = SHA-256 fingerprint of public key

### Scaling Policy

Sponsored inference must follow these scaling rules:

- Keep custody committees small: `3-10` peers
- Never split one shared key across the whole swarm
- Scale capacity by adding key buckets, not by adding more custodians to one key
- Route requesters to a key bucket, not to the full swarm
- Isolate failure domains per key bucket

### Network Exception

Authorized executors are granted a **scoped network exception** to the "no arbitrary network requests" rule:

- **Scope**: HTTPS calls to `generativelanguage.googleapis.com` only
- **Trigger**: Only in response to a valid, signed lease and quorum-backed share release
- **Constraint**: Only allowlisted demo models and bounded sponsored-mode quotas
- **Audit**: All forwarded requests logged with peer ID, key ID, token count, timestamp

This is not a general network hole. The exception is:
1. Scoped to a single API endpoint
2. Gated behind sponsor opt-in and committee quorum
3. Metered per peer identity
4. Constrained to the weakest model tier

### Quota Enforcement

Quota enforcement is keyed by public-key fingerprint and key bucket.

Default demo quotas, lease limits, and stream limits are defined in the blueprint. Security policy requires that sponsored inference remain bounded, low-priority, and separately metered from BYOK or local inference.

### Sponsored Mode Constraints

Sponsored inference is intentionally limited:

- Flash Lite tier only
- Low max output tokens
- Slower queue priority
- Small daily quota
- No long context
- No batch jobs
- No arena / heavy self-improvement paths
- Small custody committees only
- Capacity scales by adding more shared keys, not more custodians per key

### Upgrade Nudges

| Usage | Action |
|-------|--------|
| 50% | Show usage meter in UI |
| 80% | "Add your own Gemini key for full speed" prompt |
| 100% | Hard stop. Offer: BYOK, local Doppler, or wait for sponsor refill |

### Limitations (Explicit)

This is soft enforcement for a demo tier, not a secure production secret:

- **Sybil identities**: A peer can generate new keypairs. Mitigate with per-key quotas and sponsor-side heuristics.
- **Executor compromise**: A malicious executor can abuse a reconstructed key in memory. Mitigate with short-lived leases, scoped model restrictions, key rotation, and monitoring.
- **Replay attacks**: Signed leases require expiry timestamps and nonces.
- **No backend authority**: Without a server, there is no single source of truth for quota state. Executors gossip usage receipts for soft consistency.
- **No global Shamir mesh**: A single shared key must never be split across a large open swarm. Scaling comes from multiple key buckets with small committees.

The right product framing is sponsored serverless demo capacity, not a secure shared-production secret.

---

## Threat Mitigations

| Category | Threats | Mitigation Blueprint |
|----------|---------|----------------------|
| Prompt Injection | Malicious user input | [0x000001](../src/blueprints/0x000001-system-prompt-architecture.md) |
| Code Injection | `eval()`, dynamic imports | [0x000040](../src/blueprints/0x000040-verification-manager.md) |
| Resource Exhaustion | Infinite loops, API flooding | [0x00005C](../src/blueprints/0x00005C-circuit-breaker-pattern.md), [0x000029](../src/blueprints/0x000029-rate-limiting-strategies.md) |
| Data Exfiltration | Arbitrary fetch | VFS containment, no network access |
| Sponsor Key Abuse | Sybil peers, quota bypass | [0x0000e1](../src/blueprints/0x0000e1-sponsor-peer-protocol.md) - signed leases, per-key quotas, sharded key buckets |
| Sponsor Compromise | Malicious executor/custodian | Short-lived leases, committee quorum, key rotation, monitoring |

---

## Configuration

### Recommended Settings for RSI Experiments

```javascript
localStorage.REPLOID_ARENA_GATING = 'true';      // Require consensus
localStorage.REPLOID_MAX_ITERATIONS = '50';      // Cap iterations
```

### For Production Use

```javascript
localStorage.REPLOID_ARENA_GATING = 'true';      // Multi-model consensus
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

- **[0x000040: Verification Manager](../src/blueprints/0x000040-verification-manager.md)** - Complete security integration section
- **[0x000049: HITL Controller](../src/blueprints/0x000049-hitl-controller.md)** - Human oversight modes
- **[0x00005C: Circuit Breaker](../src/blueprints/0x00005C-circuit-breaker-pattern.md)** - Failure isolation
- **[0x00003C: Genesis Snapshots](../src/blueprints/0x00003C-genesis-snapshot-system.md)** - Rollback system
- **[0x0000e1: Sponsor-Peer Protocol](../src/blueprints/0x0000e1-sponsor-peer-protocol.md)** - P2P free tier inference

---

*Last updated: March 2026*
