# REPLOID Security Model

Security architecture for safe recursive self-improvement research.

---

## Overview

REPLOID is designed to study RSI (recursive self-improvement) without giving agents access to the host operating system. All execution happens in a browser sandbox with multiple containment layers.

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER SANDBOX                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   VFS       │  │ Verification│  │   Circuit   │         │
│  │ (IndexedDB) │  │   Worker    │  │   Breaker   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│         │                │                │                 │
│         ▼                ▼                ▼                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              SAFETY STACK (8 layers)                 │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Containment Layers

### Layer 1: VFS Containment

All file I/O is virtualized via IndexedDB. Agents cannot:
- Access host filesystem
- Read system files
- Execute host binaries
- Modify files outside VFS

```javascript
// All paths are VFS paths, not real paths
await VFS.write('/tools/MyTool.js', code);  // Writes to IndexedDB
await VFS.read('/core/agent-loop.js');       // Reads from IndexedDB
```

### Layer 2: Service Worker Interception

All ES6 module imports are intercepted and served from VFS:

```javascript
// In sw-module-loader.js
self.addEventListener('fetch', (event) => {
  if (isModuleRequest(event.request)) {
    event.respondWith(serveFromVFS(event.request));
  }
});
```

Network requests for modules are blocked. Only VFS content is served.

### Layer 3: Genesis Snapshots

Full VFS state is captured at boot before any agent action:

- Instant rollback to pristine state
- Works fully offline
- Diff viewer shows all changes
- No external dependencies

```javascript
const snapshot = await GenesisSnapshot.capture();
// ... agent makes changes ...
await GenesisSnapshot.restore(snapshot.id);  // Full rollback
```

### Layer 4: Verification Worker

Pre-flight checks run in isolated Web Worker:

| Check | Purpose |
|-------|---------|
| Syntax validation | Catch parse errors before execution |
| Forbidden patterns | Block `eval`, `Function`, `__proto__` |
| Policy violations | Enforce naming conventions |
| Import validation | Verify dependencies exist |

```javascript
// Forbidden patterns (blocked)
eval(userInput);
new Function(code);
obj.__proto__ = malicious;
document.write(html);
```

### Layer 5: Arena Gating

High-risk modifications require consensus from multiple models:

1. Agent proposes change
2. Multiple candidate models evaluate
3. Only verified solutions commit
4. Disagreements block execution

Enable via: `localStorage.REPLOID_ARENA_GATING = 'true'`

### Layer 6: VFS Sandbox

Test changes in disposable clone before committing:

```javascript
const sandbox = await VFSSandbox.create();
await sandbox.apply(proposedChanges);
const valid = await sandbox.verify();
if (!valid) {
  await sandbox.discard();  // Changes never applied
}
```

### Layer 7: Circuit Breakers

Prevent runaway failures:

- Track consecutive failures per tool
- Trip breaker after threshold (default: 3)
- Auto-reset after cooldown
- Emit events for UI warning

```javascript
// Tool fails 3 times → circuit opens
// Further calls return immediately with error
// After 60s → circuit resets to half-open
```

### Layer 8: HITL Controller

Human-in-the-loop approval gates:

| Mode | Behavior |
|------|----------|
| AUTONOMOUS | No approval required |
| HITL | Queue all actions for approval |
| EVERY_N | Checkpoint every N steps |

---

## Permission Model

### Worker Types

Workers (sub-agents) receive filtered tool access:

| Type | Allowed Tools | Use Case |
|------|---------------|----------|
| explore | ReadFile, ListFiles, Grep, Find | Codebase analysis |
| analyze | ReadFile, ListFiles, Grep, Jq | Data processing |
| execute | All tools | Full task execution |

### Tool Categories

| Category | Risk Level | Examples |
|----------|------------|----------|
| Read-only | Low | ReadFile, ListFiles, Grep |
| Write VFS | Medium | WriteFile, CreateTool, Edit |
| Meta/RSI | High | LoadModule, ModifyGoal |
| System | Critical | (none exposed to agent) |

---

## Attack Surface Analysis

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
- Access browser APIs directly (clipboard, notifications)
- Escape browser sandbox
- Modify Service Worker directly
- Access other browser tabs/origins

### Known Limitations

1. **IndexedDB quota**: Large VFS can exhaust quota
2. **Memory pressure**: Complex agents can consume significant RAM
3. **API keys**: If using client-mode, keys are in browser memory
4. **CORS**: Some operations require proxy server

---

## Threat Mitigations

### Prompt Injection

| Threat | Mitigation |
|--------|------------|
| Malicious user input | System prompt isolation |
| Tool output injection | Structured tool responses |
| Context manipulation | Context sanitization |

### Code Injection

| Threat | Mitigation |
|--------|------------|
| eval() in tools | Verification Worker blocks |
| Dynamic imports | Service Worker intercepts |
| Prototype pollution | Pattern detection |

### Resource Exhaustion

| Threat | Mitigation |
|--------|------------|
| Infinite loops | Iteration caps per cycle |
| Memory bloat | Completed worker eviction |
| API flooding | Rate limiter (token bucket) |
| Storage exhaustion | Quota monitoring |

### Data Exfiltration

| Threat | Mitigation |
|--------|------------|
| Arbitrary fetch | No direct network access |
| VFS extraction | Data stays in IndexedDB |
| Key leakage | Proxy mode hides keys |

---

## Audit Logging

All tool executions are logged:

```javascript
// /.logs/audit/YYYY-MM-DD.jsonl
{
  "ts": 1733000000000,
  "tool": "WriteFile",
  "args": { "path": "/tools/MyTool.js" },
  "duration": 45,
  "success": true,
  "workerId": null
}
```

Logs are:
- Append-only (immutable)
- Stored in VFS (survives refresh)
- Exportable for analysis
- Include sanitized arguments

---

## Security Configuration

### Recommended Settings

```javascript
// For maximum safety during RSI experiments
localStorage.REPLOID_ARENA_GATING = 'true';      // Require consensus
localStorage.REPLOID_HITL_MODE = 'EVERY_N';      // Periodic checkpoints
localStorage.REPLOID_HITL_N = '5';               // Every 5 steps
localStorage.REPLOID_MAX_ITERATIONS = '50';      // Cap iterations
```

### For Production Use

```javascript
// Stricter settings
localStorage.REPLOID_HITL_MODE = 'HITL';         // Approve everything
localStorage.REPLOID_ARENA_GATING = 'true';      // Multi-model consensus
localStorage.REPLOID_VERIFICATION = 'strict';    // Block all unsafe patterns
```

---

## Incident Response

### If Agent Behaves Unexpectedly

1. **Stop agent**: Press Escape or click Stop button
2. **Review audit log**: Check /.logs/audit/ for recent actions
3. **Restore genesis**: Click "Restore to Genesis" in Snapshots tab
4. **Export session**: Save for analysis before clearing
5. **Clear VFS**: If needed, clear IndexedDB entirely

### Reporting Security Issues

For security vulnerabilities:
1. Do NOT open a public GitHub issue
2. Email details to security contact
3. Include reproduction steps
4. Allow time for fix before disclosure

---

## Security Checklist

### Before Running Experiments

- [ ] Understand what permissions agent has
- [ ] Enable appropriate HITL mode
- [ ] Verify genesis snapshot captured
- [ ] Know how to stop agent quickly
- [ ] Have audit logging enabled

### Before Deploying

- [ ] Use proxy mode (hide API keys)
- [ ] Set appropriate rate limits
- [ ] Enable arena gating for RSI
- [ ] Configure HITL checkpoints
- [ ] Review tool allowlists

---

## References

- [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) - Full architecture details
- [blueprints/0x000022-confirmation-modal-safety.md](../dreamer/reploid/blueprints/0x000022-confirmation-modal-safety.md) - HITL design
- [blueprints/0x000056-verification-worker-sandboxing.md](../dreamer/reploid/blueprints/0x000056-verification-worker-sandboxing.md) - Verification design
- [blueprints/0x000067-circuit-breaker-pattern.md](../dreamer/reploid/blueprints/0x000067-circuit-breaker-pattern.md) - Circuit breaker design

---

*Last updated: December 2025*
